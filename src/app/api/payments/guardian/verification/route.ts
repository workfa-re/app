import { isIP } from "node:net";
import { readNativeGuardianSetup, saveNativeGuardianSetup } from "@/lib/payments/guardian-native.server";
import { paymentError, paymentExpectedOwner, paymentJson, readPaymentJson } from "@/lib/payments/http.server";
import { assertPaymentRequestHost, PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const paymentRuntime = requirePaymentRuntime();
        assertPaymentRequestHost(request, paymentRuntime);
        const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site"), url = new URL(request.url);
        if (origin !== null && origin !== paymentRuntime.origin || site !== null && !["same-origin", "none"].includes(site)) throw new PaymentFlowError("same_origin_required", 403);
        if (url.searchParams.size !== 1 || !url.searchParams.has("childId")) throw new PaymentFlowError("invalid_request");
        return paymentJson(await readNativeGuardianSetup(url.searchParams.get("childId"), paymentExpectedOwner(request)));
    } catch (error) { return paymentError(error); }
}

export async function POST(request: Request) {
    try {
        const input = await readPaymentJson(request, ["childId", "consent", "guardian", "child"]);
        // The production origin is behind Cloudflare. This header must be
        // overwritten by the trusted ingress; arbitrary X-Forwarded-For is not evidence.
        const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
        if (!isIP(ip)) throw new PaymentFlowError("recipient_acceptance_ip_required");
        const response = paymentJson(await saveNativeGuardianSetup(input, request.headers.get("idempotency-key"), paymentExpectedOwner(request), {
            date: new Date().toISOString(), ip, userAgent: request.headers.get("user-agent") ?? "",
        }));
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
    } catch (error) { return paymentError(error); }
}
