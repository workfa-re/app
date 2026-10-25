import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getUser: api.user }, rpc: api.rpc }) }));
import { validGuardianChildOverview, trustedGuardianAvatar } from "@/lib/guardian/child-overview-types";
import { assertGuardianOverviewOrigin, guardianChildCursor, readGuardianChildOverview } from "@/lib/guardian/child-overview.server";
import { GET } from "@/app/api/guardian/children/overview/route";

const owner = "11111111-1111-4111-8111-111111111111", child = "22222222-2222-4222-8222-222222222222", job = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-25T12:00:00Z";
const raw = () => ({ ownerId: owner, child: { id: child, name: "Alex Beispiel", avatarUrl: null }, access: "minor_jobs", counts: { active: 8, completed: 1, contacts: 2 }, view: "active", jobs: [{ id: job, title: "Garten helfen", status: "agreed", partner: { name: "Robin Anbieter", avatarUrl: null }, startsAt: at, completedAt: null, sortAt: at }], hasMore: false });
const read = (patch = {}) => readGuardianChildOverview({ childId: child, view: "active", cursor: null, expectedOwnerId: owner, ...patch });
const request = (path = `?childId=${child}&view=active`, headers = {}) => new Request(`https://app.workfa.re/api/guardian/children/overview${path}`, { headers: { "X-Workfare-Owner": owner, ...headers } });
beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("APP_ORIGIN", "https://app.workfa.re"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://aaaaaaaaaaaaaaaaaaaa.supabase.co");
    api.user.mockResolvedValue({ data: { user: { id: owner, email_confirmed_at: at } }, error: null });
    api.rpc.mockResolvedValue({ data: raw(), error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("minimal guardian child projection", () => {
    it("uses the authenticated client and exposes only allowed child/job fields", async () => {
        const result = await read();
        expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_guardian_child_overview", { p_child_id: child, p_view: "active", p_before_at: null, p_before_id: null });
        expect(result.jobs[0]).toEqual({ id: job, title: "Garten helfen", status: "agreed", partner: { name: "Robin Anbieter", avatarUrl: null }, startsAt: at, completedAt: null });
        expect(validGuardianChildOverview(result, owner, child, "active")).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/sortAt|email|message|content|street|iban|acct_|conversation/);
    });
    it("keeps an adult/private view free of misleading zero counts", async () => {
        api.rpc.mockResolvedValue({ data: { ...raw(), access: "profile_only", counts: null, jobs: [] }, error: null });
        expect(await read()).toMatchObject({ access: "profile_only", counts: null, jobs: [], nextCursor: null });
    });
    it.each([{ access: "profile_only" }, { ownerId: other }, { child: { ...raw().child, id: other } }, { view: "completed" }, { jobs: [{ ...raw().jobs[0], status: "completed" }] }, { counts: { active: -1, completed: 1, contacts: 1 } }])("rejects a mismatched or overbroad projection %j", async patch => {
        api.rpc.mockResolvedValue({ data: { ...raw(), ...patch }, error: null });
        await expect(read()).rejects.toMatchObject({ code: "overview_unavailable", status: 503 });
    });
    it("does not pass private unexpected fields through a schema change", async () => {
        api.rpc.mockResolvedValue({ data: { ...raw(), messages: ["private"] }, error: null });
        await expect(read()).rejects.toMatchObject({ code: "overview_unavailable" });
    });
    it("normalizes old display names and falls back instead of exposing email/contact URLs", async () => {
        api.rpc.mockResolvedValue({ data: { ...raw(), child: { id: child, name: "old@mail.invalid", avatarUrl: "https://tracker.invalid/private.png" }, jobs: [{ ...raw().jobs[0], title: "  Garten\n helfen\u0000  ", partner: { name: "provider@mail.invalid", avatarUrl: "javascript:alert(1)" } }] }, error: null });
        const result = await read();
        expect(result.child).toEqual({ id: child, name: "Dein Kind", avatarUrl: null });
        expect(result.jobs[0]).toMatchObject({ title: "Garten helfen", partner: { name: "Anbieter", avatarUrl: null } });
    });
    it("rejects absent, unconfirmed or changed ownership before the RPC", async () => {
        for (const user of [null, { id: owner }, { id: other, email_confirmed_at: at }]) {
            api.user.mockResolvedValue({ data: { user }, error: null }); await expect(read()).rejects.toBeInstanceOf(Error);
        }
        expect(api.rpc).not.toHaveBeenCalled();
    });
    it("returns unavailable when deployment has not installed the new read model", async () => {
        api.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "private implementation" } });
        await expect(read()).rejects.toMatchObject({ code: "overview_unavailable", status: 503 });
    });
    it("does not turn a revoked/foreign family into an empty valid overview", async () => {
        api.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
        await expect(read()).rejects.toMatchObject({ code: "child_forbidden", status: 403 });
    });
});

describe("bounded keyset and avatar handling", () => {
    it("binds the next page to the requested child and view", async () => {
        api.rpc.mockResolvedValue({ data: { ...raw(), hasMore: true }, error: null });
        const result = await read(), cursor = result.nextCursor!;
        expect(guardianChildCursor(cursor, child, "active")).toEqual({ v: 1, childId: child, view: "active", at, id: job });
        expect(() => guardianChildCursor(cursor, other, "active")).toThrow(); expect(() => guardianChildCursor(cursor, child, "completed")).toThrow();
        await read({ cursor }); expect(api.rpc).toHaveBeenLastCalledWith("get_guardian_child_overview", { p_child_id: child, p_view: "active", p_before_at: at, p_before_id: job });
    });
    it.each(["not-json", "#", "x".repeat(513), Buffer.from(JSON.stringify({ v: 1, childId: child, view: "active", at: "not-a-date", id: job })).toString("base64url")])("refuses malformed cursor %s", cursor => {
        expect(() => guardianChildCursor(cursor, child, "active")).toThrow();
    });
    it("allows only own platform images with a safe storage path", () => {
        const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
        expect(trustedGuardianAvatar(`${origin}/storage/v1/object/public/avatars/${child}/photo.webp`)).toBe(`${origin}/storage/v1/object/public/avatars/${child}/photo.webp`);
        expect(trustedGuardianAvatar("/avatars/alex.webp")).toBe("/avatars/alex.webp");
        for (const value of ["//tracker.invalid/photo", "data:image/png;base64,abc", "https://tracker.invalid/photo", `${origin}/storage/v1/object/public/jobs/photo.webp`, `${origin}/storage/v1/object/public/avatars/alex.png?track=1`, "/avatars/../secret.png"]) expect(trustedGuardianAvatar(value)).toBeNull();
    });
});

describe("private guardian GET route", () => {
    it("works without a Stripe configuration and prevents storage in shared caches", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
        const response = await GET(request()); expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toContain("private, no-store"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    });
    it.each(["?childId=bad", `?childId=${child}&view=other`, `?childId=${child}&childId=${other}`, `?childId=${child}&select=messages`])("rejects invalid selectors %s", async path => {
        expect((await GET(request(path))).status).toBe(400); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("keeps failed requests generic and does not leak provider data", async () => {
        api.rpc.mockRejectedValue(new Error("private address and database diagnostic"));
        const response = await GET(request()); expect(response.status).toBe(503);
        expect(JSON.stringify(await response.json())).not.toMatch(/private address|diagnostic/);
    });
    it.each([{ Origin: "https://foreign.invalid" }, { "Sec-Fetch-Site": "cross-site" }, { Host: "foreign.invalid" }, { "X-Forwarded-Host": "foreign.invalid" }])("rejects cross-site reads %j", async headers => {
        expect((await GET(request(undefined, headers))).status).toBe(403); expect(api.user).not.toHaveBeenCalled();
    });
    it("accepts the existing trusted live reverse-proxy path", () => {
        expect(() => assertGuardianOverviewOrigin(new Request("http://localhost:3000/api/guardian/children/overview", { headers: { Host: "app.workfa.re", "X-Forwarded-Host": "app.workfa.re", "X-Forwarded-Proto": "https", "X-Forwarded-Port": "443" } }))).not.toThrow();
    });
});
