import "server-only";
import type Stripe from "stripe";
import { PaymentFlowError } from "./runtime.server";
import { requirePaymentOrders, requirePaymentOrderMaintenance } from "./order-config.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import type { PaymentsEnvironment } from "./config";
import type { PrivatePaymentOrder, VerifiedOrderState } from "./order-types";
import { SEPA_UNAVAILABLE_REASON } from "./method-capabilities";
import { LIVE_SERVICE_FEE_POLICY, validPaymentOrderFee } from "./tariff";

const ref = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;
function mismatch(): never { throw new PaymentFlowError("payment_order_object_mismatch", 409); }

function ownedIntent(intent: Stripe.PaymentIntent, order: PrivatePaymentOrder) {
    assertStripeModeObject(intent, order.mode);
    if (!validPaymentOrderFee(order) || !/^pi_[a-zA-Z0-9]+$/.test(intent.id) || (order.intentRef && intent.id !== order.intentRef)
        || intent.currency !== "eur" || intent.amount !== order.totalCents || intent.capture_method !== "manual"
        || intent.allowed_payment_method_types?.length !== 1 || intent.allowed_payment_method_types[0] !== "card"
        || ref(intent.customer) !== order.customerRef || ref(intent.payment_method) !== order.methodRef
        || intent.metadata.workfare_pay_order !== order.id || intent.metadata.workfare_pay_provider !== order.providerId
        || intent.metadata.workfare_pay_recipient !== order.recipientId || intent.metadata.workfare_pay_terms !== order.termsVersion
        || (order.serviceFeeCents > 0 && (intent.metadata.workfare_pay_fee_policy !== order.feePolicy
            || intent.metadata.workfare_pay_fee_gross_cents !== String(order.serviceFeeCents)
            || (order.mode !== "live" && intent.metadata.workfare_pay_tax_assumption !== order.feeTariff?.tax?.determinationReference)))
        || ref(intent.transfer_data?.destination) !== order.accountRef || (intent.application_fee_amount ?? 0) !== order.serviceFeeCents) mismatch();
}

function intentSecret(intent: Stripe.PaymentIntent) {
    const prefix = `${intent.id}_secret_`;
    if (!intent.client_secret?.startsWith(prefix) || intent.client_secret.length <= prefix.length || intent.client_secret.length > 4_096
        || /[\s\u0000-\u001f\u007f]/.test(intent.client_secret)) mismatch();
    return intent.client_secret;
}

function refundState(refund: Stripe.Refund, intent: Stripe.PaymentIntent, order: PrivatePaymentOrder): VerifiedOrderState {
    // Refund objects do not expose livemode. Its parent PaymentIntent and
    // Charge are freshly retrieved and must both be explicit test objects.
    if (!/^re_[a-zA-Z0-9]+$/.test(refund.id) || (order.refundRef && refund.id !== order.refundRef)
        || ref(refund.payment_intent) !== intent.id || ref(refund.charge) !== ref(intent.latest_charge)
        || refund.amount !== order.totalCents || refund.currency !== "eur" || refund.metadata?.workfare_pay_order !== order.id
        || refund.metadata?.workfare_pay_provider !== order.providerId) mismatch();
    if (refund.status === "succeeded" && !ref(refund.transfer_reversal)) mismatch();
    return { intentRef: intent.id, captureBefore: null, refundRef: refund.id,
        state: refund.status === "succeeded" ? "refunded" : ["pending", "requires_action"].includes(refund.status ?? "") ? "refund_pending" : "review_required" };
}

/** Mode-bound card authorization/capture, explicit cancellation/full refund. */
export function createPaymentOrderStripeAdapter(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentOrderMaintenance(environment);
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("sandbox_required", 503);
    const mode = runtime.mode;
    const sdk = paymentStripeSdk(environment);
    async function customer(order: PrivatePaymentOrder) {
        if (order.mode !== mode || !order.customerRef || !order.methodRef || !order.accountRef || !validPaymentOrderFee(order)
            || (mode === "live" ? order.feePolicy !== LIVE_SERVICE_FEE_POLICY : order.feePolicy === LIVE_SERVICE_FEE_POLICY)) mismatch();
        const stripe = await sdk();
        const found = await stripe.customers.retrieve(order.customerRef);
        assertStripeModeObject(found, mode);
        if (("deleted" in found && found.deleted) || found.id !== order.customerRef || !("metadata" in found) || found.metadata.workfare_pay_user !== order.providerId) mismatch();
    }
    async function retrieve(order: PrivatePaymentOrder) {
        if (order.mode !== mode || !order.intentRef) mismatch();
        const intent = await (await sdk()).paymentIntents.retrieve(order.intentRef, { expand: ["latest_charge"] });
        ownedIntent(intent, order);
        await customer(order);
        if (typeof intent.latest_charge === "string") mismatch();
        if (intent.latest_charge && typeof intent.latest_charge !== "string") {
            const charge = intent.latest_charge;
            assertStripeModeObject(charge, mode);
            if (ref(charge.customer) !== order.customerRef || ref(charge.payment_intent) !== intent.id || charge.currency !== "eur" || charge.amount !== order.totalCents) mismatch();
        }
        return intent;
    }
    async function destinationFeeEvidence(intent: Stripe.PaymentIntent, order: PrivatePaymentOrder) {
        const charge = intent.latest_charge;
        if (!charge || typeof charge !== "object" || charge.application_fee_amount !== order.serviceFeeCents) mismatch();
        const transferRef = ref(charge.transfer), feeRef = ref(charge.application_fee);
        if (!transferRef || !/^tr_[a-zA-Z0-9]+$/.test(transferRef) || !feeRef || !/^fee_[a-zA-Z0-9]+$/.test(feeRef)) {
            throw new PaymentFlowError("payment_order_fee_evidence_pending", 503);
        }
        const stripe = await sdk();
        const [transfer, fee] = await Promise.all([stripe.transfers.retrieve(transferRef), stripe.applicationFees.retrieve(feeRef)]);
        assertStripeModeObject(transfer, mode); assertStripeModeObject(fee, mode);
        if (transfer.id !== transferRef || transfer.amount !== order.totalCents || transfer.currency !== "eur"
            || ref(transfer.destination) !== order.accountRef || ref(transfer.source_transaction) !== charge.id
            || fee.id !== feeRef || fee.amount !== order.serviceFeeCents || fee.currency !== "eur" || ref(fee.account) !== order.accountRef
            || ref(fee.originating_transaction) !== charge.id || !ref(transfer.destination_payment) || ref(fee.charge) !== ref(transfer.destination_payment)) mismatch();
        return { transfer, fee };
    }
    async function verifiedRefund(refund: Stripe.Refund, intent: Stripe.PaymentIntent, order: PrivatePaymentOrder) {
        const verified = refundState(refund, intent, order);
        if (verified.state === "refunded" && order.serviceFeeCents > 0) {
            // ApplicationFee and Transfer are derived only from the freshly owned
            // platform Charge. Refund objects themselves have no livemode flag.
            const { transfer, fee } = await destinationFeeEvidence(intent, order);
            const reversalRef = ref(refund.transfer_reversal)!;
            const reversal = await (await sdk()).transfers.retrieveReversal(transfer.id, reversalRef);
            if (reversal.id !== reversalRef || ref(reversal.transfer) !== transfer.id || ref(reversal.source_refund) !== refund.id
                || reversal.amount !== order.totalCents || reversal.currency !== "eur") mismatch();
            if (!transfer.reversed || transfer.amount_reversed !== order.totalCents || !fee.refunded || fee.amount_refunded !== order.serviceFeeCents) {
                throw new PaymentFlowError("payment_order_refund_evidence_pending", 503);
            }
            const feeRefunds = fee.refunds;
            if (!feeRefunds || feeRefunds.has_more || feeRefunds.data.length !== 1) throw new PaymentFlowError("payment_order_refund_evidence_pending", 503);
            const feeRefund = feeRefunds.data[0];
            if (!/^fr_[a-zA-Z0-9]+$/.test(feeRefund.id) || ref(feeRefund.fee) !== fee.id || feeRefund.currency !== "eur" || feeRefund.amount !== order.serviceFeeCents) mismatch();
        }
        return verified;
    }
    async function existingRefund(intent: Stripe.PaymentIntent, order: PrivatePaymentOrder) {
        const refunds = await (await sdk()).refunds.list({ payment_intent: intent.id, limit: 20 });
        for (const existing of refunds.data) {
            if (ref(existing.payment_intent) !== intent.id || ref(existing.charge) !== ref(intent.latest_charge) || existing.currency !== "eur") mismatch();
        }
        if (refunds.has_more || refunds.data.length > 1) return { kind: "review" as const };
        if (refunds.data.length === 0) return { kind: "empty" as const };
        const refund = refunds.data[0];
        if (refund.metadata?.workfare_pay_order !== order.id || refund.metadata?.workfare_pay_provider !== order.providerId || refund.amount !== order.totalCents) return { kind: "review" as const };
        return { kind: "own" as const, refund };
    }
    async function inspect(order: PrivatePaymentOrder): Promise<VerifiedOrderState> {
        const intent = await retrieve(order);
        if (typeof intent.latest_charge === "object" && intent.latest_charge?.disputed) {
            // A later dispute still matters after a successful refund. Never
            // hide it behind the earlier terminal refund state or send money.
            return { intentRef: intent.id, captureBefore: null, refundRef: order.refundRef, state: "review_required" };
        }
        if (order.refundRef) return verifiedRefund(await (await sdk()).refunds.retrieve(order.refundRef), intent, order);
        const base = { intentRef: intent.id, captureBefore: null, refundRef: null };
        if (intent.status === "canceled") return { ...base, state: "canceled" };
        if (intent.status === "requires_capture") {
            const charge = intent.latest_charge;
            const deadline = typeof charge === "object" && charge ? charge.payment_method_details?.card?.capture_before : null;
            if (intent.amount_capturable !== order.totalCents || intent.amount_received !== 0 || !deadline || !Number.isSafeInteger(deadline)) mismatch();
            if (deadline * 1_000 <= Date.now()) return { ...base, state: "review_required" };
            return { ...base, state: "authorized", captureBefore: new Date(deadline * 1_000).toISOString() };
        }
        if (intent.status === "succeeded") {
            const charge = intent.latest_charge;
            if (intent.amount_received !== order.totalCents || typeof charge !== "object" || !charge || !charge.paid || !ref(charge.transfer)) mismatch();
            // Dashboard refunds or disputes require a fresh supported resolution;
            // neither means a bank payout has reached the recipient.
            if (charge.amount_refunded > 0) {
                // A Charge event can precede the server response that binds its
                // own Refund. Recover that proof instead of inventing a dispute.
                const existing = await existingRefund(intent, order);
                return existing.kind === "own" ? verifiedRefund(existing.refund, intent, order) : { ...base, state: "review_required" };
            }
            if (order.serviceFeeCents > 0) {
                const { transfer, fee } = await destinationFeeEvidence(intent, order);
                if (transfer.reversed || transfer.amount_reversed !== 0 || fee.refunded || fee.amount_refunded !== 0) return { ...base, state: "review_required" };
            }
            return { ...base, state: "paid" };
        }
        return { ...base, state: intent.status === "processing" && order.state === "capture_pending" ? "capture_pending" : "authorization_pending" };
    }
    return Object.freeze({
        async authorize(order: PrivatePaymentOrder, operationId: string) {
            requirePaymentOrders(environment);
            if (!validPaymentOrderFee(order)) mismatch();
            await customer(order);
            const stripe = await sdk();
            const method = await stripe.paymentMethods.retrieve(order.methodRef!);
            assertStripeModeObject(method, mode);
            if (method.id !== order.methodRef || ref(method.customer) !== order.customerRef) mismatch();
            if (method.type === "sepa_debit") throw new PaymentFlowError(SEPA_UNAVAILABLE_REASON, 409);
            if (method.type !== "card") throw new PaymentFlowError("payment_order_method_not_supported", 409);
            const recipient = await createRecipientStripeAdapter(environment).inspect(order.recipientId, order.accountRef!);
            if (recipient.status !== "ready" || !recipient.transfersActive || !recipient.payoutsEnabled || !recipient.hasPayoutMethod) throw new PaymentFlowError("payment_order_recipient_not_ready", 409);
            if (order.intentRef) {
                const existing = await retrieve(order);
                return { intentRef: existing.id, clientSecret: intentSecret(existing) };
            }
            const intent = await stripe.paymentIntents.create({ amount: order.totalCents, currency: "eur", customer: order.customerRef!, payment_method: order.methodRef!,
                allowed_payment_method_types: ["card"], capture_method: "manual", confirm: false,
                application_fee_amount: order.serviceFeeCents, transfer_data: { destination: order.accountRef! },
                metadata: { workfare_pay_order: order.id, workfare_pay_provider: order.providerId, workfare_pay_recipient: order.recipientId, workfare_pay_terms: order.termsVersion,
                    ...(order.serviceFeeCents > 0 ? { workfare_pay_fee_policy: order.feePolicy, workfare_pay_fee_gross_cents: String(order.serviceFeeCents),
                        ...(order.mode !== "live" ? { workfare_pay_tax_assumption: order.feeTariff!.tax!.determinationReference } : {}) } : {}) },
            }, { idempotencyKey: `workfare-pay:order:${order.id}:authorize:${operationId}` });
            ownedIntent(intent, order);
            return { intentRef: intent.id, clientSecret: intentSecret(intent) };
        },
        inspect,
        async inspectRefund(order: PrivatePaymentOrder, refundRef: string) {
            if (!/^re_[a-zA-Z0-9]+$/.test(refundRef) || (order.refundRef && order.refundRef !== refundRef)) mismatch();
            const intent = await retrieve(order);
            const charge = intent.latest_charge;
            if (intent.status !== "succeeded" || intent.amount_received !== order.totalCents || !charge || typeof charge !== "object" || !charge.paid || !ref(charge.transfer)) mismatch();
            const refund = await (await sdk()).refunds.retrieve(refundRef);
            return { verified: await verifiedRefund(refund, intent, { ...order, refundRef }), disputed: charge.disputed === true };
        },
        async resolveDisputeOrder(dispute: Stripe.Dispute) {
            assertStripeModeObject(dispute, mode);
            const intentRef = ref(dispute.payment_intent);
            const chargeRef = ref(dispute.charge);
            if (!/^dp_[a-zA-Z0-9]+$/.test(dispute.id) || !intentRef || !/^pi_[a-zA-Z0-9]+$/.test(intentRef)
                || !chargeRef || !/^ch_[a-zA-Z0-9]+$/.test(chargeRef)) mismatch();
            // Dispute metadata is separate from PaymentIntent metadata. Resolve
            // through its freshly retrieved parent, never a claimed order ID.
            const intent = await (await sdk()).paymentIntents.retrieve(intentRef, { expand: ["latest_charge"] });
            assertStripeModeObject(intent, mode);
            if (intent.id !== intentRef || typeof intent.latest_charge !== "object" || !intent.latest_charge || intent.latest_charge.id !== chargeRef) mismatch();
            assertStripeModeObject(intent.latest_charge, mode);
            if (ref(intent.latest_charge.payment_intent) !== intent.id) mismatch();
            return { orderId: intent.metadata.workfare_pay_order, providerId: intent.metadata.workfare_pay_provider, intentRef };
        },
        async capture(order: PrivatePaymentOrder, operationId: string) {
            const intent = await retrieve(order);
            if (intent.status === "succeeded") return inspect(order);
            const verified = await inspect(order);
            if (verified.state !== "authorized" || !verified.captureBefore || Date.parse(verified.captureBefore) <= Date.now()) throw new PaymentFlowError("payment_order_authorization_expired", 409);
            const recipient = await createRecipientStripeAdapter(environment).inspect(order.recipientId, order.accountRef!);
            if (recipient.status !== "ready" || !recipient.transfersActive || !recipient.payoutsEnabled || !recipient.hasPayoutMethod) {
                throw new PaymentFlowError("payment_order_recipient_not_ready", 409);
            }
            const captured = await (await sdk()).paymentIntents.capture(intent.id, { amount_to_capture: order.totalCents }, { idempotencyKey: `workfare-pay:order:${order.id}:capture:${operationId}` });
            ownedIntent(captured, order);
            return inspect(order);
        },
        async cancel(order: PrivatePaymentOrder, operationId: string) {
            const intent = await retrieve(order);
            if (intent.status !== "canceled") {
                if (intent.status === "succeeded") throw new PaymentFlowError("payment_order_refund_required", 409);
                const canceled = await (await sdk()).paymentIntents.cancel(intent.id, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: `workfare-pay:order:${order.id}:cancel:${operationId}` });
                ownedIntent(canceled, order);
            }
            return inspect(order);
        },
        async refund(order: PrivatePaymentOrder, operationId: string) {
            const intent = await retrieve(order);
            if (order.refundRef) return inspect(order);
            if (intent.status !== "succeeded" || intent.amount_received !== order.totalCents) throw new PaymentFlowError("payment_order_not_paid", 409);
            const charge = intent.latest_charge;
            if (!charge || typeof charge !== "object" || !charge.paid || !ref(charge.transfer)) mismatch();
            const review: VerifiedOrderState = { intentRef: intent.id, captureBefore: null, refundRef: null, state: "review_required" };
            if (charge.disputed) return review;
            // Recover an interrupted successful/pending refund by its own PSP
            // facts before considering another create request. Dashboard/partial
            // refunds need review instead of a second full reimbursement.
            const existing = await existingRefund(intent, order);
            if (existing.kind === "review") return review;
            if (existing.kind === "own") return verifiedRefund(existing.refund, intent, order);
            if (charge.amount_refunded > 0) return review;
            if (order.serviceFeeCents > 0) {
                const { transfer, fee } = await destinationFeeEvidence(intent, order);
                if (transfer.reversed || transfer.amount_reversed !== 0 || fee.refunded || fee.amount_refunded !== 0) return review;
            }
            const refund = await (await sdk()).refunds.create({ payment_intent: intent.id, amount: order.totalCents, reverse_transfer: true,
                refund_application_fee: order.serviceFeeCents > 0, metadata: { workfare_pay_order: order.id, workfare_pay_provider: order.providerId } },
            { idempotencyKey: `workfare-pay:order:${order.id}:refund:${operationId}` });
            // Re-read the fee/transfer after creating the refund. Their prior
            // preflight state is not proof that either reversal has completed.
            return verifiedRefund(refund, await retrieve(order), order);
        },
        async verifyWebhook(payload: string, signature: string) {
            const secret = environment.STRIPE_PAYMENT_WEBHOOK_SECRET ?? environment.STRIPE_WEBHOOK_SECRET;
            if (!secret || !/^whsec_[a-zA-Z0-9]+$/.test(secret)) throw new PaymentFlowError("payment_order_webhook_not_configured", 503);
            let event: Stripe.Event;
            const stripe = await sdk();
            try { event = stripe.webhooks.constructEvent(payload, signature, secret); }
            catch { throw new PaymentFlowError("invalid_webhook_signature", 400); }
            assertStripeModeObject(event, mode);
            return event;
        },
    });
}
