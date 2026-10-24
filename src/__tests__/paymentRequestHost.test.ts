import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({ authenticate: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/payments/service.server", () => ({ requirePaymentProvider: calls.authenticate, startPaymentSetup: calls.start }));
vi.mock("@/lib/payments/repository.server", () => ({ getPaymentSettingsSnapshot: calls.start }));
vi.mock("@/lib/payments/recipient-service.server", () => ({ requireRecipientUser: calls.authenticate, startRecipientSession: calls.start }));
vi.mock("@/lib/payments/buyer-account.server", () => ({ getBuyerAccountOverview: calls.authenticate }));
vi.mock("@/lib/payments/method-capabilities.server", () => ({ getBuyerPaymentMethods: calls.authenticate }));
vi.mock("@/lib/payments/recipient-payouts.server", () => ({ getRecipientPayoutOverview: calls.authenticate }));
vi.mock("@/lib/payments/recipient-summary.server", () => ({ getRecipientPaymentSummary: calls.authenticate }));
vi.mock("@/lib/payments/guardian-recipient.server", () => ({ getGuardianRecipientContext: calls.authenticate, refreshGuardianRecipient: calls.authenticate, startGuardianRecipient: calls.authenticate }));
vi.mock("@/lib/payments/recipient-hosted.server", () => ({ refreshHostedRecipient: calls.authenticate, startHostedRecipient: calls.start }));
import { assertPaymentRequestHost, assertPaymentSameOrigin, PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { GET as status } from "@/app/api/payments/status/route";
import { GET as account } from "@/app/api/payments/account/route";
import { GET as methods } from "@/app/api/payments/methods/route";
import { GET as payouts } from "@/app/api/payments/recipient/payouts/route";
import { GET as summary } from "@/app/api/payments/recipient/summary/route";
import { GET as guardian } from "@/app/api/payments/guardian/recipients/route";
import { GET as recipientRefresh } from "@/app/api/payments/recipient/hosted/refresh/route";
import { GET as guardianRefresh } from "@/app/api/payments/guardian/recipients/hosted/refresh/route";
import { POST as setup } from "@/app/api/payments/setup/route";
import { POST as session } from "@/app/api/payments/recipient/session/route";
import { POST as hosted } from "@/app/api/payments/recipient/hosted/route";

const origin = "https://app.workfa.re", owner = "11111111-1111-4111-8111-111111111111";
const environment = { WORKFARE_PAY_MODE: "live", WORKFARE_PAY_LIVE_ENABLED: "enabled", WORKFARE_PAY_LIVE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa", WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT: "acct_fixture", APP_ORIGIN: origin, SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", STRIPE_SECRET_KEY: "sk_live_fixture", PORT: "3000", WORKFARE_DEMO_ENABLED: "false", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "false", WORKFARE_DEMO_MODE: "", WORKFARE_DEMO_PROJECT_REF: "", WORKFARE_DEMO_LOCAL_URL: "" };
const proxy = { host: "app.workfa.re", "x-forwarded-host": "app.workfa.re", "x-forwarded-proto": "https", "x-forwarded-port": "443" };
const runtime = () => requirePaymentRuntime(environment);
function request(url = "http://0.0.0.0:3000/api/payments/status", headers: Record<string, string> = {}) {
    return new Request(url, { headers: { ...proxy, ...headers } });
}
beforeEach(() => {
    vi.resetAllMocks();
    Object.entries(environment).forEach(([name, value]) => vi.stubEnv(name, value));
    calls.authenticate.mockRejectedValue(new PaymentFlowError("authentication_required", 401));
});
afterEach(() => vi.unstubAllEnvs());

describe("canonical payment request host", () => {
    it("keeps direct canonical requests valid without requiring proxy headers", () => {
        expect(() => assertPaymentRequestHost(new Request(`${origin}/api/payments/status`), runtime())).not.toThrow();
    });
    it.each(["http://0.0.0.0:3000", "https://0.0.0.0:3000", "http://localhost:3000", "https://[::1]:3000"])("accepts the bound standalone URL %s only with explicit canonical HTTPS forwarding", internal => {
        expect(() => assertPaymentRequestHost(request(`${internal}/api/payments/status`), runtime())).not.toThrow();
    });
    it("accepts only the canonical or Next-normalized bound forwarded port in the internal URL case", () => {
        expect(() => assertPaymentRequestHost(request(undefined, { "x-forwarded-port": "3000" }), runtime())).not.toThrow();
        expect(() => assertPaymentRequestHost(request(`${origin}/api/payments/status`, { "x-forwarded-port": "3000" }), runtime())).toThrow();
    });
    it.each([
        { host: "evil.example" }, { host: "app.workfa.re, app.workfa.re" },
        { "x-forwarded-host": "evil.example" }, { "x-forwarded-host": "app.workfa.re, app.workfa.re" },
        { "x-forwarded-host": "app.workfa.re:443" }, { "x-forwarded-proto": "http" },
        { "x-forwarded-proto": "https, https" }, { "x-forwarded-proto": "https,http" },
        { "x-forwarded-port": "80" }, { "x-forwarded-port": "443,443" },
    ] as Record<string, string>[])("rejects conflicting or ambiguous authority headers for both URL forms %j", headers => {
        for (const url of ["http://0.0.0.0:3000/api/payments/status", `${origin}/api/payments/status`]) {
            expect(() => assertPaymentRequestHost(request(url, headers), runtime())).toThrow(expect.objectContaining({ code: "same_origin_required" }));
        }
    });
    it.each(["host", "x-forwarded-host", "x-forwarded-proto"])("requires the %s header for an internal URL", name => {
        const headers = new Headers(proxy); headers.delete(name);
        expect(() => assertPaymentRequestHost(new Request("http://0.0.0.0:3000/api/payments/status", { headers }), runtime())).toThrow();
    });
    it.each(["https://evil.example/api/payments/status", "http://app.workfa.re/api/payments/status", "https://app.workfa.re.evil.example/api/payments/status", "http://0.0.0.0:4000/api/payments/status", "http://127.0.0.2:3000/api/payments/status"])("never converts an unrelated URL into the canonical authority (%s)", url => {
        expect(() => assertPaymentRequestHost(request(url), runtime())).toThrow();
    });
    it.each(["", "0", "3000junk", "65536", "03000"])("fails closed for invalid configured bind port %j", PORT => {
        expect(() => assertPaymentRequestHost(request(), runtime(), { PORT })).toThrow();
    });
    it("does not enable this proxy exception for sandbox or local simulation", () => {
        for (const mode of ["sandbox", "local_simulation"] as const) expect(() => assertPaymentRequestHost(request(), { ...runtime(), mode })).toThrow();
    });
    it("preserves explicit Origin, Fetch-Site and JSON requirements for writes", () => {
        const write = (headers: Record<string, string> = {}) => new Request("https://0.0.0.0:3000/api/payments/setup", { method: "POST", headers: { ...proxy, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: "{}" });
        expect(() => assertPaymentSameOrigin(write(), runtime())).not.toThrow();
        for (const headers of [{ origin: "null" }, { origin: "https://evil.example" }, { origin: `${origin}, ${origin}` }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
            expect(() => assertPaymentSameOrigin(write(headers), runtime())).toThrow(expect.objectContaining({ code: "same_origin_required" }));
        }
        const absent = write(); absent.headers.delete("origin"); expect(() => assertPaymentSameOrigin(absent, runtime())).toThrow();
        expect(() => assertPaymentSameOrigin(write({ "content-type": "text/plain" }), runtime())).toThrow(expect.objectContaining({ code: "json_required" }));
    });
});

const reads = [status, account, methods, payouts, summary, guardian, recipientRefresh, guardianRefresh];
describe("Pay route proxy integration", () => {
    it.each(reads)("passes a valid live proxy request through to the unchanged authentication boundary", async route => {
        const response = await route(request(undefined, { "x-workfare-owner": owner }));
        expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: "authentication_required" });
        expect(calls.authenticate).toHaveBeenCalledOnce();
    });
    it.each(reads)("rejects an ambiguous proxy host before any auth/provider work", async route => {
        const response = await route(request(undefined, { "x-workfare-owner": owner, "x-forwarded-host": "app.workfa.re, evil.example" }));
        expect(response.status).toBe(403); expect(calls.authenticate).not.toHaveBeenCalled(); expect(calls.start).not.toHaveBeenCalled();
    });
    it.each([setup, session, hosted])("still requires authentication before creating any live session", async route => {
        const response = await route(new Request("http://0.0.0.0:3000/api/payments/setup", { method: "POST", headers: { ...proxy, origin, "content-type": "application/json", "x-workfare-owner": owner }, body: "{}" }));
        expect(response.status).toBe(401); expect(calls.start).not.toHaveBeenCalled();
    });
    it.each([recipientRefresh, guardianRefresh])("preserves the top-level hosted-return exception without allowing a cross-site subresource", async route => {
        const response = await route(request(undefined, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }));
        expect(response.status).toBe(401); expect(calls.authenticate).toHaveBeenCalledOnce(); calls.authenticate.mockClear();
        const blocked = await route(request(undefined, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }));
        expect(blocked.status).toBe(403); expect(calls.authenticate).not.toHaveBeenCalled();
    });
    it("keeps the hosted consent cookie Secure even when Next uses an internal HTTP URL", async () => {
        calls.authenticate.mockResolvedValue(owner);
        calls.start.mockResolvedValue({ payload: { kind: "live" }, cookie: "signed-fixture", maxAge: 600 });
        const response = await hosted(new Request("http://0.0.0.0:3000/api/payments/recipient/hosted", { method: "POST", headers: { ...proxy, origin, "content-type": "application/json", "x-workfare-owner": owner }, body: '{"consent":true}' }));
        expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("; HttpOnly; SameSite=Lax; Secure");
    });
});
