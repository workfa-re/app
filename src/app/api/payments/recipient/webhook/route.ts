import { readPaymentBody, paymentError, paymentJson } from "@/lib/payments/http.server";
import { handleRecipientWebhook } from "@/lib/payments/recipient-service.server";
import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        requirePaymentRuntime();
        const signature = request.headers.get("stripe-signature");
        if (!signature) throw new PaymentFlowError("invalid_webhook_signature");
        return paymentJson(await handleRecipientWebhook(await readPaymentBody(request, 262_144), signature));
    } catch (error) { return paymentError(error); }
}
