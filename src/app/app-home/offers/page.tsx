import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { MyJobsView } from "./components/MyJobsView";
import { fetchJobs } from "@/lib/dal/platform";
import type { ApplicationStatus, JobsListItem } from "@/lib/types/platform";
import { getAppHomeAccess, getAppHomeContext, getMarketSummary } from "@/lib/app-shell";
import { summarizeProviderApplications, type ProviderJobApplicationSummary } from "./presentation";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import { CumulativeLoadMoreLink } from "@/components/ui/CumulativeLoadMoreLink";
import { CircleAlert } from "lucide-react";
import styles from "./components/MyJobsView.module.css";

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
    const [context, params] = await Promise.all([getAppHomeContext(), searchParams]);
    const { profile, effectiveView } = context;
    if (effectiveView.viewRole === "job_seeker") {
        redirect("/app-home/jobs");
    }

    const offersPage = parsePage(params[OFFERS_PAGE_PARAM]);
    const visibleOfferLimit = offersPage * OFFERS_PAGE_SIZE;
    if (params.view === "region") {
        redirect("/app-home/offers");
    }
    if (params.view === "applications") {
        redirect("/app-home/activities");
    }

    const offersPromise = fetchCumulativeOffers({
        mode: "my_jobs",
        userId: profile.id,
        userCoordinates: { lat: profile.lat ?? null, lng: profile.lng ?? null },
        includeApplicationState: false,
    }, visibleOfferLimit);
    const summariesPromise = offersPromise.then(({ result }) => result.ok
        ? fetchApplicationSummaries(result.data.map((job) => job.id))
        : null);
    const [offersPageResult, applicationSummaries, market, access] = await Promise.all([
        offersPromise,
        summariesPromise,
        getMarketSummary(profile.market_id),
        getAppHomeAccess(context),
    ]);
    const res = offersPageResult.result;
    const jobs = res.ok ? res.data : [];
    const jobsError = res.ok ? null : res.error;
    const canLoadMoreOffers = res.ok && offersPage < MAX_OFFERS_PAGE && offersPageResult.hasMore;
    const regionName = market?.display_name || market?.brand_prefix;
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
                    <div className={styles.state} role="status">
                        <div className={styles.stateIcon} aria-hidden="true">
                            <CircleAlert size={24} />
                        </div>
                        <div className={styles.stateCopy}>
                            <h2>Jobs konnten nicht geladen werden.</h2>
                            <p className={styles.errorDetails}>
                                {jobsError.code ? `${jobsError.code}: ` : ""}{jobsError.message}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <MyJobsView
                            jobs={jobs}
                            marketName={marketLabel}
                            isVerified={access.canCreateJobs === true}
                            applicationSummaries={applicationSummaries}
                        />
                        {access.canCreateJobs && canLoadMoreOffers ? (
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
