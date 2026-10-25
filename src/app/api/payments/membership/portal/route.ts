import { readPaymentJson, paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { createMembershipPortal } from "@/lib/payments/subscription-service.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        await readPaymentJson(request, []);
        return paymentJson(await createMembershipPortal(paymentExpectedOwner(request)));
    } catch (error) {
        return paymentError(error);
    }
}
