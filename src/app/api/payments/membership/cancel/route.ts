import { readPaymentJson, paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { changeMembershipRenewal } from "@/lib/payments/subscription-service.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["consent"]);
        return paymentJson(await changeMembershipRenewal(paymentExpectedOwner(request), true, input.consent));
    } catch (error) {
        return paymentError(error);
    }
}
