import { paymentError, paymentJson } from "@/lib/payments/http.server";
import { requestMembershipCancellation,readMembershipDeclaration } from "@/lib/payments/subscription-cancellation.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        const input = await readMembershipDeclaration(request);
        const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
            "unknown";
        return paymentJson(await requestMembershipCancellation(input, request.headers.get("idempotency-key"), ip));
    } catch (error) {
        return paymentError(error);
    }
}
