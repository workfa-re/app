"use client";

import type { AuthState } from "@/lib/auth";
import { OnboardingWizard } from "./OnboardingWizard";

type AuthBridgeProps = {
  authState: AuthState;
  redirectTo?: string;
  initialMode?: "signup" | "signin" | null;
  initialError?: string | null;
};

export default function AuthBridge({ authState, redirectTo, initialMode, initialError }: AuthBridgeProps) {
  if (authState.state === "no-session") {
    return <OnboardingWizard initialProfile={null} redirectTo={redirectTo} initialMode={initialMode} initialError={initialError} />;
  }

  if (authState.state === "email-unconfirmed") {
    return (
      <OnboardingWizard
        initialProfile={authState.profile}
        forcedStep="email-confirm"
        initialEmail={authState.session.user.email ?? ""}
        redirectTo={redirectTo}
        reserveFooterSpace
      />
    );
  }

  if (authState.state === "incomplete-profile") {
    return (
      <OnboardingWizard
        initialProfile={authState.profile}
        forcedStep="role"
        initialEmail={authState.session.user.email ?? ""}
        redirectTo={redirectTo}
        reserveFooterSpace
      />
    );
  }

  // "ready" wird bereits in den Server-Komponenten umgeleitet
  return null;
}
