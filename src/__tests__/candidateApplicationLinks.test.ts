import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
}));

vi.mock("@/lib/supabaseServer", () => ({
    supabaseServer: async () => ({ from: state.from }),
}));

import { fetchCandidateApplicationLinks } from "@/lib/dal/platform";

describe("candidate application discovery links", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.from.mockReturnValue({ select: state.select });
        state.select.mockReturnValue({ eq: state.eq });
    });

    it("reads only the current user's routing IDs without loading or filtering job/application states", async () => {
        const links = [
            { id: "active-conversation", job_id: "current-job" },
            { id: "ended-conversation", job_id: "reopened-job" },
        ];
        state.eq.mockResolvedValue({ data: links, error: null });

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toEqual({ ok: true, data: links });
        expect(state.from.mock.calls).toEqual([["applications"]]);
        expect(state.select.mock.calls).toEqual([["id, job_id"]]);
        expect(state.eq.mock.calls).toEqual([["user_id", "synthetic-seeker"]]);
    });

    it("returns an empty history when the user has no applications", async () => {
        state.eq.mockResolvedValue({ data: null, error: null });

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toEqual({ ok: true, data: [] });
    });

    it("preserves a failed history query so discovery cannot expose another application entry point", async () => {
        state.eq.mockResolvedValue({ data: null, error: { message: "Synthetic denied history", code: "42501" } });

        expect(await fetchCandidateApplicationLinks("synthetic-seeker")).toMatchObject({
            ok: false,
            error: { message: "Synthetic denied history", code: "42501" },
        });
    });
});
