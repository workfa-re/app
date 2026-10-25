import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ state: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), emailPermission: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthState: auth.state }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getUser: auth.getUser, updateUser: auth.updateUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: auth.emailPermission }) }));
import { getBuyerProfileIdentity, requestBuyerEmailChange, syncBuyerCustomerIdentity } from "@/lib/payments/buyer-identity.server";
import { POST } from "@/app/api/payments/account/email/route";

const userId = "11111111-1111-4111-8111-111111111111", foreignId = "22222222-2222-4222-8222-222222222222";
const identity = { name: "Robin Muster", email: "account@example.test" };
const user = () => ({ id: userId, email: identity.email, email_confirmed_at: "2026-10-24T00:00:00Z" });
const state = () => ({ state: "ready", session: { user: user() }, profile: { full_name: identity.name, email: "stale-profile@example.test", account_type: "job_provider" } });
const customer = () => ({ object: "customer", id: "cus_fixture", livemode: false, name: identity.name, email: identity.email,
    metadata: { workfare_pay_user: userId }, address: { line1: "Unverändert 1" } });
const environment = { WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true", WORKFARE_DEMO_MODE: "local",
    WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321", SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: "http://127.0.0.1:3000", STRIPE_SECRET_KEY: "sk_test_offlineFixture" };
beforeEach(() => {
    vi.resetAllMocks(); for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    auth.state.mockResolvedValue(state()); auth.getUser.mockResolvedValue({ data: { user: user() }, error: null });
    auth.updateUser.mockResolvedValue({ data: { user: user() }, error: null });
    auth.emailPermission.mockResolvedValue({ data: { allowed: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("profile-linked buyer identity", () => {
    it("uses the real profile name and verified Auth email, ignoring mutable metadata and stale profile email", async () => {
        auth.state.mockResolvedValue({ ...state(), session: { user: { ...user(), user_metadata: { full_name: "Fake Name", email: "fake@example.test" } } } });
        expect(await getBuyerProfileIdentity(userId)).toEqual(identity);
    });
    it("uses the displayed company name for an actual company provider profile", async () => {
        auth.state.mockResolvedValue({ ...state(), profile: { ...state().profile, provider_kind: "company", company_name: "Musterbetrieb" } });
        expect(await getBuyerProfileIdentity(userId)).toEqual({ name: "Musterbetrieb", email: identity.email });
    });
    it.each([
        [{ state: "no-session" }, "authentication_required"],
        [{ ...state(), session: { user: { ...user(), id: foreignId } } }, "owner_mismatch"],
        [{ ...state(), state: "family-only" }, "provider_account_required"],
        [{ ...state(), profile: { ...state().profile, account_type: "job_seeker" } }, "provider_account_required"],
        [{ ...state(), profile: { ...state().profile, full_name: "" } }, "profile_name_required"],
        [{ ...state(), profile: { ...state().profile, full_name: "Robin\nMuster" } }, "profile_name_required"],
        [{ ...state(), session: { user: { ...user(), email_confirmed_at: null } } }, "confirmed_email_required"],
    ])("rejects an unavailable or foreign authoritative identity before Stripe (%j)", async (value, code) => {
        auth.state.mockResolvedValue(value); await expect(getBuyerProfileIdentity(userId)).rejects.toMatchObject({ code });
    });
    it("does not write an already linked Customer or touch its invoice address", async () => {
        const retrieve = vi.fn().mockResolvedValue(customer()), update = vi.fn();
        const result = await syncBuyerCustomerIdentity({ customers: { retrieve, update } } as unknown as Stripe, "cus_fixture", userId, identity, "sandbox");
        expect(result).toMatchObject({ address: { line1: "Unverändert 1" } }); expect(update).not.toHaveBeenCalled();
    });
    it("repairs a missing dashboard name and old email using only the linked identity", async () => {
        const retrieve = vi.fn().mockResolvedValueOnce({ ...customer(), name: null, email: "old@example.test" }).mockResolvedValue(customer());
        const update = vi.fn().mockResolvedValue(customer());
        expect(await syncBuyerCustomerIdentity({ customers: { retrieve, update } } as unknown as Stripe, "cus_fixture", userId, identity, "sandbox")).toMatchObject(identity);
        expect(update).toHaveBeenCalledWith("cus_fixture", identity, { idempotencyKey: expect.stringMatching(/^workfare-pay:profile-contact:/) });
        expect(update.mock.calls[0][1]).not.toHaveProperty("address"); expect(update.mock.calls[0][1]).not.toHaveProperty("metadata");
        expect(retrieve).toHaveBeenCalledTimes(2);
    });
    it.each([{ id: "cus_foreign" }, { metadata: { workfare_pay_user: foreignId } }, { livemode: true }, { deleted: true }])("never repairs a foreign or mixed-mode Customer (%j)", async patch => {
        const retrieve = vi.fn().mockResolvedValue({ ...customer(), ...patch }), update = vi.fn();
        await expect(syncBuyerCustomerIdentity({ customers: { retrieve, update } } as unknown as Stripe, "cus_fixture", userId, identity, "sandbox")).rejects.toThrow();
        expect(update).not.toHaveBeenCalled();
    });
    it("does not report a synchronization success after a competing contact edit", async () => {
        const retrieve = vi.fn().mockResolvedValueOnce({ ...customer(), name: null }).mockResolvedValue({ ...customer(), email: "other@example.test" });
        const update = vi.fn().mockResolvedValue(customer());
        await expect(syncBuyerCustomerIdentity({ customers: { retrieve, update } } as unknown as Stripe, "cus_fixture", userId, identity, "sandbox")).rejects.toMatchObject({ code: "billing_sync_unconfirmed" });
    });
});

describe("normal account email confirmation", () => {
    it("requests Auth confirmation on the fixed own Pay return path and keeps the current email in use", async () => {
        const result = await requestBuyerEmailChange("new@example.test", userId);
        expect(result).toEqual({ ownerId: userId, status: "pending" });
        expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ email: "new@example.test" }, { emailRedirectTo: "http://127.0.0.1:3000/auth/callback?next=%2Fapp-home%2Fsettings%2Fpayments" });
    });
    it("does not send another request for the current or already pending address", async () => {
        expect(await requestBuyerEmailChange(identity.email.toUpperCase(), userId)).toMatchObject({ status: "unchanged" });
        auth.getUser.mockResolvedValue({ data: { user: { ...user(), new_email: "new@example.test", email_change_sent_at: "2026-10-25T10:00:00Z" } }, error: null });
        expect(await requestBuyerEmailChange("new@example.test", userId)).toMatchObject({ status: "pending" });
        expect(auth.updateUser).not.toHaveBeenCalled();
        expect(auth.emailPermission).not.toHaveBeenCalled();
    });
    it.each([
        [{ data: null, error: { message: "RECIPIENT_GUARDIAN_EMAIL_CHANGE_REQUIRES_REVIEW" } }, "account_email_family_review_required"],
        [{ data: null, error: { message: "RPC unavailable" } }, "email_change_unavailable"],
        [{ data: { allowed: false }, error: null }, "email_change_unavailable"],
    ])("requires a positive family compatibility check before requesting Auth emails (%j)", async (result, code) => {
        auth.emailPermission.mockResolvedValue(result);
        await expect(requestBuyerEmailChange("new@example.test", userId)).rejects.toMatchObject({ code });
        expect(auth.updateUser).not.toHaveBeenCalled();
        expect(auth.emailPermission).toHaveBeenCalledWith("pay_assert_account_email_change", { p_user_id: userId });
    });
    it("reports changed only after a fresh verified Auth read confirms the new account email", async () => {
        auth.getUser.mockResolvedValueOnce({ data: { user: user() }, error: null }).mockResolvedValueOnce({ data: { user: { ...user(), email: "new@example.test" } }, error: null });
        expect(await requestBuyerEmailChange("new@example.test", userId)).toMatchObject({ status: "changed" });
        expect(auth.getUser).toHaveBeenCalledTimes(2);
    });
    it.each(["invalid", "", "x".repeat(255) + "@example.test"])("does not send a request for invalid input %j", async email => {
        await expect(requestBuyerEmailChange(email, userId)).rejects.toMatchObject({ code: "invalid_email" }); expect(auth.updateUser).not.toHaveBeenCalled();
    });
    it("keeps local simulation free of real confirmation emails", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        await expect(requestBuyerEmailChange("new@example.test", userId)).rejects.toMatchObject({ code: "account_email_change_unavailable" }); expect(auth.updateUser).not.toHaveBeenCalled();
    });
    it("does not act if the verified session owner changes", async () => {
        auth.getUser.mockResolvedValue({ data: { user: { ...user(), id: foreignId } }, error: null });
        await expect(requestBuyerEmailChange("new@example.test", userId)).rejects.toMatchObject({ code: "authentication_required" }); expect(auth.updateUser).not.toHaveBeenCalled();
    });
    it("does not report success when Auth throttles or cannot confirm the change", async () => {
        auth.updateUser.mockResolvedValueOnce({ error: { status: 429, message: "private details" } });
        await expect(requestBuyerEmailChange("new@example.test", userId)).rejects.toMatchObject({ code: "email_change_rate_limited", status: 429 });
        auth.getUser.mockReset().mockResolvedValueOnce({ data: { user: user() }, error: null }).mockResolvedValueOnce({ data: { user: null }, error: new Error("private") });
        await expect(requestBuyerEmailChange("new@example.test", userId)).rejects.toMatchObject({ code: "email_change_unconfirmed" });
    });
});

describe("account email route boundary", () => {
    const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${environment.APP_ORIGIN}/api/payments/account/email`, {
        method: "POST", headers: { origin: environment.APP_ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-workfare-owner": userId, ...headers }, body: JSON.stringify(body),
    });
    it("preserves no-store and returns only the own confirmation state", async () => {
        const response = await POST(request({ email: "new@example.test" }));
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ ownerId: userId, status: "pending" });
    });
    it.each<Record<string, string>>([{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }])("rejects cross-site requests before sending email (%j)", async headers => {
        expect((await POST(request({ email: "new@example.test" }, headers))).status).toBe(403); expect(auth.updateUser).not.toHaveBeenCalled();
    });
    it("does not accept another account or unowned attributes", async () => {
        expect((await POST(request({ email: "new@example.test", userId: foreignId }))).status).toBe(400);
        expect((await POST(request({ email: "new@example.test" }, { "x-workfare-owner": foreignId }))).status).toBe(409); expect(auth.updateUser).not.toHaveBeenCalled();
    });
});
