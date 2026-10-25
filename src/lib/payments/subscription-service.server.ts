import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import { requirePaymentProvider } from "./service.server";
import { getBuyerProfileIdentity, syncBuyerCustomerIdentity } from "./buyer-identity.server";
import { claimPaymentCustomer, getPaymentCustomer, savePaymentCustomer } from "./repository.server";
import { createStripeSandboxAdapter } from "./stripe-sandbox.server";
import {
    claimMembershipCheckout,
    membershipRecord,
    membershipRpc,
    type MembershipRecord,
} from "./subscription-repository.server";
import { MEMBERSHIP_DEFAULT_OFFER, MEMBERSHIP_TERMS_VERSION, type MembershipSnapshot } from "./subscription-types";

const uuid = z.string().uuid();
const ref = (value: string | { id: string } | null | undefined) =>
    typeof value === "string" ? value : (value?.id ?? null);
const date = (seconds: number) =>
    Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
function fail(code = "membership_object_mismatch"): never {
    throw new PaymentFlowError(code, 409);
}
const MEMBERSHIP_PATH = "/app-home/settings/membership";
const STRIPE_STATUSES = [
    "active",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "paused",
    "trialing",
    "unpaid",
];

function projection(record: MembershipRecord): MembershipSnapshot {
    const blocked =
        record.subscriptionRef !== null && !["canceled", "incomplete_expired", "none"].includes(record.status);
    return {
        ownerId: record.userId,
        kind: record.mode,
        offer: MEMBERSHIP_DEFAULT_OFFER,
        membership: {
            status: record.status,
            entitled: record.entitled,
            currentPeriodEnd: record.periodEnd,
            cancelAtPeriodEnd: record.cancelAtPeriodEnd,
            contractReference: record.contractReference,
        },
        checkoutAvailable: record.enabled && !blocked,
        manageAvailable: !!record.subscriptionRef,
    };
}
function safeUrl(value: string | null, kind: "checkout" | "portal") {
    const url = new URL(value ?? "");
    const allowed =
        kind === "checkout" ? ["checkout.stripe.com", "pay.workfa.re"] : ["billing.stripe.com", "pay.workfa.re"];
    if (url.protocol !== "https:" || url.username || url.password || !allowed.includes(url.hostname))
        fail("membership_redirect_unconfirmed");
    return url.toString();
}
async function ownedCustomer(stripe: Stripe, record: MembershipRecord) {
    if (!record.customerRef) fail("membership_customer_required");
    const customer = await stripe.customers.retrieve(record.customerRef!);
    assertStripeModeObject(customer, record.mode);
    if (
        customer.id !== record.customerRef ||
        ("deleted" in customer && customer.deleted) ||
        !("metadata" in customer) ||
        customer.metadata.workfare_pay_user !== record.userId
    )
        fail("membership_owner_conflict");
}
async function price(stripe: Stripe, record: MembershipRecord) {
    if (!record.enabled || !record.priceRef || !record.productRef)
        throw new PaymentFlowError("membership_unavailable", 503);
    const item = await stripe.prices.retrieve(record.priceRef);
    assertStripeModeObject(item, record.mode);
    if (
        !item.active ||
        item.id !== record.priceRef ||
        ref(item.product) !== record.productRef ||
        item.unit_amount !== record.monthlyCents ||
        item.currency !== "eur" ||
        item.type !== "recurring" ||
        item.recurring?.interval !== "month" ||
        item.recurring.interval_count !== 1
    )
        fail("membership_price_unconfirmed");
    if (record.taxTreatment === "pending") throw new PaymentFlowError("membership_tax_configuration_required", 503);
    if (record.taxTreatment === "vat19") {
        if (!record.taxRateRef || item.tax_behavior !== "inclusive") fail("membership_tax_unconfirmed");
        const rate = await stripe.taxRates.retrieve(record.taxRateRef);
        assertStripeModeObject(rate, record.mode);
        if (
            rate.id !== record.taxRateRef ||
            !rate.active ||
            !rate.inclusive ||
            rate.percentage !== 19 ||
            rate.country !== "DE" ||
            rate.tax_type !== "vat"
        )
            fail("membership_tax_unconfirmed");
    }
    return item;
}
async function ensureMembershipCustomer(userId: string, mode: "sandbox" | "live") {
    const identity = await getBuyerProfileIdentity(userId),
        operation = randomUUID();
    let customer = await getPaymentCustomer(userId, mode);
    if (!customer?.stripeCustomerId) {
        const claim = await claimPaymentCustomer(userId, mode, operation);
        let customerRef = claim.customerRef;
        if (!customerRef) {
            if (!claim.claimed) throw new PaymentFlowError("membership_setup_in_progress", 409);
            customerRef = await createStripeSandboxAdapter().createCustomer(
                userId,
                `workfare-pay:customer:${userId}`,
                identity.email,
                identity.name,
            );
            await savePaymentCustomer(userId, mode, operation, customerRef);
        }
        customer = await getPaymentCustomer(userId, mode);
    }
    if (!customer?.stripeCustomerId) fail("membership_customer_required");
    const stripe = await paymentStripeSdk()();
    await syncBuyerCustomerIdentity(stripe, customer.stripeCustomerId!, userId, identity, mode);
    return customer.stripeCustomerId!;
}

/** Positive, actually collected current-period invoice; credits/trials never grant a paid plan. */
export async function inspectMembershipInvoice(
    stripe: Stripe,
    subscription: Stripe.Subscription,
    record: MembershipRecord,
) {
    const item = subscription.items.data[0],
        invoiceRef = ref(subscription.latest_invoice);
    if (!invoiceRef) return { paidUntil: null, invoiceRef: null, review: false };
    const invoice = await stripe.invoices.retrieve(invoiceRef);
    assertStripeModeObject(invoice, record.mode);
    if (
        invoice.id !== invoiceRef ||
        ref(invoice.customer) !== record.customerRef ||
        ref(invoice.parent?.subscription_details?.subscription) !== subscription.id ||
        invoice.currency !== "eur"
    )
        fail();
    if (invoice.status !== "paid") return { paidUntil: null, invoiceRef, review: false };
    const lines = await stripe.invoices.listLineItems(invoice.id, { limit: 10 });
    if (lines.has_more || lines.data.length !== 1) return { paidUntil: null, invoiceRef, review: true };
    const line = lines.data[0];
    const matching =
        line.pricing?.price_details?.price === record.priceRef &&
        line.parent?.subscription_item_details?.subscription_item === item.id &&
        line.period.start === item.current_period_start &&
        line.period.end === item.current_period_end &&
        line.amount === record.monthlyCents &&
        line.quantity === 1;
    if (
        !matching ||
        invoice.amount_paid !== record.monthlyCents ||
        invoice.amount_remaining !== 0 ||
        invoice.total !== record.monthlyCents ||
        invoice.amount_paid_off_stripe
    )
        return { paidUntil: null, invoiceRef, review: true };
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 });
    if (payments.has_more || payments.data.length !== 1) return { paidUntil: null, invoiceRef, review: true };
    const paid = payments.data[0];
    assertStripeModeObject(paid, record.mode);
    if (
        ref(paid.invoice) !== invoice.id ||
        paid.currency !== "eur" ||
        paid.amount_paid !== record.monthlyCents ||
        paid.payment.type !== "payment_intent"
    )
        return { paidUntil: null, invoiceRef, review: true };
    const paymentRef = ref(paid.payment.payment_intent);
    if (!paymentRef) return { paidUntil: null, invoiceRef, review: true };
    const intent = await stripe.paymentIntents.retrieve(paymentRef, { expand: ["latest_charge"] });
    assertStripeModeObject(intent, record.mode);
    const charge = intent.latest_charge;
    if (
        intent.id !== paymentRef ||
        ref(intent.customer) !== record.customerRef ||
        intent.currency !== "eur" ||
        intent.status !== "succeeded" ||
        intent.amount_received !== record.monthlyCents ||
        !charge ||
        typeof charge === "string"
    )
        return { paidUntil: null, invoiceRef, review: true };
    assertStripeModeObject(charge, record.mode);
    if (
        ref(charge.customer) !== record.customerRef ||
        ref(charge.payment_intent) !== intent.id ||
        !charge.paid ||
        charge.status !== "succeeded" ||
        charge.amount_refunded > 0 ||
        charge.refunded ||
        charge.disputed
    )
        return { paidUntil: null, invoiceRef, review: true };
    return { paidUntil: date(item.current_period_end), invoiceRef, review: false };
}

/** A generation is claimed before network reads, so a late response cannot replace newer evidence. */
async function reconcileMembership(stripe: Stripe, record: MembershipRecord, subscriptionId: string) {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !record.customerRef) fail();
    await ownedCustomer(stripe, record);
    const ticket = await membershipRpc<number>("pay_membership_sync_begin", {
        p_user_id: record.userId,
        p_mode: record.mode,
        p_customer_ref: record.customerRef,
    });
    const actual = await stripe.subscriptions.retrieve(subscriptionId);
    assertStripeModeObject(actual, record.mode);
    const item = actual.items.data[0];
    if (
        actual.id !== subscriptionId ||
        ref(actual.customer) !== record.customerRef ||
        actual.items.has_more ||
        actual.items.data.length !== 1 ||
        !STRIPE_STATUSES.includes(actual.status) ||
        ref(item.price.product) !== record.productRef ||
        item.price.id !== record.priceRef ||
        item.price.unit_amount !== record.monthlyCents ||
        item.price.currency !== "eur" ||
        item.price.recurring?.interval !== "month" ||
        item.price.recurring.interval_count !== 1 ||
        item.quantity !== 1 ||
        actual.currency !== "eur" ||
        actual.collection_method !== "charge_automatically" ||
        actual.pause_collection ||
        actual.trial_end ||
        !date(item.current_period_end) ||
        !date(item.current_period_start)
    )
        fail();
    const invoice = await inspectMembershipInvoice(stripe, actual, record);
    const same = await membershipRecord(record.userId, record.mode);
    if (same.customerRef !== record.customerRef || same.priceRef !== record.priceRef) fail("membership_owner_conflict");
    await membershipRpc("pay_membership_sync_apply", {
        p_user_id: record.userId,
        p_mode: record.mode,
        p_generation: ticket,
        p_subscription_ref: actual.id,
        p_status: actual.status,
        p_paid_until: invoice.paidUntil,
        p_period_end: date(item.current_period_end),
        p_cancel_at_period_end: actual.cancel_at_period_end,
        p_invoice_ref: invoice.invoiceRef,
        p_review_required: invoice.review,
    });
    return membershipRecord(record.userId, record.mode);
}
async function reconcileCheckout(stripe: Stripe, record: MembershipRecord, sessionId: string) {
    const op = record.checkout;
    if (!op?.sessionRef || sessionId !== op.sessionRef) fail("membership_checkout_not_found");
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    assertStripeModeObject(session, record.mode);
    if (
        session.id !== sessionId ||
        ref(session.customer) !== record.customerRef ||
        session.mode !== "subscription" ||
        session.client_reference_id !== op.id
    )
        fail();
    if (session.status === "expired") {
        await membershipRpc("pay_membership_checkout_expire", { p_user_id:record.userId,p_mode:record.mode,p_checkout_id:op.id,p_session_ref:session.id });
        return membershipRecord(record.userId,record.mode);
    }
    if (session.status === "complete") {
        const subscriptionId = ref(session.subscription);
        if (!subscriptionId) fail();
        record = await reconcileMembership(stripe, record, subscriptionId!);
        await membershipRpc("pay_membership_checkout_attach", {
            p_user_id: record.userId,
            p_mode: record.mode,
            p_checkout_id: op.id,
            p_session_ref: session.id,
            p_expires_at: date(session.expires_at),
            p_complete: true,
        });
    }
    return record;
}
async function reconcileNewOwnedSubscription(stripe: Stripe, record: MembershipRecord, subscriptionId: string) {
    const op = record.checkout;
    if (!op || !["pending", "complete"].includes(op.state) || !record.customerRef) return null;
    let session: Stripe.Checkout.Session;
    if (op.sessionRef) session = await stripe.checkout.sessions.retrieve(op.sessionRef);
    else {
        const sessions = await stripe.checkout.sessions.list({
            customer: record.customerRef,
            subscription: subscriptionId,
            limit: 2,
        });
        if (sessions.has_more || sessions.data.length !== 1) return null;
        session = sessions.data[0];
    }
    assertStripeModeObject(session, record.mode);
    if (
        session.mode !== "subscription" ||
        session.status !== "complete" ||
        session.client_reference_id !== op.id ||
        ref(session.customer) !== record.customerRef ||
        ref(session.subscription) !== subscriptionId
    )
        return null;
    if (!op.sessionRef) {
        await membershipRpc("pay_membership_checkout_attach", {
            p_user_id: record.userId,
            p_mode: record.mode,
            p_checkout_id: op.id,
            p_session_ref: session.id,
            p_expires_at: date(session.expires_at),
            p_complete: false,
        });
        record = await membershipRecord(record.userId, record.mode);
    }
    return reconcileCheckout(stripe, record, session.id);
}
export async function getMembershipSnapshot(expectedOwner: string): Promise<MembershipSnapshot> {
    const owner = await requirePaymentProvider(expectedOwner),
        runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation")
        return {
            ownerId: owner,
            kind: "local",
            offer: MEMBERSHIP_DEFAULT_OFFER,
            membership: {
                status: "none",
                entitled: false,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                contractReference: null,
            },
            checkoutAvailable: false,
            manageAvailable: false,
        };
    const record = await membershipRecord(owner, runtime.mode);
    return projection(record);
}
export async function syncMembership(expectedOwner: string, sessionId?: unknown) {
    const owner = await requirePaymentProvider(expectedOwner),
        runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") return getMembershipSnapshot(expectedOwner);
    let record = await membershipRecord(owner, runtime.mode);
    const stripe = await paymentStripeSdk()();
    if (
        sessionId !== undefined &&
        !(typeof sessionId === "string" && /^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId))
    )
        fail("invalid_request");
    if (sessionId !== undefined) record = await reconcileCheckout(stripe, record, sessionId as string);
    else if (record.checkout?.sessionRef && record.checkout.state === "pending")
        record = await reconcileCheckout(stripe, record, record.checkout.sessionRef);
    else if (record.subscriptionRef) record = await reconcileMembership(stripe, record, record.subscriptionRef);
    else if (record.checkout?.sessionRef) record = await reconcileCheckout(stripe, record, record.checkout.sessionRef);
    await requirePaymentProvider(owner);
    return projection(record);
}
export async function startMembershipCheckout(
    expectedOwner: string,
    input: Record<string, unknown>,
    operationId: string | null,
) {
    const owner = await requirePaymentProvider(expectedOwner),
        runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("membership_unavailable", 503);
    if (input.consent !== true || input.immediateStart !== true || input.termsVersion !== MEMBERSHIP_TERMS_VERSION)
        throw new PaymentFlowError("explicit_consent_required", 400);
    if (!uuid.safeParse(operationId).success) throw new PaymentFlowError("invalid_operation_id", 400);
    let before = await membershipRecord(owner, runtime.mode);
    const stripe = await paymentStripeSdk()();
    await price(stripe, before);
    await ensureMembershipCustomer(owner, runtime.mode);
    before = await membershipRecord(owner, runtime.mode);
    await ownedCustomer(stripe, before);
    if (before.subscriptionRef) before = await reconcileMembership(stripe, before, before.subscriptionRef);
    if (before.checkout?.sessionRef && before.checkout.state === "pending")
        before = await reconcileCheckout(stripe, before, before.checkout.sessionRef);
    const pending = before.checkout;
    const effectiveOperation =
        pending?.state === "pending" &&
        Date.parse(pending.expiresAt) > Date.now() &&
        pending.priceRef === before.priceRef &&
        pending.termsVersion === MEMBERSHIP_TERMS_VERSION
            ? pending.operationId
            : before.checkout?.state === "expired" && before.checkout.operationId === operationId ? randomUUID() : operationId!;
    const record = await claimMembershipCheckout(
            owner,
            runtime.mode,
            effectiveOperation,
            MEMBERSHIP_TERMS_VERSION,
            true,
        ),
        op = record.checkout;
    if (
        !op ||
        op.operationId !== effectiveOperation ||
        op.priceRef !== record.priceRef ||
        op.state !== "pending" ||
        Date.parse(op.expiresAt) <= Date.now()
    )
        fail("membership_checkout_expired");
    await requirePaymentProvider(owner);
    const session = op.sessionRef
        ? await stripe.checkout.sessions.retrieve(op.sessionRef)
        : await stripe.checkout.sessions.create(
              {
                  mode: "subscription",
                  customer: record.customerRef!,
                  client_reference_id: op.id,
                  line_items: [{ price: record.priceRef!, quantity: 1 }],
                  success_url: `${runtime.origin}${MEMBERSHIP_PATH}?membership=returned&session_id={CHECKOUT_SESSION_ID}`,
                  cancel_url: `${runtime.origin}${MEMBERSHIP_PATH}?membership=canceled`,
                  allow_promotion_codes: false,
                  automatic_tax: { enabled: false },
                  consent_collection: { terms_of_service: "required" },
                  custom_text: {
                      submit: {
                          message:
                              "Workfare Plan · 5,90 € pro Monat. Monatlich zum Ende des bezahlten Zeitraums kündbar. Keine kostenlose Probephase.",
                      },
                  },
                  subscription_data: {
                      metadata: { workfare_membership: "workfare-plan-v1" },
                      ...(record.taxTreatment === "vat19" ? { default_tax_rates: [record.taxRateRef!] } : {}),
                  },
                  integration_identifier: `workfare_membership_${createHash("sha256").update(op.id).digest("hex").slice(0, 8)}`,
                  expires_at: Math.floor(new Date(op.expiresAt).getTime() / 1000),
              },
              { idempotencyKey: `workfare:membership-checkout:${op.id}` },
          );
    assertStripeModeObject(session, record.mode);
    if (
        session.mode !== "subscription" ||
        ref(session.customer) !== record.customerRef ||
        session.client_reference_id !== op.id ||
        session.status !== "open" ||
        !date(session.expires_at)
    )
        fail();
    await membershipRpc("pay_membership_checkout_attach", {
        p_user_id: owner,
        p_mode: runtime.mode,
        p_checkout_id: op.id,
        p_session_ref: session.id,
        p_expires_at: date(session.expires_at),
        p_complete: false,
    });
    await requirePaymentProvider(owner);
    return { url: safeUrl(session.url, "checkout") };
}
export async function changeMembershipRenewal(expectedOwner: string, cancel: boolean, consent: unknown) {
    if (consent !== true) throw new PaymentFlowError("explicit_consent_required", 400);
    const owner = await requirePaymentProvider(expectedOwner),
        runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("membership_unavailable", 503);
    let record = await membershipRecord(owner, runtime.mode);
    if (!record.subscriptionRef) fail("membership_not_found");
    const stripe = await paymentStripeSdk()();
    record = await reconcileMembership(stripe, record, record.subscriptionRef!);
    if (
        cancel
            ? ["none", "canceled", "incomplete_expired"].includes(record.status)
            : record.status !== "active" || !record.entitled
    )
        fail("membership_not_active");
    await requirePaymentProvider(owner);
    await stripe.subscriptions.update(
        record.subscriptionRef!,
        { cancel_at_period_end: cancel },
        { idempotencyKey: `workfare:membership-renewal:${record.subscriptionRef}:${cancel}:${randomUUID()}` },
    );
    record = await reconcileMembership(stripe, record, record.subscriptionRef!);
    if (record.cancelAtPeriodEnd !== cancel) fail("membership_change_unconfirmed");
    if (cancel && record.contractReference) {
        const identity = await getBuyerProfileIdentity(owner);
        await (
            await import("./subscription-cancellation.server")
        ).requestMembershipCancellation(
            {
                contractReference: record.contractReference,
                email: identity.email,
                name: identity.name,
                kind: "ordinary",
            },
            randomUUID(),
            `authenticated:${owner}`,
        );
    }
    return projection(record);
}
export async function createMembershipPortal(expectedOwner: string) {
    const owner = await requirePaymentProvider(expectedOwner),
        runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("membership_unavailable", 503);
    const record = await membershipRecord(owner, runtime.mode);
    if (!record.portalRef || !record.customerRef || !record.subscriptionRef) fail("membership_portal_unavailable");
    const stripe = await paymentStripeSdk()();
    await ownedCustomer(stripe, record);
    await requirePaymentProvider(owner);
    const session = await stripe.billingPortal.sessions.create({
        customer: record.customerRef!,
        configuration: record.portalRef!,
        return_url: `${runtime.origin}${MEMBERSHIP_PATH}`,
    });
    if (session.customer !== record.customerRef) fail();
    return { url: safeUrl(session.url, "portal") };
}

/** Verify signature once; look up ownership through Customer, never caller metadata. */
export async function handleMembershipEvent(event: Stripe.Event) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("membership_unavailable", 503);
    const stripe = await paymentStripeSdk()();
    assertStripeModeObject(event, runtime.mode);
    if (event.account) return;
    if(event.type==="checkout.session.expired"){
        const snapshot=event.data.object as Stripe.Checkout.Session;
        if(snapshot.mode!=="subscription"||!ref(snapshot.customer))return;
        const owner=await membershipRpc<string|null>("pay_membership_find",{p_mode:runtime.mode,p_customer_ref:ref(snapshot.customer)});
        if(!owner)return;
        let record=await membershipRecord(owner,runtime.mode);const op=record.checkout;
        if(!op)return;
        const actual=await stripe.checkout.sessions.retrieve(snapshot.id);assertStripeModeObject(actual,runtime.mode);
        if(actual.mode!=="subscription"||actual.client_reference_id!==op.id||ref(actual.customer)!==record.customerRef||actual.status!=="expired")return;
        if(!op.sessionRef){await membershipRpc("pay_membership_checkout_attach",{p_user_id:owner,p_mode:record.mode,p_checkout_id:op.id,p_session_ref:actual.id,p_expires_at:date(actual.expires_at),p_complete:false});record=await membershipRecord(owner,runtime.mode);}
        if(record.checkout?.sessionRef===actual.id)await reconcileCheckout(stripe,record,actual.id);
        return;
    }
    let customer: string | null = null,
        subscriptionId: string | null = null;
    if (event.type.startsWith("customer.subscription.")) {
        const sub = event.data.object as Stripe.Subscription;
        customer = ref(sub.customer);
        subscriptionId = sub.id;
    } else if (event.type.startsWith("invoice.")) {
        const invoice = event.data.object as Stripe.Invoice;
        customer = ref(invoice.customer);
        subscriptionId = ref(invoice.parent?.subscription_details?.subscription);
    } else if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
    ) {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") return;
        customer = ref(session.customer);
        subscriptionId = ref(session.subscription);
    } else if(event.type.startsWith("payment_intent.")){
        const snapshot=event.data.object as Stripe.PaymentIntent;
        if(!ref(snapshot.customer))return;
        const actual=await stripe.paymentIntents.retrieve(snapshot.id);assertStripeModeObject(actual,runtime.mode);
        customer=ref(actual.customer);if(actual.id!==snapshot.id||customer!==ref(snapshot.customer))fail();
        const invoices=await stripe.invoicePayments.list({payment:{type:"payment_intent",payment_intent:actual.id},limit:10});
        if(invoices.has_more)throw new PaymentFlowError("membership_payment_review",503);
        const invoiceIds=[...new Set(invoices.data.map(row=>ref(row.invoice)))].filter(Boolean);if(invoiceIds.length!==1)return;
        const invoice=await stripe.invoices.retrieve(invoiceIds[0]!);assertStripeModeObject(invoice,runtime.mode);
        if(ref(invoice.customer)!==customer)fail();subscriptionId=ref(invoice.parent?.subscription_details?.subscription);
    } else if (
        ["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(
            event.type,
        )
    ) {
        const object = event.data.object as Stripe.Charge | Stripe.Dispute;
        const charge = event.type.startsWith("charge.dispute.")
            ? await stripe.charges.retrieve(ref((object as Stripe.Dispute).charge)!)
            : (object as Stripe.Charge);
        assertStripeModeObject(charge, runtime.mode);
        customer = ref(charge.customer);
        const intent = ref(charge.payment_intent);
        if (!intent) return;
        const invoices = await stripe.invoicePayments.list({
            payment: { type: "payment_intent", payment_intent: intent },
            limit: 10,
        });
        if (invoices.has_more) throw new PaymentFlowError("membership_payment_review", 503);
        const invoiceIds = [...new Set(invoices.data.map((row) => ref(row.invoice)))].filter(Boolean);
        if (invoiceIds.length !== 1) return;
        const invoice = await stripe.invoices.retrieve(invoiceIds[0]!);
        assertStripeModeObject(invoice, runtime.mode);
        if (ref(invoice.customer) !== customer) fail();
        subscriptionId = ref(invoice.parent?.subscription_details?.subscription);
    } else return;
    if (!customer || !subscriptionId) return;
    const owner = await membershipRpc<string | null>("pay_membership_find", {
        p_mode: runtime.mode,
        p_customer_ref: customer,
    });
    if (!owner) return;
    const record = await membershipRecord(owner, runtime.mode);
    if (record.customerRef !== customer) fail();
    // A replacement must be the completed, persisted Checkout owned by this
    // provider. A same-Customer subscription or copied metadata alone cannot bind.
    if (record.subscriptionRef !== subscriptionId) {
        await reconcileNewOwnedSubscription(stripe, record, subscriptionId);
        return;
    }
    const actual = await stripe.subscriptions.retrieve(subscriptionId);
    assertStripeModeObject(actual, runtime.mode);
    if (!actual.items.data.some((item) => item.price.id === record.priceRef)) return;
    await reconcileMembership(stripe, record, subscriptionId);
}

/** Internal cancellation worker invokes only the existing owned subscription. */
export async function reconcileMembershipAfterCancellation(
    userId: string,
    mode: "live" | "sandbox",
    subscriptionId: string,
) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode !== mode) fail("membership_mode_mismatch");
    const record = await membershipRecord(userId, mode);
    return reconcileMembership(await paymentStripeSdk()(), record, subscriptionId);
}
