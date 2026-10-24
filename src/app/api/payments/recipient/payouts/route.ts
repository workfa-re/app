import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { getRecipientPayoutOverview } from "@/lib/payments/recipient-payouts.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const { origin } = requirePaymentRuntime();
        const url = new URL(request.url), sentOrigin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
        if (url.origin !== origin || (sentOrigin !== null && sentOrigin !== origin) || ![null, "none", "same-origin"].includes(site)) throw new PaymentFlowError("same_origin_required", 403);
        if (url.search) throw new PaymentFlowError("invalid_request");
        return paymentJson(await getRecipientPayoutOverview(paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
