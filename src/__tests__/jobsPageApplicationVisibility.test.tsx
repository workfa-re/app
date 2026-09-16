import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    fetchJobs: vi.fn(),
    fetchCandidateApplications: vi.fn(),
    getAppHomeSnapshot: vi.fn(),
    jobsListProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/dal/platform", () => ({
    fetchJobs: testState.fetchJobs,
    fetchCandidateApplications: testState.fetchCandidateApplications,
}));
vi.mock("@/lib/app-shell", () => ({
    getAppHomeSnapshot: testState.getAppHomeSnapshot,
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
    };
}

describe("jobs page application visibility", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        testState.jobsListProps = null;
        testState.getAppHomeSnapshot.mockResolvedValue({
            profile: {
                id: "seeker-a",
                market_id: "market-a",
                lat: null,
                lng: null,
            },
            effectiveView: { viewRole: "job_seeker" },
            canApply: true,
            guardianStatus: "active",
        });

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

        testState.fetchJobs.mockImplementation(async ({ status }: { status: string }) => ({
            ok: true,
            data: status === "open" ? openJobs : reservedJobs,
        }));
        testState.fetchCandidateApplications.mockResolvedValue({
            ok: true,
            data: [
                { status: "withdrawn", job: { ...openJobs[0], application_id: "app-withdrawn" } },
                { status: "rejected", job: { ...reservedJobs[0], application_id: "app-rejected" } },
                { status: "waitlisted", job: { ...reservedJobs[1], application_id: "app-waitlisted" } },
                { status: "negotiating", job: { ...reservedJobs[2], application_id: "app-active" } },
            ],
        });
    });

    it("keeps every historical application out of new application entry points", async () => {
        const page = await JobsPage({ searchParams: Promise.resolve({}) });
        renderToStaticMarkup(page as ReactElement);

        const props = testState.jobsListProps as {
            localActiveJobs: Array<{ id: string }>;
            waitlistedJobs: Array<{ id: string }>;
            appliedJobs: Array<{ id: string }>;
        };

        expect(props.localActiveJobs.map((job) => job.id)).toEqual(["fresh-open"]);
        expect(props.waitlistedJobs.map((job) => job.id)).toEqual(["own-waitlist", "fresh-reserved"]);
        expect(props.appliedJobs.map((job) => job.id)).toEqual(["active-application"]);
    });
});
