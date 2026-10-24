import { paymentExpectedOwner } from "@/lib/payments/http.server";
import { requireRecipientUser } from "@/lib/payments/recipient-service.server";
import { readPaymentJson, paymentError, paymentJson } from "@/lib/payments/http.server";
import { syncRecipientStatus } from "@/lib/payments/recipient-service.server";

export const runtime = "nodejs";
export async function POST(request: Request) {
    try {
        await readPaymentJson(request, []);
        await requireRecipientUser(paymentExpectedOwner(request),true);
        return paymentJson(await syncRecipientStatus());
    } catch (error) { return paymentError(error); }
}
