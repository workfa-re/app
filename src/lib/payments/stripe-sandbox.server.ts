import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import type { PaymentMode } from "./types";
import { inspectPaymentsConfiguration, type PaymentsEnvironment } from "./config";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { PAYMENT_SETTINGS_PATH, sanitizePaymentReturnPath } from "./return-path";
import type { StoredMethod } from "./types";

const referenceId = (value: string | { id: string } | null): string | null => typeof value === "string" ? value : value?.id ?? null;
function reject(): never { throw new PaymentFlowError("sandbox_object_mismatch", 409); }

function assertCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer, userId: string, mode: PaymentMode = "sandbox"): asserts customer is Stripe.Customer {
    if ("deleted" in customer && customer.deleted) reject();
    assertStripeModeObject(customer, mode);
    if ((customer as Stripe.Customer).metadata.workfare_pay_user !== userId) reject();
}

function assertSetupSession(session: Stripe.Checkout.Session, customerId: string, userId: string, setupId: string, mode: PaymentMode = "sandbox") {
    assertStripeModeObject(session, mode);
    if (!(mode === "live" ? /^cs_live_[a-zA-Z0-9]+$/ : /^cs_test_[a-zA-Z0-9]+$/).test(session.id) || session.mode !== "setup"
        || referenceId(session.customer) !== customerId || session.client_reference_id !== setupId
        || session.metadata?.workfare_pay_setup !== setupId || session.metadata?.workfare_pay_user !== userId) reject();
}

function embeddedSession(session: Stripe.Checkout.Session, customerId: string, userId: string, setupId: string, mode: PaymentMode = "sandbox") {
    assertSetupSession(session, customerId, userId, setupId, mode);
    if (session.ui_mode !== "embedded_page") throw new PaymentFlowError("setup_surface_mismatch", 409);
    if (!Number.isFinite(session.expires_at) || session.expires_at * 1_000 <= Date.now()) {
        throw new PaymentFlowError("setup_expired_or_finished", 409);
    }
    const expiresAt = new Date(session.expires_at * 1_000).toISOString();
    if (session.status === "complete") return { status: "complete" as const, id: session.id, expiresAt };
    if (session.status !== "open") throw new PaymentFlowError("setup_expired_or_finished", 409);
    // This secret is handed directly to Stripe.js for this owner and is never
    // persisted, placed in a URL, logged or accepted back as completion proof.
    const prefix = `${session.id}_secret_`;
    if (!session.client_secret?.startsWith(prefix) || /[\s\u0000-\u001f\u007f]/.test(session.client_secret)
        || session.client_secret.length <= prefix.length || session.client_secret.length > 4_096) reject();
    return { status: "pending" as const, id: session.id, clientSecret: session.client_secret, expiresAt };
}

function cardSummary(method: Stripe.PaymentMethod, customerId: string, mode: PaymentMode = "sandbox"): StoredMethod {
    assertStripeModeObject(method, mode);
    if (referenceId(method.customer) !== customerId || method.type !== "card" || !method.card
        || !/^\d{4}$/.test(method.card.last4) || method.card.exp_month < 1 || method.card.exp_month > 12
        || !Number.isInteger(method.card.exp_year)) reject();
    return { id: method.id, kind: "card", brand: method.card.brand, last4: method.card.last4,
        expiryMonth: method.card.exp_month, expiryYear: method.card.exp_year };
}

/** Only the explicitly reviewed setup/inspect/detach operations are available. */
export function createStripeSandboxAdapter(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    if (runtime.mode === "local_simulation" || inspectPaymentsConfiguration(environment).status !== runtime.mode) throw new PaymentFlowError("sandbox_required", 503);
    const mode = runtime.mode;
    const sdk = paymentStripeSdk(environment);
    const customerForSetup = async (stripe: Stripe, customerId: string, userId: string, setupId: string, email?: string) => {
        if (email !== undefined && !z.email().max(254).safeParse(email).success) throw new PaymentFlowError("confirmed_email_required", 403);
        const customer = await stripe.customers.retrieve(customerId);
        assertCustomer(customer, userId, mode);
        if (customer.id !== customerId) reject();
        if (email === undefined || customer.email === email) return;
        // Keep createCustomer's stable idempotency parameters unchanged. This
        // also repairs Customers created before account-email prefill existed.
        // The key contains a digest, never the person's email address.
        const emailDigest = createHash("sha256").update(email).digest("hex");
        const updated = await stripe.customers.update(customerId, { email }, {
            idempotencyKey: `workfare-pay:setup-email:${setupId}:${emailDigest}`,
        });
        assertCustomer(updated, userId, mode);
        if (updated.id !== customerId || updated.email !== email) reject();
    };

    return Object.freeze({
        async createCustomer(userId: string, idempotencyKey: string) {
            const customer = await (await sdk()).customers.create({ metadata: { workfare_pay_user: userId } }, { idempotencyKey });
            assertCustomer(customer, userId, mode);
            return customer.id;
        },
        async createSetup(customerId: string, userId: string, setupId: string, returnTo: string | null, email?: string) {
            if (returnTo !== null && !sanitizePaymentReturnPath(returnTo)) throw new PaymentFlowError("invalid_return_path");
            const stripe = await sdk();
            await customerForSetup(stripe, customerId, userId, setupId, email);
            const success = new URL(PAYMENT_SETTINGS_PATH, runtime.origin);
            success.searchParams.set("session_id", setupId);
            success.searchParams.set("setup", "success");
            if (returnTo) success.searchParams.set("returnTo", returnTo);
            const cancel = new URL(success);
            cancel.searchParams.set("setup", "canceled");
            const metadata = { workfare_pay_setup: setupId, workfare_pay_user: userId };
            const session = await stripe.checkout.sessions.create({
                mode: "setup", ui_mode: "hosted_page", customer: customerId, currency: "eur",
                allowed_payment_method_types: ["card"], client_reference_id: setupId,
                metadata, setup_intent_data: { metadata }, wallet_options: { link: { display: "never" } },
                success_url: success.toString(), cancel_url: cancel.toString(), locale: "de",
            }, { idempotencyKey: `workfare-pay:setup:${setupId}` });
            assertStripeModeObject(session, mode);
            if (session.mode !== "setup" || referenceId(session.customer) !== customerId || !session.id.startsWith(mode === "live" ? "cs_live_" : "cs_test_") || !session.url) reject();
            const url = new URL(session.url);
            if (!["https://checkout.stripe.com", ...(mode === "live" && environment.WORKFARE_PAY_CHECKOUT_ORIGIN === "https://pay.workfa.re" ? ["https://pay.workfa.re"] : [])].includes(url.origin) || url.username || url.password) reject();
            return { id: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1_000).toISOString() };
        },
        async createEmbeddedSetup(customerId: string, userId: string, setupId: string, returnTo: string | null, existingSessionId: string | null = null, theme: "light" | "dark" = "light", email?: string) {
            if (returnTo !== null && !sanitizePaymentReturnPath(returnTo)) throw new PaymentFlowError("invalid_return_path");
            const stripe = await sdk();
            await customerForSetup(stripe, customerId, userId, setupId, email);
            if (existingSessionId) {
                const existing = await stripe.checkout.sessions.retrieve(existingSessionId);
                if (existing.id !== existingSessionId) reject();
                return embeddedSession(existing, customerId, userId, setupId, mode);
            }
            const returnUrl = new URL(PAYMENT_SETTINGS_PATH, runtime.origin);
            returnUrl.searchParams.set("session_id", setupId);
            const metadata = { workfare_pay_setup: setupId, workfare_pay_user: userId };
            const session = await stripe.checkout.sessions.create({
                mode: "setup", ui_mode: "embedded_page", customer: customerId, currency: "eur",
                allowed_payment_method_types: ["card"], client_reference_id: setupId,
                metadata, setup_intent_data: { metadata }, locale: "de", wallet_options: { link: { display: "never" } },
                branding_settings: { display_name: "Workfare", font_family: "inter", border_style: "rounded",
                    background_color: theme === "dark" ? "#101010" : "#f7f7f7", button_color: theme === "dark" ? "#f2f2f2" : "#202020" },
                // Card setup completes in place. A bank authentication flow may
                // return here, where the server verifies the stored setup again.
                redirect_on_completion: "if_required", return_url: returnUrl.toString(),
            }, { idempotencyKey: `workfare-pay:embedded-setup:${setupId}` });
            return embeddedSession(session, customerId, userId, setupId, mode);
        },
        async inspectSetup(sessionId: string, customerId: string, userId: string, setupId: string) {
            const stripe = await sdk();
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            assertSetupSession(session, customerId, userId, setupId, mode);
            if (session.id !== sessionId) reject();
            if (session.status === "expired") return { status: "expired" as const };
            if (session.status !== "complete") return { status: "pending" as const };
            const setupIntentId = referenceId(session.setup_intent);
            if (!setupIntentId) reject();
            const intent = await stripe.setupIntents.retrieve(setupIntentId);
            assertStripeModeObject(intent, mode);
            if (intent.status !== "succeeded" || referenceId(intent.customer) !== customerId
                || intent.metadata?.workfare_pay_setup !== setupId || intent.metadata?.workfare_pay_user !== userId) reject();
            const methodId = referenceId(intent.payment_method);
            if (!methodId) reject();
            assertCustomer(await stripe.customers.retrieve(customerId), userId, mode);
            const method = cardSummary(await stripe.paymentMethods.retrieve(methodId), customerId, mode);
            return { status: "complete" as const, method };
        },
        async detachMethod(customerId: string, methodId: string, userId: string, idempotencyKey: string) {
            const stripe = await sdk();
            assertCustomer(await stripe.customers.retrieve(customerId), userId, mode);
            const method = await stripe.paymentMethods.retrieve(methodId);
            assertStripeModeObject(method, mode);
            if (method.customer === null) return;
            if (referenceId(method.customer) !== customerId) reject();
            const detached = await stripe.paymentMethods.detach(methodId, {}, { idempotencyKey });
            assertStripeModeObject(detached, mode);
            if (detached.customer !== null) reject();
        },
        async verifyWebhook(payload: string, signature: string) {
            const secret = environment.STRIPE_WEBHOOK_SECRET;
            if (!secret || !/^whsec_[a-zA-Z0-9]+$/.test(secret)) throw new PaymentFlowError("webhook_not_configured", 503);
            let event: Stripe.Event;
            const stripe = await sdk();
            try { event = stripe.webhooks.constructEvent(payload, signature, secret); }
            catch { throw new PaymentFlowError("invalid_webhook_signature", 400); }
            assertStripeModeObject(event, mode);
            return event;
        },
    });
}
