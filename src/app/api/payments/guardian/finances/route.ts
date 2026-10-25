import { readGuardianFinance } from "@/lib/payments/guardian-finance.server";
import { paymentError, paymentExpectedOwner, paymentJson } from "@/lib/payments/http.server";
import { assertPaymentRequestHost, PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const current = requirePaymentRuntime(), url = new URL(request.url);
        assertPaymentRequestHost(request, current);
        const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
        if (origin !== null && origin !== current.origin || site !== null && !["same-origin", "none"].includes(site)) throw new PaymentFlowError("same_origin_required", 403);
        if (url.searchParams.size !== 1 || !url.searchParams.has("childId")) throw new PaymentFlowError("invalid_request");
        const response = paymentJson(await readGuardianFinance(url.searchParams.get("childId"), paymentExpectedOwner(request)));
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
    } catch (error) { return paymentError(error); }
}
