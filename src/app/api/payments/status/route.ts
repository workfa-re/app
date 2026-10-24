import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requirePaymentProvider } from "@/lib/payments/service.server";
import { getPaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import { paymentJson, paymentError } from "@/lib/payments/http.server";
import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const { origin } = requirePaymentRuntime();
        const url = new URL(request.url);
        const requestOrigin = request.headers.get("origin");
        const fetchSite = request.headers.get("sec-fetch-site");
        if (url.origin !== origin || (requestOrigin !== null && requestOrigin !== origin)
            || (fetchSite !== null && !["same-origin", "none"].includes(fetchSite))) throw new PaymentFlowError("same_origin_required", 403);
        if (url.search) throw new PaymentFlowError("invalid_request", 400);
        return paymentJson(await getPaymentSettingsSnapshot(await requirePaymentProvider(paymentExpectedOwner(request))));
    }
    catch (error) { return paymentError(error); }
}
