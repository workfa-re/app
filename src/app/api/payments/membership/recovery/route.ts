import { paymentError, paymentJson } from "@/lib/payments/http.server";
import {
    assertMembershipRecoveryToken,
    recoverMembershipCancellations,
} from "@/lib/payments/subscription-cancellation.server";
export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        assertMembershipRecoveryToken(request.headers.get("authorization"));
        return paymentJson(await recoverMembershipCancellations());
    } catch (error) {
        return paymentError(error);
    }
}
