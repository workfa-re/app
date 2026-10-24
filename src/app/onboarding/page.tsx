import { OnboardingWizard } from "@/components/OnboardingWizard";
import { getAuthState } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSafeInternalRedirect } from "@/lib/safe-redirect";
import type { OnboardingStep } from "@/lib/onboardingFlow";
import { isIncompletePrivateProviderProfile } from "@/lib/guardian/workspace";

// server component
export default async function OnboardingPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> // Next.js 15+ compatible
}) {
  const searchParams = await props.searchParams;
  const authState = await getAuthState();
  const providerUpgrade = searchParams.purpose === "provider" && (authState.state === "family-only"
    || (authState.state === "incomplete-profile" && isIncompletePrivateProviderProfile(authState.profile)));
  if (authState.state === "family-only" && !providerUpgrade) redirect("/guardian/access");

  // Special handling: If we just came from email verification, we might have a race condition
  // where the session is ready but we want to show the "Email Confirmed" state briefly
  // or ensure the user lands on the right step.
  const isJustVerified = !providerUpgrade && searchParams?.verified === "true";
  const redirectTo = getSafeInternalRedirect(searchParams?.redirectTo) ?? undefined;
  const initialMode =
    searchParams?.authMode === "signup" || searchParams?.authMode === "signin"
      ? searchParams.authMode
      : undefined;

  if (authState.state === "ready") {
    // If just verified, we allow rendering to show "Success" message if needed,
    // otherwise we redirect to app-home.
    // However, usually "ready" means profile is complete too.
    // If profile is complete AND just verified -> Go to app-home
    if (!isJustVerified) {
      redirect("/app-home");
    }
  }

  const initialProfile =
    authState.state === "incomplete-profile" || authState.state === "family-only" ? authState.profile : null;
  const wizardProfile =
    !providerUpgrade && authState.state === "incomplete-profile" && initialProfile
      ? {
          ...initialProfile,
          account_type: null,
          provider_kind: null,
        }
      : initialProfile;

  // If just verified, force the step to email-confirm (which will show success state)
  // OR if the user is incomplete, force them to the role/profile step to prevent "Welcome/Login" loop.
  let forcedStep: OnboardingStep | undefined = authState.state === "email-unconfirmed" ? "email-confirm" : undefined;

  if (authState.state === "incomplete-profile" && !forcedStep) {
    forcedStep = "role";
  }
  if (providerUpgrade) forcedStep = initialProfile?.market_id && initialProfile.city ? "summary" : "location";

  if (isJustVerified) {
    forcedStep = "email-confirm";
  }

  const initialEmail =
    authState.state !== "no-session"
      ? authState.session.user.email ?? ""
      : "";

  const initialRegion =
    authState.state !== "no-session"
      ? authState.session.user.user_metadata?.city
      : "";

  return (
    <OnboardingWizard
      initialProfile={wizardProfile}
      forcedStep={forcedStep}
      initialEmail={initialEmail}
      initialRegion={initialRegion}
      redirectTo={redirectTo}
      initialMode={initialMode}
      isJustVerified={isJustVerified}
      providerUpgrade={providerUpgrade}
      initialError={searchParams.error === "auth_code_error" ? "Dieser Bestätigungslink ist ungültig oder abgelaufen. Melde dich an, um einen neuen Code anzufordern." : null}
    />
  );
}
