import { redirect } from "next/navigation";
import { getAppHomeContext } from "@/lib/app-shell";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";
import { MembershipPage } from "@/components/membership/MembershipPage";

export const dynamic = "force-dynamic";
type Search = { membership?: string; session_id?: string };

export default async function MembershipSettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
    const [context, search] = await Promise.all([getAppHomeContext(), searchParams]);
    if (context.effectiveView.viewRole !== "job_provider") redirect("/app-home/settings/payments");
    const result = search.membership === "returned" || search.membership === "canceled" ? search.membership : null;
    const sessionId = typeof search.session_id === "string" && /^cs_[A-Za-z0-9_]{8,255}$/.test(search.session_id) ? search.session_id : null;
    return <><AppRouteReady href="/app-home/settings/membership" /><MembershipPage key={context.sessionUserId} ownerId={context.sessionUserId} result={result} sessionId={sessionId} /></>;
}
