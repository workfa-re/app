import { getAuthState } from "@/lib/auth";
import { getDefaultAppHomePath } from "@/lib/app-shell";
import { redirect } from "next/navigation";
import AuthBridge from "@/components/AuthBridge";
import { getSafeInternalRedirect } from "@/lib/safe-redirect";
import { guardianReturnPath } from "@/lib/guardian/navigation";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await searchParams;
  const authState = await getAuthState();
  const redirectTo = getSafeInternalRedirect(resolvedParams.redirectTo) ?? undefined;
  const authMode = typeof resolvedParams.authMode === "string" && (resolvedParams.authMode === "signup" || resolvedParams.authMode === "signin")
    ? resolvedParams.authMode
    : undefined;

  // Wenn ready → zu /app-home oder redirectTo
  if (authState.state === "ready") {
    const viewRole = authState.effectiveView?.viewRole ?? authState.profile?.account_type;
    redirect(redirectTo || getDefaultAppHomePath(viewRole));
  }
  if (authState.state === "family-only") redirect(guardianReturnPath(redirectTo) || "/guardian/access");

  if (authState.state === "incomplete-profile" && guardianReturnPath(redirectTo)) redirect(guardianReturnPath(redirectTo)!);
  // A resumable UI preference only. All family/provider permissions remain DB-bound.
  if (authState.state === "incomplete-profile" && authState.session.user.user_metadata?.signup_purpose === "family") redirect("/guardian/access");

  if (authState.state === "email-unconfirmed" || authState.state === "incomplete-profile") {
    redirect(redirectTo ? `/onboarding?redirectTo=${encodeURIComponent(redirectTo)}` : "/onboarding");
  }

  // A demo visitor returns to the controlled demo entry after signing out.
  if (process.env.WORKFARE_DEMO_ENABLED === "true") redirect("/demo");

  // Ohne Session zeigt der Client-Wizard ggf. einen lokal gespeicherten Pending-Onboarding-Stand.
  return (
    <AuthBridge authState={authState} redirectTo={redirectTo} initialMode={authMode}
      initialError={resolvedParams.error === "auth_code_error" ? "Dieser Bestätigungslink ist ungültig oder abgelaufen. Melde dich an, um einen neuen Code anzufordern." : null} />
  );
}
