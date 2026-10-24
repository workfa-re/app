import { beforeEach, describe, expect, it, vi } from "vitest";

type Response = { data: unknown; error: null | { message: string; code?: string }; count?: number | null };
const state = vi.hoisted(() => ({
    server: vi.fn(), from: vi.fn(),
    responses: {} as Record<string, Array<Response | Promise<Response>>>,
    queries: [] as Array<{ table: string; steps: Array<[string, ...unknown[]]> }>,
    executed: [] as string[],
}));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: state.server }));
vi.mock("@/lib/dal/visible-profiles", () => ({
    fetchVisibleJobCreatorSummaries: async () => ({ data: [], error: null }),
    fetchActivityPartnerProfiles: async () => ({ data: [], error: null }),
}));
import { fetchJobs, getEffectiveView } from "@/lib/dal/platform";

const card = (id: string) => ({ id, title: `Job ${id}`, description: "Beschreibung", posted_by: "provider", status: "open", created_at: "2026-10-24T10:00:00Z", market_id: null, public_lat: 0, public_lng: 0, wage_hourly: 17, category: "garden" });
const params = { mode: "feed" as const, userId: "seeker", userCoordinates: { lat: 0, lng: 0 } };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("platform DAL bounded and parallel reads", () => {
    beforeEach(() => {
        vi.clearAllMocks(); state.queries = []; state.executed = []; state.responses = {};
        state.server.mockResolvedValue({ from: state.from });
        state.from.mockImplementation((table: string) => {
            const query = { table, steps: [] as Array<[string, ...unknown[]]> }; state.queries.push(query);
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "in", "or", "eq", "gte", "lte", "order", "range", "single", "maybeSingle"]) {
                builder[method] = (...args: unknown[]) => { query.steps.push([method, ...args]); return builder; };
            }
            builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
                state.executed.push(table);
                return Promise.resolve(state.responses[table]?.shift() ?? { data: [], error: null, count: 0 }).then(resolve, reject);
            };
            return builder;
        });
    });

    it("restricts application state to returned card IDs and reuses one user-scoped client", async () => {
        state.responses.jobs = [{ data: [card("visible")], error: null }];
        state.responses.applications = [{ data: [{ id: "conversation", job_id: "visible", status: "withdrawn" }], error: null, count: 1 }];
        expect(await fetchJobs({ ...params, jobIds: ["visible", "not-returned"] })).toMatchObject({ ok: true, data: [{ id: "visible", is_applied: true, application_id: "conversation", application_status: "withdrawn", distance_km: 0 }] });
        expect(state.server).toHaveBeenCalledTimes(1);
        const application = state.queries.find(query => query.table === "applications")!;
        expect(application.steps).toContainEqual(["eq", "user_id", "seeker"]);
        expect(application.steps).toContainEqual(["in", "job_id", ["visible"]]);
        expect(application.steps).toContainEqual(["select", "id, job_id, status", { count: "exact" }]);
        const projection = state.queries.find(query => query.table === "jobs")!.steps.find(([method]) => method === "select")![1] as string;
        expect(projection).not.toBe("*");
        expect(projection).toContain("description"); expect(projection).toContain("reach");
    });

    it("continues reading card application state below an API row cap", async () => {
        state.responses.jobs = [{ data: [card("a"), card("b"), card("c")], error: null }];
        state.responses.applications = [
            { data: [{ id: "ca", job_id: "a", status: "accepted" }], error: null, count: 3 },
            { data: [{ id: "cb", job_id: "b", status: "completed" }], error: null },
            { data: [{ id: "cc", job_id: "c", status: "rejected" }], error: null },
        ];
        const result = await fetchJobs(params);
        expect(result.ok && result.data.map(item => item.application_id)).toEqual(["ca", "cb", "cc"]);
        expect(state.queries.filter(query => query.table === "applications").map(query => query.steps.find(([method]) => method === "range"))).toEqual([["range", 0, 99], ["range", 1, 100], ["range", 2, 101]]);
    });

    it("does not assume a short application response is complete when an exact count is unavailable", async () => {
        state.responses.jobs = [{ data: [card("a"), card("b")], error: null }];
        state.responses.applications = [
            { data: [{ id: "ca", job_id: "a", status: "accepted" }], error: null, count: null },
            { data: [{ id: "cb", job_id: "b", status: "completed" }], error: null },
            { data: [], error: null },
        ];
        const result = await fetchJobs(params);
        expect(result.ok && result.data.every(item => item.is_applied)).toBe(true);
        expect(state.queries.filter(query => query.table === "applications")).toHaveLength(3);
    });

    it("fails closed instead of returning false application eligibility after a later-page error", async () => {
        state.responses.jobs = [{ data: [card("a"), card("b")], error: null }];
        state.responses.applications = [
            { data: [{ id: "ca", job_id: "a", status: "accepted" }], error: null, count: 2 },
            { data: null, error: { message: "Application state unavailable", code: "42501" } },
        ];
        expect(await fetchJobs(params)).toMatchObject({ ok: false, error: { message: "Application state unavailable", code: "42501" } });
    });

    it("bounds application IN lists while retaining every loaded card", async () => {
        const cards = Array.from({ length: 105 }, (_, index) => card(`job-${index}`));
        state.responses.jobs = [{ data: cards, error: null }];
        state.responses.applications = [
            { data: cards.slice(0, 100).map(job => ({ id: `conversation-${job.id}`, job_id: job.id, status: "accepted" })), error: null, count: 100 },
            { data: cards.slice(100).map(job => ({ id: `conversation-${job.id}`, job_id: job.id, status: "completed" })), error: null, count: 5 },
        ];
        const result = await fetchJobs({ ...params, limit: 105 });
        expect(result.ok && result.data.filter(item => item.is_applied)).toHaveLength(105);
        expect(state.queries.filter(query => query.table === "applications").map(query => (query.steps.find(([method]) => method === "in")![2] as string[]).length)).toEqual([100, 5]);
    });

    it("starts job and coordinate reads together instead of waiting on the profile", async () => {
        let releaseCoordinates!: (response: Response) => void;
        state.responses.profiles = [new Promise(resolve => { releaseCoordinates = resolve; })];
        state.responses.jobs = [{ data: [card("a")], error: null }];
        const pending = fetchJobs({ mode: "feed", userId: "seeker", includeApplicationState: false });
        await flush();
        expect(state.executed).toEqual(expect.arrayContaining(["profiles", "jobs"]));
        releaseCoordinates({ data: { lat: 0, lng: 0 }, error: null });
        expect(await pending).toMatchObject({ ok: true, data: [{ id: "a", distance_km: 0 }] });
    });

    it.each([{ cards: [] }, { cards: [card("a")] }])("skips application history when no cards need state or state is explicitly disabled", async ({ cards }) => {
        state.responses.jobs = [{ data: cards, error: null }];
        await fetchJobs({ ...params, includeApplicationState: cards.length ? false : undefined });
        expect(state.queries.some(query => query.table === "applications")).toBe(false);
    });

    it.each(["job_provider", null] as const)("does not re-read an explicitly supplied account type: %s", async baseAccountType => {
        state.responses.user_system_roles = [{ data: [{ role: { name: "moderator" } }], error: null }];
        expect(await getEffectiveView({ userId: "person", baseAccountType })).toEqual({ ok: true, data: { viewRole: baseAccountType ?? "job_seeker", roles: ["moderator"] } });
        expect(state.queries.map(query => query.table)).toEqual(["user_system_roles"]);
        expect(state.queries[0].steps).toContainEqual(["eq", "user_id", "person"]);
    });

    it("still resolves the profile account type when it was not supplied", async () => {
        state.responses.profiles = [{ data: { account_type: "job_provider" }, error: null }];
        state.responses.user_system_roles = [{ data: [], error: null }];
        expect(await getEffectiveView({ userId: "person" })).toEqual({ ok: true, data: { viewRole: "job_provider", roles: [] } });
        expect(state.queries.map(query => query.table)).toEqual(["profiles", "user_system_roles"]);
    });
});
