import "server-only";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { requireRecipientUser } from "./recipient-service.server";
import { getRecipientAccount } from "./recipient-repository.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";

/** No schedule update or payout creation exists until retention is operable. */
export async function getRecipientPayoutOverview(expectedOwnerId?: string) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("recipient_payouts_require_sandbox", 409);
    const userId = await requireRecipientUser(expectedOwnerId,true);
    const account = await getRecipientAccount(userId, runtime.mode);
    if (!account?.accountRef) throw new PaymentFlowError("recipient_account_required", 409);
    return createRecipientStripeAdapter().readPayoutOverview(userId, account.accountRef);
}
