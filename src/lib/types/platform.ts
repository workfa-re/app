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
};

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"] & {
  applicant?: {
    full_name: string | null;
    avatar_url?: string | null;
  } | null;
};

export type HeaderNotificationItem = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "type" | "title" | "body" | "read_at"
> & {
  created_at: string | null;
  data?: unknown;
  category?: string;
  priority?: 1 | 2 | 3;
  event_key?: string | null;
  event_type?: string;
  seen_at?: string | null;
};

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
