import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    responses: [] as Array<{ data: Array<{ id: string; job_id: string }> | null; error: null | { message: string; code?: string }; count?: number | null }>,
}));

vi.mock("@/lib/supabaseServer", () => ({
    supabaseServer: async () => ({ from: state.from }),
}));

import { fetchCandidateApplicationLinks } from "@/lib/dal/platform";

describe("candidate application discovery links", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.responses = [];
        const query = { select: state.select, eq: state.eq, order: state.order, range: state.range };
        state.from.mockReturnValue(query); state.select.mockReturnValue(query); state.eq.mockReturnValue(query); state.order.mockReturnValue(query);
        state.range.mockImplementation(async () => state.responses.shift() ?? { data: [], error: null, count: 0 });
    });

    it("reads only the current user's routing IDs without loading or filtering job/application states", async () => {
        const links = [
            { id: "active-conversation", job_id: "current-job" },
            { id: "ended-conversation", job_id: "reopened-job" },
        ];
        state.responses = [{ data: links, error: null, count: 2 }];

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toEqual({ ok: true, data: links });
        expect(state.from.mock.calls).toEqual([["applications"]]);
        expect(state.select.mock.calls).toEqual([["id, job_id", { count: "exact" }]]);
        expect(state.eq.mock.calls).toEqual([["user_id", "synthetic-seeker"]]);
        expect(state.order.mock.calls).toEqual([["id", { ascending: true }]]);
        expect(state.range.mock.calls).toEqual([[0, 99]]);
    });

    it("returns an empty history when the user has no applications", async () => {
        state.responses = [{ data: null, error: null, count: 0 }];

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toEqual({ ok: true, data: [] });
    });

    it("preserves a failed history query so discovery cannot expose another application entry point", async () => {
        state.responses = [{ data: null, error: { message: "Synthetic denied history", code: "42501" } }];

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toMatchObject({
            ok: false,
            error: { message: "Synthetic denied history", code: "42501" },
        });
    });

    it("reads every earlier conversation despite a lower API row cap", async () => {
        state.responses = [
            { data: [{ id: "a", job_id: "old-job-a" }], error: null, count: 3 },
            { data: [{ id: "b", job_id: "old-job-b" }], error: null },
            { data: [{ id: "c", job_id: "old-job-c" }], error: null },
        ];
        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toEqual({ ok: true, data: [
            { id: "a", job_id: "old-job-a" }, { id: "b", job_id: "old-job-b" }, { id: "c", job_id: "old-job-c" },
        ] });
        expect(state.range.mock.calls).toEqual([[0, 99], [1, 100], [2, 101]]);
        expect(state.select.mock.calls).toEqual([["id, job_id", { count: "exact" }], ["id, job_id", undefined], ["id, job_id", undefined]]);
        expect(state.eq.mock.calls).toEqual(Array(3).fill(["user_id", "synthetic-seeker"]));
        expect(state.order.mock.calls).toEqual(Array(3).fill(["id", { ascending: true }]));
    });

    it("continues until an empty page if an exact count is unavailable", async () => {
        state.responses = [
            { data: [{ id: "a", job_id: "old-job-a" }], error: null, count: null },
            { data: [{ id: "b", job_id: "old-job-b" }], error: null },
            { data: [], error: null },
        ];
        const result = await fetchCandidateApplicationLinks("synthetic-seeker");
        expect(result.ok && result.data.map(link => link.job_id)).toEqual(["old-job-a", "old-job-b"]);
        expect(state.range.mock.calls).toEqual([[0, 99], [1, 100], [2, 101]]);
    });

    it("never exposes a partial exclusion history if a following page fails", async () => {
        state.responses = [
            { data: [{ id: "a", job_id: "old-job-a" }], error: null, count: 2 },
            { data: null, error: { message: "Later history page unavailable", code: "42501" } },
        ];
        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toMatchObject({ ok: false, error: { message: "Later history page unavailable", code: "42501" } });
    });
});
