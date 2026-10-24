import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requireRecipientUser } from "@/lib/payments/recipient-service.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { startRecipientSession } from "@/lib/payments/recipient-service.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["component", "consent"]);
        await requireRecipientUser(paymentExpectedOwner(request),true);
        return paymentJson(await startRecipientSession({ component: input.component, consent: input.consent, operationId: request.headers.get("idempotency-key") ?? undefined }));
    } catch (error) { return paymentError(error); }
}
