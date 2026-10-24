import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { actOnAppointmentPayment } from "@/lib/payments/order-service.server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
    try {
        const input = await readPaymentJson(request, ["action", "consent"]);
        return paymentJson(await actOnAppointmentPayment((await context.params).orderId, { action: input.action, consent: input.consent,
            operationId: request.headers.get("idempotency-key") ?? undefined }));
    } catch (error) { return paymentError(error); }
}
