import type { PaymentOrderState } from "./order-types";
import type { RecipientPayoutOverview } from "./recipient-types";

export type RecipientEarnings = Readonly<{
    scope: "confirmed_workfare_payments";
    confirmedCents: number;
    refundedCents: number;
    underReviewCents: number;
    underReviewCount: number;
    paidJobs: number;
}>;
export type RecipientRecentPayment = Readonly<{
    id: string;
    applicationId: string;
    title: string;
    earningsCents: number;
    state: PaymentOrderState;
    startsAt: string;
    updatedAt: string;
}>;
export type RecipientRecentPayout = Readonly<{
    id: string;
    amountCents: number;
    status: "paid" | "pending" | "in_transit" | "canceled" | "failed";
    arrivalAt: string;
    createdAt: string;
    automatic: boolean;
}>;
export type RecipientPayoutHistory = Readonly<{
    /** Null when the bounded provider result does not cover the entire history. */
    paidOutCents: number | null;
    inTransitCents: number | null;
    coverage: "complete" | "recent_only";
    recent: readonly RecipientRecentPayout[];
    checkedAt: string;
}>;
export type RecipientPaymentSummary = Readonly<{
    ownerId: string;
    kind: "sandbox" | "local" | "live";
    currency: "eur";
    checkedAt: string;
    earnings: RecipientEarnings;
    funds: RecipientPayoutOverview | null;
    payouts: RecipientPayoutHistory | null;
    fundsUnavailableReason: "recipient_setup_required" | "minor_review_required" | "provider_unavailable" | "local_simulation" | null;
    recentPayments: readonly RecipientRecentPayment[];
}>;
export type RecipientEarningsSnapshot = Pick<RecipientPaymentSummary, "ownerId" | "kind" | "currency" | "checkedAt" | "earnings" | "recentPayments">;
