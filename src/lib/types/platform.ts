import type { AccountType } from "@/lib/types";
import type { Database } from "@/lib/types/supabase";
import type { Market, Profile } from "@/lib/types";

export type ErrorInfo = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusText?: string;
};

export type EffectiveViewSnapshot = {
  viewRole: AccountType;
  roles: string[];
};

export type JobStatus = Database["public"]["Enums"]["job_status"];
export type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export type WaitlistJobSummary = {
  job_id: string;
  waitlist_count: number;
  next_position: number;
  conversation_active: boolean;
  my_waitlist_position: number | null;
};

// Normalized shape for list rendering across list and detail views.
export type JobsListItem = {
  id: string;
  title: string;
  description: string | null;
  posted_by: string;
  status: JobStatus;
  created_at: string;
  market_id: string | null;
  public_location_label: string | null;
  public_lat?: number | null;
  public_lng?: number | null;
  wage_hourly: number | null;
  payment_type?: "hourly" | "fixed" | null;
  job_kind?: "one_time" | "recurring" | null;
  recurrence_rule?: "weekly" | "biweekly" | "monthly" | "flexible" | null;
  continuity_preferred?: boolean;
  reach?: 'internal_rheinbach' | 'extended' | null;
  // Optional enrichments (separate lookup).
  distance_km?: number | null;
  market_name?: string | null;
  brand_prefix?: string | null;
  is_applied?: boolean;
  creator?: {
    id?: string;
    full_name: string | null;
    company_name: string | null;
    account_type: AccountType;
    avatar_url?: string | null;
    bio?: string | null;
    city?: string | null;
    country?: string | null;
    created_at?: string | null;
    provider_verification_status?: string | null;
    is_staff?: boolean;
  } | null;
  category?: string | null;
  address_reveal_policy?: string | null;
  application_status?: ApplicationStatus | null;
  application_id?: string | null;
  waitlist_count?: number | null;
  next_position?: number | null;
  conversation_active?: boolean | null;
  my_waitlist_position?: number | null;
};

/** Merge privacy-preserving waitlist metadata without exposing another applicant. */
export function mergeWaitlistJobSummaries(
  jobs: JobsListItem[],
  summaries: WaitlistJobSummary[],
): JobsListItem[] {
  if (jobs.length === 0 || summaries.length === 0) return jobs;

  const summariesByJobId = new Map(summaries.map((summary) => [summary.job_id, summary]));

  return jobs.map((job) => {
    const summary = summariesByJobId.get(job.id);
    if (!summary) return job;

    return {
      ...job,
      waitlist_count: Number(summary.waitlist_count ?? 0),
      next_position: Number(summary.next_position ?? 1),
      conversation_active: Boolean(summary.conversation_active),
      my_waitlist_position: summary.my_waitlist_position == null
        ? null
        : Number(summary.my_waitlist_position),
    };
  });
}

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"] & {
  applicant?: {
    full_name: string | null;
    avatar_url?: string | null;
  } | null;
};

export type HeaderNotificationItem = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "type" | "title" | "body" | "created_at" | "read_at"
>;

export type AppHeaderProfile = Profile & {
  has_active_guardian?: boolean;
};

export type AppHomeSnapshot = {
  sessionUserId: string;
  profile: AppHeaderProfile;
  profileLite: AppHeaderProfile;
  effectiveView: EffectiveViewSnapshot;
  market: Market | null;
  isStaff: boolean;
  accountEmail: string | null;
  guardianStatus: string;
  hasActiveGuardian: boolean;
  isVerified: boolean;
  canApply: boolean;
  unreadCount: number;
  notificationsPreview: HeaderNotificationItem[];
};
