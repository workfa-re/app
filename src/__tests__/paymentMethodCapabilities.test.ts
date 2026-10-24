import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ requirePaymentProvider: vi.fn() }));
const repository = vi.hoisted(() => ({ getPaymentSettingsSnapshot: vi.fn(), getPaymentCustomer: vi.fn() }));
vi.mock("@/lib/payments/service.server", () => auth);
vi.mock("@/lib/payments/repository.server", () => repository);
import { getBuyerPaymentMethods } from "@/lib/payments/method-capabilities.server";
import { GET } from "@/app/api/payments/methods/route";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

const userId = "11111111-1111-4111-8111-111111111111";
const origin = "http://localhost:3001";
const request = (query = "", headers: Record<string, string> = {}) => new Request(`${origin}/api/payments/methods${query}`, { headers });
beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-method-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", APP_ORIGIN: origin, STRIPE_SECRET_KEY: "sk_test_offlineFixture" })) vi.stubEnv(key, value);
    auth.requirePaymentProvider.mockResolvedValue(userId);
    repository.getPaymentSettingsSnapshot.mockResolvedValue({ kind: "sandbox", featureEnabled: true, buyerReady: true });
    repository.getPaymentCustomer.mockResolvedValue({ userId, mode: "sandbox", stripeCustomerId: "cus_private", method: { id: "pm_private", kind: "card" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("owner-bound payment method availability", () => {
    it("reads only the authenticated provider and exposes no PSP references or collection-readiness claim", async () => {
        const result = await getBuyerPaymentMethods();
        expect(repository.getPaymentSettingsSnapshot).toHaveBeenCalledExactlyOnceWith(userId);
        expect(repository.getPaymentCustomer).toHaveBeenCalledExactlyOnceWith(userId, "sandbox");
        expect(result).toMatchObject({ version: "buyer-methods-v1", kind: "sandbox", livePaymentsEnabled: false, selectedMethod: "card" });
        expect(result.methods[0]).toMatchObject({ setupEnabled: true, availability: "available", flow: "authorize_then_capture", manualCaptureSupported: true });
        for (const field of ["cus_private", "pm_private", userId, "sk_test", "buyerReady"]) expect(JSON.stringify(result)).not.toContain(field);
    });

    it("enables actual live card setup independently from publication gates", async () => {
        for (const [key,value] of Object.entries({WORKFARE_PAY_MODE:"live", WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_fixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""})) vi.stubEnv(key,value);
        repository.getPaymentSettingsSnapshot.mockResolvedValue({kind:"live",featureEnabled:false,setupEnabled:true});
        repository.getPaymentCustomer.mockResolvedValue({userId,mode:"live",method:{kind:"card"}});
        expect(await getBuyerPaymentMethods()).toMatchObject({kind:"live",livePaymentsEnabled:true,selectedMethod:"card",methods:[{setupEnabled:true},{setupEnabled:false}]});
    });

    it("keeps SEPA explicitly unavailable even if an unrecognized environment flag requests it", async () => {
        vi.stubEnv("WORKFARE_PAY_SEPA_ENABLED", "true");
        const result = await getBuyerPaymentMethods();
        expect(result.methods[1]).toEqual({ type: "sepa_debit", label: "SEPA-Lastschrift", setupEnabled: false, availability: "not_available",
            flow: "async_debit_after_service", manualCaptureSupported: false, reasonCode: "sepa_async_collection_unavailable" });
    });

    it.each([{ kind: "disabled", featureEnabled: false }, { kind: "sandbox", featureEnabled: false }, { kind: "local", featureEnabled: true }])
    ("does not query private references or enable setup outside the actual owner rollout (%j)", async snapshot => {
        repository.getPaymentSettingsSnapshot.mockResolvedValue(snapshot);
        const result = await getBuyerPaymentMethods();
        expect(result.selectedMethod).toBeNull();
        expect(result.methods[0]).toMatchObject({ setupEnabled: false, availability: "not_enabled" });
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();
    });

    it("distinguishes a local simulation from an actual card and tolerates no existing method", async () => {
        repository.getPaymentCustomer.mockResolvedValue(null);
        expect((await getBuyerPaymentMethods()).selectedMethod).toBeNull();
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        repository.getPaymentSettingsSnapshot.mockResolvedValue({ kind: "local", featureEnabled: true });
        repository.getPaymentCustomer.mockResolvedValue({ userId, mode: "local_simulation", method: { kind: "simulated" } });
        expect(await getBuyerPaymentMethods()).toMatchObject({ kind: "local", selectedMethod: "simulated", livePaymentsEnabled: false });
    });

    it.each([{ userId: "someone-else", mode: "sandbox" }, { userId, mode: "local_simulation" }])("rejects substituted customer ownership (%j)", async patch => {
        repository.getPaymentCustomer.mockResolvedValue({ ...patch, method: { kind: "card" } });
        await expect(getBuyerPaymentMethods()).rejects.toMatchObject({ code: "owner_mismatch", status: 403 });
    });

    it.each(["sepa_debit", "simulated", null])("rejects an incompatible stored sandbox method (%j)", async kind => {
        repository.getPaymentCustomer.mockResolvedValue({ userId, mode: "sandbox", method: { kind } });
        await expect(getBuyerPaymentMethods()).rejects.toMatchObject({ code: "payment_method_unavailable" });
    });

    it.each([["authentication_required", 401], ["provider_account_required", 403]] as const)("authenticates before any financial read (%s)", async (code, status) => {
        auth.requirePaymentProvider.mockRejectedValue(new PaymentFlowError(code, status));
        expect((await GET(request())).status).toBe(status);
        expect(repository.getPaymentSettingsSnapshot).not.toHaveBeenCalled();
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();
    });

    it("returns a noncached response without allowing browser-selected customer/owner IDs", async () => {
        const response = await GET(request("", { origin, "sec-fetch-site": "same-origin" }));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        for (const query of ["?userId=other", "?customerId=cus_other", "?paymentMethod=sepa_debit"]) expect((await GET(request(query))).status).toBe(400);
        expect(auth.requirePaymentProvider).toHaveBeenCalledOnce();
    });

    it.each<Record<string, string>>([{ origin: "https://other.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])
    ("rejects cross-origin reads before authentication (%j)", async headers => {
        expect((await GET(request("", headers))).status).toBe(403);
        expect(auth.requirePaymentProvider).not.toHaveBeenCalled();
    });

    it("rejects an alternate request host, disabled runtime and hosted demo before auth", async () => {
        expect((await GET(new Request("http://127.0.0.1:3001/api/payments/methods", { headers: { origin } }))).status).toBe(403);
        vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
        expect((await GET(request())).status).toBe(503);
        vi.stubEnv("WORKFARE_PAY_MODE", "sandbox"); vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
        expect((await GET(request())).status).toBe(503);
        expect(auth.requirePaymentProvider).not.toHaveBeenCalled();
    });

    it("sanitizes unexpected errors and keeps failure responses noncached", async () => {
        repository.getPaymentSettingsSnapshot.mockRejectedValue(new Error("cus_private person@example.test sk_test_private"));
        const response = await GET(request());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        for (const secret of ["cus_private", "person@example.test", "sk_test_private"]) expect(await response.clone().text()).not.toContain(secret);
    });
});
