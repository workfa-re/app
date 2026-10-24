import { currentBrandLabel } from "@/lib/brand-compat";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { Market } from "@/lib/types";
import type { AccountType, Profile } from "@/lib/types";
import type { AppHeaderProfile, AppHomeSnapshot, EffectiveViewSnapshot } from "@/lib/types/platform";
import { normalizeNotificationItem, parseNotificationPage } from "@/components/notifications/notificationPayload";
import type { NotificationItem } from "@/components/notifications/notificationTypes";
import { getGuardianApplicationAccess } from "@/lib/guardian/access-state.server";
import { hasCompleteProviderAddress } from "@/lib/provider-address";

export function getDefaultAppHomePath(viewRole: AccountType | null | undefined) {
  return viewRole === "job_provider" ? "/app-home/offers" : "/app-home/jobs";
}

function buildFallbackView(profile: Profile): EffectiveViewSnapshot {
  return {
    viewRole: (profile.account_type ?? "job_seeker") as AccountType,
    roles: [],
  };
}

export const getMarketSummary = cache(async (marketId: string | null | undefined): Promise<Market | null> => {
  if (!marketId) return null;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("regions_live")
    .select("id, city, is_live, display_name, brand_prefix")
    .eq("id", marketId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    display_name: currentBrandLabel(data.display_name || data.city),
    brand_prefix: currentBrandLabel(data.brand_prefix),
    is_live: data.is_live,
  };
});

const getVerificationState = cache(async (
  viewRole: AccountType,
  guardianStatus: string | null,
  providerVerificationStatus: string | null,
  providerVerifiedAt: string | null,
): Promise<{
  guardianStatus: string;
  hasActiveGuardian: boolean;
  isVerified: boolean;
  canApply: boolean;
}> => {
  if (viewRole === "job_provider") {
    const isVerified = providerVerificationStatus === "verified" && Boolean(providerVerifiedAt);
    return {
      guardianStatus: guardianStatus ?? "none",
      hasActiveGuardian: false,
      isVerified,
      canApply: false,
    };
  }

  return await getGuardianApplicationAccess() ?? {
    guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: false,
  };
});

type AppHomeContext = Pick<AppHomeSnapshot,
  "sessionUserId" | "profile" | "profileLite" | "effectiveView" | "isStaff" | "accountEmail"
>;

/** Request-scoped identity needed to start page data without waiting for header UI. */
export const getAppHomeContext = cache(async (): Promise<AppHomeContext> => {
  const authState = await getAuthState();

  if (authState.state === "no-session" || authState.state === "email-unconfirmed") {
    redirect("/");
  }

  if (authState.state === "incomplete-profile") {
    redirect("/onboarding");
  }
  if (authState.state === "family-only") redirect("/guardian/access");

  const profile = authState.profile!;
  const effectiveView = authState.effectiveView ?? buildFallbackView(profile);
  const normalizedProfile: AppHeaderProfile = { ...profile, account_type: effectiveView.viewRole };

  return {
    sessionUserId: profile.id,
    profile: normalizedProfile,
    profileLite: normalizedProfile,
    effectiveView,
    isStaff: authState.systemRoles.some((role) => ["admin", "moderator", "analyst"].includes(role)),
    accountEmail: profile.email?.trim() || null,
  };
});

export async function getAppHomeAccess(context: AppHomeContext) {
  const { profile, effectiveView } = context;
  const access = await getVerificationState(
    effectiveView.viewRole,
    profile.guardian_status,
    profile.provider_verification_status,
    profile.provider_verified_at,
  );
  return { ...access, ...(effectiveView.viewRole === "job_provider" ? { canCreateJobs: hasCompleteProviderAddress(profile) } : {}) };
}

export const getAppHomeSnapshot = cache(async (): Promise<AppHomeSnapshot> => {
  const context = await getAppHomeContext();
  const { profile } = context;

  const marketPromise = getMarketSummary(profile.market_id);
  const verificationPromise = getAppHomeAccess(context);
  const supabase = await supabaseServer();
  const notificationsPromise = (async () => {
    const { data, error } = await supabase.rpc("get_notification_feed", { p_limit: 25 });
    if (!error) {
      try {
        const page = parseNotificationPage(data);
        return { unreadCount: page.unreadCount, notifications: page.notifications.filter(item => !item.user_id || item.user_id === profile.id) };
      } catch { return { unreadCount: 0, notifications: [] }; }
    }
    // A rolling deployment may briefly run against the previous schema. Never
    // broaden visibility when the new schema exists but the RPC is unavailable.
    if (error.code !== "PGRST202" && error.code !== "42883") return { unreadCount: 0, notifications: [] };
    const visibleRows = supabase.from("notifications").select("id, type, title, body, data, category, priority, event_key, event_type, seen_at, created_at, read_at")
      .eq("user_id", profile.id).eq("in_app_visible", true).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25);
    const visibleCount = supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", profile.id).eq("in_app_visible", true).is("read_at", null);
    const [rows, count] = await Promise.all([visibleRows, visibleCount]);
    if (!rows.error && !count.error) return { unreadCount: count.count ?? 0, notifications: (rows.data ?? []).map(normalizeNotificationItem).filter((item): item is NotificationItem => item !== null) };
    if (![rows.error?.code, count.error?.code].some(code => code === "42703" || code === "PGRST204")) return { unreadCount: 0, notifications: [] };
    const [compatibleRows, compatibleCount] = await Promise.all([
      supabase.from("notifications").select("id, type, title, body, data, created_at, read_at").eq("user_id", profile.id).eq("in_app_visible", true)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25),
      visibleCount,
    ]);
    if (!compatibleRows.error && !compatibleCount.error) return { unreadCount: compatibleCount.count ?? 0, notifications: compatibleRows.data ?? [] };
    const visibilityMissing = [compatibleRows.error, compatibleCount.error].some(failure =>
      (failure?.code === "42703" || failure?.code === "PGRST204") && failure.message.includes("in_app_visible"));
    if (!visibilityMissing) return { unreadCount: 0, notifications: [] };
    const [legacyRows, legacyCount] = await Promise.all([
      supabase.from("notifications").select("id, type, title, body, data, created_at, read_at").eq("user_id", profile.id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null),
    ]);
    return { unreadCount: legacyCount.error ? 0 : legacyCount.count ?? 0, notifications: legacyRows.error ? [] : legacyRows.data ?? [] };
  })();
  const [market, verification, notifications] = await Promise.all([
    marketPromise,
    verificationPromise,
    notificationsPromise,
  ]);

  const normalizedProfile: AppHeaderProfile = {
    ...profile,
    guardian_status: verification.guardianStatus as Profile["guardian_status"],
    has_active_guardian: verification.hasActiveGuardian,
  };

  return {
    ...context,
    profile: normalizedProfile,
    profileLite: normalizedProfile,
    market,
    guardianStatus: verification.guardianStatus,
    hasActiveGuardian: verification.hasActiveGuardian,
    isVerified: verification.isVerified,
    canApply: verification.canApply,
    unreadCount: notifications.unreadCount,
    notificationsPreview: notifications.notifications,
  };
});
