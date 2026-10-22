import type { OnboardingRole, Profile } from "@/lib/types";

export type OnboardingStep =
  | "location"
  | "welcome"
  | "mode"
  | "auth"
  | "email-confirm"
  | "role"
  | "profile"
  | "contact"
  | "summary";

export function getOnboardingEntryStep({ forcedStep, initialMode, draftStep }: {
  forcedStep?: OnboardingStep | null;
  initialMode?: "signup" | "signin" | null;
  draftStep?: OnboardingStep;
}): OnboardingStep {
  if (forcedStep) return forcedStep;
  if (initialMode === "signin") return "auth";
  if (initialMode === "signup") return "location";
  if (!draftStep || draftStep === "mode") return "welcome";
  return draftStep;
}

export function mustChooseOnboardingRole(forcedStep: OnboardingStep | null | undefined, isJustVerified: boolean) {
  return forcedStep === "role" || forcedStep === "email-confirm" || isJustVerified;
}

export function inferOnboardingRole(profile: Profile | null | undefined): OnboardingRole | null {
  if (!profile?.account_type) return null;
  if (profile.account_type === "job_seeker") return "youth";
  if (profile.account_type === "job_provider") {
    return profile.provider_kind === "company" ? "company" : "adult";
  }
  return null;
}

export function getInitialOnboardingRole({
  profile,
  forcedStep,
  isJustVerified,
}: {
  profile: Profile | null | undefined;
  forcedStep: OnboardingStep | null | undefined;
  isJustVerified: boolean;
}) {
  return mustChooseOnboardingRole(forcedStep, isJustVerified) ? null : inferOnboardingRole(profile);
}
