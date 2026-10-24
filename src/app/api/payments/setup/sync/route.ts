import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { requirePaymentProvider, syncPaymentSetupReturn } from "@/lib/payments/service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["sessionId"]);
        if (typeof input.sessionId !== "string") throw new PaymentFlowError("invalid_request");
        return paymentJson(await syncPaymentSetupReturn(await requirePaymentProvider(paymentExpectedOwner(request)), input.sessionId));
    } catch (error) { return paymentError(error); }
}
