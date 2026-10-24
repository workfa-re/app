import { supabaseServer } from "@/lib/supabaseServer";
import { ActivitiesPageClient } from "@/components/activity/ActivitiesPageClient";
import { ProviderActivityList } from "@/components/activity/ProviderActivityList";
import { getAppHomeContext } from "@/lib/app-shell";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import styles from "@/components/activity/ActivityWorkspace.module.css";
import { paymentOrderPreviewVisible } from "@/lib/payments/order-feature";
import {
    fetchActivityPartnerProfiles,
    type ActivityPartnerProfile,
} from "@/lib/dal/visible-profiles";

type ActivityRow = Record<string, any>;

function firstJoinedRow(value: unknown) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeJoinedRow(row: ActivityRow): ActivityRow {
    return {
        ...row,
        job: firstJoinedRow(row.job),
        applicant: firstJoinedRow(row.applicant),
    };
}

function getNextAppointment(appointments: ActivityRow[]) {
    const scheduled = appointments
        .filter((appointment) => appointment.status === "scheduled")
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return scheduled.find((appointment) => new Date(appointment.starts_at).getTime() >= Date.now() - 60_000)
        ?? scheduled.at(-1)
        ?? null;
}

function attachPartnerProfiles(
    rows: ActivityRow[],
    partners: ActivityPartnerProfile[],
    role: "provider" | "seeker",
) {
    const byApplicationId = new Map(partners.map((partner) => [partner.application_id, partner]));

    return rows.map((row) => {
        const partner = byApplicationId.get(row.id);
        if (!partner) return row;

        const visibleProfile = {
            id: partner.profile_id,
            full_name: partner.full_name,
            company_name: partner.company_name,
            account_type: partner.account_type,
            avatar_url: partner.avatar_url,
            bio: partner.bio,
            city: partner.city,
            country: partner.country,
            skills: partner.skills,
            interests: partner.interests,
            created_at: partner.created_at,
            provider_verification_status: partner.provider_verification_status,
            age_years: partner.age_years,
            is_staff: partner.is_staff,
        };

        if (role === "provider") return { ...row, applicant: visibleProfile };
        return {
            ...row,
            job: row.job ? { ...row.job, creator: visibleProfile } : row.job,
        };
    });
}

async function enrichActivityRows(client: any, rows: ActivityRow[]): Promise<ActivityRow[]> {
    if (rows.length === 0) return rows;

    const applicationIds = rows.map((row) => row.id);
    const [summaryResult, engagementResult, reopenResult] = await Promise.all([
        client.rpc("get_activity_inbox_summaries"),
        client
            .from("job_engagements")
            .select("*, appointments:job_appointments(*)")
            .in("application_id", applicationIds),
        client
            .from("conversation_reopen_requests")
            .select("*")
            .in("application_id", applicationIds)
            .order("created_at", { ascending: false }),
    ]);

    if (summaryResult.error) console.error("Activity summary fetch error:", summaryResult.error);
    if (engagementResult.error) console.error("Activity engagement fetch error:", engagementResult.error);
    if (reopenResult.error) console.error("Activity reopen request fetch error:", reopenResult.error);

    const summaries = new Map<string, ActivityRow>(
        (summaryResult.data ?? []).map((summary: ActivityRow) => [summary.application_id, summary]),
    );
    const engagements = new Map<string, ActivityRow>(
        (engagementResult.data ?? []).map((engagement: ActivityRow) => [engagement.application_id, engagement]),
    );
    const reopenRequests = new Map<string, ActivityRow[]>();
    for (const request of reopenResult.data ?? []) {
        const current = reopenRequests.get(request.application_id) ?? [];
        current.push(request);
        reopenRequests.set(request.application_id, current);
    }

    return rows.map((row) => {
        const summary = summaries.get(row.id);
        const engagement = engagements.get(row.id) ?? null;
        const appointments = [...(engagement?.appointments ?? [])].sort((a, b) => (
            new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
        ));
        const nextAppointment = getNextAppointment(appointments);

        return {
            ...row,
            last_message_preview: summary?.last_message_preview ?? null,
            last_message_at: summary?.last_message_at ?? null,
            last_activity_at: summary?.last_activity_at ?? row.last_activity_at ?? row.created_at,
            unread_count: Number(summary?.unread_count ?? 0),
            pending_reopen_count: Number(summary?.pending_reopen_count ?? 0),
            engagement: engagement ? { ...engagement, appointments } : null,
            appointments,
            reopen_requests: reopenRequests.get(row.id) ?? [],
            scheduled_for: nextAppointment?.starts_at ?? null,
            agreed_at: nextAppointment?.updated_at ?? null,
            agreement: nextAppointment,
        };
    });
}

export default async function ActivityPage({
    searchParams,
}: {
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const paramsPromise: Promise<{ [key: string]: string | string[] | undefined }> =
        searchParams ?? Promise.resolve({});
    const [context, params] = await Promise.all([
        getAppHomeContext(),
        paramsPromise,
    ]);
    const profile = context.profile;
    const viewRole = context.effectiveView.viewRole;
    const paymentOrdersEnabled = paymentOrderPreviewVisible(process.env);
    const selectedJobId = typeof params.jobId === "string" ? params.jobId : null;
    const supabase = await supabaseServer();

    if (viewRole === "job_provider") {
        const { data, error } = await supabase
            .from("applications")
            .select(`
                *,
                job:jobs!inner(
                    id, title, description, status, posted_by, wage_hourly, payment_type,
                    public_location_label, category, job_kind, recurrence_rule,
                    continuity_preferred, completed_at
                )
            `)
            .eq("jobs.posted_by", profile.id)
            .order("last_activity_at", { ascending: false });

        if (error) {
            console.error("Provider activity fetch error:", error);
            return <ActivityLoadError />;
        }

        const baseRows = (data ?? []).map(normalizeJoinedRow);
        const [enrichedRows, partnerResult] = await Promise.all([
            enrichActivityRows(supabase, baseRows),
            fetchActivityPartnerProfiles(supabase, baseRows.map((row) => row.id)),
        ]);
        if (partnerResult.error) console.error("Provider activity partner fetch error:", partnerResult.error);
        const applications = attachPartnerProfiles(enrichedRows, partnerResult.data, "provider");
        const selectedJobTitle = selectedJobId
            ? applications.find((application) => application.job?.id === selectedJobId)?.job?.title ?? null
            : null;
        const visibleApplications = selectedJobId
            ? applications.filter((application) => application.job?.id === selectedJobId)
            : applications;

        return (
            <ActivityPageShell>
                <ProviderActivityList
                    paymentOrdersEnabled={paymentOrdersEnabled}
                    applications={visibleApplications as any}
                    userId={profile.id}
                    selectedJobId={selectedJobId}
                    selectedJobTitle={selectedJobTitle}
                />
            </ActivityPageShell>
        );
    }

    const { data, error } = await supabase
        .from("applications")
        .select(`
            *,
            job:jobs(*)
        `)
        .eq("user_id", profile.id)
        .order("last_activity_at", { ascending: false });

    if (error) {
        console.error("Seeker activity fetch error:", error);
        return <ActivityLoadError />;
    }

    const baseRows = (data ?? []).map(normalizeJoinedRow);
    const [enrichedRows, partnerResult] = await Promise.all([
        enrichActivityRows(supabase, baseRows),
        fetchActivityPartnerProfiles(supabase, baseRows.map((row) => row.id)),
    ]);
    if (partnerResult.error) console.error("Seeker activity partner fetch error:", partnerResult.error);
    const applications = attachPartnerProfiles(enrichedRows, partnerResult.data, "seeker");

    return (
        <ActivityPageShell>
            <ActivitiesPageClient
                paymentOrdersEnabled={paymentOrdersEnabled}
                applications={applications}
                userId={profile.id}
            />
        </ActivityPageShell>
    );
}

function ActivityPageShell({ children }: { children: React.ReactNode }) {
    return (
        <div className={`${styles.page} activities-page`}>
            <AppRouteReady href="/app-home/activities" />
            <div className={styles.pageInner}>{children}</div>
        </div>
    );
}

function ActivityLoadError() {
    return (
        <>
            <AppRouteReady href="/app-home/activities" />
            <div className="container mx-auto px-4 py-12 text-red-400">
                Nachrichten konnten nicht geladen werden.
            </div>
        </>
    );
}
