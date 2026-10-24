import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => api }));
vi.mock("@/lib/demo/session", () => ({ demoTokenHash: (value: string) => `hashed-${value}` }));
import { getSandboxPreviewVisit } from "@/lib/payments/sandbox-preview.server";

const token = "a".repeat(64);
const visit = { id: "00000000-0000-4000-8000-000000000001", expires_at: "2060-01-01T00:00:00.000Z", seeded: true, identities: {
    seeker: "00000000-0000-4000-8000-000000000002", "private-provider": "00000000-0000-4000-8000-000000000003", company: "00000000-0000-4000-8000-000000000004",
    guardian: "00000000-0000-4000-8000-000000000005", "peer-seeker": "00000000-0000-4000-8000-000000000006",
} };
beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_URL: "http://127.0.0.1:55321", APP_ORIGIN: "http://localhost:3001",
        STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly", WORKFARE_PAY_RECIPIENT_SANDBOX: "enabled" })) vi.stubEnv(key, value);
    api.rpc.mockImplementation(async (name) => ({ data: name === "demo_get_session" ? visit : null, error: null }));
});
afterEach(() => vi.unstubAllEnvs());

describe("existing-visit-only sandbox login preparation", () => {
    it("uses the hashed cookie and own stored role mapping without creating users or enrolling anyone", async () => {
        expect(await getSandboxPreviewVisit(token, "private-provider", false)).toMatchObject({ visit, token, identity: "private-provider" });
        expect(api.rpc.mock.calls).toEqual([
            ["demo_get_session", { p_token_hash: `hashed-${token}` }],
            ["pay_assert_sandbox_preview", { p_user_id: visit.identities["private-provider"], p_role: "provider" }],
        ]);
    });
    it("binds the adult alias to the stored peer identity and requires its recipient cohort", async () => {
        const result = await getSandboxPreviewVisit(token, "seeker", true);
        expect(result.identity).toBe("peer-seeker");
        expect(api.rpc).toHaveBeenLastCalledWith("pay_assert_sandbox_preview", { p_user_id: visit.identities["peer-seeker"], p_role: "recipient" });
    });
    it.each([undefined, "", "b".repeat(63), "not-a-cookie"])("rejects an absent or malformed existing-visit cookie (%s)", async (cookie) => {
        await expect(getSandboxPreviewVisit(cookie, "seeker", true)).rejects.toMatchObject({ code: "sandbox_preview_required", status: 403 });
        expect(api.rpc).not.toHaveBeenCalled();
    });
    it.each([null, { ...visit, seeded: false }, { ...visit, expires_at: "2000-01-01T00:00:00.000Z" }, { ...visit, identities: {} }])
    ("does not replace expired, unseeded or absent visits with new personas (%j)", async (data) => {
        api.rpc.mockResolvedValue({ data, error: null });
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toMatchObject({ code: "sandbox_preview_required", status: 403 });
        expect(api.rpc).toHaveBeenCalledOnce();
    });
    it("refuses a missing explicit cohort before an OTP can be issued", async () => {
        api.rpc.mockImplementation(async (name) => name === "demo_get_session" ? { data: visit, error: null }
            : { data: null, error: { message: "PAYMENT_SANDBOX_PREVIEW_REQUIRED" } });
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toMatchObject({ code: "sandbox_preview_required", status: 403 });
    });
    it("does not expose raw database failures", async () => {
        api.rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toMatchObject({ code: "sandbox_preview_unavailable", status: 503 });
    });
    it("keeps the alias unavailable when adult sandbox onboarding was not explicitly enabled", async () => {
        vi.stubEnv("WORKFARE_PAY_RECIPIENT_SANDBOX", undefined);
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toMatchObject({ code: "sandbox_preview_required" });
        expect(api.rpc).not.toHaveBeenCalled();
    });
    it("keeps hosted and non-sandbox environments closed before reading a private visit", async () => {
        vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toThrow();
        expect(api.rpc).not.toHaveBeenCalled();
        vi.stubEnv("WORKFARE_DEMO_MODE", "local"); vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        await expect(getSandboxPreviewVisit(token, "seeker", true)).rejects.toMatchObject({ code: "sandbox_required" });
        expect(api.rpc).not.toHaveBeenCalled();
    });
});
