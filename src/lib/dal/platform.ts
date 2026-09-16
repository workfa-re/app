import { currentBrandLabel } from "@/lib/brand-compat";
import { supabaseServer } from "@/lib/supabaseServer";
import type { AccountType } from "@/lib/types";
import type { Database } from "@/lib/types/supabase";
import {
  mergeWaitlistJobSummaries,
  type EffectiveViewSnapshot,
  type ErrorInfo,
  type JobsListItem,
  type ApplicationRow,
  type ApplicationStatus,
  type WaitlistJobSummary,
} from "@/lib/types/platform";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  fetchActivityPartnerProfiles,
  fetchVisibleJobCreatorSummaries,
} from "@/lib/dal/visible-profiles";

// Haversine formula for calculating distance between two coordinates in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

function toErrorInfo(error: unknown, extra?: Pick<ErrorInfo, "status" | "statusText">): ErrorInfo {
  if (!error) return { message: "Unknown error" };

  if (typeof error === "object" && error !== null && "message" in error) {
    const e = error as Partial<PostgrestError> & { message: string };
    return {
      message: e.message,
      code: typeof e.code === "string" ? e.code : undefined,
      details: typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
      ...extra,
    };
  }

  if (typeof error === "string") return { message: error, ...extra };
  return { message: "Unknown error", ...extra };
}

// ────────────────────────────────────────────────────────────────────
// Auth helper
// ────────────────────────────────────────────────────────────────────

export async function getSessionUser(): Promise<Result<{ userId: string }>> {
  const supabase = await supabaseServer();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { ok: false, error: toErrorInfo(error) };
    if (!data.user?.id) return { ok: false, error: { message: "Nicht authentifiziert" } };
    return { ok: true, data: { userId: data.user.id } };
  } catch (e) {
    return { ok: false, error: toErrorInfo(e) };
  }
}

// ────────────────────────────────────────────────────────────────────
// Effective view (base account type + protected system roles)
// ────────────────────────────────────────────────────────────────────

export async function getEffectiveView(opts?: {
  userId?: string;
  baseAccountType?: AccountType | null;
}): Promise<Result<EffectiveViewSnapshot>> {
  const supabase = await supabaseServer();

  // Resolve userId
  const userResult = opts?.userId ?? (await getSessionUser());
  if (typeof userResult !== "string" && !userResult.ok) return { ok: false, error: userResult.error };
  const userId = typeof userResult === "string" ? userResult : userResult.data.userId;
  if (!userId) return { ok: false, error: { message: "Missing userId" } };

  const [profileResult, rolesResult] = await Promise.all([
    supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
    supabase.from("user_system_roles").select("role:system_roles(name)").eq("user_id", userId),
  ]);

  const systemRoles = rolesResult.data ? (rolesResult.data as any[]).map((r) => r.role?.name).filter(Boolean) : [];

  // Base account type remains the only product-facing view role.
  let baseAccountType = opts?.baseAccountType ?? null;
  if (baseAccountType === undefined || baseAccountType === null) {
    if (opts?.baseAccountType === undefined) {
      baseAccountType = (profileResult.data?.account_type as AccountType | null) ?? null;
    }
  }

  const baseRole: AccountType = baseAccountType === "job_provider" ? "job_provider" : "job_seeker";

  return {
    ok: true,
    data: {
      viewRole: baseRole,
      roles: systemRoles,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Fetch jobs
// ────────────────────────────────────────────────────────────────────

export type FetchJobsParams = {
  mode: "feed" | "my_jobs";
  userId: string;
  marketId?: string | null;
  userCoordinates?: UserCoordinates;
  includeApplicationState?: boolean;
  status?: Database["public"]["Enums"]["job_status"] | Database["public"]["Enums"]["job_status"][];
  limit?: number;
  offset?: number;
};

type UserCoordinates = {
  lat?: number | null;
  lng?: number | null;
};

async function resolveUserCoordinates(
  supabase: SupabaseClient<Database>,
  userId: string,
  providedCoordinates?: UserCoordinates,
): Promise<UserCoordinates> {
  if (providedCoordinates) {
    return {
      lat: providedCoordinates.lat ?? null,
      lng: providedCoordinates.lng ?? null,
    };
  }

  if (!userId) return { lat: null, lng: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("lat, lng")
    .eq("id", userId)
    .single();

  return {
    lat: profile?.lat ?? null,
    lng: profile?.lng ?? null,
  };
}

/** Fetch the map of job IDs -> Application Data the current user has applied to. */
async function fetchAppliedJobIds(userId: string): Promise<Map<string, { id: string; status: ApplicationStatus }>> {
  if (!userId) return new Map();

  const client = await supabaseServer();

  const { data, error } = await client
    .from("applications")
    .select("id, job_id, status")
    .eq("user_id", userId);

  if (error) {
    console.warn("[DAL] fetchAppliedJobIds error", error.message);
    return new Map();
  }
  return new Map(data?.map((a) => [a.job_id, { id: a.id, status: a.status as ApplicationStatus }]) ?? []);
}

/** Map a raw DB row to the normalized `JobsListItem` shape. */
function toJobsListItem(row: Database["public"]["Tables"]["jobs"]["Row"]): JobsListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    posted_by: row.posted_by,
    status: row.status,
    created_at: String(row.created_at ?? ""),
    market_id: row.market_id ?? null,
    public_location_label: row.public_location_label ?? null,
    public_lat: row.public_lat ? Number(row.public_lat) : null,
    public_lng: row.public_lng ? Number(row.public_lng) : null,
    wage_hourly: row.wage_hourly != null ? Number(row.wage_hourly) : null,
    payment_type: row.payment_type === "fixed" ? "fixed" : "hourly",
    job_kind: row.job_kind === "recurring" ? "recurring" : "one_time",
    recurrence_rule: ["weekly", "biweekly", "monthly", "flexible"].includes(row.recurrence_rule ?? "")
      ? row.recurrence_rule as JobsListItem["recurrence_rule"]
      : null,
    continuity_preferred: Boolean(row.continuity_preferred),
    category: row.category ?? "",
    address_reveal_policy: row.address_reveal_policy ?? "after_apply",
    reach: (row as any).reach ?? 'internal_rheinbach',
    is_applied: false,
  };
}

/**
 * Enrich jobs with market info from `regions_live`.
 * The table has `city` (no `display_name` / `brand_prefix`).
 */
async function enrichWithMarketNames(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  items = items.map((item) => ({
    ...item,
    ...(item.market_name ? { market_name: currentBrandLabel(item.market_name) } : {}),
    ...(item.brand_prefix ? { brand_prefix: currentBrandLabel(item.brand_prefix) } : {}),
  }));
  const ids = [...new Set(items.filter((j) => j.market_id && !j.market_name).map((j) => j.market_id!))];
  if (ids.length === 0) return items;

  const { data, error } = await supabase.from("regions_live").select("id, city, display_name, brand_prefix").in("id", ids);
  if (error || !data) return items;

  const map = new Map(data.map((r) => [r.id, { city: r.city, displayName: r.display_name, brandPrefix: r.brand_prefix }]));
  return items.map((j) => {
    if (!j.market_id || j.market_name) return j;
    const m = map.get(j.market_id);
    return m ? { ...j, market_name: currentBrandLabel(m.displayName || m.city), brand_prefix: currentBrandLabel(m.brandPrefix) } : j;
  });
}

/** Enrich jobs with creator profile info. */
async function enrichWithCreators(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  const jobIds = [...new Set(items.map((item) => item.id).filter(Boolean))];
  if (jobIds.length === 0) return items;

  const { data, error } = await fetchVisibleJobCreatorSummaries(supabase, jobIds);

  if (error || !data) {
    if (error) console.warn("[DAL] get_visible_job_creator_summaries error", error.message);
    return items;
  }

  const creatorMap = new Map(data.map((creator) => [creator.job_id, creator]));
  return items.map((i) => {
    const c = creatorMap.get(i.id);
    return {
      ...i,
      creator: c ? {
        id: c.creator_id,
        full_name: c.full_name,
        company_name: c.company_name,
        account_type: (c.account_type ?? "job_provider") as AccountType,
        avatar_url: c.avatar_url,
        bio: c.bio,
        city: c.city,
        country: c.country,
        created_at: c.created_at,
        provider_verification_status: c.provider_verification_status,
        is_staff: Boolean(c.is_staff),
      } : null,
    };
  });
}

/**
 * Enrich reserved jobs with aggregate queue information only.
 * The RPC deliberately exposes no data about the active applicant.
 */
async function enrichWithWaitlistSummaries(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  const reservedJobIds = [...new Set(items.filter((job) => job.status === "reserved").map((job) => job.id))];
  if (reservedJobIds.length === 0) return items;

  const { data, error } = await supabase.rpc("get_waitlist_job_summaries", {
    p_job_ids: reservedJobIds,
  });

  if (error) {
    console.warn("[DAL] get_waitlist_job_summaries error", error.message);
    return items;
  }

  return mergeWaitlistJobSummaries(items, (data ?? []) as WaitlistJobSummary[]);
}

async function enrichJobsInParallel(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  const [withMarkets, withCreators, withWaitlistSummaries] = await Promise.all([
    enrichWithMarketNames(supabase, items),
    enrichWithCreators(supabase, items),
    enrichWithWaitlistSummaries(supabase, items),
  ]);

  return items.map((item, index) => ({
    ...item,
    market_name: withMarkets[index]?.market_name ?? item.market_name,
    brand_prefix: withMarkets[index]?.brand_prefix ?? item.brand_prefix,
    creator: withCreators[index]?.creator ?? item.creator,
    waitlist_count: withWaitlistSummaries[index]?.waitlist_count ?? item.waitlist_count,
    next_position: withWaitlistSummaries[index]?.next_position ?? item.next_position,
    conversation_active: withWaitlistSummaries[index]?.conversation_active ?? item.conversation_active,
    my_waitlist_position: withWaitlistSummaries[index]?.my_waitlist_position ?? item.my_waitlist_position,
  }));
}

async function enrichCandidateJobsInParallel(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  const [withMarkets, withCreators, withWaitlistSummaries] = await Promise.all([
    enrichWithMarketNames(supabase, items),
    enrichWithCreators(supabase, items),
    enrichWithWaitlistSummaries(supabase, items),
  ]);

  return items.map((item, index) => ({
    ...item,
    market_name: withMarkets[index]?.market_name ?? item.market_name,
    brand_prefix: withMarkets[index]?.brand_prefix ?? item.brand_prefix,
    creator: withCreators[index]?.creator ?? item.creator,
    waitlist_count: withWaitlistSummaries[index]?.waitlist_count ?? item.waitlist_count,
    next_position: withWaitlistSummaries[index]?.next_position ?? item.next_position,
    conversation_active: withWaitlistSummaries[index]?.conversation_active ?? item.conversation_active,
    my_waitlist_position: withWaitlistSummaries[index]?.my_waitlist_position ?? item.my_waitlist_position,
  }));
}

export async function fetchJobs(params: FetchJobsParams): Promise<Result<JobsListItem[]>> {
  const supabase = await supabaseServer();
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const status = params.status ?? "open";

  const applyRange = (q: any) => {
    if (!limit) return q;
    return q.range(offset, offset + limit - 1);
  };

  const { lat: userLat, lng: userLng } = await resolveUserCoordinates(
    supabase,
    params.userId,
    params.userCoordinates,
  );

  const appliedJobIds = params.includeApplicationState === false
    ? new Map<string, { id: string; status: ApplicationStatus }>()
    : await fetchAppliedJobIds(params.userId);

  let q = supabase.from("jobs").select("*");
  if (params.mode === "feed") {
    if (Array.isArray(status)) {
      q = q.in("status", status);
    } else {
      q = q.eq("status", status);
    }
    // Fetch local jobs OR extended jobs from other regions
    if (params.marketId) {
      q = q.or(`market_id.eq.${params.marketId},reach.eq.extended`);
    } else {
      // Fallback if user has no market_id: show everything for now or just extended? 
      // Safest is to just let it show everything if no market_id is set.
    }
  }
  if (params.mode === "my_jobs") q = q.eq("posted_by", params.userId);
  q = q.order("created_at", { ascending: false });
  q = applyRange(q) as typeof q;

  const { data, error } = await q;
  if (error) return { ok: false, error: toErrorInfo(error) };

  let items = (data ?? []).map((row) => {
    const appData = appliedJobIds.get(row.id);
    let distance_km = null;
    if (userLat != null && userLng != null && row.public_lat != null && row.public_lng != null) {
      distance_km = calculateDistance(userLat, userLng, Number(row.public_lat), Number(row.public_lng));
    }

    return {
      ...toJobsListItem(row),
      is_applied: !!appData,
      application_id: appData?.id || null,
      application_status: appData?.status || null,
      distance_km
    };
  });

  items = await enrichJobsInParallel(supabase, items) as typeof items;

  return { ok: true, data: items };
}

// ────────────────────────────────────────────────────────────────────
// Create job
// ────────────────────────────────────────────────────────────────────

export type CreateJobInput = {
  posted_by: string;
  market_id: string;
  title: string;
  description: string;
  wage_hourly: number;
  status: Database["public"]["Enums"]["job_status"];
  category: string;
  payment_type: string;
  address_reveal_policy?: string | null;
  public_location_label?: string;
  public_lat?: number | null;
  public_lng?: number | null;
  reach?: 'internal_rheinbach' | 'extended' | null;
  job_kind: 'one_time' | 'recurring';
  recurrence_rule?: 'weekly' | 'biweekly' | 'monthly' | 'flexible' | null;
  continuity_preferred?: boolean;
};

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"] & {
  market_name?: string | null;
  distance_km?: number | null;
  is_applied?: boolean;
  creator?: {
    full_name: string | null;
    company_name: string | null;
    account_type: Database["public"]["Enums"]["account_type"] | null;
  } | null;
};

export type JobPrivateInput = {
  address_full?: string | null;
  private_lat?: number | null;
  private_lng?: number | null;
  notes?: string | null;
  /** Kept for RPC compatibility; not stored in the table directly. */
  location_id?: string | null;
};

export type CreateJobOutcome = { jobId: string };

export async function createJob(params: {
  job: CreateJobInput;
  privateDetails: JobPrivateInput | null;
}): Promise<Result<CreateJobOutcome>> {
  const supabase = await supabaseServer();

  const rpcRes = await (supabase.rpc as any)("create_job_v2", {
    p_market_id: params.job.market_id,
    p_title: params.job.title,
    p_description: params.job.description,
    p_wage: params.job.wage_hourly,
    p_category: params.job.category,
    p_payment_type: params.job.payment_type,
    p_status: params.job.status,
    p_address_reveal_policy: params.job.address_reveal_policy ?? "after_accept",
    p_public_location_label: params.job.public_location_label ?? "",
    p_public_lat: params.job.public_lat ?? null,
    p_public_lng: params.job.public_lng ?? null,
    p_reach: params.job.reach ?? "internal_rheinbach",
    p_job_kind: params.job.job_kind,
    p_recurrence_rule: params.job.recurrence_rule ?? null,
    p_continuity_preferred: params.job.continuity_preferred ?? false,
    p_address_full: params.privateDetails?.address_full ?? null,
    p_private_lat: params.privateDetails?.private_lat ?? null,
    p_private_lng: params.privateDetails?.private_lng ?? null,
    p_notes: params.privateDetails?.notes ?? null,
  });

  if (rpcRes.error) {
    return { ok: false, error: toErrorInfo(rpcRes.error) };
  }
  const payload = rpcRes.data as { ok?: boolean; error?: string; job_id?: string } | null;
  if (!payload?.ok || !payload.job_id) {
    return { ok: false, error: { message: payload?.error || "Der Job konnte nicht erstellt werden." } };
  }

  return {
    ok: true,
    data: {
      jobId: payload.job_id,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Fetch job applications
// ────────────────────────────────────────────────────────────────────

export async function fetchJobApplications(jobId: string, _userId: string): Promise<Result<ApplicationRow[]>> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: toErrorInfo(error) };

  let items = (data as ApplicationRow[]) ?? [];

  // Participant-scoped profile summaries; no full profile-table access.
  const applicationIds = items.map((item) => item.id);
  if (applicationIds.length > 0) {
    const { data: partners, error: partnerError } = await fetchActivityPartnerProfiles(supabase, applicationIds);

    if (partnerError) {
      console.warn("[DAL] get_activity_partner_profiles error", partnerError.message);
    } else if (partners) {
      const map = new Map(partners.map((partner) => [partner.application_id, partner]));
      items = items.map((item) => {
        const partner = map.get(item.id);
        return {
          ...item,
          applicant: partner ? {
            full_name: partner.full_name,
            avatar_url: partner.avatar_url,
          } : null,
        };
      });
    }
  }

  return { ok: true, data: items };
}

export async function fetchCandidateApplications(
  userId: string,
  opts?: { userCoordinates?: UserCoordinates },
): Promise<Result<{ job: JobsListItem; status: Database["public"]["Enums"]["application_status"] }[]>> {
  const supabase = await supabaseServer();
  const { lat: userLat, lng: userLng } = await resolveUserCoordinates(
    supabase,
    userId,
    opts?.userCoordinates,
  );

  const { data, error } = await supabase
    .from("applications")
    .select("id, status, job:jobs(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: toErrorInfo(error) };

  // Map to JobsListItem
  let items = (data ?? []).map((row: any) => {
    const rawJob = row.job;
    let distance_km = null;

    // Calculate distance if both user and public job coordinates exist
    if (userLat != null && userLng != null && rawJob.public_lat != null && rawJob.public_lng != null) {
      distance_km = calculateDistance(userLat, userLng, Number(rawJob.public_lat), Number(rawJob.public_lng));
    }

    return {
      job: {
        ...toJobsListItem(rawJob),
        is_applied: true,
        application_status: row.status,
        application_id: row.id,
        distance_km
      } as JobsListItem,
      status: row.status as any // force cast
    };
  });

  // Enrich with market/creator (optimization: we could batch this, but for now reuse existing)
  // We need to extract the jobs list to enrich
  const jobsList = await enrichCandidateJobsInParallel(
    supabase,
    items.map((i: any) => i.job),
  );

  // Re-attach enriched jobs
  const enrichedItems = items.map((item: any, index: number) => ({
    ...item,
    job: jobsList[index]
  }));

  return { ok: true, data: enrichedItems };
}
