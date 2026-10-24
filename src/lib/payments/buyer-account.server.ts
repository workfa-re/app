import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { getPaymentCustomer } from "./repository.server";
import { requirePaymentProvider } from "./service.server";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import type { PaymentMode } from "./types";
import type { PaymentsEnvironment } from "./config";
import type { BuyerAccountSnapshot, BuyerBillingDetails, BuyerInvoiceEntry, BuyerPaymentEntry } from "./buyer-account-types";

const HISTORY_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plainText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum).refine((value) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value));
const billingSchema = z.object({
    name: plainText(2, 150),
    email: z.string().trim().email().max(254),
    address: z.object({
        line1: plainText(3, 200),
        line2: plainText(0, 200).optional().default(""),
        postalCode: z.string().trim().regex(/^\d{5}$/),
        city: plainText(1, 100),
        country: z.literal("DE"),
    }).strict().nullable().optional(),
}).strict();

function mismatch(): never { throw new PaymentFlowError("payment_account_mismatch", 409); }
function referenceId(value: string | { id: string } | null) { return typeof value === "string" ? value : value?.id ?? null; }
function safeText(value: unknown, maximum = 160): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
    return normalized ? normalized.slice(0, maximum) : null;
}
function minorAmount(value: unknown, signed = false): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || (!signed && value < 0)) mismatch();
    return value;
}
function currency(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z]{3}$/.test(value)) mismatch();
    return value;
}
function createdAt(value: unknown): string {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799) mismatch();
    return new Date(value * 1_000).toISOString();
}

/** Accept only Stripe-returned customer documents, never a dashboard or arbitrary redirect. */
function documentUrl(value: unknown, kind: "receipt" | "invoice" | "pdf"): string | null {
    if (typeof value !== "string" || value.length > 4_096) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return null;
        if (kind === "receipt" && url.hostname === "pay.stripe.com" && url.pathname.startsWith("/receipts/") && url.pathname.length > 10) return url.href;
        if (kind === "invoice" && url.hostname === "invoice.stripe.com" && url.pathname.startsWith("/i/") && url.pathname.length > 3) return url.href;
        if (kind === "pdf" && url.hostname === "pay.stripe.com" && /^\/invoice\/.+\/pdf$/.test(url.pathname)) return url.href;
    } catch { /* An invalid document link never blocks access to the underlying financial record. */ }
    return null;
}

function ownedCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer, customerId: string, userId: string, mode: PaymentMode = "sandbox"): Stripe.Customer {
    assertStripeModeObject(customer, mode);
    if (customer.id !== customerId || ("deleted" in customer && customer.deleted)
        || !("metadata" in customer) || customer.metadata.workfare_pay_user !== userId) mismatch();
    return customer as Stripe.Customer;
}

function billingDetails(customer: Stripe.Customer): BuyerBillingDetails {
    return {
        name: safeText(customer.name, 150),
        email: safeText(customer.email, 254),
        address: customer.address ? {
            line1: safeText(customer.address.line1, 200),
            line2: safeText(customer.address.line2, 200),
            postalCode: safeText(customer.address.postal_code, 20),
            city: safeText(customer.address.city, 100),
            country: safeText(customer.address.country, 2),
        } : null,
    };
}

function confirmsBilling(customer: Stripe.Customer, input: z.infer<typeof billingSchema>): boolean {
    const stored = billingDetails(customer);
    if (stored.name !== input.name || stored.email !== input.email) return false;
    // Contact-only edits leave even partial or foreign invoice addresses untouched.
    if (input.address === undefined) return true;
    if (input.address === null) return stored.address === null;
    return stored.address?.line1 === input.address.line1 && (stored.address.line2 ?? "") === input.address.line2
        && stored.address.postalCode === input.address.postalCode && stored.address.city === input.address.city
        && stored.address.country === input.address.country;
}

function paymentEntry(charge: Stripe.Charge, customerId: string, mode: PaymentMode = "sandbox"): BuyerPaymentEntry {
    assertStripeModeObject(charge, mode);
    if (!/^ch_[a-zA-Z0-9]+$/.test(charge.id) || referenceId(charge.customer) !== customerId) mismatch();
    const amountMinor = minorAmount(charge.amount);
    const capturedAmountMinor = minorAmount(charge.amount_captured);
    const refundedAmountMinor = minorAmount(charge.amount_refunded);
    if (capturedAmountMinor > amountMinor || refundedAmountMinor > capturedAmountMinor
        || !["pending", "succeeded", "failed"].includes(charge.status)
        || typeof charge.paid !== "boolean" || typeof charge.captured !== "boolean") mismatch();
    const intent = charge.payment_intent;
    if (intent !== null) {
        // Expand in the bounded list request, never perform one read per entry.
        // Customer-scoped history may also contain legacy Charges without a PI.
        if (typeof intent !== "object" || intent.object !== "payment_intent" || !/^pi_[a-zA-Z0-9]+$/.test(intent.id)) mismatch();
        assertStripeModeObject(intent, mode);
        if (referenceId(intent.customer) !== customerId || intent.amount !== amountMinor || intent.currency !== charge.currency) mismatch();
    }
    let status: BuyerPaymentEntry["status"] = charge.status === "failed" ? "failed" : "pending";
    if (charge.status === "succeeded" && charge.paid) {
        if (!charge.captured) {
            // A canceled manual authorization can keep Charge.status=succeeded,
            // paid=true, captured=false and refunded=0. Only its own current PI
            // distinguishes a released hold from an active authorization.
            if (intent && ["requires_capture", "canceled"].includes(intent.status)) {
                if (referenceId(intent.latest_charge) !== charge.id) mismatch();
                status = intent.status === "canceled" ? "released" : "authorized";
            }
        } else status = refundedAmountMinor === capturedAmountMinor && refundedAmountMinor > 0 ? "refunded"
                : refundedAmountMinor > 0 ? "partially_refunded" : "paid";
    }
    return {
        id: charge.id, createdAt: createdAt(charge.created), description: safeText(charge.description), status,
        amountMinor, capturedAmountMinor, refundedAmountMinor, currency: currency(charge.currency),
        receiptUrl: ["paid", "partially_refunded", "refunded"].includes(status) ? documentUrl(charge.receipt_url, "receipt") : null,
    };
}

function invoiceEntry(invoice: Stripe.Invoice, customerId: string, mode: PaymentMode = "sandbox"): BuyerInvoiceEntry | null {
    assertStripeModeObject(invoice, mode);
    if (!/^in_[a-zA-Z0-9]+$/.test(invoice.id) || referenceId(invoice.customer) !== customerId) mismatch();
    // A draft is not an issued invoice and must not appear as a customer document.
    if (invoice.status === "draft") return null;
    if (!["open", "paid", "uncollectible", "void"].includes(invoice.status ?? "")) mismatch();
    return {
        id: invoice.id, createdAt: createdAt(invoice.created), number: safeText(invoice.number, 80), description: safeText(invoice.description),
        status: invoice.status as BuyerInvoiceEntry["status"], amountMinor: minorAmount(invoice.total, true),
        paidAmountMinor: minorAmount(invoice.amount_paid), remainingAmountMinor: minorAmount(invoice.amount_remaining),
        currency: currency(invoice.currency), invoiceUrl: documentUrl(invoice.hosted_invoice_url, "invoice"), pdfUrl: documentUrl(invoice.invoice_pdf, "pdf"),
    };
}

/** Scoped customer reads and billing updates only; no collection, payout, refund or portal access. */
export function createBuyerAccountSandboxAdapter(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("sandbox_required", 503);
    const mode = runtime.mode;
    const sdk = paymentStripeSdk(environment);
    const retrieveOwned = async (customerId: string, userId: string) => ownedCustomer(await (await sdk()).customers.retrieve(customerId), customerId, userId, mode);
    return Object.freeze({
        async overview(customerId: string, userId: string) {
            if (!/^cus_[a-zA-Z0-9]+$/.test(customerId)) mismatch();
            const customer = await retrieveOwned(customerId, userId);
            const stripe = await sdk();
            const [charges, invoices] = await Promise.all([
                stripe.charges.list({ customer: customerId, limit: HISTORY_LIMIT, expand: ["data.payment_intent"] }),
                stripe.invoices.list({ customer: customerId, limit: HISTORY_LIMIT }),
            ]);
            if (!Array.isArray(charges.data) || !Array.isArray(invoices.data) || charges.data.length > HISTORY_LIMIT
                || invoices.data.length > HISTORY_LIMIT || typeof charges.has_more !== "boolean" || typeof invoices.has_more !== "boolean") mismatch();
            return {
                billing: billingDetails(customer),
                payments: charges.data.map((charge) => paymentEntry(charge, customerId, mode)),
                invoices: invoices.data.map((invoice) => invoiceEntry(invoice, customerId, mode)).filter((invoice): invoice is BuyerInvoiceEntry => invoice !== null),
                hasMore: { payments: charges.has_more, invoices: invoices.has_more },
            };
        },
        async updateBilling(customerId: string, userId: string, input: unknown, operationId: string) {
            if (!/^cus_[a-zA-Z0-9]+$/.test(customerId) || !UUID.test(operationId)) mismatch();
            const parsed = billingSchema.safeParse(input);
            if (!parsed.success) throw new PaymentFlowError("invalid_billing_details", 400);
            const details = parsed.data;
            await retrieveOwned(customerId, userId);
            const customer = ownedCustomer(await (await sdk()).customers.update(customerId, {
                name: details.name, email: details.email,
                ...(details.address === undefined ? {} : { address: details.address === null ? "" : {
                    line1: details.address.line1, line2: details.address.line2, postal_code: details.address.postalCode,
                    city: details.address.city, country: details.address.country, state: "",
                } }),
            }, { idempotencyKey: `workfare-pay:billing:${userId}:${operationId}` }), customerId, userId, mode);
            if (!confirmsBilling(customer, details)) throw new PaymentFlowError("billing_sync_unconfirmed", 409);
            // A timeout or concurrent edit must never become a false "saved".
            // Repeating the same operation reuses Stripe's idempotent write and
            // checks the current customer again without touching Auth/profile.
            const current = await retrieveOwned(customerId, userId);
            if (!confirmsBilling(current, details)) throw new PaymentFlowError("billing_sync_unconfirmed", 409);
            return billingDetails(current);
        },
    });
}

function emptySnapshot(kind: BuyerAccountSnapshot["kind"], ownerId: string, customerExists = false): BuyerAccountSnapshot {
    return { kind, ownerId, customerExists, billing: { available: false, details: null }, history: {
        state: kind === "local" ? "local_simulation" : "empty", payments: [], invoices: [], hasMore: { payments: false, invoices: false },
    } };
}

export async function getBuyerAccountOverview(expectedOwnerId?: string): Promise<BuyerAccountSnapshot> {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    assertExpectedOwner(expectedOwnerId, userId);
    if (runtime.mode === "local_simulation") return emptySnapshot("local", userId);
    const customer = await getPaymentCustomer(userId, runtime.mode);
    if (!customer) return emptySnapshot(runtime.mode, userId);
    if (customer.userId !== userId || customer.mode !== runtime.mode) mismatch();
    if (!customer.stripeCustomerId) return emptySnapshot(runtime.mode, userId);
    const overview = await createBuyerAccountSandboxAdapter().overview(customer.stripeCustomerId, userId);
    return { kind: runtime.mode, ownerId: userId, customerExists: true, billing: { available: true, details: overview.billing }, history: {
        state: overview.payments.length || overview.invoices.length ? "available" : "empty",
        payments: overview.payments, invoices: overview.invoices, hasMore: overview.hasMore,
    } };
}

/** This changes billing contact data only, never profile, verified provider address or payment defaults. */
export async function updateBuyerBillingDetails(input: unknown, operationId?: string, expectedOwnerId?: string) {
    const runtime = requirePaymentRuntime();
    const userId = await requirePaymentProvider();
    assertExpectedOwner(expectedOwnerId, userId);
    if (!billingSchema.safeParse(input).success) throw new PaymentFlowError("invalid_billing_details", 400);
    if (operationId !== undefined && !UUID.test(operationId)) throw new PaymentFlowError("invalid_operation_id", 400);
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("billing_requires_sandbox", 409);
    const customer = await getPaymentCustomer(userId, runtime.mode);
    if (!customer || !customer.stripeCustomerId) throw new PaymentFlowError("payment_customer_required", 409);
    if (customer.userId !== userId || customer.mode !== runtime.mode) mismatch();
    const details = await createBuyerAccountSandboxAdapter().updateBilling(customer.stripeCustomerId, userId, input, operationId ?? randomUUID());
    return { ok: true as const, ownerId: userId, billing: details };
}

function assertExpectedOwner(expectedOwnerId: string | undefined, currentOwnerId: string) {
    if (expectedOwnerId !== undefined && expectedOwnerId !== currentOwnerId) throw new PaymentFlowError("owner_mismatch", 409);
}
