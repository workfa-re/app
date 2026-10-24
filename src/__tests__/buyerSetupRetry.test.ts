import { describe, expect, it } from "vitest";
import { resetBuyerSetupOperation } from "@/components/payments/buyer-setup-retry";
import { PaymentRequestError } from "@/components/payments/payment-client";
describe("buyer setup idempotency after interrupted responses",()=>{
    it.each([undefined,"payment_unavailable","setup_in_progress","setup_not_ready","payment_persistence_failed"])("preserves the operation across unknown or retryable failure %j",code=>{
        expect(resetBuyerSetupOperation(new PaymentRequestError("not confirmed",code))).toBe(false);
    });
    it("does not infer a terminal state from an unstructured provider or network exception",()=>{
        expect(resetBuyerSetupOperation(new Error("setup_expired_or_finished may be provider text"))).toBe(false);
    });
    it.each(["setup_expired_or_finished","PAYMENT_SETUP_STALE","setup_surface_mismatch","invalid_publishable_key","invalid_sandbox_configuration"])("starts a fresh operation only for the explicit terminal/configuration result %s",code=>{
        expect(resetBuyerSetupOperation(new PaymentRequestError("safe message",code))).toBe(true);
    });
});
