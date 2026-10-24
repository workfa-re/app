import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({ server: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), from: vi.fn(), queries: [] as Array<{ table: string; filters: Array<[string, string]> }>, profile: {} as Record<string, unknown> | null }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: state.server }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
import { getAuthState, getCurrentSessionAndProfile, requireCompleteProfile } from "@/lib/auth";

const user = (overrides: Partial<User> = {}) => ({ id: "verified-user", email: "verified@example.test", email_confirmed_at: "2026-10-01T12:00:00Z", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-01T12:00:00Z", ...overrides } as User);
const session = (currentUser = user(), overrides: Partial<Session> = {}) => ({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer", user: currentUser, ...overrides } as Session);

describe("verified server auth context", () => {
    beforeEach(() => {
        vi.clearAllMocks(); state.queries = [];
        state.profile = { id: "verified-user", full_name: "Test Person", birthdate: "2000-01-01", city: "Teststadt", account_type: "job_seeker", email: null };
        state.getUser.mockResolvedValue({ data: { user: user() }, error: null });
        state.getSession.mockResolvedValue({ data: { session: session() }, error: null });
        state.server.mockResolvedValue({ auth: { getUser: state.getUser, getSession: state.getSession }, from: state.from });
        state.from.mockImplementation((table: string) => {
            const query = { table, filters: [] as Array<[string, string]> }; state.queries.push(query);
            const response = () => ({ data: table === "profiles" ? state.profile : [{ role: { name: "moderator" } }], error: null });
            const builder = {
                select: () => builder,
                eq: (key: string, value: string) => { query.filters.push([key, value]); return builder; },
                maybeSingle: async () => response(),
                then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response()).then(resolve, reject),
            };
            return builder;
        });
    });

    it("uses the current getUser identity and email fields rather than cookie user metadata", async () => {
        const verified = user();
        state.getUser.mockResolvedValue({ data: { user: verified }, error: null });
        state.getSession.mockResolvedValue({ data: { session: session(user({ email: "cookie-value@example.test", email_confirmed_at: undefined })) }, error: null });
        const result = await getCurrentSessionAndProfile();
        expect(result.session?.user).toBe(verified);
        expect(result.profile?.email).toBe("verified@example.test");
        expect(result.systemRoles).toEqual(["moderator"]);
        expect(state.queries).toEqual([
            { table: "profiles", filters: [["id", verified.id]] },
            { table: "user_system_roles", filters: [["user_id", verified.id]] },
        ]);
    });

    it("does not let a stale confirmed cookie bypass the verified email gate", async () => {
        state.getUser.mockResolvedValue({ data: { user: user({ email_confirmed_at: undefined }) }, error: null });
        expect(await getAuthState()).toMatchObject({ state: "email-unconfirmed" });
        await expect(requireCompleteProfile()).rejects.toThrow("REDIRECT:/onboarding");
    });

    it("never treats generic or phone confirmation as an email confirmation", async () => {
        state.getUser.mockResolvedValue({ data: { user: { ...user({ email_confirmed_at: undefined, phone_confirmed_at: "2026-10-02T12:00:00Z" }), confirmed_at: "2026-10-02T12:00:00Z" } }, error: null });
        expect(await getAuthState()).toMatchObject({ state: "email-unconfirmed" });
    });

    it("preserves a verified refreshed session after an expired cookie is refreshed", async () => {
        const verified = user({ last_sign_in_at: "2026-10-24T12:00:00Z" });
        state.getSession.mockResolvedValue({ data: { session: session(user(), { access_token: "expired-fixture", expires_at: 1 }) }, error: null });
        state.getUser.mockImplementation(async () => {
            state.getSession.mockResolvedValue({ data: { session: session(user({ email_confirmed_at: undefined }), { access_token: "refreshed-fixture", expires_at: 9999999999 }) }, error: null });
            return { data: { user: verified }, error: null };
        });
        const result = await getAuthState();
        expect(result).toMatchObject({ state: "ready", session: { access_token: "refreshed-fixture", user: { id: verified.id, last_sign_in_at: verified.last_sign_in_at } } });
        expect(state.getUser).toHaveBeenCalledTimes(1); expect(state.getSession).toHaveBeenCalledTimes(1);
    });

    it.each([
        { data: { user: null }, error: { message: "Expired refresh token" } },
        { data: { user: null }, error: null },
    ])("stops every protected read if expired or missing authentication cannot be verified: %j", async response => {
        state.getUser.mockResolvedValue(response);
        expect(await getAuthState()).toEqual({ state: "no-session" });
        expect(state.getSession).not.toHaveBeenCalled(); expect(state.from).not.toHaveBeenCalled();
    });

    it.each([
        { data: { session: null }, error: null },
        { data: { session: session(user({ id: "different-cookie-id" })) }, error: null },
        { data: { session: session() }, error: { message: "Session unavailable" } },
        { data: { session: { ...session(), user: null } }, error: null },
    ])("fails closed on null, mismatched or failed raw session metadata: %j", async response => {
        state.getSession.mockResolvedValue(response);
        expect(await getAuthState()).toEqual({ state: "no-session" });
        expect(state.from).not.toHaveBeenCalled();
    });

    it("keeps confirmed users with missing profile data in onboarding", async () => {
        state.profile = null;
        expect(await getAuthState()).toMatchObject({ state: "incomplete-profile", profile: null });
    });

    it("does not reuse a user's auth context across separate calls outside a React render request", async () => {
        expect((await getCurrentSessionAndProfile()).session?.user.id).toBe("verified-user");
        state.getUser.mockResolvedValue({ data: { user: user({ id: "second-verified-user" }) }, error: null });
        state.getSession.mockResolvedValue({ data: { session: session(user({ id: "second-verified-user" })) }, error: null });
        state.profile = { ...state.profile, id: "second-verified-user" };
        expect((await getCurrentSessionAndProfile()).session?.user.id).toBe("second-verified-user");
        expect(state.getUser).toHaveBeenCalledTimes(2);
    });

    it("preserves missing-environment handling without hiding unrelated setup failures", async () => {
        state.server.mockRejectedValueOnce(new Error("Missing Supabase env vars"));
        expect(await getAuthState()).toEqual({ state: "no-session" });
        state.server.mockRejectedValueOnce(new Error("Unexpected setup failure"));
        await expect(getAuthState()).rejects.toThrow("Unexpected setup failure");
    });
});
