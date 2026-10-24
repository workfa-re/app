import { assertPayoutRecoveryToken, recoverRecipientPayoutOperations } from "@/lib/payments/recipient-payout-settings.server";
import { paymentError, paymentJson } from "@/lib/payments/http.server";
export const runtime = "nodejs";
/** Internal signed worker. It cannot originate a payout. */
export async function POST(request: Request) {
    try { assertPayoutRecoveryToken(request.headers.get("authorization")); return paymentJson(await recoverRecipientPayoutOperations()); }
    catch (error) { return paymentError(error); }
}
