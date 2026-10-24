import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fetchJobs: vi.fn(), market: vi.fn(), summaryRows: [] as Array<Record<string, string>>, summaryError: null as { message: string } | null, query: [] as Array<unknown[]>, props: null as Record<string, unknown> | null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/dal/platform", () => ({ fetchJobs: state.fetchJobs }));
vi.mock("@/lib/app-shell", () => ({
    getAppHomeContext: async () => ({ profile: { id: "provider", market_id: "market", lat: null, lng: null }, effectiveView: { viewRole: "job_provider" } }),
    getMarketSummary: state.market,
    getAppHomeAccess: async () => ({ isVerified: true }),
}));
vi.mock("@/components/layout/AppNavigationProvider", () => ({ AppRouteReady: () => null }));
vi.mock("@/components/ui/CumulativeLoadMoreLink", () => ({ CumulativeLoadMoreLink: () => null }));
vi.mock("@/app/app-home/offers/components/MyJobsView", () => ({ MyJobsView: (props: Record<string, unknown>) => { state.props = props; return null; } }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ from: (table: string) => {
    state.query.push(["from", table]);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "in", "order"]) builder[method] = (...args: unknown[]) => { state.query.push([method, ...args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.summaryRows, error: state.summaryError }).then(resolve);
    return builder;
} }) }));

import OffersPage from "@/app/app-home/offers/page";
const reservedJob = { id: "job-a", status: "reserved" };

describe("provider reservation summaries", () => {
    beforeEach(() => {
        vi.clearAllMocks(); state.query = []; state.props = null; state.summaryRows = []; state.summaryError = null;
        state.fetchJobs.mockResolvedValue({ ok: true, data: [reservedJob] });
        state.market.mockResolvedValue(null);
    });

    it("loads the real active conversation and keeps the provider's reserved offer visible", async () => {
        state.summaryRows = [
            { id: "old-queue", job_id: "job-a", status: "waitlisted" },
            { id: "active-chat", job_id: "job-a", status: "negotiating" },
            { id: "old-rejection", job_id: "job-a", status: "rejected" },
        ];
        renderToStaticMarkup(await OffersPage({ searchParams: Promise.resolve({}) }) as ReactElement);
        expect(state.query).toContainEqual(["select", "id, job_id, status"]);
        expect(state.query).toContainEqual(["in", "status", ["submitted", "negotiating", "accepted"]]);
        expect(state.props).toMatchObject({ jobs: [reservedJob], applicationSummaries: { "job-a": { conversationId: "active-chat", status: "negotiating" } } });
        expect(state.props?.applicationSummaries).not.toHaveProperty("total");
    });

    it("keeps job data when the conversation lookup fails without suggesting an empty inbox", async () => {
        state.summaryError = { message: "Synthetic summary error" };
        renderToStaticMarkup(await OffersPage({ searchParams: Promise.resolve({}) }) as ReactElement);
        expect(state.props).toMatchObject({ jobs: [reservedJob], applicationSummaries: null });
    });

    it("loads offers and their active conversations while the market label is still pending", async () => {
        let resolveMarket!: (value: null) => void;
        state.market.mockReturnValue(new Promise<null>((resolve) => { resolveMarket = resolve; }));
        const page = OffersPage({ searchParams: Promise.resolve({}) });
        await vi.waitFor(() => {
            expect(state.fetchJobs).toHaveBeenCalled();
            expect(state.query).toContainEqual(["from", "applications"]);
        });
        expect(state.props).toBeNull();
        resolveMarket(null);
        renderToStaticMarkup(await page as ReactElement);
        expect(state.props).toMatchObject({ jobs: [reservedJob], isVerified: true });
    });
});
