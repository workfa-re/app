import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { MyJobsView } from "./components/MyJobsView";
import { fetchJobs } from "@/lib/dal/platform";
import type { ApplicationStatus, JobsListItem } from "@/lib/types/platform";
import { getAppHomeSnapshot } from "@/lib/app-shell";
import { summarizeProviderApplications, type ProviderJobApplicationSummary } from "./presentation";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import { CumulativeLoadMoreLink } from "@/components/ui/CumulativeLoadMoreLink";

type OffersSearchParams = Record<string, string | string[] | undefined>;

const OFFERS_PAGE_PARAM = "offersPage";
const OFFERS_PAGE_SIZE = 24;
const MAX_OFFERS_PAGE = 25;
const JOB_FETCH_CHUNK_SIZE = 99;
const SUMMARY_JOB_CHUNK_SIZE = 100;

function parsePage(value: string | string[] | undefined) {
    if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return 1;
    const page = Number(value);
    if (!Number.isSafeInteger(page) || page < 1) return 1;
    return Math.min(page, MAX_OFFERS_PAGE);
}

async function fetchCumulativeOffers(
    options: Omit<Parameters<typeof fetchJobs>[0], "limit" | "offset">,
    visibleLimit: number,
) {
    const jobs: JobsListItem[] = [];

    for (let offset = 0; offset < visibleLimit; offset += JOB_FETCH_CHUNK_SIZE) {
        const chunkSize = Math.min(JOB_FETCH_CHUNK_SIZE, visibleLimit - offset);
        const result = await fetchJobs({
            ...options,
            limit: chunkSize + 1,
            offset,
        });

        if (!result.ok) return { result, hasMore: false };

        jobs.push(...result.data.slice(0, chunkSize));
        const hasMore = result.data.length > chunkSize;
        if (!hasMore || offset + chunkSize >= visibleLimit) {
            return {
                result: { ok: true as const, data: jobs },
                hasMore,
            };
        }
    }

    return {
        result: { ok: true as const, data: jobs },
        hasMore: false,
    };
}

type ApplicationSummaryRow = {
    id: string;
    job_id: string;
    status: ApplicationStatus;
};

async function fetchApplicationSummaries(jobIds: string[]): Promise<Record<string, ProviderJobApplicationSummary> | null> {
    if (jobIds.length === 0) return {};

    const supabase = await supabaseServer();
    const requests = [];
    for (let offset = 0; offset < jobIds.length; offset += SUMMARY_JOB_CHUNK_SIZE) {
        requests.push(
            supabase
                .from("applications")
                .select("id, job_id, status")
                .in("job_id", jobIds.slice(offset, offset + SUMMARY_JOB_CHUNK_SIZE))
                .in("status", ["submitted", "negotiating", "accepted"])
                .order("created_at", { ascending: false }),
        );
    }

    const results = await Promise.all(requests);
    const failedResult = results.find((result) => result.error);
    if (failedResult?.error) return null;

    const data = results.flatMap((result) => result.data ?? []);

    return summarizeProviderApplications(data as ApplicationSummaryRow[]);
}

export default async function OffersPage({
    searchParams,
}: {
    searchParams: Promise<OffersSearchParams>;
}) {
    const snapshot = await getAppHomeSnapshot();
    const profile = snapshot.profile;
    const effectiveView = snapshot.effectiveView;
    if (effectiveView.viewRole === "job_seeker") {
        redirect("/app-home/jobs");
    }

    const params = await searchParams;
    const offersPage = parsePage(params[OFFERS_PAGE_PARAM]);
    const visibleOfferLimit = offersPage * OFFERS_PAGE_SIZE;
    if (params.view === "region") {
        redirect("/app-home/offers");
    }
    if (params.view === "applications") {
        redirect("/app-home/activities");
    }

    let jobs: JobsListItem[] = [];
    const regionName: string | null = snapshot.market?.display_name || snapshot.market?.brand_prefix || null;
    let jobsError: { code?: string; message: string } | null = null;
    let applicationSummaries: Record<string, ProviderJobApplicationSummary> | null = {};

    const offersPageResult = await fetchCumulativeOffers({
        mode: "my_jobs",
        userId: profile.id,
        userCoordinates: { lat: profile.lat ?? null, lng: profile.lng ?? null },
        includeApplicationState: false,
    }, visibleOfferLimit);
    const res = offersPageResult.result;

    let canLoadMoreOffers = false;
    if (res.ok) {
        canLoadMoreOffers = offersPage < MAX_OFFERS_PAGE && offersPageResult.hasMore;
        jobs = res.data;
        applicationSummaries = await fetchApplicationSummaries(jobs.map((job) => job.id));
    } else {
        jobsError = { code: res.error.code, message: res.error.message };
    }

    const marketLabel = regionName || "deiner Region";

    return (
        <div className="provider-home-surface">
            <AppRouteReady href="/app-home/offers" />
            <div className="jobs-home-heading">
                <div className="max-w-2xl">
                    <h1>Meine Jobs</h1>
                </div>
            </div>

            <div className="min-h-[400px]">
                {jobsError ? (
                    <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-10 text-center shadow-[var(--shadow-card)]">
                        <p className="font-semibold text-[var(--danger)]">Jobs konnten nicht geladen werden.</p>
                        <p className="mt-2 break-words font-mono text-xs text-[var(--text-muted)]">
                            {jobsError.code ? `${jobsError.code}: ` : ""}{jobsError.message}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <MyJobsView
                            jobs={jobs}
                            marketName={marketLabel}
                            isVerified={snapshot.isVerified}
                            applicationSummaries={applicationSummaries}
                        />
                        {snapshot.isVerified && canLoadMoreOffers ? (
                            <CumulativeLoadMoreLink
                                pathname="/app-home/offers"
                                searchParams={params}
                                pageParam={OFFERS_PAGE_PARAM}
                                nextPage={offersPage + 1}
                                label="Weitere Angebote laden"
                            />
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
