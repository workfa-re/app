import "server-only";
import { randomUUID } from "node:crypto";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { requireRecipientUser } from "./recipient-service.server";
import { getRecipientAccount } from "./recipient-repository.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { sanitizeRecipientReturnPath } from "./recipient-return-path";
import { createHostedConsent, readHostedConsent, RECIPIENT_HOSTED_TTL } from "./recipient-hosted-state.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function existingRecipient() {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("recipient_hosted_requires_sandbox", 409);
    const userId = await requireRecipientUser();
    // The private RPC independently checks the mode-specific recipient model.
    const account = await getRecipientAccount(userId, runtime.mode);
    if (!account?.accountRef) throw new PaymentFlowError("recipient_account_required", 409);
    return { runtime, userId, accountRef: account.accountRef };
}
function fixedUrls(origin: string, returnTo: string | null) {
    const returned = new URL("/app-home/settings/payments", origin);
    returned.searchParams.set("recipientHosted", "returned");
    if (returnTo) returned.searchParams.set("returnTo", returnTo);
    return { refreshUrl: `${origin}/api/payments/recipient/hosted/refresh`, returnUrl: returned.toString() };
}

export async function startHostedRecipient(input: { consent: unknown; returnTo?: unknown; operationId?: string }) {
    if (input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (input.operationId && !UUID.test(input.operationId)) throw new PaymentFlowError("invalid_operation_id");
    const returnTo = sanitizeRecipientReturnPath(input.returnTo);
    if (input.returnTo !== undefined && input.returnTo !== null && returnTo === null) throw new PaymentFlowError("invalid_recipient_return_path");
    const { runtime, userId, accountRef } = await existingRecipient();
    const state = createHostedConsent(userId, accountRef, returnTo, hostedStateSecret());
    const link = await createRecipientStripeAdapter().createHostedOnboarding(userId, accountRef, fixedUrls(runtime.origin, returnTo), input.operationId ?? randomUUID());
    return { payload: { kind: runtime.mode, ...link, requiresExternalBrowser: true as const }, cookie: state.value, maxAge: RECIPIENT_HOSTED_TTL };
}

export async function refreshHostedRecipient(cookie: string | null) {
    const { runtime, userId, accountRef } = await existingRecipient();
    const consent = readHostedConsent(cookie, userId, accountRef, hostedStateSecret());
    const link = await createRecipientStripeAdapter().createHostedOnboarding(userId, accountRef, fixedUrls(runtime.origin, consent.returnTo), randomUUID());
    // Refresh never extends the original explicit consent window.
    return { url: link.url };
}

function hostedStateSecret() {
    return requirePaymentRuntime().mode === "live" ? process.env.WORKFARE_PAY_HOSTED_STATE_SECRET : process.env.WORKFARE_DEMO_RATE_SECRET;
}
