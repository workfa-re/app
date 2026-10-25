import { readPaymentJson, paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { syncMembership } from "@/lib/payments/subscription-service.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["sessionId"]);
        return paymentJson(await syncMembership(paymentExpectedOwner(request), input.sessionId));
    } catch (error) {
        return paymentError(error);
    }
}
