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

const MAX_PAYOUT_PAGES = 10;

function parsePayoutRows(page: Stripe.ApiList<Stripe.Payout>, mode: PaymentMode, seen: Set<string>) {
    if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== "boolean") invalid();
    if (page.has_more && page.data.length === 0) invalid();
    return page.data.map(payout => {
        assertStripeModeObject(payout, mode);
        if (payout.object !== "payout" || !/^po_[a-zA-Z0-9]+$/.test(payout.id) || seen.has(payout.id)
            || !Number.isSafeInteger(payout.amount) || payout.amount < 0 || !/^[a-z]{3}$/.test(payout.currency)
            || !["paid", "pending", "in_transit", "canceled", "failed"].includes(payout.status)
            || typeof payout.automatic !== "boolean" || payout.original_payout || payout.reversed_by) invalid();
        seen.add(payout.id);
        return { id: payout.id, amountCents: payout.amount, status: payout.status as RecipientRecentPayout["status"], arrivalAt: iso(payout.arrival_date),
            createdAt: iso(payout.created), automatic: payout.automatic, currency: payout.currency };
    }).filter(payout => payout.currency === "eur");
}

/** Totals require every page; the public list remains limited to ten payouts. */
export function parseRecipientPayoutPages(pages: readonly Stripe.ApiList<Stripe.Payout>[], checkedAt: string, mode: PaymentMode = "sandbox"): RecipientPayoutHistory {
    if (pages.length < 1 || pages.length > MAX_PAYOUT_PAGES) invalid();
    const seen = new Set<string>();
    const recent: RecipientRecentPayout[] = [];
    let paidOutCents = 0, inTransitCents = 0;
    for (let index = 0; index < pages.length; index++) {
        if (index > 0 && !pages[index - 1].has_more) invalid();
        for (const payout of parsePayoutRows(pages[index], mode, seen)) {
            if (payout.status === "paid") paidOutCents += payout.amountCents;
            else if (payout.status === "pending" || payout.status === "in_transit") inTransitCents += payout.amountCents;
            if (!Number.isSafeInteger(paidOutCents) || !Number.isSafeInteger(inTransitCents)) invalid();
            if (recent.length < 10) recent.push({ id: payout.id, amountCents: payout.amountCents, status: payout.status,
                arrivalAt: payout.arrivalAt, createdAt: payout.createdAt, automatic: payout.automatic });
        }
    }
    const incomplete = pages[pages.length - 1].has_more;
    const result: RecipientPayoutHistory = { coverage: incomplete ? "recent_only" : "complete", checkedAt, recent,
        paidOutCents: incomplete ? null : paidOutCents, inTransitCents: incomplete ? null : inTransitCents };
    if (!validRecipientPayoutHistory(result)) invalid();
    return result;
}

/** A truncated single page must never become a lifetime total. */
export function parseRecipientPayoutPage(page: Stripe.ApiList<Stripe.Payout>, checkedAt: string, mode: PaymentMode = "sandbox"): RecipientPayoutHistory {
    return parseRecipientPayoutPages([page], checkedAt, mode);
}

/** Call only after readPayoutOverview freshly verified this account's owner/model. */
export async function readRecipientPayoutHistory(accountRef: string): Promise<RecipientPayoutHistory> {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation" || !/^acct_[a-zA-Z0-9]+$/.test(accountRef)) invalid();
    const stripe = await paymentStripeSdk()();
    const pages: Stripe.ApiList<Stripe.Payout>[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let index = 0; index < MAX_PAYOUT_PAGES; index++) {
        const page = await stripe.payouts.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, { stripeAccount: accountRef });
        // Validate before following a provider cursor, including duplicates across pages.
        parsePayoutRows(page, runtime.mode, seen);
        pages.push(page);
        if (!page.has_more) break;
        cursor = page.data[page.data.length - 1].id;
    }
    return parseRecipientPayoutPages(pages, new Date().toISOString(), runtime.mode);
}
