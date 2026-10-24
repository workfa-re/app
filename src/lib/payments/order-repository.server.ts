import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import type { PaymentOrder, PaymentOrderAction, PaymentOrderOperation, PaymentOrderOverview, PrivatePaymentOrder, VerifiedOrderState } from "./order-types";
import { parsePaymentOrder, parsePaymentOrderOperation, parsePaymentOrderOverview, parsePrivatePaymentOrder } from "./order-parser.server";
import type { PaymentFeePolicy } from "./tariff";

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
async function rpc<T>(name: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    requirePaymentRuntime();
    const { data, error } = await (getSupabaseAdminClient() as unknown as RpcClient).rpc(name, args);
    if (error) throw new PaymentFlowError(error.message.match(/\b(?:PAYMENT_ORDER_[A-Z_]+|PAYMENTS_DISABLED|LIVE_PAYMENTS_FORBIDDEN)\b/)?.[0] ?? "payment_order_unavailable", 409);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PaymentFlowError("payment_order_unavailable", 503);
    return parse(data);
}
export const createPaymentOrder = (userId: string, operationId: string, appointmentId: string, appointmentVersion: string, plannedMinutes: number | null, quoteFeePolicy: PaymentFeePolicy) =>
    rpc<PaymentOrder>("pay_order_create_for_tariff", { p_user_id: userId, p_mode: requirePaymentRuntime().mode, p_operation_id: operationId,
        p_appointment_id: appointmentId, p_appointment_version: appointmentVersion, p_planned_minutes: plannedMinutes, p_quote_fee_policy: quoteFeePolicy }, parsePaymentOrder);
export const confirmPaymentOrder = (userId: string, orderId: string, termsVersion: string) =>
    rpc<PaymentOrder>("pay_order_confirm", { p_user_id: userId, p_order_id: orderId, p_terms_version: termsVersion }, parsePaymentOrder);
export const getPaymentOrder = (userId: string, orderId: string) => rpc<PaymentOrder>("pay_order_get", { p_user_id: userId, p_order_id: orderId, p_private: false }, parsePaymentOrder);
export const getPrivatePaymentOrder = (userId: string, orderId: string) => rpc<PrivatePaymentOrder>("pay_order_get", { p_user_id: userId, p_order_id: orderId, p_private: true }, parsePrivatePaymentOrder);
export const readPaymentOrderOverview = (userId: string, applicationId: string) =>
    rpc<PaymentOrderOverview>("pay_order_overview", { p_user_id: userId, p_application_id: applicationId }, parsePaymentOrderOverview);
export async function listPaymentOrders(userId: string, applicationId: string): Promise<readonly PaymentOrder[]> {
    requirePaymentRuntime();
    const { data, error } = await (getSupabaseAdminClient() as unknown as RpcClient).rpc("pay_order_list", { p_user_id: userId, p_application_id: applicationId });
    if (error) throw new PaymentFlowError(error.message.match(/\bPAYMENT_ORDER_[A-Z_]+\b/)?.[0] ?? "payment_order_unavailable", 409);
    if (!Array.isArray(data)) throw new PaymentFlowError("payment_order_unavailable", 503);
    return data.map(parsePaymentOrder);
}
export const beginPaymentOrderOperation = (userId: string, orderId: string, action: PaymentOrderAction, operationId: string) =>
    rpc<PaymentOrderOperation>("pay_order_begin", { p_user_id: userId, p_order_id: orderId, p_action: action, p_operation_id: operationId }, parsePaymentOrderOperation);
export const beginCompletionPayment = (userId: string, orderId: string, operationId: string) =>
    rpc("pay_order_begin_completion", { p_user_id: userId, p_order_id: orderId, p_operation_id: operationId }, value => {
        const row = value as Record<string, unknown>;
        if (!["authorize", "capture"].includes(String(row.paymentAction))) throw new PaymentFlowError("payment_order_invalid_snapshot", 503);
        return { ...parsePaymentOrderOperation(value), paymentAction: row.paymentAction as "authorize" | "capture" };
    });
export const getCompletionPaymentContext = (userId: string, orderId: string) =>
    rpc("pay_order_completion_context", { p_user_id: userId, p_order_id: orderId }, value => {
        const row = value as Record<string, unknown>;
        if (row.orderId !== orderId || typeof row.providerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.providerId) || typeof row.requested !== "boolean"
            || (row.requested && (typeof row.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.operationId)))) {
            throw new PaymentFlowError("payment_order_invalid_snapshot", 503);
        }
        return { orderId, providerId: row.providerId, requested: row.requested, operationId: row.operationId as string | null };
    });
export const applyPaymentOrderState = (orderId: string, eventId: string, state: VerifiedOrderState) => rpc<PaymentOrder>("pay_order_apply", {
    p_order_id: orderId, p_event_id: eventId, p_intent_ref: state.intentRef, p_state: state.state,
    p_capture_before: state.captureBefore, p_refund_ref: state.refundRef, p_livemode: requirePaymentRuntime().mode === "live",
}, parsePaymentOrder);
