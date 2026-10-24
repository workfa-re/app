import type { PaymentMode } from "./types";
import type { PaymentFeePolicy, PaymentFeeTariffSnapshot } from "./tariff";

export type PaymentOrderOverview = Readonly<{ orders: readonly PaymentOrder[]; quoteFeePolicy: PaymentFeePolicy }>;

export type PaymentOrderState = "awaiting_confirmation" | "ready" | "authorization_pending" | "authorized" | "capture_pending" | "paid"
    | "cancel_pending" | "canceled" | "refund_pending" | "refunded" | "failed" | "review_required";
export type PaymentOrderAction = "authorize" | "capture" | "cancel" | "refund";

/** Contract snapshot, not a bank balance, invoice or payout confirmation. */
export type PaymentOrder = Readonly<{
    id: string; mode: PaymentMode; appointmentId: string; applicationId: string; providerId: string; recipientId: string;
    title: string; startsAt: string; endsAt: string | null; timezone: string; appointmentVersion: string; quoteVersion: number;
    paymentType: "fixed" | "hourly"; rateCents: number; plannedMinutes: number | null;
    earningsCents: number; serviceFeeCents: number; totalCents: number; currency: "eur";
    feePolicy: PaymentFeePolicy; feeTariff?: PaymentFeeTariffSnapshot | null; termsVersion: "appointment-price-v1";
    recipientConfirmedAt: string | null; state: PaymentOrderState; captureBefore: string | null; refundedCents: number;
    createdAt: string; updatedAt: string; termsCurrent: boolean; bankPayoutConfirmed: false; livePaymentsEnabled: boolean;
}>;

export type PrivatePaymentOrder = PaymentOrder & Readonly<{
    customerRef: string | null; methodRef: string | null; accountRef: string | null; intentRef: string | null; refundRef: string | null; revision: number;
}>;
export type PaymentOrderOperation = PrivatePaymentOrder & Readonly<{ operationId: string; replay: boolean }>;
export type VerifiedOrderState = Readonly<{
    state: "authorization_pending" | "authorized" | "capture_pending" | "paid" | "canceled" | "refund_pending" | "refunded" | "failed" | "review_required";
    intentRef: string; captureBefore: string | null; refundRef: string | null;
}>;
