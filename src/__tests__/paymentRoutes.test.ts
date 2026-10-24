import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const service = vi.hoisted(() => ({
    startPaymentSetup: vi.fn(), finishLocalPaymentSetup: vi.fn(), removeBuyerPaymentMethod: vi.fn(), retryBuyerPaymentMethodRemoval: vi.fn(),
    syncPaymentSetupReturn: vi.fn(), requirePaymentProvider: vi.fn(), handlePaymentWebhook: vi.fn(),
}));
vi.mock("@/lib/payments/service.server", () => service);
import { POST as start } from "@/app/api/payments/setup/route";
import { POST as finish } from "@/app/api/payments/local/setup/route";
import { POST as remove } from "@/app/api/payments/method/remove/route";
import { POST as retryRemoval } from "@/app/api/payments/method/retry-removal/route";
import { POST as sync } from "@/app/api/payments/setup/sync/route";
import { POST as webhook } from "@/app/api/payments/webhook/route";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

const origin = "http://127.0.0.1:3000";
function request(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return new Request(`${origin}/api/payments/${path}`, { method: "POST", headers: {
        origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-workfare-owner":"11111111-1111-4111-8111-111111111111", ...headers,
    }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => {
    vi.resetAllMocks();
    const environment = { WORKFARE_PAY_MODE: "local_simulation", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: origin };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    service.startPaymentSetup.mockResolvedValue({ url: "/app-home/settings/payments/setup?session_id=fixture" });
    service.finishLocalPaymentSetup.mockResolvedValue({ url: "/app-home/settings/payments" });
    service.removeBuyerPaymentMethod.mockResolvedValue({ ok: true });
    service.retryBuyerPaymentMethodRemoval.mockResolvedValue({ ok: true, pendingRemoval: false });
    service.requirePaymentProvider.mockResolvedValue("verified-user");
    service.syncPaymentSetupReturn.mockResolvedValue({ status: "pending", returnTo: null });
    service.handlePaymentWebhook.mockResolvedValue({ received: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("Workfare Pay mutation routes", () => {
    it("keeps disabled mode closed before touching the payment service", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
        expect((await start(request("setup", { consent: true }))).status).toBe(503);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
    });

    it.each([start, finish, remove, retryRemoval, sync])("rejects cross-origin requests before any service mutation", async (handler) => {
        expect((await handler(request("setup", {}, { origin: "https://evil.example" }))).status).toBe(403);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
        expect(service.finishLocalPaymentSetup).not.toHaveBeenCalled();
        expect(service.removeBuyerPaymentMethod).not.toHaveBeenCalled();
        expect(service.retryBuyerPaymentMethodRemoval).not.toHaveBeenCalled();
        expect(service.syncPaymentSetupReturn).not.toHaveBeenCalled();
    });

    it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp"])("rejects unsafe/incorrect media type %s", async (type) => {
        expect((await start(request("setup", {}, { "content-type": type }))).status).toBe(415);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
    });

    it.each(["{broken", "[]", "null", '{"consent":true,"userId":"victim"}', '{"consent":true,"customerId":"cus_victim"}',
        '{"consent":true,"email":"someone-else@example.com"}', '{"consent":true,"customer_email":"someone-else@example.com"}'])
    ("rejects malformed bodies and client-owned identity fields (%s)", async (body) => {
        expect((await start(request("setup", body))).status).toBe(400);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
    });

    it("bounds streamed JSON input regardless of the content-length header", async () => {
        const response = await start(request("setup", `{"returnTo":"${"x".repeat(5_000)}"}`, { "content-length": "1" }));
        expect(response.status).toBe(413);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
    });

    it("forwards only explicit setup fields and the opaque idempotency key", async () => {
        const response = await start(request("setup", { consent: true, returnTo: "/app-home/offers/new?resume=payment" }, { "idempotency-key": "operation-fixture" }));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.startPaymentSetup).toHaveBeenCalledWith({ consent: true, returnTo: "/app-home/offers/new?resume=payment", operationId: "operation-fixture" });
    });

    it("forwards the optional method selection to server validation without accepting PSP references", async () => {
        const response = await start(request("setup", { consent: true, paymentMethod: "card" }));
        expect(response.status).toBe(200);
        expect(service.startPaymentSetup).toHaveBeenCalledWith({ consent: true, returnTo: undefined, paymentMethod: "card", operationId: undefined });
        service.startPaymentSetup.mockRejectedValue(new PaymentFlowError("sepa_async_collection_unavailable", 409));
        const unavailable = await start(request("setup", { consent: true, paymentMethod: "sepa_debit" }));
        expect(unavailable.status).toBe(409);
        expect(await unavailable.json()).toMatchObject({ code: "sepa_async_collection_unavailable" });
    });

    it("keeps the embedded secret in the no-store JSON response and accepts no browser-owned identity", async () => {
        const result = { kind: "embedded", sessionId: "internal-fixture", clientSecret: "cs_test_fixture_secret_fixture", publishableKey: "pk_test_fixture" };
        service.startPaymentSetup.mockResolvedValue(result);
        const response = await start(request("setup", { consent: true, uiMode: "embedded" }));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(result);
        expect(service.startPaymentSetup).toHaveBeenCalledWith({ consent: true, returnTo: undefined, uiMode: "embedded", operationId: undefined });
        service.startPaymentSetup.mockClear();
        const injected = await start(request("setup", { consent: true, uiMode: "embedded", customerId: "cus_someoneElse" }));
        expect(injected.status).toBe(400);
        expect(service.startPaymentSetup).not.toHaveBeenCalled();
    });

    it("accepts only supported simulation outcomes and never accepts card inputs", async () => {
        expect((await finish(request("local/setup", { sessionId: "fixture", outcome: "complete" }))).status).toBe(200);
        expect(service.finishLocalPaymentSetup).toHaveBeenCalledWith("fixture", "complete");
        service.finishLocalPaymentSetup.mockClear();
        for (const body of [{ sessionId: "fixture", outcome: "approved" }, { sessionId: "fixture", outcome: "complete", cardNumber: "do-not-accept-card-data" }]) {
            expect((await finish(request("local/setup", body))).status).toBe(400);
        }
        expect(service.finishLocalPaymentSetup).not.toHaveBeenCalled();
    });

    it("uses the verified actor for return sync and accepts no target method in removal", async () => {
        expect((await sync(request("setup/sync", { sessionId: "fixture" }))).status).toBe(200);
        expect(service.syncPaymentSetupReturn).toHaveBeenCalledWith("verified-user", "fixture");
        expect((await remove(request("method/remove", { methodId: "pm_other" }))).status).toBe(400);
        expect(service.removeBuyerPaymentMethod).not.toHaveBeenCalled();
        expect((await remove(request("method/remove"))).status).toBe(200);
    });

    it("routes a cleanup retry separately from removal and accepts no client method reference", async () => {
        const response = await retryRemoval(request("method/retry-removal"));
        expect(await response.json()).toEqual({ ok: true, pendingRemoval: false });
        expect(service.retryBuyerPaymentMethodRemoval).toHaveBeenCalledOnce();
        expect(service.removeBuyerPaymentMethod).not.toHaveBeenCalled();
        service.retryBuyerPaymentMethodRemoval.mockClear();
        expect((await retryRemoval(request("method/retry-removal", { methodId: "pm_injected" }))).status).toBe(400);
        expect(service.retryBuyerPaymentMethodRemoval).not.toHaveBeenCalled();
    });

    it("sanitizes unexpected provider errors without leaking IDs, keys or contact data", async () => {
        service.startPaymentSetup.mockRejectedValue(new Error("cus_private sk_test_private person@example.com"));
        const response = await start(request("setup", { consent: true }));
        expect(response.status).toBe(503);
        const text = await response.text();
        for (const secret of ["cus_private", "sk_test_private", "person@example.com"]) expect(text).not.toContain(secret);
    });
});

describe("raw signed webhook route", () => {
    it("rejects a missing signature before invoking the service", async () => {
        expect((await webhook(request("webhook", "raw"))).status).toBe(400);
        expect(service.handlePaymentWebhook).not.toHaveBeenCalled();
    });

    it("preserves payload bytes without JSON parsing and does not require browser CSRF headers", async () => {
        const raw = '{ "id": "evt_fixture", "data": {"object": {}} }\n';
        const req = new Request(`${origin}/api/payments/webhook`, { method: "POST", headers: { "stripe-signature": "signed-fixture" }, body: raw });
        expect((await webhook(req)).status).toBe(200);
        expect(service.handlePaymentWebhook).toHaveBeenCalledWith(raw, "signed-fixture");
    });

    it("returns signature failures as 400 and transient application failures as retryable 503", async () => {
        service.handlePaymentWebhook.mockRejectedValueOnce(new PaymentFlowError("invalid_webhook_signature", 400));
        expect((await webhook(request("webhook", "raw", { "stripe-signature": "invalid" }))).status).toBe(400);
        service.handlePaymentWebhook.mockRejectedValueOnce(new Error("private storage details"));
        expect((await webhook(request("webhook", "raw", { "stripe-signature": "valid" }))).status).toBe(503);
    });
});
