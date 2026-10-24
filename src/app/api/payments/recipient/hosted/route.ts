import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requireRecipientUser } from "@/lib/payments/recipient-service.server";
import { paymentError, paymentJson, readPaymentJson } from "@/lib/payments/http.server";
import { startHostedRecipient } from "@/lib/payments/recipient-hosted.server";
import { hostedConsentCookie } from "@/lib/payments/recipient-hosted-state.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        if (new URL(request.url).search) return paymentJson({ code: "invalid_request" }, 400);
        const input = await readPaymentJson(request, ["consent", "returnTo"]);
        await requireRecipientUser(paymentExpectedOwner(request));
        const result = await startHostedRecipient({ consent: input.consent, returnTo: input.returnTo, operationId: request.headers.get("idempotency-key") ?? undefined });
        const response = paymentJson(result.payload);
        response.headers.append("Set-Cookie", hostedConsentCookie(result.cookie, result.maxAge, new URL(request.url).protocol === "https:"));
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
    } catch (error) { return paymentError(error); }
}
