import "server-only";
import { randomUUID } from "node:crypto";
import { getAuthState } from "@/lib/auth";
import { PaymentFlowError } from "./runtime.server";
import { requirePaymentOrders, requirePaymentOrderMaintenance } from "./order-config.server";
import { createPaymentOrderStripeAdapter } from "./order-stripe.server";
import * as repository from "./order-repository.server";
import type { PaymentOrderAction, PrivatePaymentOrder, VerifiedOrderState } from "./order-types";
import type Stripe from "stripe";
import type { PaymentFeePolicy } from "./tariff";
import { stripePublishableKey } from "./stripe-mode.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, code = "invalid_request"): asserts value is string {
    if (typeof value !== "string" || !UUID.test(value)) throw new PaymentFlowError(code);
}
async function actor(providerOnly = false, newPayment = false) {
    if (newPayment) requirePaymentOrders(); else requirePaymentOrderMaintenance();
    const auth = await getAuthState();
    if (auth.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (auth.state !== "ready" || !["job_provider", ...(providerOnly ? [] : ["job_seeker"])].includes(auth.profile?.account_type ?? "")) {
        throw new PaymentFlowError("payment_order_account_required", 403);
    }
    return auth.session.user.id;
}

export async function proposeAppointmentPayment(input: { appointmentId: unknown; appointmentVersion: unknown; plannedMinutes?: unknown; quoteFeePolicy: unknown; consent: unknown; operationId?: string }) {
    const userId = await actor(true, true);
    uuid(input.appointmentId);
    if (input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (typeof input.appointmentVersion !== "string" || input.appointmentVersion.length > 50 || !Number.isFinite(Date.parse(input.appointmentVersion))) throw new PaymentFlowError("invalid_appointment_version");
    if (input.plannedMinutes !== undefined && input.plannedMinutes !== null
        && (typeof input.plannedMinutes !== "number" || !Number.isSafeInteger(input.plannedMinutes) || input.plannedMinutes < 1 || input.plannedMinutes > 480)) throw new PaymentFlowError("invalid_planned_minutes");
    if (typeof input.quoteFeePolicy !== "string" || !["local-zero-fee-v1", "test-service-5-v1", "workfare-service-5-v1"].includes(input.quoteFeePolicy)) throw new PaymentFlowError("invalid_quote_fee_policy");
    if (input.operationId) uuid(input.operationId, "invalid_operation_id");
    return { order: await repository.createPaymentOrder(userId, input.operationId ?? randomUUID(), input.appointmentId, input.appointmentVersion, (input.plannedMinutes ?? null) as number | null, input.quoteFeePolicy as PaymentFeePolicy) };
}

export async function confirmAppointmentPayment(orderId: string, input: { termsVersion: unknown; consent: unknown }) {
    const userId = await actor();
    uuid(orderId);
    if (input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (input.termsVersion !== "appointment-price-v1") throw new PaymentFlowError("invalid_payment_terms");
    return { order: await repository.confirmPaymentOrder(userId, orderId, input.termsVersion) };
}

export async function readAppointmentPayment(orderId: string) {
    const userId = await actor();
    uuid(orderId);
    return { order: await repository.getPaymentOrder(userId, orderId) };
}

export async function listAppointmentPayments(applicationId: string) {
    const userId = await actor();
    uuid(applicationId);
    return repository.readPaymentOrderOverview(userId, applicationId);
}

function localState(order: PrivatePaymentOrder, action: PaymentOrderAction): VerifiedOrderState {
    return { state: action === "authorize" ? "authorized" : action === "capture" ? "paid" : action === "cancel" ? "canceled" : "refunded",
        intentRef: order.intentRef ?? `local_pi_${order.id}`, captureBefore: action === "authorize" ? new Date(Date.now() + 48 * 60 * 60_000).toISOString() : null,
        refundRef: action === "refund" ? `local_refund_${order.id}` : null };
}

export async function actOnAppointmentPayment(orderId: string, input: { action: unknown; consent: unknown; operationId?: string }) {
    const runtime = requirePaymentOrderMaintenance();
    const userId = await actor(true);
    uuid(orderId);
    if (input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (typeof input.action !== "string" || !["authorize", "capture", "cancel", "refund"].includes(input.action)) throw new PaymentFlowError("invalid_payment_action");
    if (input.operationId) uuid(input.operationId, "invalid_operation_id");
    const action = input.action as PaymentOrderAction;
    if (action === "authorize") requirePaymentOrders();
    const publishableKey = runtime.mode !== "local_simulation" && action === "authorize" ? stripePublishableKey() : null;
    const order = await repository.beginPaymentOrderOperation(userId, orderId, action, input.operationId ?? randomUUID());
    // SQL provides the first operation's stable UUID, including when the caller
    // retries with another request UUID after an interrupted response.
    const eventId = `order-action:${action}:${order.operationId}`;
    if (order.state === "review_required" || (action === "cancel" && order.state === "canceled") || (order.replay && ((action === "authorize" && order.state !== "authorization_pending")
        || (action === "capture" && ["paid", "refund_pending", "refunded"].includes(order.state)) || (action === "refund" && order.state === "refunded")))) {
        return { kind: "state" as const, order: await repository.getPaymentOrder(userId, orderId) };
    }
    if (runtime.mode === "local_simulation") {
        return { kind: "local" as const, order: await repository.applyPaymentOrderState(order.id, eventId, localState(order, action)) };
    }
    const adapter = createPaymentOrderStripeAdapter();
    if (action === "authorize") {
        if (order.intentRef) {
            const current = await adapter.inspect(order);
            if (current.state !== "authorization_pending") return { kind: "state" as const, order: await repository.applyPaymentOrderState(order.id, `order-resume:${randomUUID()}`, current) };
        }
        const result = await adapter.authorize(order, order.operationId);
        await repository.applyPaymentOrderState(order.id, eventId, { state: "authorization_pending", intentRef: result.intentRef, captureBefore: null, refundRef: null });
        return { kind: "confirmation" as const, order: await repository.getPaymentOrder(userId, orderId), clientSecret: result.clientSecret, publishableKey: publishableKey! };
    }
    const verified = await adapter[action](order, order.operationId);
    return { kind: "state" as const, order: await repository.applyPaymentOrderState(order.id, `${eventId}:${verified.state}`, verified) };
}

export async function syncAppointmentPayment(orderId: string) {
    const runtime = requirePaymentOrderMaintenance();
    const userId = await actor();
    uuid(orderId);
    if (runtime.mode === "local_simulation") return { order: await repository.getPaymentOrder(userId, orderId) };
    const order = await repository.getPrivatePaymentOrder(userId, orderId);
    if (!order.intentRef) return { order: await repository.getPaymentOrder(userId, orderId) };
    return { order: await repository.applyPaymentOrderState(order.id, `order-sync:${randomUUID()}`, await createPaymentOrderStripeAdapter().inspect(order)) };
}

export async function handlePaymentOrderWebhook(payload: string, signature: string) {
    const runtime = requirePaymentOrderMaintenance();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("sandbox_required", 503);
    const adapter = createPaymentOrderStripeAdapter();
    const event = await adapter.verifyWebhook(payload, signature);
    const disputeEvent = ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"].includes(event.type);
    if (event.account || (!disputeEvent && !["payment_intent.amount_capturable_updated", "payment_intent.succeeded", "payment_intent.canceled", "payment_intent.payment_failed", "payment_intent.processing", "refund.created", "refund.updated", "refund.failed", "charge.refunded"].includes(event.type))) return { received: true };
    const object = event.data.object as unknown as { id: string; object: string; metadata?: Record<string, string>; payment_intent?: string };
    if (disputeEvent && object.object !== "dispute") return { received: true };
    const disputeParent = disputeEvent ? await adapter.resolveDisputeOrder(event.data.object as Stripe.Dispute) : null;
    const orderId = disputeEvent ? disputeParent?.orderId : object.metadata?.workfare_pay_order;
    const providerId = disputeEvent ? disputeParent?.providerId : object.metadata?.workfare_pay_provider;
    if (!orderId || !providerId || !UUID.test(orderId) || !UUID.test(providerId)) return { received: true };
    let order: PrivatePaymentOrder;
    try { order = await repository.getPrivatePaymentOrder(providerId, orderId); }
    catch (error) {
        if (error instanceof PaymentFlowError && error.code === "PAYMENT_ORDER_NOT_FOUND") return { received: true };
        throw error;
    }
    const intentRef = disputeParent?.intentRef ?? (object.object === "payment_intent" ? object.id : object.payment_intent);
    if (!order.intentRef) throw new PaymentFlowError("payment_order_reference_pending", 503);
    if (order.mode !== runtime.mode || order.intentRef !== intentRef || (object.object === "refund" && order.refundRef && order.refundRef !== object.id)) return { received: true };
    if (object.object === "refund") {
        const { verified, disputed } = await adapter.inspectRefund(order, object.id);
        if (disputed) await repository.applyPaymentOrderState(order.id, `${event.id}:dispute`, { ...verified, state: "review_required" });
        await repository.applyPaymentOrderState(order.id, event.id, verified);
        return { received: true };
    }
    await repository.applyPaymentOrderState(order.id, event.id, await adapter.inspect(order));
    return { received: true };
}
