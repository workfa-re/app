import { readPaymentJson, paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { startMembershipCheckout } from "@/lib/payments/subscription-service.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["consent", "immediateStart", "termsVersion"]);
        return paymentJson(
            await startMembershipCheckout(paymentExpectedOwner(request), input, request.headers.get("idempotency-key")),
        );
    } catch (error) {
        return paymentError(error);
    }
}
