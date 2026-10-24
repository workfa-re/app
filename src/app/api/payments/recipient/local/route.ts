import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requireRecipientUser } from "@/lib/payments/recipient-service.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { finishLocalRecipientSession } from "@/lib/payments/recipient-service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["sessionId", "outcome"]);
        await requireRecipientUser(paymentExpectedOwner(request));
        if (typeof input.sessionId !== "string" || (input.outcome !== "complete" && input.outcome !== "cancel")) throw new PaymentFlowError("invalid_request");
        return paymentJson(await finishLocalRecipientSession(input.sessionId, input.outcome));
    } catch (error) { return paymentError(error); }
}
