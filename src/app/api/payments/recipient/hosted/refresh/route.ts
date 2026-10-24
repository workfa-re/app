import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { paymentError } from "@/lib/payments/http.server";
import { refreshHostedRecipient } from "@/lib/payments/recipient-hosted.server";
import { hostedCookieFromHeader } from "@/lib/payments/recipient-hosted-state.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
    try {
        const { origin } = requirePaymentRuntime();
        const target = new URL(request.url);
        const sentOrigin = request.headers.get("origin");
        if (target.origin !== origin || target.search || (sentOrigin !== null && sentOrigin !== origin)) throw new PaymentFlowError("same_origin_required", 403);
        // Stripe returns through a top-level cross-site navigation. Embedded
        // or script-initiated cross-site requests cannot refresh a credential.
        if (request.headers.get("sec-fetch-site") === "cross-site"
            && (request.headers.get("sec-fetch-mode") !== "navigate" || request.headers.get("sec-fetch-dest") !== "document")) throw new PaymentFlowError("same_origin_required", 403);
        const result = await refreshHostedRecipient(hostedCookieFromHeader(request.headers.get("cookie")));
        return new Response(null, { status: 303, headers: { Location: result.url, "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" } });
    } catch (error) { return paymentError(error); }
}
