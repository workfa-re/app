import { currentBrandLabel } from "@/lib/brand-compat";
import { supabaseServer } from "@/lib/supabaseServer";
import type { AccountType } from "@/lib/types";
import type { Database } from "@/lib/types/supabase";
import {
  type EffectiveViewSnapshot,
  type ErrorInfo,
  type JobsListItem,
  type ApplicationRow,
  type ApplicationStatus,
} from "@/lib/types/platform";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { jobDistanceBounds, jobDistanceKm, type JobCoordinates, type JobDiscoveryCandidate } from "@/lib/jobs/discovery";
import type { FilterState } from "@/lib/jobs/sortFilter";
import {
  fetchActivityPartnerProfiles,
  fetchVisibleJobCreatorSummaries,
} from "@/lib/dal/visible-profiles";

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
    opts?.baseAccountType === undefined
      ? supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
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
  jobIds?: readonly string[];
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

type AppliedJobState = Map<string, { id: string; status: ApplicationStatus }>;

/** Load application state only for returned cards, retaining lower API row caps. */
async function fetchAppliedJobIds(
  client: SupabaseClient<Database>,
  userId: string,
  jobIds: string[],
): Promise<Result<AppliedJobState>> {
  const applied: AppliedJobState = new Map();
  const ids = [...new Set(jobIds)];
  if (!userId || ids.length === 0) return { ok: true, data: applied };
  const batchSize = 100;
  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize);
    let total: number | null = null;
    for (let offset = 0; ;) {
      const { data, error, count } = await client.from("applications")
        .select("id, job_id, status", offset === 0 ? { count: "exact" } : undefined)
        .eq("user_id", userId).in("job_id", batch)
        .order("id", { ascending: true }).range(offset, offset + batchSize - 1);
      if (error) return { ok: false, error: toErrorInfo(error) };
      if (offset === 0) total = count ?? null;
      for (const application of data ?? []) {
        applied.set(application.job_id, { id: application.id, status: application.status });
      }
      const returned = data?.length ?? 0;
      offset += returned;
      if (!returned || (total !== null && offset >= total)) break;
    }
  }
  return { ok: true, data: applied };
}

const JOB_CARD_COLUMNS = "id, title, description, posted_by, status, created_at, market_id, public_location_label, public_lat, public_lng, wage_hourly, payment_type, job_kind, recurrence_rule, continuity_preferred, category, address_reveal_policy, reach" as const;
type JobCardRow = Pick<Database["public"]["Tables"]["jobs"]["Row"],
  "id" | "title" | "description" | "posted_by" | "status" | "created_at" | "market_id" |
  "public_location_label" | "public_lat" | "public_lng" | "wage_hourly" | "payment_type" |
  "job_kind" | "recurrence_rule" | "continuity_preferred" | "category" | "address_reveal_policy" | "reach"
>;

/** Map a raw DB row to the normalized `JobsListItem` shape. */
function toJobsListItem(row: JobCardRow): JobsListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    posted_by: row.posted_by,
    status: row.status,
    created_at: String(row.created_at ?? ""),
    market_id: row.market_id ?? null,
    public_location_label: row.public_location_label ?? null,
    public_lat: row.public_lat != null ? Number(row.public_lat) : null,
    public_lng: row.public_lng != null ? Number(row.public_lng) : null,
    wage_hourly: row.wage_hourly != null ? Number(row.wage_hourly) : null,
    payment_type: row.payment_type === "fixed" ? "fixed" : "hourly",
    job_kind: row.job_kind === "recurring" ? "recurring" : "one_time",
    recurrence_rule: ["weekly", "biweekly", "monthly", "flexible"].includes(row.recurrence_rule ?? "")
      ? row.recurrence_rule as JobsListItem["recurrence_rule"]
      : null,
    continuity_preferred: Boolean(row.continuity_preferred),
    category: row.category ?? "",
    address_reveal_policy: row.address_reveal_policy ?? "after_apply",
    reach: row.reach === "extended" ? "extended" : "internal_rheinbach",
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

async function enrichJobsInParallel(
  supabase: SupabaseClient<Database>,
  items: JobsListItem[],
): Promise<JobsListItem[]> {
  const [withMarkets, withCreators] = await Promise.all([
    enrichWithMarketNames(supabase, items),
    enrichWithCreators(supabase, items),
  ]);

  return items.map((item, index) => ({
    ...item,
    market_name: withMarkets[index]?.market_name ?? item.market_name,
    brand_prefix: withMarkets[index]?.brand_prefix ?? item.brand_prefix,
    creator: withCreators[index]?.creator ?? item.creator,
  }));
}

export async function fetchJobs(params: FetchJobsParams): Promise<Result<JobsListItem[]>> {
  if (params.jobIds?.length === 0) return { ok: true, data: [] };
  const supabase = await supabaseServer();
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const status = params.status ?? "open";

  const applyRange = (q: any) => {
    if (!limit) return q;
    return q.range(offset, offset + limit - 1);
  };

  let q = supabase.from("jobs").select(JOB_CARD_COLUMNS);
  if (params.jobIds) q = q.in("id", [...params.jobIds]);
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

  const [{ lat: userLat, lng: userLng }, { data, error }] = await Promise.all([
    resolveUserCoordinates(supabase, params.userId, params.userCoordinates),
    q,
  ]);
  if (error) return { ok: false, error: toErrorInfo(error) };

  const [applications, enrichedItems] = await Promise.all([
    params.includeApplicationState === false
      ? Promise.resolve({ ok: true as const, data: new Map() as AppliedJobState })
      : fetchAppliedJobIds(supabase, params.userId, (data ?? []).map(row => row.id)),
    enrichJobsInParallel(supabase, (data ?? []).map(toJobsListItem)),
  ]);
  if (!applications.ok) return applications;

  const items = enrichedItems.map((item) => {
    const appData = applications.data.get(item.id);
    const distance_km = jobDistanceKm({ lat: userLat, lng: userLng }, { lat: item.public_lat, lng: item.public_lng });

    return {
      ...item,
      is_applied: !!appData,
      application_id: appData?.id || null,
      application_status: appData?.status || null,
      distance_km
    };
  });

  return { ok: true, data: items };
}

/** Read only the fields needed to find matching IDs before loading full job cards. */
export async function fetchJobDiscoveryCandidates(params: {
  marketId?: string | null;
  userCoordinates: JobCoordinates;
  filters: FilterState;
}): Promise<Result<JobDiscoveryCandidate[]>> {
  const supabase = await supabaseServer();
  const bounds = jobDistanceBounds(params.userCoordinates, params.filters.maxDistanceKm);
  const rows: JobDiscoveryCandidate[] = [];
  const batchSize = 100;
  let total: number | null = null;
  for (let offset = 0; ;) {
    let query = supabase.from("jobs")
      .select("id, created_at, category, wage_hourly, public_lat, public_lng", offset === 0 ? { count: "exact" } : undefined)
      .eq("status", "open");
    if (params.marketId) query = query.or(`market_id.eq.${params.marketId},reach.eq.extended`);
    else query = query.eq("reach", "extended");
    if (params.filters.categories.includes("other")) {
      // Older jobs without a category use the same "other" fallback in the UI.
      const categories = params.filters.categories.map(value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
      query = query.or(`category.is.null,category.in.(${categories})`);
    } else if (params.filters.categories.length) query = query.in("category", params.filters.categories);
    if (bounds) {
      query = query.gte("public_lat", bounds.latitudeMin).lte("public_lat", bounds.latitudeMax);
      if (bounds.longitude) query = query.gte("public_lng", bounds.longitude.west).lte("public_lng", bounds.longitude.east);
    }
    const { data, error, count } = await query.order("id", { ascending: true }).range(offset, offset + batchSize - 1);
    if (error) return { ok: false, error: toErrorInfo(error) };
    if (offset === 0) total = count ?? null;
    for (const row of data ?? []) rows.push({
      ...row,
      distance_km: jobDistanceKm(params.userCoordinates, { lat: row.public_lat, lng: row.public_lng }),
    });
    const returned = data?.length ?? 0;
    offset += returned;
    if (!returned || (total !== null ? offset >= total : returned < batchSize)) break;
  }
  return { ok: true, data: rows };
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

/** All own applications are routing links, including ended conversations. */
export async function fetchCandidateApplicationLinks(
  userId: string,
): Promise<Result<Pick<ApplicationRow, "id" | "job_id">[]>> {
  const supabase = await supabaseServer();
  const links: Pick<ApplicationRow, "id" | "job_id">[] = [];
  const batchSize = 100;
  let total: number | null = null;
  for (let offset = 0; ;) {
    const { data, error, count } = await supabase.from("applications")
      .select("id, job_id", offset === 0 ? { count: "exact" } : undefined)
      .eq("user_id", userId)
      .order("id", { ascending: true }).range(offset, offset + batchSize - 1);
    if (error) return { ok: false, error: toErrorInfo(error) };
    if (offset === 0) total = count ?? null;
    links.push(...data ?? []);
    const returned = data?.length ?? 0;
    offset += returned;
    if (!returned || (total !== null && offset >= total)) break;
  }
  return { ok: true, data: links };
}
