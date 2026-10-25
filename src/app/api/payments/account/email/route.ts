import { requestBuyerEmailChange } from "@/lib/payments/buyer-identity.server";
import { paymentError, paymentExpectedOwner, paymentJson, readPaymentJson } from "@/lib/payments/http.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["email"]);
        return paymentJson(await requestBuyerEmailChange(input.email, paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
