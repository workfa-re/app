import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/providers/ThemeProvider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
import { confirmBuyerSetupSession } from "@/components/payments/BuyerPaymentMethod";
const owner = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const ready = { kind: "sandbox", buyerReady: true, method: { brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2030 } };
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
afterEach(() => vi.unstubAllGlobals());
describe("buyer setup confirmation recovery", () => {
    it("retries the same setup after a transport failure and confirms both sync and stored method before returning", async () => {
        const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
            .mockResolvedValueOnce(response({ status: "complete", returnTo: "/app-home/offers/new" }))
            .mockResolvedValueOnce(response(ready));
        vi.stubGlobal("fetch", fetch);
        await expect(confirmBuyerSetupSession(session, owner, "sandbox")).rejects.toThrow("Verbindung");
        const result = await confirmBuyerSetupSession(session, owner, "sandbox");
        expect(result).toEqual({ snapshot: ready, returnTo: "/app-home/offers/new" });
        expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/payments/setup/sync", "/api/payments/setup/sync", "/api/payments/status"]);
        expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ sessionId: session }));
        expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
        for (const [, options] of fetch.mock.calls) expect(options.headers["X-Workfare-Owner"]).toBe(owner);
    });
    it.each([
        { status: "pending", snapshot: ready },
        { status: "complete", snapshot: { ...ready, buyerReady: false } },
        { status: "complete", snapshot: { ...ready, method: null } },
        { status: "complete", snapshot: { ...ready, kind: "live" } },
    ])("rejects an unfinished, incomplete or environment-mismatched confirmation: %j", async ({ status, snapshot }) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ status, returnTo: "/app-home/offers/new" })).mockResolvedValueOnce(response(snapshot)));
        await expect(confirmBuyerSetupSession(session, owner, "sandbox")).rejects.toThrow();
    });
    it("never follows an external return target even after confirmed setup", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ status: "complete", returnTo: "https://external.example/" })).mockResolvedValueOnce(response(ready)));
        expect((await confirmBuyerSetupSession(session, owner, "sandbox")).returnTo).toBeNull();
    });
});
