import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ getUser: vi.fn(), server: vi.fn(), admin: vi.fn(), from: vi.fn(),
    queries: [] as Array<{ table: string; steps: Array<[string, ...unknown[]]> }>, response: { data: [] as unknown, error: null as unknown } }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: state.server }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: state.admin }));
import { getGuardians, getWards } from "@/app/actions/guardian";

const OWNER = "b1be649d-adb1-4eaa-b24d-224e07fc817f";
const LINKED = "142846f8-4e5d-40f9-bc06-b093a774cccf";
const linkedProfile = { id: LINKED, full_name: " Alex Beispiel ", email: " alex@example.invalid " };

describe("recipient-scoped linked profile accounts", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        state.queries = [];
        state.response = { data: [], error: null };
        state.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
        state.server.mockResolvedValue({ auth: { getUser: state.getUser } });
        state.admin.mockReturnValue({ from: state.from });
        state.from.mockImplementation((table: string) => {
            const query = { table, steps: [] as Array<[string, ...unknown[]]> };
            state.queries.push(query);
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "eq", "order"]) builder[method] = (...args: unknown[]) => { query.steps.push([method, ...args]); return builder; };
            builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(state.response).then(resolve, reject);
            return builder;
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it.each([
        ["guardians", getGuardians, "child_id", "guardian_id"],
        ["wards", getWards, "guardian_id", "child_id"],
    ] as const)("loads %s from active relationships using only verified session identity", async (_kind, action, ownerColumn, counterpartColumn) => {
        await Reflect.apply(action, undefined, ["untrusted-other-user"]);
        expect(state.getUser).toHaveBeenCalledOnce();
        expect(state.queries).toHaveLength(1);
        expect(state.queries[0].table).toBe("guardian_relationships");
        expect(state.queries[0].steps).toContainEqual(["eq", ownerColumn, OWNER]);
        expect(state.queries[0].steps).toContainEqual(["eq", "status", "active"]);
        expect(state.queries[0].steps).toContainEqual(["order", "created_at", { ascending: false }]);
        expect(state.queries[0].steps).toContainEqual(["order", counterpartColumn, { ascending: true }]);
        expect(state.queries[0].steps.find(([method]) => method === "select")?.[1]).toContain(`guardian_relationships_${counterpartColumn}_fkey`);
        expect(JSON.stringify(state.queries)).not.toContain("untrusted-other-user");
        expect(JSON.stringify(state.queries)).not.toContain("guardian_invitations");
    });

    it("normalizes and deduplicates guardian joins without phantom accounts", async () => {
        state.response.data = [
            { guardian_id: LINKED, created_at: "2026-10-24T10:00:00Z", linked_profile: linkedProfile },
            { guardian_id: LINKED, created_at: "2026-10-23T10:00:00Z", linked_profile: [linkedProfile] },
            { guardian_id: "missing-profile", linked_profile: null },
            { guardian_id: null, linked_profile: linkedProfile },
            { guardian_id: "mismatch", linked_profile: linkedProfile },
            { guardian_id: OWNER, linked_profile: { id: OWNER, full_name: "Self" } },
        ];
        expect(await getGuardians()).toEqual({ guardians: [{ id: LINKED, full_name: "Alex Beispiel", email: "alex@example.invalid", linked_at: "2026-10-24T10:00:00Z" }] });
    });

    it("accepts array-form ward joins and retains only the matching identity", async () => {
        state.response.data = [
            { child_id: LINKED, created_at: "2026-10-24T10:00:00Z", linked_profile: [{ id: "wrong", full_name: "Wrong" }, linkedProfile] },
            { child_id: LINKED, linked_profile: linkedProfile },
            { child_id: "missing-profile", linked_profile: [] },
        ];
        expect(await getWards()).toEqual({ wards: [{ id: LINKED, full_name: "Alex Beispiel", email: "alex@example.invalid", linked_at: "2026-10-24T10:00:00Z" }] });
    });

    it.each([getGuardians, getWards])("does not create an admin client without an authenticated user", async action => {
        state.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expect(await action()).toEqual({ error: "Nicht authentifiziert" });
        expect(state.admin).not.toHaveBeenCalled();
        expect(state.from).not.toHaveBeenCalled();
    });

    it.each([getGuardians, getWards])("fails closed on an authentication error even if a user object exists", async action => {
        state.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: { message: "Technical auth failure" } });
        const result = await action();
        expect(result.error).toContain("Sitzung");
        expect(JSON.stringify(result)).not.toContain("Technical auth failure");
        expect(state.admin).not.toHaveBeenCalled();
    });

    it.each([getGuardians, getWards])("reports lookup failures instead of returning a false empty state", async action => {
        state.response = { data: null, error: { code: "42501", message: "Private SQL diagnostics" } };
        const result = await action();
        expect(result.error).toContain("nicht geladen");
        expect(result).not.toHaveProperty("guardians");
        expect(result).not.toHaveProperty("wards");
        expect(JSON.stringify(result)).not.toContain("Private SQL diagnostics");
    });

    it.each([getGuardians, getWards])("reports unavailable server credentials without exposing diagnostics", async action => {
        state.admin.mockImplementation(() => { throw new Error("Private credential diagnostics"); });
        const result = await action();
        expect(result.error).toContain("nicht geladen");
        expect(JSON.stringify(result)).not.toContain("Private credential diagnostics");
    });

    it("distinguishes a successful empty result from a failed load", async () => {
        expect(await getGuardians()).toEqual({ guardians: [] });
        expect(await getWards()).toEqual({ wards: [] });
    });
});
