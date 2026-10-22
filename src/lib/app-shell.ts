import { currentBrandLabel } from "@/lib/brand-compat";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { Market } from "@/lib/types";
import type { AccountType, Profile } from "@/lib/types";
import type { AppHeaderProfile, AppHomeSnapshot, EffectiveViewSnapshot } from "@/lib/types/platform";

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
  profileId: string,
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
    const isVerified = providerVerificationStatus === "verified" || Boolean(providerVerifiedAt);
    return {
      guardianStatus: guardianStatus ?? "none",
      hasActiveGuardian: false,
      isVerified,
      canApply: false,
    };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("guardian_relationships")
    .select("child_id")
    .eq("child_id", profileId)
    .eq("status", "active")
    .limit(1);

  const hasActiveGuardian = !error && Boolean(data?.length);

  return {
    guardianStatus: hasActiveGuardian ? "linked" : "none",
    hasActiveGuardian,
    isVerified: hasActiveGuardian,
    canApply: hasActiveGuardian,
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

export function getAppHomeAccess(context: AppHomeContext) {
  const { profile, effectiveView } = context;
  return getVerificationState(
    profile.id,
    effectiveView.viewRole,
    profile.guardian_status,
    profile.provider_verification_status,
    profile.provider_verified_at,
  );
}

export const getAppHomeSnapshot = cache(async (): Promise<AppHomeSnapshot> => {
  const context = await getAppHomeContext();
  const { profile } = context;

  const marketPromise = getMarketSummary(profile.market_id);
  const verificationPromise = getAppHomeAccess(context);
  const supabase = await supabaseServer();
  const [market, verification, unreadResult, notificationsResult] = await Promise.all([
    marketPromise,
    verificationPromise,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .is("read_at", null),
    supabase
      .from("notifications")
      .select("id, type, title, body, data, created_at, read_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10),
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
    unreadCount: unreadResult.error ? 0 : unreadResult.count ?? 0,
    notificationsPreview: notificationsResult.error ? [] : notificationsResult.data ?? [],
  };
});
