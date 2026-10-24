import { readPaymentBody, paymentError, paymentJson } from "@/lib/payments/http.server";
import { handleRecipientWebhook } from "@/lib/payments/recipient-service.server";
import { handleRecipientPayoutSnapshot } from "@/lib/payments/recipient-payout-settings.server";
import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        requirePaymentRuntime();
        const signature = request.headers.get("stripe-signature");
        if (!signature) throw new PaymentFlowError("invalid_webhook_signature");
        const payload = await readPaymentBody(request, 262_144);
        const result = await handleRecipientWebhook(payload, signature, "snapshot");
        await handleRecipientPayoutSnapshot(payload, signature);
        return paymentJson(result);
    } catch (error) { return paymentError(error); }
}
