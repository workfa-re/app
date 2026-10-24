import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requirePaymentProvider } from "@/lib/payments/service.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { retryBuyerPaymentMethodRemoval } from "@/lib/payments/service.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        await readPaymentJson(request, []);
        await requirePaymentProvider(paymentExpectedOwner(request));
        return paymentJson(await retryBuyerPaymentMethodRemoval());
    } catch (error) { return paymentError(error); }
}
