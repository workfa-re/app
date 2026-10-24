import { getAppHomeContext } from "@/lib/app-shell";
import { getPaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import { getRecipientSettingsSnapshot } from "@/lib/payments/recipient-repository.server";
import { sanitizePaymentReturnPath } from "@/lib/payments/return-path";
import { sanitizeRecipientReturnPath } from "@/lib/payments/recipient-return-path";
import { getPaymentSetupForUser, syncPaymentSetupReturn } from "@/lib/payments/service.server";
import {
    PaymentSettings,
    PaymentSettingsUnavailable,
} from "@/components/payments/PaymentSettings";
import { AppRouteReady } from "@/components/layout/AppNavigationProvider";

export const dynamic = "force-dynamic";

type Search = { returnTo?: string; session_id?: string; resume_setup?: string; recipientHosted?: string };

export default async function PaymentsPage({
    searchParams,
}: {
    searchParams: Promise<Search>;
}) {
    const [context, search] = await Promise.all([
        getAppHomeContext(),
        searchParams,
    ]);
    const provider = context.effectiveView.viewRole === "job_provider";
    let returnTo = provider ? sanitizePaymentReturnPath(search.returnTo) : sanitizeRecipientReturnPath(search.returnTo);
    let resumeSetupId: string | null = null;
    let result: "success" | "canceled" | "unconfirmed" | null = null;
    if (
        typeof search.session_id === "string" &&
        context.effectiveView.viewRole === "job_provider"
    ) {
        try {
            const setup = await syncPaymentSetupReturn(
                context.sessionUserId,
                search.session_id,
            );
            returnTo = setup.returnTo;
            result =
                setup.status === "complete"
                    ? "success"
                    : setup.status === "canceled" || setup.status === "expired"
                      ? "canceled"
                      : "unconfirmed";
        } catch {
            // A return URL alone never confirms payment-method ownership or setup.
            result = "unconfirmed";
        }
    }
    if (provider && typeof search.resume_setup === "string") {
        const setup = await getPaymentSetupForUser(context.sessionUserId, search.resume_setup).catch(() => null);
        if (setup?.mode === "local_simulation" && setup.status === "pending") {
            resumeSetupId = setup.id;
            returnTo = setup.returnTo;
        }
    }
    const [snapshot, recipientSnapshot] = await Promise.all([
        getPaymentSettingsSnapshot(context.sessionUserId).catch(() => null),
        context.effectiveView.viewRole === "job_seeker" ? getRecipientSettingsSnapshot(context.sessionUserId).catch(() => null) : null,
    ]);
    return (
        <>
            <AppRouteReady href="/app-home/settings/payments" />
            {snapshot ? (
                <PaymentSettings
                    key={`${context.sessionUserId}:${context.effectiveView.viewRole}`}
                    ownerId={context.sessionUserId}
                    snapshot={snapshot}
                    recipientSnapshot={recipientSnapshot}
                    role={context.effectiveView.viewRole}
                    returnTo={returnTo}
                    result={result}
                    resumeSetupId={resumeSetupId}
                    recipientHostedReturned={context.effectiveView.viewRole === "job_seeker" && search.recipientHosted === "returned"}
                />
            ) : (
                <PaymentSettingsUnavailable />
            )}
        </>
    );
}
