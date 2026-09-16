import { redirect } from "next/navigation";
import { fetchJobs, fetchCandidateApplications } from "@/lib/dal/platform";
import { JobsList } from "@/components/jobs/JobsList";
import type { ApplicationStatus, JobsListItem } from "@/lib/types/platform";
import { getAppHomeSnapshot } from "@/lib/app-shell";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import { CumulativeLoadMoreLink } from "@/components/ui/CumulativeLoadMoreLink";

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

async function fetchCumulativeJobs(
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

const APPLIED_APPLICATION_STATUSES = new Set<ApplicationStatus>([
    "submitted",
    "negotiating",
    "accepted",
]);

const WAITLIST_APPLICATION_STATUSES = new Set<ApplicationStatus>([
    "waitlisted",
]);

export default async function JobsPage({
    searchParams,
}: {
    searchParams?: Promise<JobsSearchParams>;
}) {
    const paramsPromise: Promise<JobsSearchParams> = searchParams ?? Promise.resolve({});
    const [snapshot, params] = await Promise.all([
        getAppHomeSnapshot(),
        paramsPromise,
    ]);
    const profile = snapshot.profile;
    const view = snapshot.effectiveView;
    if (view.viewRole === "job_provider") {
        redirect("/app-home/offers");
    }

    const userCoordinates = { lat: profile.lat ?? null, lng: profile.lng ?? null };
    const jobsPage = parsePage(params[JOBS_PAGE_PARAM]);
    const visibleJobLimit = jobsPage * JOBS_PAGE_SIZE;
    const [openJobsPage, reservedJobsPage, appsRes] = await Promise.all([
        fetchCumulativeJobs({
            mode: "feed",
            userId: profile.id,
            marketId: profile.market_id,
            userCoordinates,
            includeApplicationState: false,
            status: "open",
        }, visibleJobLimit),
        fetchCumulativeJobs({
            mode: "feed",
            userId: profile.id,
            marketId: profile.market_id,
            userCoordinates,
            includeApplicationState: false,
            status: "reserved",
        }, visibleJobLimit),
        fetchCandidateApplications(profile.id, { userCoordinates })
    ]);

    const openJobsRes = openJobsPage.result;
    const reservedJobsRes = reservedJobsPage.result;
    const canLoadMoreJobs = jobsPage < MAX_JOBS_PAGE
        && (openJobsPage.hasMore || reservedJobsPage.hasMore);
    const openJobs = openJobsRes.ok ? openJobsRes.data : [];
    const reservedJobs = reservedJobsRes.ok ? reservedJobsRes.data : [];

    const rawActiveJobs: JobsListItem[] = [
        ...openJobs,
        ...reservedJobs,
    ];
    const jobsError = !openJobsRes.ok
        ? openJobsRes.error
        : !reservedJobsRes.ok
            ? reservedJobsRes.error
            : null;
    const allApps = appsRes.ok ? appsRes.data : [];
    const activeJobsById = new Map(rawActiveJobs.map((job) => [job.id, job]));

    const mapApplicationToJob = (application: (typeof allApps)[number]): JobsListItem | null => {
        if (!application.job) return null;
        const richJob = activeJobsById.get(application.job.id);
        return richJob
            ? {
                ...richJob,
                is_applied: true,
                application_status: application.status,
                application_id: application.job.application_id ?? null,
            }
            : { ...application.job, is_applied: true, application_status: application.status };
    };

    // Applied jobs are active application conversations. Waitlist entries live in the waitlist tab.
    const appliedJobs = allApps
        .filter((application) => APPLIED_APPLICATION_STATUSES.has(application.status))
        .map(mapApplicationToJob)
        .filter((job): job is JobsListItem => Boolean(job));

    const userWaitlistedJobs = allApps
        .filter((application) => WAITLIST_APPLICATION_STATUSES.has(application.status))
        .map(mapApplicationToJob)
        .filter((job): job is JobsListItem => Boolean(job));

    // A job with any existing application must continue through Activities.
    // The submission RPC intentionally permits only one application per user/job,
    // including applications that have already been closed.
    const historicalApplicationJobIds = new Set(
        allApps
            .map((application) => application.job?.id)
            .filter((jobId): jobId is string => Boolean(jobId))
    );

    /*
     * Waitlist tab:
     * - own waitlist entries first
     * - then reserved jobs where the user has never applied before
     */
    const waitlistedJobsById = new Map<string, JobsListItem>();
    for (const job of userWaitlistedJobs) waitlistedJobsById.set(job.id, job);
    for (const job of rawActiveJobs) {
        if (job.status === "reserved" && !historicalApplicationJobIds.has(job.id)) {
            waitlistedJobsById.set(job.id, job);
        }
    }
    const waitlistedJobs = [...waitlistedJobsById.values()];

    // Active feed: only open jobs without any current or historical application.
    const allActiveJobs = rawActiveJobs.filter(job =>
        !historicalApplicationJobIds.has(job.id) &&
        job.status === 'open'
    );

    const localActiveJobs = allActiveJobs.filter(job => job.market_id === profile.market_id);
    const extendedActiveJobs = allActiveJobs.filter(job => job.market_id !== profile.market_id && job.reach === 'extended');

    return (
        <div className="jobs-home-surface container mx-auto py-2 px-4 md:px-6">
            <AppRouteReady href="/app-home/jobs" />
            <div className="mx-auto max-w-[78rem] space-y-8">
                <div className="jobs-home-heading">
                    <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-strong)]">
                        Finde deinen Job
                    </h1>
                    <p className="text-[var(--text-muted)]">Hier findest du aktuelle Taschengeldjobs in deiner Nähe.</p>
                </div>

                {jobsError ? (
                    <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-12 text-center">
                        <p className="font-semibold text-[var(--danger)]">Jobs konnten nicht geladen werden.</p>
                        <p className="mt-2 break-words font-mono text-xs text-[var(--danger)]">
                            {jobsError.code ? `${jobsError.code}: ` : ""}{jobsError.message}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <JobsList
                            currentUserId={profile.id}
                            localActiveJobs={localActiveJobs}
                            extendedActiveJobs={extendedActiveJobs}
                            waitlistedJobs={waitlistedJobs}
                            appliedJobs={appliedJobs}
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
