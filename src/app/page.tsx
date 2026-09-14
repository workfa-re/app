import { getAuthState } from "@/lib/auth";
import { getDefaultAppHomePath } from "@/lib/app-shell";
import { redirect } from "next/navigation";
import AuthBridge from "@/components/AuthBridge";
import { MiniFooter } from "@/components/layout/MiniFooter";
import { getSafeInternalRedirect } from "@/lib/safe-redirect";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const resolvedParams: any = await searchParams;
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

  if (authState.state === "email-unconfirmed" || authState.state === "incomplete-profile") {
    redirect(redirectTo ? `/onboarding?redirectTo=${encodeURIComponent(redirectTo)}` : "/onboarding");
  }

  // A demo visitor returns to the controlled demo entry after signing out.
  if (process.env.WORKFARE_DEMO_ENABLED === "true") redirect("/demo");

  // Ohne Session zeigt der Client-Wizard ggf. einen lokal gespeicherten Pending-Onboarding-Stand.
  return (
    <div className="landing-auth-shell min-h-dvh bg-[#07090f]">
      <AuthBridge authState={authState} redirectTo={redirectTo} initialMode={authMode} />
      <MiniFooter />
    </div>
  );
}
