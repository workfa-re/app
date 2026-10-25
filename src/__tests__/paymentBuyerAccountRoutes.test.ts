import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const service = vi.hoisted(() => ({ getBuyerAccountOverview: vi.fn(), updateBuyerBillingDetails: vi.fn() }));
vi.mock("@/lib/payments/buyer-account.server", () => service);
import { GET } from "@/app/api/payments/account/route";
import { POST } from "@/app/api/payments/account/billing/route";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

const origin = "http://127.0.0.1:3000";
function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request(`${origin}/api/payments/account/billing`, { method: "POST", headers: {
        origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-workfare-owner":"11111111-1111-4111-8111-111111111111", ...headers,
    }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "local_simulation", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: origin })) vi.stubEnv(key, value);
    service.getBuyerAccountOverview.mockResolvedValue({ kind: "local", history: { state: "local_simulation", payments: [], invoices: [] } });
    service.updateBuyerBillingDetails.mockResolvedValue({ ok: true, billing: {} });
});
afterEach(() => vi.unstubAllEnvs());

describe("private buyer account routes", () => {
    it("returns only a no-store owner-bound snapshot without accepting identifiers", async () => {
        const response = await GET(new Request(`${origin}/api/payments/account`,{headers:{"x-workfare-owner":"11111111-1111-4111-8111-111111111111"}}));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.getBuyerAccountOverview).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
        expect((await GET(new Request(`${origin}/api/payments/account?customerId=cus_other`))).status).toBe(400);
        expect(service.getBuyerAccountOverview).toHaveBeenCalledOnce();
    });

    it.each<Record<string, string>>([{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }])("rejects cross-site financial reads (%j)", async (headers) => {
        const response = await GET(new Request(`${origin}/api/payments/account`, { headers }));
        expect(response.status).toBe(403);
        expect(service.getBuyerAccountOverview).not.toHaveBeenCalled();
    });

    it("keeps reads and mutations disabled outside the local payment runtime", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
        expect((await GET(new Request(`${origin}/api/payments/account`,{headers:{"x-workfare-owner":"11111111-1111-4111-8111-111111111111"}}))).status).toBe(503);
        expect((await POST(post({}))).status).toBe(503);
        expect(service.getBuyerAccountOverview).not.toHaveBeenCalled();
        expect(service.updateBuyerBillingDetails).not.toHaveBeenCalled();
    });

    it("forwards only explicit billing fields and the opaque operation key", async () => {
        const input = { address: { line1: "Musterweg 4", city: "Rheinbach", postalCode: "53359", country: "DE" } };
        const response = await POST(post(input, { "idempotency-key": "22222222-2222-4222-8222-222222222222" }));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.updateBuyerBillingDetails).toHaveBeenCalledWith(input, "22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111");
    });

    it.each([
        {},
        { address: null },
    ])("preserves the distinction between an omitted and explicitly removed invoice address (%j)", async input => {
        expect((await POST(post(input))).status).toBe(200);
        expect(service.updateBuyerBillingDetails).toHaveBeenCalledWith(input, undefined, "11111111-1111-4111-8111-111111111111");
    });

    it.each(['{"customerId":"cus_other"}', "[]", "null", "{broken"])("rejects malformed or injected input %s", async (body) => {
        expect((await POST(post(body))).status).toBe(400);
        expect(service.updateBuyerBillingDetails).not.toHaveBeenCalled();
    });

    it("bounds JSON and rejects cross-origin writes before invoking the account service", async () => {
        expect((await POST(post({ name: "x".repeat(5_000) }))).status).toBe(413);
        expect((await POST(post({}, { origin: "https://evil.example" }))).status).toBe(403);
        expect((await POST(post({}, { "content-type": "text/plain" }))).status).toBe(415);
        expect(service.updateBuyerBillingDetails).not.toHaveBeenCalled();
    });

    it("preserves authentication status without leaking provider or contact details", async () => {
        service.getBuyerAccountOverview.mockRejectedValueOnce(new PaymentFlowError("authentication_required", 401));
        expect((await GET(new Request(`${origin}/api/payments/account`,{headers:{"x-workfare-owner":"11111111-1111-4111-8111-111111111111"}}))).status).toBe(401);
        service.updateBuyerBillingDetails.mockRejectedValueOnce(new Error("cus_private sk_test_private person@example.test"));
        const response = await POST(post({}));
        expect(response.status).toBe(503);
        const body = await response.text();
        for (const secret of ["cus_private", "sk_test_private", "person@example.test"]) expect(body).not.toContain(secret);
    });
});
