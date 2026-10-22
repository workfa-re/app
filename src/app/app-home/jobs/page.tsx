import { redirect } from "next/navigation";
import { fetchJobs, fetchCandidateApplicationLinks, fetchJobDiscoveryCandidates } from "@/lib/dal/platform";
import { JobsList } from "@/components/jobs/JobsList";
import type { JobsListItem } from "@/lib/types/platform";
import { getAppHomeAccess, getAppHomeContext } from "@/lib/app-shell";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import { CumulativeLoadMoreLink } from "@/components/ui/CumulativeLoadMoreLink";
import { hasJobDiscoveryQuery, hasValidJobCoordinates, readJobDiscoveryPreferences, selectJobDiscoveryPage } from "@/lib/jobs/discovery";

type JobsSearchParams = Record<string, string | string[] | undefined>;

const JOBS_PAGE_PARAM = "jobsPage";
const JOBS_PAGE_SIZE = 24;
const MAX_JOBS_PAGE = 25;
const JOB_FETCH_CHUNK_SIZE = 99;

function parsePage(value: string | string[] | undefined) {
    if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return 1;
    const page = Number(value);
    if (!Number.isSafeInteger(page) || page < 1) return 1;
    return Math.min(page, MAX_JOBS_PAGE);
}

type DiscoveryFetchOptions = Omit<Parameters<typeof fetchJobs>[0], "limit" | "offset">;

async function fetchDiscoveryDetailChunk(options: DiscoveryFetchOptions, ids: string[]) {
    let remainingIds = ids;
    const jobs: JobsListItem[] = [];
    while (remainingIds.length) {
        const result = await fetchJobs({ ...options, jobIds: remainingIds, limit: remainingIds.length, offset: 0 });
        if (!result.ok) return result;
        const pending = new Set(remainingIds);
        for (const job of result.data) {
            if (pending.delete(job.id)) jobs.push(job);
        }
        // A lower API row cap may require another read. Deleted or no longer
        // visible jobs must stop here once the query makes no further progress.
        if (pending.size === remainingIds.length) break;
        remainingIds = [...pending];
    }
    return { ok: true as const, data: jobs };
}

async function fetchDiscoveryDetails(options: DiscoveryFetchOptions, ids: string[]) {
    const requests = [];
    for (let offset = 0; offset < ids.length; offset += JOB_FETCH_CHUNK_SIZE) {
        const jobIds = ids.slice(offset, offset + JOB_FETCH_CHUNK_SIZE);
        requests.push(fetchDiscoveryDetailChunk(options, jobIds));
    }
    const results = await Promise.all(requests);
    for (const result of results) if (!result.ok) return result;
    return { ok: true as const, data: results.flatMap(result => result.ok ? result.data : []) };
}

export default async function JobsPage({
    searchParams,
}: {
    searchParams?: Promise<JobsSearchParams>;
}) {
    const paramsPromise: Promise<JobsSearchParams> = searchParams ?? Promise.resolve({});
    const [context, params] = await Promise.all([
        getAppHomeContext(),
        paramsPromise,
    ]);
    const profile = context.profile;
    const view = context.effectiveView;
    if (view.viewRole === "job_provider") {
        redirect("/app-home/offers");
    }

    const userCoordinates = { lat: profile.lat ?? null, lng: profile.lng ?? null };
    const hasLocation = hasValidJobCoordinates(userCoordinates);
    const preferences = readJobDiscoveryPreferences(params, hasLocation);
    const jobsPage = parsePage(params[JOBS_PAGE_PARAM]);
    const visibleJobLimit = jobsPage * JOBS_PAGE_SIZE;
    const [candidatesRes, appsRes, access] = await Promise.all([
        fetchJobDiscoveryCandidates({
            marketId: profile.market_id,
            userCoordinates,
            filters: preferences.filterState,
        }),
        fetchCandidateApplicationLinks(profile.id),
        getAppHomeAccess(context),
    ]);
    const snapshot = { ...context, ...access };

    const allApps = appsRes.ok ? appsRes.data : [];
    // Discovery ends at the first application. Its conversation remains the
    // single destination even when a job is reopened or an application ends.
    const applicationConversations = Object.fromEntries<string | null>(allApps.map((application) => (
        [application.job_id, application.id] as const
    )));
    const discovery = selectJobDiscoveryPage(candidatesRes.ok ? candidatesRes.data : [], new Set(Object.keys(applicationConversations)), preferences, visibleJobLimit);
    const jobsRes = candidatesRes.ok && appsRes.ok
        ? await fetchDiscoveryDetails({ mode: "feed", userId: profile.id, marketId: profile.market_id, userCoordinates, includeApplicationState: false, status: "open" }, discovery.ids)
        : { ok: true as const, data: [] as JobsListItem[] };
    const jobsError = !candidatesRes.ok ? candidatesRes.error : !appsRes.ok ? appsRes.error : !jobsRes.ok ? jobsRes.error : null;
    const canLoadMoreJobs = jobsPage < MAX_JOBS_PAGE && discovery.hasMore;
    const rawActiveJobs = jobsRes.ok ? jobsRes.data : [];
    const allActiveJobs = rawActiveJobs.filter((job) => (
        !Object.hasOwn(applicationConversations, job.id)
        && job.status === "open"
    ));

    const localActiveJobs = allActiveJobs.filter(job => job.market_id === profile.market_id);
    const extendedActiveJobs = allActiveJobs.filter(job => job.market_id !== profile.market_id && job.reach === 'extended');

    return (
        <div className="jobs-home-surface">
            <AppRouteReady href="/app-home/jobs" />
            <div>
                {jobsError ? (
                    <>
                        <div className="jobs-home-heading"><h1>Jobs finden</h1></div>
                        <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-12 text-center">
                            <p className="font-semibold text-[var(--danger)]">Jobs konnten nicht geladen werden.</p>
                            <p className="mt-2 break-words font-mono text-xs text-[var(--danger)]">
                                {jobsError.code ? `${jobsError.code}: ` : ""}{jobsError.message}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="space-y-6">
                        <JobsList
                            currentUserId={profile.id}
                            localActiveJobs={localActiveJobs}
                            extendedActiveJobs={extendedActiveJobs}
                            applicationConversations={applicationConversations}
                            initialPreferences={preferences}
                            hasExplicitPreferences={hasJobDiscoveryQuery(params)}
                            hasLocation={hasLocation}
                            canApply={snapshot.canApply}
                            guardianStatus={snapshot.guardianStatus}
                        />
                        {canLoadMoreJobs ? (
                            <CumulativeLoadMoreLink
                                pathname="/app-home/jobs"
                                searchParams={params}
                                pageParam={JOBS_PAGE_PARAM}
                                nextPage={jobsPage + 1}
                                label="Weitere Jobs laden"
                            />
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
