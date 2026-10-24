import { getAuthState } from "@/lib/auth";
import { getDefaultAppHomePath } from "@/lib/app-shell";
import { redirect } from "next/navigation";

export default async function AppHomePage() {
  const authState = await getAuthState();

  if (authState.state === "no-session" || authState.state === "email-unconfirmed") {
    redirect("/");
  }

  if (authState.state === "incomplete-profile") {
    redirect("/onboarding");
  }
  if (authState.state === "family-only") redirect("/guardian/access");

  const viewRole = authState.effectiveView?.viewRole ?? authState.profile?.account_type;
  redirect(getDefaultAppHomePath(viewRole));

  // Fallback (should not be reached if types are correct)
  return null;
}
