import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    from: vi.fn(),
    batches: [] as Array<{ data: Record<string, unknown>[] | null; error: { message: string } | null; count?: number | null }>,
    queries: [] as Array<{ table: string; steps: Array<[string, ...unknown[]]> }>,
}));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ from: state.from }) }));
vi.mock("@/lib/dal/visible-profiles", () => ({
    fetchVisibleJobCreatorSummaries: async () => ({ data: [], error: null }),
    fetchActivityPartnerProfiles: async () => ({ data: [], error: null }),
}));

import { fetchJobDiscoveryCandidates, fetchJobs } from "@/lib/dal/platform";

const row = (id: string) => ({ id, created_at: "2026-10-22T12:00:00Z", category: "garden", wage_hourly: 17, public_lat: 50.62, public_lng: 6.95 });
const params = { marketId: "market-a", userCoordinates: { lat: 50.62, lng: 6.95 }, filters: { categories: ["garden"], maxDistanceKm: 5 } };

describe("job discovery read contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.queries = [];
        state.batches = [];
        state.from.mockImplementation((table: string) => {
            const query = { table, steps: [] as Array<[string, ...unknown[]]> };
            state.queries.push(query);
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "in", "or", "eq", "gte", "lte", "order", "range"]) builder[method] = (...args: unknown[]) => { query.steps.push([method, ...args]); return builder; };
            builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.batches.shift() ?? { data: [], error: null, count: 0 }).then(resolve);
            return builder;
        });
    });

    it("reads only public matching candidates and narrows the rectangle before loading descriptions or profiles", async () => {
        state.batches = [{ data: [row("near-job")], count: 1, error: null }];
        const result = await fetchJobDiscoveryCandidates(params);
        expect(result).toMatchObject({ ok: true, data: [{ id: "near-job", distance_km: 0 }] });
        expect(state.queries).toHaveLength(1);
        expect(state.queries[0].table).toBe("jobs");
        expect(state.queries[0].steps).toContainEqual(["select", "id, created_at, category, wage_hourly, public_lat, public_lng", { count: "exact" }]);
        expect(state.queries[0].steps).toContainEqual(["eq", "status", "open"]);
        expect(state.queries[0].steps).toContainEqual(["or", "market_id.eq.market-a,reach.eq.extended"]);
        expect(state.queries[0].steps).toContainEqual(["in", "category", ["garden"]]);
        expect(state.queries[0].steps.filter(([method]) => method === "gte" || method === "lte")).toHaveLength(4);
    });

    it("continues when the API row cap is lower than the requested batch size", async () => {
        state.batches = [
            { data: Array.from({ length: 30 }, (_, index) => row(`job-${index}`)), count: 65, error: null },
            { data: Array.from({ length: 30 }, (_, index) => row(`job-${index + 30}`)), count: null, error: null },
            { data: Array.from({ length: 5 }, (_, index) => row(`job-${index + 60}`)), count: null, error: null },
        ];
        const result = await fetchJobDiscoveryCandidates(params);
        expect(result.ok && result.data).toHaveLength(65);
        expect(state.queries.map(query => query.steps.find(([method]) => method === "range"))).toEqual([["range", 0, 99], ["range", 30, 129], ["range", 60, 159]]);
        expect(state.queries[1].steps.find(([method]) => method === "select")?.[2]).toBeUndefined();
    });

    it("includes uncategorized jobs in other without weakening regional visibility", async () => {
        state.batches = [{ data: [{ ...row("legacy"), category: null }], count: 1, error: null }];
        const result = await fetchJobDiscoveryCandidates({ ...params, filters: { ...params.filters, categories: ["other", "garden"] } });
        expect(result).toMatchObject({ ok: true, data: [{ id: "legacy", category: null }] });
        expect(state.queries[0].steps.filter(([method]) => method === "or")).toEqual([
            ["or", "market_id.eq.market-a,reach.eq.extended"],
            ["or", 'category.is.null,category.in.("other","garden")'],
        ]);
        expect(state.queries[0].steps.some(([method, column]) => method === "in" && column === "category")).toBe(false);
    });

    it("does not return a partial feed if a later candidate batch fails", async () => {
        state.batches = [{ data: [row("one")], count: 2, error: null }, { data: null, error: { message: "Synthetic next-page failure" } }];
        expect(await fetchJobDiscoveryCandidates(params)).toMatchObject({ ok: false, error: { message: "Synthetic next-page failure" } });
    });

    it("keeps jobs outside a missing home region restricted to extended reach", async () => {
        state.batches = [{ data: [], count: 0, error: null }];
        await fetchJobDiscoveryCandidates({ ...params, marketId: null, userCoordinates: { lat: null, lng: null }, filters: { categories: [], maxDistanceKm: null } });
        expect(state.queries[0].steps).toContainEqual(["eq", "reach", "extended"]);
        expect(state.queries[0].steps.some(([method]) => method === "gte" || method === "lte")).toBe(false);
    });

    it("loads only selected card IDs and keeps valid zero coordinates and distances", async () => {
        state.batches = [{ data: [{ ...row("selected"), title: "Test", description: "Test", posted_by: "provider", status: "open", market_id: null, public_lat: 0, public_lng: 0 }], error: null }];
        const result = await fetchJobs({ mode: "feed", userId: "seeker", userCoordinates: { lat: 0, lng: 0 }, jobIds: ["selected"], includeApplicationState: false });
        expect(result).toMatchObject({ ok: true, data: [{ id: "selected", public_lat: 0, public_lng: 0, distance_km: 0 }] });
        expect(state.queries[0].steps).toContainEqual(["in", "id", ["selected"]]);
    });

    it("loads a provider's reserved card without any queue-summary read", async () => {
        state.batches = [{ data: [{ ...row("reserved-job"), title: "Test", description: "Test", posted_by: "provider", status: "reserved", market_id: null }], error: null }];
        const result = await fetchJobs({ mode: "my_jobs", userId: "provider", userCoordinates: { lat: 0, lng: 0 }, includeApplicationState: false });
        expect(result).toMatchObject({ ok: true, data: [{ id: "reserved-job", status: "reserved" }] });
        // The mock intentionally has no RPC method: loading a reserved offer
        // must no longer request queue metadata or another applicant's state.
        expect(state.queries.map(query => query.table)).toEqual(["jobs"]);
    });
});
