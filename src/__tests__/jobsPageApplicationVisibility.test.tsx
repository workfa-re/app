import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    fetchJobs: vi.fn(),
    fetchJobDiscoveryCandidates: vi.fn(),
    fetchCandidateApplicationLinks: vi.fn(),
    getAppHomeContext: vi.fn(),
    getAppHomeAccess: vi.fn(),
    jobsListProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/dal/platform", () => ({
    fetchJobs: testState.fetchJobs,
    fetchJobDiscoveryCandidates: testState.fetchJobDiscoveryCandidates,
    fetchCandidateApplicationLinks: testState.fetchCandidateApplicationLinks,
}));
vi.mock("@/lib/app-shell", () => ({
    getAppHomeContext: testState.getAppHomeContext,
    getAppHomeAccess: testState.getAppHomeAccess,
}));
vi.mock("@/components/jobs/JobsList", () => ({
    JobsList: (props: Record<string, unknown>) => {
        testState.jobsListProps = props;
        return null;
    },
}));
vi.mock("@/components/layout/AppNavigationProvider", () => ({
    AppRouteReady: () => null,
}));
vi.mock("@/components/ui/CumulativeLoadMoreLink", () => ({
    CumulativeLoadMoreLink: () => null,
}));

import JobsPage from "@/app/app-home/jobs/page";

function makeJob(id: string, status: "open" | "reserved") {
    return {
        id,
        title: id,
        status,
        market_id: "market-a",
        reach: "internal_rheinbach",
        created_at: "2026-10-22T12:00:00Z",
        category: "garden", wage_hourly: 17, distance_km: null, public_lat: null, public_lng: null,
    };
}

describe("jobs page application visibility", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        testState.jobsListProps = null;
        testState.getAppHomeContext.mockResolvedValue({
            profile: {
                id: "seeker-a",
                market_id: "market-a",
                lat: null,
                lng: null,
            },
            effectiveView: { viewRole: "job_seeker" },
        });
        testState.getAppHomeAccess.mockResolvedValue({ canApply: true, guardianStatus: "active" });

        const openJobs = [
            makeJob("historical-open", "open"),
            makeJob("fresh-open", "open"),
        ];
        const reservedJobs = [
            makeJob("historical-reserved", "reserved"),
            makeJob("own-waitlist", "reserved"),
            makeJob("active-application", "reserved"),
            makeJob("fresh-reserved", "reserved"),
        ];

        const jobs = [...openJobs, ...reservedJobs];
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: jobs });
        testState.fetchJobs.mockImplementation(async ({ jobIds }: { jobIds: string[] }) => ({ ok: true, data: jobs.filter(job => jobIds.includes(job.id)) }));
        testState.fetchCandidateApplicationLinks.mockResolvedValue({
            ok: true,
            data: [
                { id: "app-withdrawn", job_id: openJobs[0].id },
                { id: "app-rejected", job_id: reservedJobs[0].id },
                { id: "app-waitlisted", job_id: reservedJobs[1].id },
                { id: "app-active", job_id: reservedJobs[2].id },
            ],
        });
    });

    it("keeps every historical application out of new application entry points", async () => {
        const page = await JobsPage({ searchParams: Promise.resolve({}) });
        renderToStaticMarkup(page as ReactElement);

        const props = testState.jobsListProps as {
            localActiveJobs: Array<{ id: string }>;
            applicationConversations: Record<string, string | null>;
        };

        expect(props.localActiveJobs.map((job) => job.id)).toEqual(["fresh-open"]);
        expect(props.applicationConversations).toEqual({
            "historical-open": "app-withdrawn",
            "historical-reserved": "app-rejected",
            "own-waitlist": "app-waitlisted",
            "active-application": "app-active",
        });
        expect(props).not.toHaveProperty("waitlistedJobs");
        expect(props).not.toHaveProperty("appliedJobs");
    });

    it.each(["submitted", "negotiating", "accepted", "waitlisted", "withdrawn", "rejected", "auto_rejected", "cancelled", "completed"])(
        "keeps a reopened job with a %s application in its existing workspace",
        async (status) => {
            const job = makeJob("reopened-job", "open");
            testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: [job] });
            testState.fetchCandidateApplicationLinks.mockResolvedValue({
                ok: true,
                data: [{ id: "existing-conversation", job_id: job.id, status }],
            });

            const page = await JobsPage({ searchParams: Promise.resolve({}) });
            renderToStaticMarkup(page as ReactElement);

            expect(testState.jobsListProps).toMatchObject({
                localActiveJobs: [],
                extendedActiveJobs: [],
                applicationConversations: { "reopened-job": "existing-conversation" },
            });
        },
    );

    it("excludes reserved jobs even from a stale candidate result and keeps regional visibility intact", async () => {
        const jobs = [
            { ...makeJob("extended-reserved", "reserved"), market_id: "market-b", reach: "extended" },
            { ...makeJob("extended-open", "open"), market_id: "market-b", reach: "extended" },
            { ...makeJob("private-region-reserved", "reserved"), market_id: "market-b" },
        ];
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: jobs });
        testState.fetchJobs.mockImplementation(async ({ jobIds }: { jobIds: string[] }) => ({ ok: true, data: jobs.filter(job => jobIds.includes(job.id)) }));
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [] });

        const page = await JobsPage({ searchParams: Promise.resolve({}) });
        renderToStaticMarkup(page as ReactElement);

        expect(testState.jobsListProps).toMatchObject({
            localActiveJobs: [],
            extendedActiveJobs: [expect.objectContaining({ id: "extended-open", status: "open" })],
        });
    });

    it("still excludes an existing application when its conversation ID is unavailable", async () => {
        const job = makeJob("known-job", "reserved");
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: [job] });
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [{ id: null, job_id: job.id }] });

        const page = await JobsPage({ searchParams: Promise.resolve({}) });
        renderToStaticMarkup(page as ReactElement);

        expect(testState.jobsListProps).toMatchObject({
            localActiveJobs: [],
            applicationConversations: { "known-job": null },
        });
    });

    it("does not expose application entry points when the user's application history fails to load", async () => {
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: false, error: { message: "Synthetic application-history failure" } });

        const page = await JobsPage({ searchParams: Promise.resolve({}) });
        const markup = renderToStaticMarkup(page as ReactElement);

        expect(testState.jobsListProps).toBeNull();
        expect(markup).toContain("Jobs konnten nicht geladen werden.");
    });

    it.each([["1", 24], ["2", 48], ["6", 144]])(
        "loads every selected card on cumulative page %s with an API row cap of 30",
        async (jobsPage, expectedCount) => {
            const jobs = Array.from({ length: 160 }, (_, index) => makeJob(`job-${String(index).padStart(3, "0")}`, "open"));
            testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: jobs });
            testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [] });
            testState.fetchJobs.mockImplementation(async ({ jobIds }: { jobIds: string[] }) => ({ ok: true, data: jobs.filter(job => jobIds.includes(job.id)).slice(0, 30) }));

            renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({ jobsPage: String(jobsPage) }) }) as ReactElement);

            const visible = (testState.jobsListProps as { localActiveJobs: Array<{ id: string }> }).localActiveJobs;
            expect(visible.map(job => job.id).sort()).toEqual(jobs.slice(0, Number(expectedCount)).map(job => job.id));
            expect(new Set(visible.map(job => job.id)).size).toBe(expectedCount);
            for (const [request] of testState.fetchJobs.mock.calls) {
                expect(request.jobIds.length).toBeLessThanOrEqual(99);
                expect(request).toMatchObject({ limit: request.jobIds.length, offset: 0 });
                expect(request.jobIds.every((id: string) => jobs.slice(0, Number(expectedCount)).some(job => job.id === id))).toBe(true);
            }
        },
    );

    it("finishes when selected jobs disappeared instead of retrying inaccessible IDs indefinitely", async () => {
        const candidates = Array.from({ length: 6 }, (_, index) => makeJob(`job-${index}`, "open"));
        const available = candidates.slice(0, 4);
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: candidates });
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [] });
        testState.fetchJobs.mockImplementation(async ({ jobIds }: { jobIds: string[] }) => ({ ok: true, data: available.filter(job => jobIds.includes(job.id)).slice(0, 2) }));

        renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({}) }) as ReactElement);

        expect(testState.jobsListProps).toMatchObject({ localActiveJobs: available });
        expect(testState.fetchJobs).toHaveBeenCalledTimes(3);
        expect(testState.fetchJobs.mock.calls.map(([request]) => request.jobIds)).toEqual([
            candidates.map(job => job.id), candidates.slice(2).map(job => job.id), candidates.slice(4).map(job => job.id),
        ]);
    });

    it("stops on zero new matching IDs and never duplicates a repeated response", async () => {
        const candidates = [makeJob("first", "open"), makeJob("gone", "open")];
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: candidates });
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [] });
        testState.fetchJobs.mockResolvedValue({ ok: true, data: [candidates[0]] });

        renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({}) }) as ReactElement);

        expect(testState.jobsListProps).toMatchObject({ localActiveJobs: [candidates[0]] });
        expect(testState.fetchJobs).toHaveBeenCalledTimes(2);
        expect(testState.fetchJobs.mock.calls[1][0].jobIds).toEqual(["gone"]);
    });

    it("does not publish a partial card list when a subsequent detail read fails", async () => {
        const candidates = [makeJob("first", "open"), makeJob("second", "open")];
        testState.fetchJobDiscoveryCandidates.mockResolvedValue({ ok: true, data: candidates });
        testState.fetchCandidateApplicationLinks.mockResolvedValue({ ok: true, data: [] });
        testState.fetchJobs.mockResolvedValueOnce({ ok: true, data: [candidates[0]] })
            .mockResolvedValueOnce({ ok: false, error: { message: "Synthetic detail failure" } });

        const markup = renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve({}) }) as ReactElement);

        expect(testState.jobsListProps).toBeNull();
        expect(markup).toContain("Jobs konnten nicht geladen werden.");
    });

    it("starts lean discovery and application history while the access check is still pending", async () => {
        let resolveAccess!: (value: { canApply: boolean; guardianStatus: string }) => void;
        testState.getAppHomeAccess.mockReturnValue(new Promise((resolve) => { resolveAccess = resolve; }));

        const pagePromise = JobsPage({ searchParams: Promise.resolve({}) });
        await vi.waitFor(() => {
            expect(testState.fetchJobDiscoveryCandidates).toHaveBeenCalledTimes(1);
            expect(testState.fetchCandidateApplicationLinks).toHaveBeenCalledTimes(1);
        });
        expect(testState.fetchJobs).not.toHaveBeenCalled();
        resolveAccess({ canApply: false, guardianStatus: "none" });

        const page = await pagePromise;
        renderToStaticMarkup(page as ReactElement);
        expect(testState.jobsListProps).toMatchObject({ canApply: false, guardianStatus: "none" });
    });
});
