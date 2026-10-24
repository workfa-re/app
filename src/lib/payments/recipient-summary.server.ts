import "server-only";
import { getAuthState } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { isAdultBirthdate } from "@/lib/age";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { getRecipientAccount } from "./recipient-repository.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { readRecipientPayoutHistory } from "./recipient-summary-stripe.server";
import { parseRecipientEarningsSnapshot } from "./recipient-summary-parser";
import type { RecipientPaymentSummary } from "./recipient-summary-types";

type RpcClient = { rpc(name: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export async function getRecipientPaymentSummary(view: "full" | "home" = "full"): Promise<RecipientPaymentSummary> {
    const runtime = requirePaymentRuntime();
    if (view !== "full" && view !== "home") throw new PaymentFlowError("invalid_request");
    const auth = await getAuthState();
    if (auth.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (auth.state !== "ready" || auth.profile?.account_type !== "job_seeker") throw new PaymentFlowError("recipient_account_required", 403);
    const client = await supabaseServer();
    const { data, error } = await (client as unknown as RpcClient).rpc("get_my_recipient_payment_summary");
    if (error) throw new PaymentFlowError("recipient_summary_unavailable", 503);
    const earnings = parseRecipientEarningsSnapshot(data);
    if (earnings.ownerId !== auth.session.user.id || earnings.kind !== (runtime.mode === "local_simulation" ? "local" : runtime.mode)) {
        throw new PaymentFlowError("recipient_summary_unavailable", 503);
    }
    const result: RecipientPaymentSummary = { ...earnings, funds: null, payouts: null,
        fundsUnavailableReason: runtime.mode === "local_simulation" ? "local_simulation" : "recipient_setup_required" };
    if (runtime.mode === "local_simulation") return result;
    if (runtime.mode!=="live" && !isAdultBirthdate(auth.profile.birthdate)) return { ...result, fundsUnavailableReason: "minor_review_required" };
    try {
        const account = await getRecipientAccount(auth.session.user.id, runtime.mode);
        if (!account?.accountRef) return result;
        const funds = await createRecipientStripeAdapter().readPayoutOverview(auth.session.user.id, account.accountRef);
        if (view === "home") return { ...result, funds, fundsUnavailableReason: null };
        // The owner/model check above always precedes the contextual Payouts read.
        try {
            const payouts = await readRecipientPayoutHistory(account.accountRef);
            return { ...result, funds, payouts, fundsUnavailableReason: null };
        } catch { return { ...result, funds, fundsUnavailableReason: "provider_unavailable" }; }
    } catch { return { ...result, fundsUnavailableReason: "provider_unavailable" }; }
}
