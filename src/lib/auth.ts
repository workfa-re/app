import type { Session } from "@supabase/supabase-js";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabaseServer";
import { Profile, isProfileComplete, SystemRoleType, AccountType } from "./types";
import type { EffectiveViewSnapshot } from "./types/platform";

const emptySessionContext = {
  session: null,
  profile: null,
  systemRoles: [],
  effectiveView: null,
} satisfies {
  session: Session | null;
  profile: Profile | null;
  systemRoles: string[];
  effectiveView: EffectiveViewSnapshot | null;
};

const isMissingSupabaseEnvError = (error: unknown) =>
  error instanceof Error && error.message.includes("Missing Supabase env vars");

export type AuthState =
  | { state: "no-session" }
  | { state: "email-unconfirmed"; session: Session; profile: Profile | null; systemRoles: string[]; effectiveView: EffectiveViewSnapshot | null }
  | { state: "incomplete-profile"; session: Session; profile: Profile | null; systemRoles: string[]; effectiveView: EffectiveViewSnapshot | null }
  | { state: "ready"; session: Session; profile: Profile | null; systemRoles: string[]; effectiveView: EffectiveViewSnapshot | null };

const getCurrentSessionAndProfileCached = cache(async (): Promise<{
  session: Session | null;
  profile: Profile | null;
  systemRoles: string[];
  effectiveView: EffectiveViewSnapshot | null;
}> => {
  let supabase: Awaited<ReturnType<typeof supabaseServer>>;

  try {
    supabase = await supabaseServer();
  } catch (error) {
    if (isMissingSupabaseEnvError(error)) {
      return emptySessionContext;
    }

    throw error;
  }

  // Use getUser() first — this contacts the Supabase Auth server and
  // refreshes the session if the access token has expired.
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user?.id) {
    return { session: null, profile: null, systemRoles: [], effectiveView: null };
  }

  // Read raw tokens only; cookie-backed session.user is not an authorization
  // source. Every identity/profile field comes from the verified Auth response.
  const { data: { session: storedSession }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !storedSession || storedSession.user?.id !== user.id) {
    return { session: null, profile: null, systemRoles: [], effectiveView: null };
  }
  const session: Session = { ...storedSession, user };

  const [profileResult, rolesResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_system_roles").select("role:system_roles(name)").eq("user_id", user.id),
  ]);

  const profile = profileResult.data as Profile | null;
  if (profile && !profile.email && session.user.email) {
    profile.email = session.user.email;
  }

  // Extract system roles
  const systemRoles = rolesResult.data ? (rolesResult.data as any[]).map((r) => r.role?.name).filter(Boolean) : [];

  let effectiveView: EffectiveViewSnapshot | null = null;

  if (profile) {
    const baseRole = (profile.account_type as AccountType | null) ?? "job_seeker";
    effectiveView = {
      viewRole: baseRole,
      roles: systemRoles,
    };

    profile.account_type = effectiveView.viewRole;
  }

  return { session, profile: profile ?? null, systemRoles, effectiveView };
});

export const getCurrentSessionAndProfile = async () => getCurrentSessionAndProfileCached();

// Helpers
export const isAccountType = (profile: Profile | null, type: AccountType) => {
  return profile?.account_type === type;
};

export const hasSystemRole = (userRoles: string[], role: SystemRoleType) => {
  return userRoles.includes(role);
};

// Klare Zustände, kein Redirect
const getAuthStateCached = cache(async (): Promise<AuthState> => {
  const { session, profile, systemRoles, effectiveView } = await getCurrentSessionAndProfileCached();

  if (!session) {
    return { state: "no-session" } as const;
  }

  const isEmailConfirmed = Boolean(session.user.email_confirmed_at);

  if (!isEmailConfirmed) {
    return { state: "email-unconfirmed", session, profile, systemRoles, effectiveView } as const;
  }

  if (!isProfileComplete(profile)) {
    return { state: "incomplete-profile", session, profile, systemRoles, effectiveView } as const;
  }

  return { state: "ready", session, profile, systemRoles, effectiveView } as const;
});

export async function getAuthState(): Promise<AuthState> {
  return getAuthStateCached();
}

export const requireSession = async () => {
  const state = await getAuthState();
  if (state.state === "no-session") redirect("/");
  if (state.state === "email-unconfirmed") redirect("/onboarding");
  return { session: state.session!, profile: state.profile ?? null, systemRoles: state.systemRoles };
};

export const requireCompleteProfile = async () => {
  const state = await getAuthState();
  if (state.state === "no-session") redirect("/");
  if (state.state === "email-unconfirmed")
    redirect("/onboarding");
  if (state.state === "incomplete-profile") redirect("/onboarding");
  return { session: state.session!, profile: state.profile!, systemRoles: state.systemRoles };
};

export const redirectIfAuthenticated = async () => {
  const state = await getAuthState();
  if (state.state === "ready") redirect("/app-home");
};
