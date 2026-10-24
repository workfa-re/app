import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { confirmAppointmentPayment } from "@/lib/payments/order-service.server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
    try {
        const input = await readPaymentJson(request, ["termsVersion", "consent"]);
        return paymentJson(await confirmAppointmentPayment((await context.params).orderId, { termsVersion: input.termsVersion, consent: input.consent }));
    } catch (error) { return paymentError(error); }
}
