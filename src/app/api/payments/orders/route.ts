import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { listAppointmentPayments, proposeAppointmentPayment } from "@/lib/payments/order-service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const query = new URL(request.url).searchParams;
        const applicationId = query.get("applicationId");
        if (!applicationId || query.getAll("applicationId").length !== 1 || [...query.keys()].some(key => key !== "applicationId")) throw new PaymentFlowError("invalid_request");
        return paymentJson(await listAppointmentPayments(applicationId));
    } catch (error) { return paymentError(error); }
}
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["appointmentId", "appointmentVersion", "plannedMinutes", "quoteFeePolicy", "consent"]);
        return paymentJson(await proposeAppointmentPayment({ appointmentId: input.appointmentId, appointmentVersion: input.appointmentVersion,
            plannedMinutes: input.plannedMinutes, quoteFeePolicy: input.quoteFeePolicy, consent: input.consent, operationId: request.headers.get("idempotency-key") ?? undefined }));
    } catch (error) { return paymentError(error); }
}
