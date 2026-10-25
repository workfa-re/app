import { updateBuyerBillingDetails } from "@/lib/payments/buyer-account.server";
import { paymentError, paymentJson, readPaymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["address"]);
        return paymentJson(await updateBuyerBillingDetails(input, request.headers.get("idempotency-key") ?? undefined, paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
