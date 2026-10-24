import type { PaymentOrderState } from "./order-types";
import type { RecipientEarningsSnapshot, RecipientPayoutHistory } from "./recipient-summary-types";

const states: readonly PaymentOrderState[] = ["awaiting_confirmation", "ready", "authorization_pending", "authorized", "capture_pending", "paid", "cancel_pending", "canceled", "refund_pending", "refunded", "failed", "review_required"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function invalid(): never { throw new Error("recipient_summary_unconfirmed"); }

/** Allowlist the DTO so unexpected provider/private fields never leave the server. */
export function parseRecipientEarningsSnapshot(value: unknown): RecipientEarningsSnapshot {
    const row = object(value), earnings = object(row?.earnings);
    if (!row || !earnings || typeof row.ownerId !== "string" || !uuid.test(row.ownerId) || !["local", "sandbox", "live"].includes(String(row.kind)) || row.currency !== "eur" || !date(row.checkedAt)
        || earnings.scope !== "confirmed_workfare_payments" || ![earnings.confirmedCents, earnings.refundedCents, earnings.underReviewCents, earnings.underReviewCount, earnings.paidJobs].every(cents)
        || !Array.isArray(row.recentPayments) || row.recentPayments.length > 10) invalid();
    const recentPayments = row.recentPayments.map(value => {
        const payment = object(value);
        if (!payment || typeof payment.id !== "string" || !uuid.test(payment.id) || typeof payment.applicationId !== "string" || !uuid.test(payment.applicationId)
            || typeof payment.title !== "string" || payment.title.length < 1 || payment.title.length > 240
            || !cents(payment.earningsCents) || !states.includes(payment.state as PaymentOrderState) || !date(payment.startsAt) || !date(payment.updatedAt)) invalid();
        return { id: payment.id, applicationId: payment.applicationId, title: payment.title, earningsCents: payment.earningsCents,
            state: payment.state as PaymentOrderState, startsAt: payment.startsAt, updatedAt: payment.updatedAt };
    });
    return { ownerId: row.ownerId, kind: row.kind as "local" | "sandbox" | "live", currency: "eur", checkedAt: row.checkedAt,
        earnings: { scope: "confirmed_workfare_payments", confirmedCents: earnings.confirmedCents as number, refundedCents: earnings.refundedCents as number,
            underReviewCents: earnings.underReviewCents as number, underReviewCount: earnings.underReviewCount as number, paidJobs: earnings.paidJobs as number }, recentPayments };
}

export function validRecipientPayoutHistory(value: unknown): value is RecipientPayoutHistory {
    const row = object(value);
    return !!row && ["complete", "recent_only"].includes(String(row.coverage)) && date(row.checkedAt)
        && (row.coverage === "recent_only" ? row.paidOutCents === null && row.inTransitCents === null : cents(row.paidOutCents) && cents(row.inTransitCents))
        && Array.isArray(row.recent) && row.recent.length <= 10 && row.recent.every(value => {
            const payout = object(value);
            return !!payout && typeof payout.id === "string" && /^po_[a-zA-Z0-9]+$/.test(payout.id) && cents(payout.amountCents)
                && ["paid", "pending", "in_transit", "canceled", "failed"].includes(String(payout.status))
                && date(payout.arrivalAt) && date(payout.createdAt) && typeof payout.automatic === "boolean";
        });
}
