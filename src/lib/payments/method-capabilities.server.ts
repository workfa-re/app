import "server-only";
import { requirePaymentProvider } from "./service.server";
import { getPaymentCustomer, getPaymentSettingsSnapshot } from "./repository.server";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { SEPA_UNAVAILABLE_REASON, type BuyerPaymentMethods } from "./method-capabilities";

/** Reads the authenticated provider's rollout and selected method; never calls Stripe. */
export async function getBuyerPaymentMethods(): Promise<BuyerPaymentMethods> {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    const snapshot = await getPaymentSettingsSnapshot(userId);
    const kind = runtime.mode === "local_simulation" ? "local" : runtime.mode;
    const setupEnabled = snapshot.kind === kind && (snapshot.featureEnabled || snapshot.setupEnabled === true);
    let selectedMethod: BuyerPaymentMethods["selectedMethod"] = null;
    if (setupEnabled) {
        const customer = await getPaymentCustomer(userId, runtime.mode);
        if (customer && (customer.userId !== userId || customer.mode !== runtime.mode)) throw new PaymentFlowError("owner_mismatch", 403);
        const method = customer?.method;
        if (method) {
            if (method.kind !== (runtime.mode !== "local_simulation" ? "card" : "simulated")) throw new PaymentFlowError("payment_method_unavailable", 409);
            selectedMethod = method.kind;
        }
    }
    return {
        version: "buyer-methods-v1", kind, livePaymentsEnabled: kind === "live", selectedMethod,
        methods: [
            { type: "card", label: "Karte", setupEnabled, availability: setupEnabled ? "available" : "not_enabled",
                flow: "authorize_then_capture", manualCaptureSupported: true },
            { type: "sepa_debit", label: "SEPA-Lastschrift", setupEnabled: false, availability: "not_available",
                flow: "async_debit_after_service", manualCaptureSupported: false, reasonCode: SEPA_UNAVAILABLE_REASON },
        ],
    };
}
