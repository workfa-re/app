import "server-only";
import { randomUUID } from "node:crypto";
import { getAuthState } from "@/lib/auth";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { stripePublishableKey } from "./stripe-mode.server";
import { isAdultRecipient, isRecipientSandboxEnabled } from "./recipient-config";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import * as repository from "./recipient-repository.server";
import type { RecipientAccountPrefill, RecipientComponent, RecipientSessionResult } from "./recipient-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requireRecipientUser(expectedUserId?: string, allowVerifiedMinor=false) {
    const runtime = requirePaymentRuntime();
    const auth = await getAuthState();
    if (auth.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (auth.state !== "ready" || auth.profile?.account_type !== "job_seeker") throw new PaymentFlowError("recipient_account_required", 403);
    if (expectedUserId && expectedUserId !== auth.session.user.id) throw new PaymentFlowError("owner_mismatch", 409);
    if (runtime.mode !== "local_simulation") {
        if (runtime.mode === "sandbox" && !isRecipientSandboxEnabled()) throw new PaymentFlowError("recipient_sandbox_not_enabled", 503);
        if (!isAdultRecipient(auth.profile.birthdate)) {
            if (!allowVerifiedMinor || runtime.mode!=="live" || (await repository.getRecipientSettingsSnapshot(auth.session.user.id)).status!=="ready") {
                throw new PaymentFlowError("recipient_minor_review_required", 409);
            }
        }
        if (auth.profile.country?.toUpperCase() !== "DE") throw new PaymentFlowError("recipient_country_not_supported", 409);
    }
    return auth.session.user.id;
}

async function recipientPrefill(userId: string): Promise<RecipientAccountPrefill> {
    const auth = await getAuthState();
    if (auth.state !== "ready" || auth.session.user.id !== userId || auth.profile?.account_type !== "job_seeker") throw new PaymentFlowError("owner_mismatch",403);
    const email = auth.session.user.email?.trim();
    const name = auth.profile.full_name?.trim().replace(/\s+/g," ");
    const visitId = auth.session.user.app_metadata?.demo_session_id;
    const persona = auth.session.user.app_metadata?.demo_identity;
    if (!auth.session.user.email_confirmed_at || !email || email.length > 254 || /[\u0000-\u001f\u007f]/.test(email)) {
        throw new PaymentFlowError("recipient_verified_email_required",409);
    }
    // This adapter is available only to the explicit synthetic sandbox cohort.
    // Its Auth trigger makes this issued email immutable, so Account Create's
    // contact_email and user-bound idempotency key survive interrupted retries.
    // A future real-user rollout must persist its own immutable claim snapshot.
    if (typeof visitId !== "string" || !UUID.test(visitId) || !["seeker","peer-seeker"].includes(persona)
        || email !== `demo+${visitId}.${persona}@example.test`) {
        throw new PaymentFlowError("recipient_sandbox_identity_required",403);
    }
    // These are contact/display fields, never a claim of legal identity. Do not
    // prefill an unverified profile email, address, bank details or birthdate.
    return { contactEmail:email,
        ...(name && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name) ? {displayName:name} : {}) };
}

export async function startRecipientSession(input: { component: unknown; consent: unknown; operationId?: string }): Promise<RecipientSessionResult> {
    const runtime = requirePaymentRuntime();
    const userId = await requireRecipientUser(undefined,input.component==="balances" || input.component==="payouts_list");
    if (typeof input.component !== "string" || !["onboarding", "management", "balances", "payouts_list", "notification_banner"].includes(input.component)) throw new PaymentFlowError("invalid_recipient_component");
    if (input.component === "notification_banner" && runtime.mode === "local_simulation") throw new PaymentFlowError("recipient_banner_requires_sandbox", 409);
    if ((input.component === "onboarding" || input.component === "management") && input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (input.operationId && !UUID.test(input.operationId)) throw new PaymentFlowError("invalid_operation_id");
    const operationId = input.operationId ?? randomUUID();
    const component = input.component as RecipientComponent;
    const publishableKey = runtime.mode === "local_simulation" ? null : stripePublishableKey();
    const readOnly = component === "balances" || component === "payouts_list";
    let accountRef: string | null;
    if (readOnly || component === "notification_banner") {
        const snapshot = await repository.getRecipientSettingsSnapshot(userId);
        const stored = await repository.getRecipientAccount(userId, runtime.mode);
        if ((readOnly && snapshot.status !== "ready") || !stored?.accountRef) throw new PaymentFlowError("recipient_setup_required", 409);
        if (component === "notification_banner" && !snapshot.detailsSubmitted) throw new PaymentFlowError("recipient_onboarding_required", 409);
        accountRef = stored.accountRef;
        if (runtime.mode !== "local_simulation") {
            // A 24-hour cached state is insufficient when opening financial data.
            // Persist the fresh capability and payout-destination verification.
            await reconcile(userId,`account-session:${randomUUID()}`);
            const fresh = await repository.getRecipientSettingsSnapshot(userId);
            if (readOnly && fresh.status !== "ready") throw new PaymentFlowError("recipient_setup_required",409);
            if (component === "notification_banner" && !fresh.detailsSubmitted) throw new PaymentFlowError("recipient_onboarding_required",409);
        }
    } else {
        const claim = await repository.claimRecipientAccount(userId, runtime.mode, operationId);
        accountRef = claim.accountRef;
        if (!accountRef) {
            if (!claim.claimed) throw new PaymentFlowError("recipient_setup_in_progress", 409);
            accountRef = runtime.mode === "local_simulation" ? `local_recipient_${userId}` : await createRecipientStripeAdapter().createAccount(userId,runtime.mode === "live" ? requireLivePrefill(claim.prefill) : await recipientPrefill(userId));
            await repository.saveRecipientAccount(userId, runtime.mode, operationId, accountRef);
        }
    }
    if (runtime.mode === "local_simulation") {
        const session = await repository.createRecipientLocalSession(userId, operationId, component);
        if (session.status !== "pending") throw new PaymentFlowError("recipient_session_finished", 409);
        return { kind: "local", sessionId: session.id, component };
    }
    const clientSecret = await createRecipientStripeAdapter().createSession(userId, accountRef, component);
    return { kind: runtime.mode, clientSecret, publishableKey: publishableKey!, component };
}

export async function finishLocalRecipientSession(sessionId: string, outcome: "complete" | "cancel") {
    if (requirePaymentRuntime().mode !== "local_simulation") throw new PaymentFlowError("local_simulation_required", 403);
    const userId = await requireRecipientUser();
    if (!UUID.test(sessionId) || !["complete", "cancel"].includes(outcome)) throw new PaymentFlowError("invalid_request");
    await repository.finishRecipientLocalSession(userId, sessionId, outcome);
    return { ok: true, snapshot: await repository.getRecipientSettingsSnapshot(userId) };
}

async function reconcile(userId: string, eventId: string) {
    const claim = await repository.beginRecipientSync(userId, eventId);
    if (claim.duplicate) return;
    const state = await createRecipientStripeAdapter().inspect(userId, claim.accountRef);
    await repository.applyRecipientSync(userId, eventId, claim.generation, claim.accountRef, state);
}

export async function syncRecipientStatus() {
    const runtime = requirePaymentRuntime();
    const userId = await requireRecipientUser(undefined,true);
    const account = await repository.getRecipientAccount(userId, runtime.mode);
    if (runtime.mode !== "local_simulation" && account?.accountRef) await reconcile(userId, `sync:${randomUUID()}`);
    return { ok: true, snapshot: await repository.getRecipientSettingsSnapshot(userId) };
}

export async function handleRecipientWebhook(payload: string, signature: string, format: "thin" | "snapshot" = "thin") {
    if (requirePaymentRuntime().mode === "local_simulation") throw new PaymentFlowError("sandbox_required", 503);
    const adapter = createRecipientStripeAdapter();
    const event = format === "snapshot" ? await adapter.verifySnapshotWebhook(payload, signature) : await adapter.verifyWebhook(payload, signature);
    if (!event) return { received: true };
    const account = await repository.findRecipientByAccount(event.accountRef);
    if (account?.accountRef === event.accountRef) await reconcile(account.userId, event.id);
    return { received: true };
}

function requireLivePrefill(value: RecipientAccountPrefill | undefined): RecipientAccountPrefill {
    if (!value || typeof value.contactEmail !== "string" || !value.contactEmail.includes("@")) throw new PaymentFlowError("recipient_claim_snapshot_required", 503);
    return value;
}
