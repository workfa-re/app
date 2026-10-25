import { assertPaymentRequestHost, requirePaymentRuntime, PaymentFlowError } from "@/lib/payments/runtime.server";
import { paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { getMembershipSnapshot } from "@/lib/payments/subscription-service.server";
export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const runtime = requirePaymentRuntime();
        assertPaymentRequestHost(request, runtime);
        const url = new URL(request.url);
        if (url.search) throw new PaymentFlowError("invalid_request", 400);
        return paymentJson(await getMembershipSnapshot(paymentExpectedOwner(request)));
    } catch (error) {
        return paymentError(error);
    }
}
