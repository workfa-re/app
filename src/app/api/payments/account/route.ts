import { getBuyerAccountOverview } from "@/lib/payments/buyer-account.server";
import { paymentError, paymentJson, paymentExpectedOwner } from "@/lib/payments/http.server";
import { PaymentFlowError, assertPaymentRequestHost, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const paymentRuntime = requirePaymentRuntime();
        assertPaymentRequestHost(request, paymentRuntime);
        const { origin } = paymentRuntime;
        const url = new URL(request.url);
        const requestOrigin = request.headers.get("origin");
        const fetchSite = request.headers.get("sec-fetch-site");
        if ((requestOrigin !== null && requestOrigin !== origin)
            || (fetchSite !== null && !["same-origin", "none"].includes(fetchSite))) throw new PaymentFlowError("same_origin_required", 403);
        if (url.search) throw new PaymentFlowError("invalid_request", 400);
        return paymentJson(await getBuyerAccountOverview(paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
