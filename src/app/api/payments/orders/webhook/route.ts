import { readPaymentBody, paymentError, paymentJson } from "@/lib/payments/http.server";
import { handlePaymentOrderWebhook } from "@/lib/payments/order-service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const signature = request.headers.get("stripe-signature");
        if (!signature || signature.length > 2_000) throw new PaymentFlowError("invalid_webhook_signature");
        return paymentJson(await handlePaymentOrderWebhook(await readPaymentBody(request, 262_144), signature));
    } catch (error) { return paymentError(error); }
}
