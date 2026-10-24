import "server-only";
import { PaymentFlowError } from "./runtime.server";
import { MAX_QUOTE_CENTS } from "./quote";
import { validPaymentOrderFee } from "./tariff";
import type { PaymentOrder, PaymentOrderOperation, PaymentOrderOverview, PrivatePaymentOrder } from "./order-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set(["awaiting_confirmation", "ready", "authorization_pending", "authorized", "capture_pending", "paid", "cancel_pending", "canceled", "refund_pending", "refunded", "failed", "review_required"]);
const PUBLIC_FIELDS = ["id", "mode", "appointmentId", "applicationId", "providerId", "recipientId", "title", "startsAt", "endsAt", "timezone", "appointmentVersion", "quoteVersion",
    "paymentType", "rateCents", "plannedMinutes", "earningsCents", "serviceFeeCents", "totalCents", "currency", "feePolicy", "termsVersion", "recipientConfirmedAt", "state", "captureBefore", "refundedCents",
    "createdAt", "updatedAt", "termsCurrent", "bankPayoutConfirmed", "livePaymentsEnabled"] as const;
const validDate = (value: unknown) => typeof value === "string" && value.length <= 50 && Number.isFinite(Date.parse(value));
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
function invalid(): never { throw new PaymentFlowError("payment_order_invalid_snapshot", 503); }

/** Public getters project only known fields and verify immutable price/tariff evidence. */
export function parsePaymentOrder(value: unknown): PaymentOrder {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const row = value as Record<string, unknown>;
    if (!["id", "appointmentId", "applicationId", "providerId", "recipientId"].every(key => typeof row[key] === "string" && UUID.test(row[key]))
        || row.providerId === row.recipientId || !["sandbox", "local_simulation", "live"].includes(String(row.mode))
        || typeof row.title !== "string" || row.title.length > 1_000 || typeof row.timezone !== "string" || row.timezone.length > 100
        || !["startsAt", "appointmentVersion", "createdAt", "updatedAt"].every(key => validDate(row[key]))
        || !["endsAt", "captureBefore", "recipientConfirmedAt"].every(key => row[key] === null || validDate(row[key]))
        || !integer(row.quoteVersion, 1, 2_147_483_647) || !integer(row.rateCents, 1, MAX_QUOTE_CENTS)
        || !["fixed", "hourly"].includes(String(row.paymentType)) || (row.paymentType === "fixed" ? row.plannedMinutes !== null : !integer(row.plannedMinutes, 1, 480))
        || row.currency !== "eur" || !validPaymentOrderFee(row) || row.termsVersion !== "appointment-price-v1"
        || typeof row.state !== "string" || !STATES.has(row.state) || ![0, row.totalCents].includes(row.refundedCents as number)
        || typeof row.termsCurrent !== "boolean" || row.livePaymentsEnabled !== (row.mode === "live") || row.bankPayoutConfirmed !== false
        || (row.mode === "live" ? row.feePolicy !== "workfare-service-5-v1" : row.feePolicy === "workfare-service-5-v1")) invalid();
    const earnings = row.paymentType === "fixed" ? row.rateCents : Number((BigInt(row.rateCents) * BigInt(row.plannedMinutes as number) + BigInt(30)) / BigInt(60));
    if (row.earningsCents !== earnings) invalid();
    return { ...Object.fromEntries(PUBLIC_FIELDS.map(key => [key, row[key]])), feeTariff: row.feeTariff ?? null } as PaymentOrder;
}

/** The proposal preview needs today's policy even when no order exists yet. */
export function parsePaymentOrderOverview(value: unknown): PaymentOrderOverview {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const row = value as Record<string, unknown>;
    if (!Array.isArray(row.orders) || row.orders.length > 50 || typeof row.quoteFeePolicy !== "string" || !["local-zero-fee-v1", "test-service-5-v1", "workfare-service-5-v1"].includes(row.quoteFeePolicy)) invalid();
    return { orders: row.orders.map(parsePaymentOrder), quoteFeePolicy: row.quoteFeePolicy as PaymentOrderOverview["quoteFeePolicy"] };
}

export function parsePrivatePaymentOrder(value: unknown): PrivatePaymentOrder {
    const order = parsePaymentOrder(value);
    const row = value as Record<string, unknown>;
    const sandbox = order.mode !== "local_simulation";
    const patterns = sandbox ? [/^cus_[a-zA-Z0-9]+$/, /^pm_[a-zA-Z0-9]+$/, /^acct_[a-zA-Z0-9]+$/, /^pi_[a-zA-Z0-9]+$/, /^re_[a-zA-Z0-9]+$/]
        : [/^local_cus_[a-zA-Z0-9_-]+$/, /^local_pm_[a-zA-Z0-9_-]+$/, /^local_recipient_[a-zA-Z0-9_-]+$/, /^local_pi_[a-zA-Z0-9_-]+$/, /^local_refund_[a-zA-Z0-9_-]+$/];
    const fields = ["customerRef", "methodRef", "accountRef", "intentRef", "refundRef"] as const;
    if (!fields.every((key, index) => row[key] === null || (typeof row[key] === "string" && patterns[index].test(row[key])))
        || !integer(row.revision, 0, Number.MAX_SAFE_INTEGER)) invalid();
    return { ...order, ...Object.fromEntries(fields.map(key => [key, row[key]])), revision: row.revision } as PrivatePaymentOrder;
}

export function parsePaymentOrderOperation(value: unknown): PaymentOrderOperation {
    const order = parsePrivatePaymentOrder(value);
    const row = value as Record<string, unknown>;
    if (typeof row.operationId !== "string" || !UUID.test(row.operationId) || typeof row.replay !== "boolean") invalid();
    return { ...order, operationId: row.operationId, replay: row.replay };
}
