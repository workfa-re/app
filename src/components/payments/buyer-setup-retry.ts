import { PaymentRequestError } from "./payment-client";

/** Unknown transport/provider outcomes must retry the same persisted operation. */
export function resetBuyerSetupOperation(error: unknown): boolean {
    return error instanceof PaymentRequestError && ["setup_expired_or_finished", "PAYMENT_SETUP_STALE", "setup_surface_mismatch",
        "invalid_setup_surface", "PAYMENT_OPERATION_CONFLICT", "invalid_publishable_key", "invalid_sandbox_configuration", "invalid_test_key", "live_key_forbidden"].includes(error.code ?? "");
}
