import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), signIn: vi.fn(), update: vi.fn(), otp: vi.fn(), adminRpc: vi.fn(), cookie: vi.fn(), schema: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/guardian/schema-readiness.server", () => ({ readGuardianSchemaState: mock.schema }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mock.cookie }) }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getUser: mock.getUser, signInWithPassword: mock.signIn, updateUser: mock.update, signInWithOtp: mock.otp }, rpc: mock.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: mock.adminRpc }) }));
vi.mock("@/lib/demo/environment", () => ({ requireDemoEnvironment: () => ({ mode: "local" }) }));
vi.mock("@/lib/demo/session", () => ({ DEMO_VISITOR_COOKIE: "wf-demo-visitor", demoTokenHash: () => "b".repeat(64) }));
import { requestGuardianOtp, setGuardianAccessPassword, signInGuardianAccessPassword } from "@/app/guardian/access/actions";

const id = "84d4b52a-759c-4ecd-aa2b-8973fbed2570", email = "parent@example.invalid";
const user = { id, email, email_confirmed_at: "2026-10-24T09:00:00Z", last_sign_in_at: "2026-10-24T09:02:00Z" };
const owner = () => ({ data: { user }, error: null });
const anonymous = () => ({ data: { user: null }, error: null });
const context = () => ({ authenticated: true, userId: id, email, viewer: "guardian", profile: { fullName: "Paula Beispiel", birthdate: "1984-02-12", accountType: null, adultEligible: true }, relationships: [], invitation: null, workspace: { access: "family_only", providerSetupHref: "/onboarding?purpose=provider", passwordConfigured: false } });
const setup = { password: "A user chosen passphrase", passwordConfirmation: "A user chosen passphrase" };

describe("purpose-account password setup and return login", () => {
    beforeEach(() => {
        vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T09:03:00Z"));
        mock.schema.mockResolvedValue("ready");
        vi.stubEnv("WORKFARE_DEMO_ENABLED", "false"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3001");
        mock.getUser.mockResolvedValue(owner()); mock.rpc.mockResolvedValue({ data: context(), error: null });
        mock.update.mockResolvedValue({ data: { user }, error: null }); mock.signIn.mockResolvedValue({ data: { user }, error: null });
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

    it("sets only the current verified adult's first chosen password through session Auth", async () => {
        expect(await setGuardianAccessPassword(setup)).toEqual({ ok: true });
        expect(mock.rpc).toHaveBeenCalledWith("get_guardian_access_context", { p_token: null });
        expect(mock.update).toHaveBeenCalledWith({ password: setup.password });
        expect(mock.adminRpc).not.toHaveBeenCalled();
    });
    it.each([{ ...setup, passwordConfirmation: "Different passphrase" }, { password: "short", passwordConfirmation: "short" }, { ...setup, userId: "another-person" }])("rejects invalid or target-bearing credential input", async input => {
        expect((await setGuardianAccessPassword(input as typeof setup)).ok).toBe(false);
        expect(mock.update).not.toHaveBeenCalled();
    });
    it("keeps a stale session from setting a password until email ownership is freshly reconfirmed", async () => {
        mock.getUser.mockResolvedValue({ data: { user: { ...user, last_sign_in_at: "2026-10-23T09:03:00Z" } }, error: null });
        expect(await setGuardianAccessPassword(setup)).toMatchObject({ ok: false, code: "password_reauthentication_required" });
        expect(mock.update).not.toHaveBeenCalled();
    });
    it.each([null, { ...user, email_confirmed_at: null }])("requires a current confirmed Auth owner", async current => {
        mock.getUser.mockResolvedValue({ data: { user: current }, error: null });
        expect((await setGuardianAccessPassword(setup)).ok).toBe(false);
        expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    });
    it("never overwrites an already configured password from the family setup control", async () => {
        mock.rpc.mockResolvedValue({ data: { ...context(), workspace: { ...context().workspace, passwordConfigured: true } }, error: null });
        expect(await setGuardianAccessPassword(setup)).toMatchObject({ ok: false, code: "password_already_configured" });
        expect(mock.update).not.toHaveBeenCalled();
    });
    it.each([{ ...context(), userId: "22473360-9a15-4a22-83b4-bf455a01074a" }, { ...context(), profile: { ...context().profile, adultEligible: false } }])("does not trust foreign or ineligible context", async value => {
        mock.rpc.mockResolvedValue({ data: value, error: null });
        expect((await setGuardianAccessPassword(setup)).ok).toBe(false); expect(mock.update).not.toHaveBeenCalled();
    });
    it("preserves controlled demo credentials", async () => {
        vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
        expect(await setGuardianAccessPassword(setup)).toMatchObject({ ok: false, code: "demo_password_managed" });
        expect(mock.update).not.toHaveBeenCalled();
    });
    it("can send a fresh code to the same signed-in mailbox without switching accounts", async () => {
        mock.otp.mockResolvedValue({ error: null });
        expect(await requestGuardianOtp({ email, reauthenticate: true })).toEqual({ ok: true });
        expect(mock.otp).toHaveBeenCalledOnce(); expect(mock.otp.mock.calls[0][0].email).toBe(email);
    });
    it("logs into the same existing identity without creating or redeeming anything", async () => {
        mock.getUser.mockResolvedValueOnce(anonymous()).mockResolvedValueOnce(owner());
        expect(await signInGuardianAccessPassword({ email, password: "existing-password" })).toEqual({ ok: true });
        expect(mock.signIn).toHaveBeenCalledWith({ email, password: "existing-password" });
        expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    });
    it("never silently replaces another signed-in identity", async () => {
        expect(await signInGuardianAccessPassword({ email: "other@example.invalid", password: "existing-password" })).toMatchObject({ ok: false, code: "account_switch_required" });
        expect(mock.signIn).not.toHaveBeenCalled();
    });
    it("returns the same generic login error for bad credentials without leaking provider diagnostics", async () => {
        mock.getUser.mockResolvedValue(anonymous()); mock.signIn.mockResolvedValue({ error: { message: "Internal account details", code: "invalid_credentials" } });
        const result = await signInGuardianAccessPassword({ email, password: "wrong-password" });
        expect(result).toMatchObject({ ok: false, code: "password_login_failed" });
        expect(JSON.stringify(result)).not.toContain("Internal account details");
    });
    it("rechecks the logged-in owner after password sign-in instead of trusting the login response alone", async () => {
        mock.getUser.mockResolvedValueOnce(anonymous()).mockResolvedValueOnce({ data: { user: { ...user, email: "wrong@example.invalid" } }, error: null });
        expect((await signInGuardianAccessPassword({ email, password: "existing-password" })).ok).toBe(false);
    });
});
