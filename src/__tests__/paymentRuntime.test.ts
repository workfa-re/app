import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertPaymentSameOrigin, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { getPaymentSettingsHref, sanitizePaymentReturnPath } from "@/lib/payments/return-path";

export const localPaymentEnvironment = {
    WORKFARE_PAY_MODE: "local_simulation", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
    WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests",
    WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    APP_ORIGIN: "http://127.0.0.1:3000",
};

describe("isolated local payment environment", () => {
    it("requires explicit local demo configuration and a loopback app origin", () => {
        expect(requirePaymentRuntime(localPaymentEnvironment)).toEqual({ mode: "local_simulation", origin: "http://127.0.0.1:3000" });
        for (const patch of [{ WORKFARE_PAY_MODE: undefined }, { WORKFARE_DEMO_ENABLED: "false" }, { NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "false" },
            { WORKFARE_DEMO_MODE: "hosted" }, { NEXT_PUBLIC_SUPABASE_URL: "https://fqaditikccbxivpxukxp.supabase.co" },
            { APP_ORIGIN: "https://app.workfa.re" }, { APP_ORIGIN: "http://127.0.0.1:3000/redirect" },
            { APP_ORIGIN: "http://user:password@127.0.0.1:3000" }, { APP_ORIGIN: "http://localhost.evil.example:3000" }]) {
            expect(() => requirePaymentRuntime({ ...localPaymentEnvironment, ...patch })).toThrow();
        }
    });

    it("never treats the obsolete brand's mode variable as authorization", () => {
        expect(() => requirePaymentRuntime({ ...localPaymentEnvironment, WORKFARE_PAY_MODE: undefined, WORKFAIR_PAY_MODE: "local_simulation" })).toThrow();
    });

    it.each(["sk_live_fixture", "rk_live_fixture", "pk_test_fixture", ""])("rejects non-test server keys in sandbox (%s)", (key) => {
        expect(() => requirePaymentRuntime({ ...localPaymentEnvironment, WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: key })).toThrow();
    });

    it("requires same Origin, request host, fetch-site and JSON for mutations", () => {
        const runtime = requirePaymentRuntime(localPaymentEnvironment);
        const request = (url = `${runtime.origin}/api/payments/setup`, headers: Record<string, string> = {}) => new Request(url, {
            method: "POST", headers: { origin: runtime.origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: "{}",
        });
        expect(() => assertPaymentSameOrigin(request(), runtime)).not.toThrow();
        for (const req of [request(undefined, { origin: "https://evil.example" }), request(undefined, { origin: "null" }),
            request(undefined, { "sec-fetch-site": "cross-site" }), request("http://localhost:3000/api/payments/setup"),
            request(undefined, { "content-type": "text/plain" }), new Request(`${runtime.origin}/api/payments/setup`, { method: "POST" })]) {
            expect(() => assertPaymentSameOrigin(req, runtime)).toThrow();
        }
    });
});

describe("payment return allowlist", () => {
    it.each(["/app-home/offers/new", "/app-home/offers/new?resume=payment", "/app-home/offers/edit/11111111-1111-4111-8111-111111111111"])
    ("allows only an intended creation/edit destination (%s)", (path) => {
        expect(sanitizePaymentReturnPath(path)).toBe(path);
        expect(new URL(getPaymentSettingsHref(path), "http://localhost").searchParams.get("returnTo")).toBe(path);
    });

    it.each([undefined, null, "", "https://evil.example", "//evil.example", "/app-home/offers/new#x", "/app-home/offers/new?redirect=https://evil.example",
        "/app-home/offers/new?resume=payment&x=1", "/app-home/offers/new?resume=payment?x=1", "/app-home/offers/edit/not-a-uuid",
        "/app-home/offers/new/../settings", "/app-home/offers/%6eew", "/app-home/offers/new\\evil", "/app-home/settings"])
    ("rejects injected or unrelated return destinations (%j)", (path) => {
        expect(sanitizePaymentReturnPath(path)).toBeNull();
        expect(getPaymentSettingsHref(path)).toBe("/app-home/settings/payments");
    });
});
