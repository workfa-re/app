import { redirect } from "next/navigation";
import { getAppHomeContext } from "@/lib/app-shell";
import { getPaymentSetupForUser } from "@/lib/payments/service.server";

export const dynamic = "force-dynamic";

export default async function LocalPaymentSetupPage({
    searchParams,
}: {
    searchParams: Promise<{ session_id?: string }>;
}) {
    const [context, search] = await Promise.all([
        getAppHomeContext(),
        searchParams,
    ]);
    if (
        context.effectiveView.viewRole !== "job_provider" ||
        typeof search.session_id !== "string"
    )
        redirect("/app-home/settings/payments");
    const session = await getPaymentSetupForUser(
        context.sessionUserId,
        search.session_id,
    ).catch(() => null);
    if (
        !session ||
        session.mode !== "local_simulation" ||
        session.status !== "pending"
    )
        redirect("/app-home/settings/payments");
    redirect(`/app-home/settings/payments?resume_setup=${session.id}`);
}
