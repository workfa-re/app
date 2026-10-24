import "server-only";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import type { PaymentsEnvironment } from "./config";

/** Orders require a separate explicit opt-in in either real or test mode. */
export function requirePaymentOrders(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    if (runtime.mode === "live") {
        if (environment.WORKFARE_PAY_LIVE_ORDERS !== "enabled") throw new PaymentFlowError("payment_orders_disabled", 503);
        return runtime;
    }
    if (environment.WORKFARE_PAY_ORDER_PREVIEW !== "enabled") throw new PaymentFlowError("payment_orders_disabled", 503);
    if (runtime.mode === "sandbox" && environment.WORKFARE_PAY_ORDER_SANDBOX !== "enabled") throw new PaymentFlowError("payment_order_sandbox_disabled", 503);
    return runtime;
}

/** Existing live orders must remain reconcilable when new payments are stopped. */
export function requirePaymentOrderMaintenance(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    return runtime.mode === "live" ? runtime : requirePaymentOrders(environment);
}
