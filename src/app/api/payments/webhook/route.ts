import { readPaymentBody, paymentError, paymentJson } from "@/lib/payments/http.server";
import { handlePaymentWebhook } from "@/lib/payments/service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const signature = request.headers.get("stripe-signature");
        if (!signature || signature.length > 2_000) throw new PaymentFlowError("signature_required");
        return paymentJson(await handlePaymentWebhook(await readPaymentBody(request, 262_144), signature));
    } catch (error) { return paymentError(error); }
}
