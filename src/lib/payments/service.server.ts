import "server-only";
import { randomUUID } from "node:crypto";
import { getAuthState } from "@/lib/auth";
import * as repository from "./repository.server";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { createStripeSandboxAdapter } from "./stripe-sandbox.server";
import { PAYMENT_SETTINGS_PATH, sanitizePaymentReturnPath } from "./return-path";
import type { PaymentMode, SetupRecord, StoredMethod } from "./types";
import { assertStripeModeObject, stripePublishableKey } from "./stripe-mode.server";
import { SEPA_UNAVAILABLE_REASON } from "./method-capabilities";

export const PAYMENT_SETUP_CONSENT_VERSION = "buyer-method-setup-v1";
const MAX_METHOD_DETACHES_PER_REQUEST = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requirePaymentProvider(expectedUserId?: string) {
    const state = await getAuthState();
    if (state.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (state.state !== "ready" || state.profile?.account_type !== "job_provider") throw new PaymentFlowError("provider_account_required", 403);
    if (expectedUserId && expectedUserId !== state.session.user.id) throw new PaymentFlowError("owner_mismatch", 409);
    return state.session.user.id;
}

async function ownedSetup(userId: string, sessionId: string): Promise<SetupRecord> {
    const runtime = requirePaymentRuntime();
    if (!UUID.test(sessionId)) throw new PaymentFlowError("setup_not_found", 404);
    const setup = await repository.getPaymentSetup(sessionId);
    if (!setup || setup.userId !== userId || setup.mode !== runtime.mode) throw new PaymentFlowError("setup_not_found", 404);
    return setup;
}

export async function getPaymentSetupForUser(userId: string, sessionId: string) {
    await requirePaymentProvider(userId);
    const setup = await ownedSetup(userId, sessionId);
    if (!Number.isFinite(Date.parse(setup.expiresAt)) || Date.parse(setup.expiresAt) <= Date.now()) throw new PaymentFlowError("setup_expired_or_finished", 409);
    return { id: setup.id, mode: setup.mode, status: setup.status, expiresAt: setup.expiresAt, returnTo: sanitizePaymentReturnPath(setup.returnTo) };
}

async function ensureCustomer(userId: string, mode: PaymentMode, operationId: string) {
    const claim = await repository.claimPaymentCustomer(userId, mode, operationId);
    if (claim.customerRef) return claim.customerRef;
    if (!claim.claimed) throw new PaymentFlowError("setup_in_progress", 409);
    const customerRef = mode === "local_simulation" ? `local_cus_${userId}`
        : await createStripeSandboxAdapter().createCustomer(userId, `workfare-pay:customer:${userId}`);
    await repository.savePaymentCustomer(userId, mode, operationId, customerRef);
    return customerRef;
}

export async function startPaymentSetup(input: { consent: unknown; returnTo?: unknown; operationId?: string; uiMode?: unknown; theme?: unknown; paymentMethod?: unknown }) {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    // Saving an unsupported mandate would falsely satisfy the publication gate.
    // SEPA requires a separate asynchronous collection model, not manual capture.
    if (input.paymentMethod === "sepa_debit") throw new PaymentFlowError(SEPA_UNAVAILABLE_REASON, 409);
    if (input.paymentMethod !== undefined && input.paymentMethod !== "card") throw new PaymentFlowError("invalid_payment_method");
    if (input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (input.uiMode !== undefined && input.uiMode !== "embedded") throw new PaymentFlowError("invalid_setup_surface");
    if (input.theme !== undefined && input.theme !== "light" && input.theme !== "dark") throw new PaymentFlowError("invalid_setup_theme");
    const theme = input.theme === "dark" ? "dark" : "light";
    const embedded = input.uiMode === "embedded";
    // The browser only receives the publishable test key after the runtime and
    // owner have been verified. Missing keys fail before creating PSP objects.
    const publishableKey = embedded && runtime.mode !== "local_simulation" ? stripePublishableKey() : null;
    const returnTo = input.returnTo === undefined || input.returnTo === null ? null : sanitizePaymentReturnPath(input.returnTo);
    if (input.returnTo != null && !returnTo) throw new PaymentFlowError("invalid_return_path");
    if (input.operationId && !UUID.test(input.operationId)) throw new PaymentFlowError("invalid_operation_id");
    const operationId = input.operationId ?? randomUUID();
    const customerRef = await ensureCustomer(userId, runtime.mode, operationId);
    const setup = await repository.createPaymentSetup(userId, runtime.mode, operationId, returnTo, PAYMENT_SETUP_CONSENT_VERSION);
    if (setup.status === "complete") {
        if (embedded) return { kind: "complete" as const, sessionId: setup.id, returnTo: sanitizePaymentReturnPath(setup.returnTo) };
        const url = new URL(PAYMENT_SETTINGS_PATH, runtime.origin);
        url.searchParams.set("session_id", setup.id);
        return { url: url.pathname + url.search };
    }
    if (setup.status !== "pending") throw new PaymentFlowError("setup_expired_or_finished", 409);
    if (runtime.mode === "local_simulation") {
        if (embedded) return { kind: "local" as const, sessionId: setup.id };
        const url = new URL(`${PAYMENT_SETTINGS_PATH}/setup`, runtime.origin);
        url.searchParams.set("session_id", setup.id);
        return { url: url.pathname + url.search };
    }
    if (embedded) {
        const session = await createStripeSandboxAdapter().createEmbeddedSetup(customerRef, userId, setup.id, returnTo, setup.externalSessionId, theme);
        await repository.attachPaymentSetupSession(setup.id, session.id, session.expiresAt);
        if (session.status === "complete") {
            // A retried operation may have completed at Stripe while its webhook
            // is still in flight. Retrieve the SetupIntent before reporting it.
            const verified = await syncPaymentSetupReturn(userId, setup.id);
            if (verified.status !== "complete") throw new PaymentFlowError("setup_not_ready", 409);
            return { kind: "complete" as const, sessionId: setup.id, returnTo: verified.returnTo };
        }
        return { kind: "embedded" as const, sessionId: setup.id, clientSecret: session.clientSecret, publishableKey: publishableKey! };
    }
    const session = await createStripeSandboxAdapter().createSetup(customerRef, userId, setup.id, returnTo);
    await repository.attachPaymentSetupSession(setup.id, session.id, session.expiresAt);
    return { url: session.url };
}

async function reconcileSetup(setup: SetupRecord, eventId: string) {
    if (setup.mode === "local_simulation" || !setup.externalSessionId) throw new PaymentFlowError("invalid_setup_session", 409);
    const customer = await repository.getPaymentCustomer(setup.userId, setup.mode);
    if (!customer?.stripeCustomerId || customer.id !== setup.customerId) throw new PaymentFlowError("customer_mismatch", 409);
    const inspected = await createStripeSandboxAdapter().inspectSetup(setup.externalSessionId, customer.stripeCustomerId, setup.userId, setup.id);
    if (inspected.status === "complete") {
        await repository.completePaymentSetup(setup.id, eventId, customer.stripeCustomerId, inspected.method);
    } else if (inspected.status === "expired") {
        await repository.cancelPaymentSetup(setup.id, setup.userId);
    }
    return inspected.status;
}

/** Query-string success is never proof: verify the persisted owner and PSP objects. */
export async function syncPaymentSetupReturn(userId: string, sessionId: string) {
    await requirePaymentProvider(userId);
    const setup = await ownedSetup(userId, sessionId);
    const status = setup.mode === "local_simulation" || setup.status !== "pending"
        ? setup.status : await reconcileSetup(setup, `return-sync:${setup.id}`);
    if (status === "complete") {
        // The new method is already verified and persisted. Old-method cleanup
        // failure must not turn that success into a false negative. The durable
        // queue remains visible as pendingRemoval in the settings snapshot.
        await drainPendingMethodDetaches(userId, setup.mode).catch(() => undefined);
    }
    return { status, returnTo: sanitizePaymentReturnPath(setup.returnTo) };
}

export async function finishLocalPaymentSetup(sessionId: string, outcome: "complete" | "cancel") {
    if (outcome !== "complete" && outcome !== "cancel") throw new PaymentFlowError("invalid_request");
    const runtime = requirePaymentRuntime();
    if (runtime.mode !== "local_simulation") throw new PaymentFlowError("local_simulation_required", 403);
    const userId = await requirePaymentProvider();
    const setup = await ownedSetup(userId, sessionId);
    const terminalStatus = outcome === "complete" ? "complete" : "canceled";
    if (setup.status === terminalStatus) return localReturn(setup, outcome, runtime.origin);
    if (setup.status !== "pending" || Date.parse(setup.expiresAt) <= Date.now()) throw new PaymentFlowError("setup_expired_or_finished", 409);
    if (outcome === "cancel") await repository.cancelPaymentSetup(setup.id, userId);
    else {
        const customer = await repository.getPaymentCustomer(userId, runtime.mode);
        if (!customer?.stripeCustomerId || customer.id !== setup.customerId) throw new PaymentFlowError("customer_mismatch", 409);
        const method: StoredMethod = { id: `local_pm_${setup.id}`, kind: "simulated", brand: "simulation", last4: null, expiryMonth: null, expiryYear: null };
        await repository.completePaymentSetup(setup.id, `local-complete:${setup.id}`, customer.stripeCustomerId, method);
    }
    return localReturn(setup, outcome, runtime.origin);
}

function localReturn(setup: SetupRecord, outcome: "complete" | "cancel", origin: string) {
    const url = new URL(PAYMENT_SETTINGS_PATH, origin);
    url.searchParams.set("session_id", setup.id);
    url.searchParams.set("setup", outcome === "complete" ? "success" : "canceled");
    const returnTo = sanitizePaymentReturnPath(setup.returnTo);
    if (returnTo) url.searchParams.set("returnTo", returnTo);
    return { url: url.pathname + url.search };
}

export async function removeBuyerPaymentMethod() {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    const customer = await repository.getPaymentCustomer(userId, runtime.mode);
    const eventId = `owner-remove:${randomUUID()}`;
    const methodRef = customer?.method?.id ?? null;
    // Withdraw readiness first, and invalidate pending/late setups atomically.
    // A temporary PSP failure must not leave the method usable in our app.
    await repository.removePaymentMethod(userId, runtime.mode, eventId, methodRef);
    return { ok: true as const, ...await drainPendingMethodDetaches(userId, runtime.mode) };
}

/** A cleanup retry never withdraws or detaches the current payment method. */
export async function retryBuyerPaymentMethodRemoval() {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    return { ok: true as const, ...await drainPendingMethodDetaches(userId, runtime.mode) };
}

async function drainPendingMethodDetaches(userId: string, mode: PaymentMode) {
    if (mode === "local_simulation") return { pendingRemoval: false };
    const adapter = createStripeSandboxAdapter();
    const visited = new Set<string>();
    for (let index = 0; index < MAX_METHOD_DETACHES_PER_REQUEST; index += 1) {
        const customer = await repository.getPaymentCustomer(userId, mode);
        const methodRef = customer?.pendingDetachMethodId;
        if (!methodRef) return { pendingRemoval: false };
        if (!customer.stripeCustomerId || customer.method?.id === methodRef) throw new PaymentFlowError("payment_cleanup_conflict", 409);
        // A repeated projection cannot cause an unbounded network loop. SQL
        // additionally forbids queued/retired refs from becoming current again.
        if (visited.has(methodRef)) return { pendingRemoval: true };
        visited.add(methodRef);
        await adapter.detachMethod(customer.stripeCustomerId, methodRef, userId, `workfare-pay:detach:${userId}:${methodRef}`);
        await repository.confirmPaymentMethodDetached(userId, mode, methodRef);
    }
    const remaining = await repository.getPaymentCustomer(userId, mode);
    return { pendingRemoval: Boolean(remaining?.pendingDetachMethodId) };
}

export async function handlePaymentWebhook(payload: string, signature: string) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("sandbox_required", 503);
    const event = await createStripeSandboxAdapter().verifyWebhook(payload, signature);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
        const session = event.data.object;
        const setupId = session.metadata?.workfare_pay_setup;
        if (!setupId || !UUID.test(setupId)) return { received: true as const };
        const setup = await repository.getPaymentSetup(setupId);
        if (!setup || setup.mode !== runtime.mode || setup.externalSessionId !== session.id) return { received: true as const };
        if (setup.status === "complete") {
            await drainPendingMethodDetaches(setup.userId, setup.mode);
            return { received: true as const };
        }
        if (setup.status !== "pending") return { received: true as const };
        try {
            const status = await reconcileSetup(setup, event.id);
            if (status === "pending") throw new PaymentFlowError("setup_not_ready", 503);
            if (status === "complete") await drainPendingMethodDetaches(setup.userId, setup.mode);
        }
        catch (error) {
            // Removal/newer setup can race a valid delayed webhook. A stale
            // generation is deliberately ignored, never revived or retried.
            if (!(error instanceof PaymentFlowError) || error.code !== "PAYMENT_SETUP_STALE") throw error;
        }
    } else if (event.type === "payment_method.detached") {
        assertStripeModeObject(event.data.object, runtime.mode);
        // The signed object alone is insufficient to pick a user. Repository
        // resolves only the currently stored matching method under a lock.
        await repository.removePaymentMethodByReference(runtime.mode, event.id, event.data.object.id);
    }
    return { received: true as const };
}
