import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { syncAppointmentPayment } from "@/lib/payments/order-service.server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
    try {
        await readPaymentJson(request, []);
        return paymentJson(await syncAppointmentPayment((await context.params).orderId));
    } catch (error) { return paymentError(error); }
}
