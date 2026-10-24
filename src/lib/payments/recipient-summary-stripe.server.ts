import "server-only";
import type Stripe from "stripe";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import type { PaymentMode } from "./types";
import { validRecipientPayoutHistory } from "./recipient-summary-parser";
import type { RecipientPayoutHistory, RecipientRecentPayout } from "./recipient-summary-types";

function invalid(): never { throw new PaymentFlowError("recipient_payout_history_unconfirmed", 503); }
const iso = (seconds: number) => {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(new Date(seconds * 1_000).getTime())) return invalid();
    return new Date(seconds * 1_000).toISOString();
};

/** Single bounded read; a truncated page must never become a lifetime total. */
export function parseRecipientPayoutPage(page: Stripe.ApiList<Stripe.Payout>, checkedAt: string, mode: PaymentMode = "sandbox"): RecipientPayoutHistory {
    if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== "boolean") invalid();
    const seen = new Set<string>();
    const ownEur = page.data.map(payout => {
        assertStripeModeObject(payout, mode);
        if (payout.object !== "payout" || !/^po_[a-zA-Z0-9]+$/.test(payout.id) || seen.has(payout.id)
            || !Number.isSafeInteger(payout.amount) || payout.amount < 0 || !/^[a-z]{3}$/.test(payout.currency)
            || !["paid", "pending", "in_transit", "canceled", "failed"].includes(payout.status)
            || typeof payout.automatic !== "boolean" || payout.original_payout || payout.reversed_by) invalid();
        seen.add(payout.id);
        return { id: payout.id, amountCents: payout.amount, status: payout.status as RecipientRecentPayout["status"], arrivalAt: iso(payout.arrival_date),
            createdAt: iso(payout.created), automatic: payout.automatic, currency: payout.currency };
    }).filter(payout => payout.currency === "eur");
    const sum = (statuses: readonly string[]) => {
        const total = ownEur.filter(payout => statuses.includes(payout.status)).reduce((value, payout) => value + payout.amountCents, 0);
        if (!Number.isSafeInteger(total)) invalid();
        return total;
    };
    const recent: RecipientRecentPayout[] = ownEur.slice(0, 10).map(payout => ({ id: payout.id, amountCents: payout.amountCents,
        status: payout.status, arrivalAt: payout.arrivalAt, createdAt: payout.createdAt, automatic: payout.automatic }));
    const result: RecipientPayoutHistory = { coverage: page.has_more ? "recent_only" : "complete", checkedAt, recent,
        paidOutCents: page.has_more ? null : sum(["paid"]), inTransitCents: page.has_more ? null : sum(["pending", "in_transit"]) };
    if (!validRecipientPayoutHistory(result)) invalid();
    return result;
}

/** Call only after readPayoutOverview freshly verified this account's owner/model. */
export async function readRecipientPayoutHistory(accountRef: string): Promise<RecipientPayoutHistory> {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation" || !/^acct_[a-zA-Z0-9]+$/.test(accountRef)) invalid();
    const stripe = await paymentStripeSdk()();
    const page = await stripe.payouts.list({ limit: 100 }, { stripeAccount: accountRef });
    return parseRecipientPayoutPage(page, new Date().toISOString(), runtime.mode);
}
