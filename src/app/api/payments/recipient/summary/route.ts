import { PaymentFlowError, assertPaymentRequestHost, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { paymentError, paymentJson } from "@/lib/payments/http.server";
import { getRecipientPaymentSummary } from "@/lib/payments/recipient-summary.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const paymentRuntime = requirePaymentRuntime();
        assertPaymentRequestHost(request, paymentRuntime);
        const { origin } = paymentRuntime;
        const url = new URL(request.url), sentOrigin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
        if ((sentOrigin !== null && sentOrigin !== origin) || ![null, "none", "same-origin"].includes(site)) throw new PaymentFlowError("same_origin_required", 403);
        if (url.search && (url.searchParams.size !== 1 || url.searchParams.get("view") !== "home")) throw new PaymentFlowError("invalid_request");
        return paymentJson(await getRecipientPaymentSummary(url.searchParams.get("view") === "home" ? "home" : "full"));
    } catch (error) { return paymentError(error); }
}
