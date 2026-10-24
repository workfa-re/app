import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requirePaymentProvider } from "@/lib/payments/service.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { startPaymentSetup } from "@/lib/payments/service.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["returnTo", "consent", "uiMode", "theme", "paymentMethod"]);
        await requirePaymentProvider(paymentExpectedOwner(request));
        const result = await startPaymentSetup({ consent: input.consent, returnTo: input.returnTo,
            ...(input.uiMode === undefined ? {} : { uiMode: input.uiMode }),
            ...(input.theme === undefined ? {} : { theme: input.theme }),
            ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
            operationId: request.headers.get("idempotency-key") ?? undefined });
        return paymentJson(result);
    } catch (error) { return paymentError(error); }
}
