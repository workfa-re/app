import { paymentError, paymentJson } from "@/lib/payments/http.server";
import { readAppointmentPayment } from "@/lib/payments/order-service.server";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
    try { return paymentJson(await readAppointmentPayment((await context.params).orderId)); }
    catch (error) { return paymentError(error); }
}
