import { changeRecipientPayoutSettings, readRecipientPayoutSettings } from "@/lib/payments/recipient-payout-settings.server";
import { paymentError, paymentExpectedOwner, paymentJson, readPaymentJson } from "@/lib/payments/http.server";
import { assertPaymentRequestHost, PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const current = requirePaymentRuntime(); assertPaymentRequestHost(request, current);
        const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
        if (origin !== null && origin !== current.origin || site !== null && !["same-origin", "none"].includes(site)) throw new PaymentFlowError("same_origin_required", 403);
        if (new URL(request.url).search) throw new PaymentFlowError("invalid_request");
        return paymentJson(await readRecipientPayoutSettings(paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["action", "consent", "monthlyDay", "amountCents"]);
        return paymentJson(await changeRecipientPayoutSettings(input, request.headers.get("idempotency-key"), paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}
