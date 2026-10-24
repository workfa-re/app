import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ platformRetrieve: vi.fn(), customerRetrieve: vi.fn(), customerUpdate: vi.fn(), chargesList: vi.fn(), invoicesList: vi.fn() }));
const repository = vi.hoisted(() => ({ getPaymentCustomer: vi.fn() }));
const auth = vi.hoisted(() => ({ requirePaymentProvider: vi.fn() }));
vi.mock("@/lib/payments/repository.server", () => repository);
vi.mock("@/lib/payments/service.server", () => auth);
vi.mock("stripe", async (importOriginal) => {
    const { default: Actual } = await importOriginal<typeof import("stripe")>();
    return { default: class extends Actual {
        constructor(...args: ConstructorParameters<typeof Actual>) {
            super(...args);
            this.accounts.retrieve = api.platformRetrieve;
            this.customers.retrieve = api.customerRetrieve;
            this.customers.update = api.customerUpdate;
            this.charges.list = api.chargesList;
            this.invoices.list = api.invoicesList;
        }
    } };
});

import { createBuyerAccountSandboxAdapter, getBuyerAccountOverview, updateBuyerBillingDetails } from "@/lib/payments/buyer-account.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

const userId = "11111111-1111-4111-8111-111111111111";
const customerId = "cus_buyerFixture";
const operationId = "22222222-2222-4222-8222-222222222222";
const environment = {
    WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
    WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests",
    WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: "http://127.0.0.1:3000", STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly",
};
const billingInput = { name: "Robin Muster", email: "billing@example.test", address: { line1: "Musterweg 4", line2: "", postalCode: "53359", city: "Rheinbach", country: "DE" } };
const customer = () => ({ id: customerId, livemode: false, metadata: { workfare_pay_user: userId }, name: billingInput.name,
    email: billingInput.email, address: { line1: "Musterweg 4", line2: null, postal_code: "53359", city: "Rheinbach", country: "DE", state: null } });
const charge = (patch: Record<string, unknown> = {}) => ({ id: "ch_fixture", customer: customerId, livemode: false, created: 1_790_000_000,
    status: "succeeded", amount: 3_000, amount_captured: 3_000, amount_refunded: 0, currency: "eur", paid: true, captured: true,
    payment_intent: null, description: "Gartenhilfe", receipt_url: "https://pay.stripe.com/receipts/payment/fixture", ...patch });
const paymentIntent = (patch: Record<string, unknown> = {}) => ({ object: "payment_intent", id: "pi_fixture", livemode: false,
    customer: customerId, currency: "eur", amount: 3_000, latest_charge: "ch_auth", status: "requires_capture", ...patch });
const invoice = (patch: Record<string, unknown> = {}) => ({ id: "in_fixture", customer: customerId, livemode: false, created: 1_790_000_000,
    status: "paid", total: 3_300, amount_paid: 3_300, amount_remaining: 0, currency: "eur", number: "WF-001", description: "Servicegebühr",
    hosted_invoice_url: "https://invoice.stripe.com/i/acct_fixture/test_fixture", invoice_pdf: "https://pay.stripe.com/invoice/acct_fixture/test_fixture/pdf?s=ap", ...patch });

beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    auth.requirePaymentProvider.mockResolvedValue(userId);
    api.platformRetrieve.mockResolvedValue({ id: "acct_fixture", country: "DE" });
    repository.getPaymentCustomer.mockResolvedValue({ id: "internal-customer", userId, mode: "sandbox", stripeCustomerId: customerId, method: null });
    api.customerRetrieve.mockResolvedValue(customer());
    api.customerUpdate.mockImplementation(async (id, input) => {
        const updated = { ...customer(), id, name: input.name, email: input.email, address: input.address,
            metadata: { ...customer().metadata, ...input.metadata } };
        api.customerRetrieve.mockResolvedValue(updated);
        return updated;
    });
    api.chargesList.mockResolvedValue({ data: [charge()], has_more: false });
    api.invoicesList.mockResolvedValue({ data: [invoice()], has_more: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("owner-bound Workfare Pay account overview", () => {
    it("uses only the authenticated provider's private mapping and bounded customer filters", async () => {
        const result = await getBuyerAccountOverview();
        expect(repository.getPaymentCustomer).toHaveBeenCalledWith(userId, "sandbox");
        expect(api.customerRetrieve).toHaveBeenCalledWith(customerId);
        expect(api.chargesList).toHaveBeenCalledWith({ customer: customerId, limit: 20, expand: ["data.payment_intent"] });
        expect(api.invoicesList).toHaveBeenCalledWith({ customer: customerId, limit: 20 });
        expect(result).toMatchObject({ kind: "sandbox", customerExists: true, billing: { available: true }, history: { state: "available" } });
        expect(result.history.payments[0]).toMatchObject({ amountMinor: 3_000, capturedAmountMinor: 3_000, refundedAmountMinor: 0, status: "paid" });
        expect(result.history.invoices[0]).toMatchObject({ amountMinor: 3_300, number: "WF-001", pdfUrl: expect.stringContaining("pay.stripe.com/invoice/") });
        expect(JSON.stringify(result)).not.toContain(customerId);
        expect(JSON.stringify(result)).not.toContain("workfare_pay_user");
        expect(result).not.toHaveProperty("balance");
        expect(result).not.toHaveProperty("total");
    });

    it("rejects stale-tab reads and billing writes before financial access",async()=>{
        await expect(getBuyerAccountOverview("22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({code:"owner_mismatch",status:409});
        await expect(updateBuyerBillingDetails(billingInput,operationId,"22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({code:"owner_mismatch",status:409});
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();expect(api.customerRetrieve).not.toHaveBeenCalled();expect(api.customerUpdate).not.toHaveBeenCalled();
    });

    it("keeps local simulation explicitly empty without constructing or contacting Stripe", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        expect(await getBuyerAccountOverview()).toEqual({ kind: "local", ownerId:userId, customerExists: false, billing: { available: false, details: null },
            history: { state: "local_simulation", payments: [], invoices: [], hasMore: { payments: false, invoices: false } } });
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();
        expect(api.customerRetrieve).not.toHaveBeenCalled();
        expect(api.chargesList).not.toHaveBeenCalled();
        expect(api.invoicesList).not.toHaveBeenCalled();
    });

    it("returns an honest empty state before a Stripe customer exists", async () => {
        repository.getPaymentCustomer.mockResolvedValue(null);
        expect(await getBuyerAccountOverview()).toMatchObject({ customerExists: false, billing: { available: false }, history: { state: "empty", payments: [], invoices: [] } });
        expect(api.customerRetrieve).not.toHaveBeenCalled();
    });

    it("denies missing authentication before looking up financial references", async () => {
        auth.requirePaymentProvider.mockRejectedValue(new PaymentFlowError("authentication_required", 401));
        await expect(getBuyerAccountOverview()).rejects.toMatchObject({ status: 401 });
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();
        expect(api.customerRetrieve).not.toHaveBeenCalled();
    });

    it.each([{ userId: "another-user" }, { mode: "local_simulation" }])("rejects a corrupted private ownership mapping (%j)", async (patch) => {
        repository.getPaymentCustomer.mockResolvedValue({ id: "internal", userId, mode: "sandbox", stripeCustomerId: customerId, ...patch });
        await expect(getBuyerAccountOverview()).rejects.toMatchObject({ code: "payment_account_mismatch" });
        expect(api.customerRetrieve).not.toHaveBeenCalled();
    });

    it.each([{ livemode: true }, { livemode: undefined }, { deleted: true }, { id: "cus_foreign" }, { metadata: { workfare_pay_user: "another-user" } }])
    ("rejects a foreign, deleted or non-test Stripe customer before history reads (%j)", async (patch) => {
        api.customerRetrieve.mockResolvedValue({ ...customer(), ...patch });
        await expect(getBuyerAccountOverview()).rejects.toThrow();
        expect(api.chargesList).not.toHaveBeenCalled();
        expect(api.invoicesList).not.toHaveBeenCalled();
    });

    it.each(["charge", "invoice"])("rechecks each returned %s rather than trusting the list filter", async (kind) => {
        if (kind === "charge") api.chargesList.mockResolvedValue({ data: [charge({ customer: "cus_foreign" })], has_more: false });
        else api.invoicesList.mockResolvedValue({ data: [invoice({ customer: "cus_foreign", status: "draft" })], has_more: false });
        await expect(getBuyerAccountOverview()).rejects.toMatchObject({ code: "payment_account_mismatch" });
    });

    it.each(["charge", "invoice"])("never exposes live-mode %s records returned unexpectedly by a test adapter", async (kind) => {
        if (kind === "charge") api.chargesList.mockResolvedValue({ data: [charge({ livemode: true })], has_more: false });
        else api.invoicesList.mockResolvedValue({ data: [invoice({ livemode: true })], has_more: false });
        await expect(getBuyerAccountOverview()).rejects.toThrow();
    });

    it("keeps authorization, capture and refund states distinct", async () => {
        api.chargesList.mockResolvedValue({ data: [
            charge({ id: "ch_auth", captured: false, amount_captured: 0, payment_intent: paymentIntent() }),
            charge({ id: "ch_partial", amount_refunded: 1_000 }),
            charge({ id: "ch_refund", amount_refunded: 3_000 }),
            charge({ id: "ch_failed", status: "failed", paid: false, captured: false, amount_captured: 0 }),
            charge({ id: "ch_pending", status: "pending", paid: false, captured: false, amount_captured: 0 }),
        ], has_more: true });
        const result = await getBuyerAccountOverview();
        expect(result.history.payments.map((entry) => entry.status)).toEqual(["authorized", "partially_refunded", "refunded", "failed", "pending"]);
        expect(result.history.payments[0].receiptUrl).toBeNull();
        expect(result.history.payments[3].receiptUrl).toBeNull();
        expect(result.history.hasMore.payments).toBe(true);
    });

    it("shows the observed canceled uncaptured Stripe Charge as a released hold without hiding the whole history", async () => {
        api.chargesList.mockResolvedValue({ data: [charge(), charge({ id: "ch_released", amount: 1_000, amount_captured: 0,
            amount_refunded: 0, captured: false, paid: true, refunded: false, status: "succeeded",
            payment_intent: paymentIntent({ status: "canceled", amount: 1_000, latest_charge: "ch_released" }) })], has_more: false });
        const result = await getBuyerAccountOverview();
        expect(result.history.payments.map((entry) => entry.status)).toEqual(["paid", "released"]);
        expect(result.history.payments[1]).toMatchObject({ amountMinor: 1_000, capturedAmountMinor: 0, refundedAmountMinor: 0, receiptUrl: null });
        expect(api.chargesList).toHaveBeenCalledOnce();
    });

    it.each([null, paymentIntent({ status: "requires_action" })])("does not claim active authorization without a requires_capture parent (%j)", async (parent) => {
        api.chargesList.mockResolvedValue({ data: [charge({ id: "ch_auth", captured: false, amount_captured: 0, payment_intent: parent })], has_more: false });
        expect((await getBuyerAccountOverview()).history.payments[0]).toMatchObject({ status: "pending", receiptUrl: null });
    });

    it.each([
        "pi_unexpanded", paymentIntent({ object: "v2.core.account" }), paymentIntent({ id: "not-an-intent" }),
        paymentIntent({ livemode: true }), paymentIntent({ livemode: undefined }), paymentIntent({ customer: "cus_foreign" }),
        paymentIntent({ currency: "usd" }), paymentIntent({ amount: 3_001 }), paymentIntent({ latest_charge: "ch_foreign" }),
    ])("rejects an unexpanded, foreign or inconsistent authorization parent (%j)", async (parent) => {
        api.chargesList.mockResolvedValue({ data: [charge({ id: "ch_auth", captured: false, amount_captured: 0, payment_intent: parent })], has_more: false });
        await expect(getBuyerAccountOverview()).rejects.toThrow();
    });

    it("retains an earlier failed attempt when its own PaymentIntent now has a different latest Charge", async () => {
        api.chargesList.mockResolvedValue({ data: [charge({ id: "ch_old", status: "failed", paid: false, captured: false, amount_captured: 0,
            payment_intent: paymentIntent({ latest_charge: "ch_new" }) })], has_more: false });
        expect((await getBuyerAccountOverview()).history.payments[0].status).toBe("failed");
    });

    it("does not present an invoice draft as an issued document", async () => {
        api.chargesList.mockResolvedValue({ data: [], has_more: false });
        api.invoicesList.mockResolvedValue({ data: [invoice({ status: "draft" })], has_more: false });
        expect((await getBuyerAccountOverview()).history).toMatchObject({ state: "empty", invoices: [] });
    });

    it.each(["https://pay.stripe.com.evil.example/receipts/payment/fixture", "http://pay.stripe.com/receipts/payment/fixture", "https://evil.example/receipt", "https://user@pay.stripe.com/receipts/payment/fixture", "https://pay.stripe.com/receipts/payment/fixture#token", "javascript:alert(1)"])
    ("drops an unsafe receipt URL without hiding the payment (%s)", async (receipt_url) => {
        api.chargesList.mockResolvedValue({ data: [charge({ receipt_url })], has_more: false });
        const result = await getBuyerAccountOverview();
        expect(result.history.payments[0].receiptUrl).toBeNull();
        expect(result.history.payments[0].status).toBe("paid");
    });

    it("drops dashboard links and spoofed invoice PDF origins", async () => {
        api.invoicesList.mockResolvedValue({ data: [invoice({ hosted_invoice_url: "https://dashboard.stripe.com/invoices/in_fixture", invoice_pdf: "https://files.stripe.com.evil.example/invoice/acct_fixture/fixture/pdf" })], has_more: false });
        expect((await getBuyerAccountOverview()).history.invoices[0]).toMatchObject({ invoiceUrl: null, pdfUrl: null });
    });

    it.each([{ amount: 1.5 }, { amount_captured: 3_001 }, { amount_refunded: 3_001 }, { created: Number.NaN }, { currency: "not-a-currency" }, { status: "future_status" }])
    ("does not turn inconsistent financial data into reassuring totals (%j)", async (patch) => {
        api.chargesList.mockResolvedValue({ data: [charge(patch)], has_more: false });
        await expect(getBuyerAccountOverview()).rejects.toThrow();
    });

    it("fails honestly on provider read errors instead of returning an empty success", async () => {
        api.chargesList.mockRejectedValue(new Error("provider temporarily unavailable"));
        await expect(getBuyerAccountOverview()).rejects.toThrow("provider temporarily unavailable");
    });

    it("keeps the restricted account adapter unavailable outside a test-key sandbox", () => {
        expect(() => createBuyerAccountSandboxAdapter({ ...environment, STRIPE_SECRET_KEY: "sk_live_forbiddenFixture" })).toThrow();
        expect(() => createBuyerAccountSandboxAdapter({ ...environment, WORKFARE_PAY_MODE: "local_simulation" })).toThrow();
        expect(() => createBuyerAccountSandboxAdapter({ ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" })).toThrow();
    });
});

describe("separate billing contact updates", () => {
    it("updates only billing name, contact email and postal address on the authenticated buyer's Stripe customer", async () => {
        const result = await updateBuyerBillingDetails(billingInput, operationId);
        expect(api.customerUpdate).toHaveBeenCalledWith(customerId, {
            name: "Robin Muster", email: "billing@example.test", address: { line1: "Musterweg 4", line2: "", postal_code: "53359", city: "Rheinbach", country: "DE" },
        }, { idempotencyKey: `workfare-pay:billing:${userId}:${operationId}` });
        expect(result).toMatchObject({ ok: true, billing: { name: "Robin Muster", address: { postalCode: "53359" } } });
        expect(repository.getPaymentCustomer).toHaveBeenCalledOnce();
        expect(api.customerRetrieve).toHaveBeenCalledTimes(2);
        expect(api.chargesList).not.toHaveBeenCalled();
    });

    it.each([
        { ...billingInput, customerId: "cus_foreign" },
        { ...billingInput, name: "R" },
        { ...billingInput, email: "not-an-email" },
        { ...billingInput, address: { ...billingInput.address, country: "US" } },
        { ...billingInput, address: { ...billingInput.address, postalCode: "123" } },
        { ...billingInput, address: { ...billingInput.address, line1: "Hidden\nStreet" } },
        { ...billingInput, name: "Robin\u202e Muster" },
        { ...billingInput, address: { ...billingInput.address, verified: true } },
    ])("rejects invalid or unowned fields before contacting Stripe (%j)", async (input) => {
        await expect(updateBuyerBillingDetails(input, operationId)).rejects.toMatchObject({ code: "invalid_billing_details", status: 400 });
        expect(api.customerRetrieve).not.toHaveBeenCalled();
        expect(api.customerUpdate).not.toHaveBeenCalled();
    });

    it("updates the billing contact without changing other Customer metadata", async () => {
        const next = { ...billingInput, email: "new-invoices@example.test" };
        api.customerRetrieve.mockResolvedValue({ ...customer(), metadata: { ...customer().metadata,
            internal_note: "keep" } });
        const result = await updateBuyerBillingDetails(next, operationId);
        expect(result.billing.email).toBe(next.email);
        const input = api.customerUpdate.mock.calls[0][1];
        expect(input).not.toHaveProperty("metadata");
        expect(input).not.toHaveProperty("invoice_settings");
        expect(input).not.toHaveProperty("default_source");
    });

    it("binds live billing updates and the confirmed read-back to the live Customer and platform", async () => {
        Object.entries({ WORKFARE_PAY_MODE: "live", WORKFARE_PAY_LIVE_ENABLED: "enabled", WORKFARE_PAY_LIVE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
            WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT: "acct_fixture", APP_ORIGIN: "https://app.workfa.re", SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
            NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", STRIPE_SECRET_KEY: "rk_live_fixture", WORKFARE_DEMO_ENABLED: "false",
            NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "false", WORKFARE_DEMO_MODE: "", WORKFARE_DEMO_PROJECT_REF: "", WORKFARE_DEMO_LOCAL_URL: "" }).forEach(([key, value]) => vi.stubEnv(key, value));
        repository.getPaymentCustomer.mockResolvedValue({ id: "internal-customer", userId, mode: "live", stripeCustomerId: customerId, method: null });
        let current = { ...customer(), livemode: true };
        api.customerRetrieve.mockImplementation(async () => current);
        api.customerUpdate.mockImplementation(async (id, input) => {
            current = { ...current, id, name: input.name, email: input.email, address: input.address,
                metadata: { ...current.metadata, ...input.metadata } };
            return current;
        });
        await expect(updateBuyerBillingDetails(billingInput, operationId)).resolves.toMatchObject({ ok: true, ownerId: userId });
        expect(api.platformRetrieve).toHaveBeenCalledWith(null);
        expect(api.customerUpdate.mock.calls[0][1]).not.toHaveProperty("metadata");
        expect(api.customerRetrieve).toHaveBeenCalledTimes(2);
    });

    it("does not pretend to save contact data in a network-free local simulation", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        await expect(updateBuyerBillingDetails(billingInput)).rejects.toMatchObject({ code: "billing_requires_sandbox", status: 409 });
        expect(repository.getPaymentCustomer).not.toHaveBeenCalled();
        expect(api.customerUpdate).not.toHaveBeenCalled();
    });

    it("requires setup before editing rather than creating an unbound customer", async () => {
        repository.getPaymentCustomer.mockResolvedValue(null);
        await expect(updateBuyerBillingDetails(billingInput)).rejects.toMatchObject({ code: "payment_customer_required", status: 409 });
        expect(api.customerUpdate).not.toHaveBeenCalled();
    });

    it("rejects a foreign customer response after an update", async () => {
        api.customerUpdate.mockResolvedValue({ ...customer(), metadata: { workfare_pay_user: "foreign" } });
        await expect(updateBuyerBillingDetails(billingInput)).rejects.toMatchObject({ code: "payment_account_mismatch" });
    });

    it.each(["name", "email", "address"])("does not report success when Stripe did not confirm the saved %s", async field => {
        api.customerUpdate.mockImplementationOnce(async (id, input) => ({ ...customer(), id,
            name: field === "name" ? "Other Name" : input.name, email: field === "email" ? "other@example.test" : input.email,
            address: field === "address" ? { ...input.address, city: "Bonn" } : input.address,
            metadata: customer().metadata }));
        await expect(updateBuyerBillingDetails(billingInput, operationId)).rejects.toMatchObject({ code: "billing_sync_unconfirmed", status: 409 });
        expect(api.customerRetrieve).toHaveBeenCalledOnce();
    });

    it("detects a concurrent billing change on the fresh post-write read", async () => {
        api.customerUpdate.mockImplementationOnce(async (id, input) => {
            const updated = { ...customer(), id, name: input.name, email: input.email, address: input.address,
                metadata: { ...customer().metadata, ...input.metadata } };
            api.customerRetrieve.mockResolvedValue({ ...updated, address: { ...updated.address, city: "Bonn" } });
            return updated;
        });
        await expect(updateBuyerBillingDetails(billingInput, operationId)).rejects.toMatchObject({ code: "billing_sync_unconfirmed", status: 409 });
        expect(api.customerRetrieve).toHaveBeenCalledTimes(2);
    });

    it("retries an uncertain post-write read with the same Stripe operation key and current data", async () => {
        api.customerUpdate.mockImplementationOnce(async (id, input) => {
            const updated = { ...customer(), id, name: input.name, email: input.email, address: input.address,
                metadata: { ...customer().metadata, ...input.metadata } };
            api.customerRetrieve.mockRejectedValueOnce(new Error("read temporarily unavailable")).mockResolvedValue(updated);
            return updated;
        });
        await expect(updateBuyerBillingDetails(billingInput, operationId)).rejects.toThrow("read temporarily unavailable");
        await expect(updateBuyerBillingDetails(billingInput, operationId)).resolves.toMatchObject({ ok: true, billing: { email: billingInput.email } });
        expect(api.customerUpdate.mock.calls.map(call => call[2].idempotencyKey)).toEqual([
            `workfare-pay:billing:${userId}:${operationId}`, `workfare-pay:billing:${userId}:${operationId}`,
        ]);
    });

    it.each([{ metadata: { workfare_pay_user: "foreign" } }, { id: "cus_foreign" }, { livemode: true }])("rejects a changed binding on the post-write read (%j)", async patch => {
        api.customerUpdate.mockImplementationOnce(async (id, input) => {
            const updated = { ...customer(), id, name: input.name, email: input.email, address: input.address,
                metadata: { ...customer().metadata, ...input.metadata } };
            api.customerRetrieve.mockResolvedValue({ ...updated, ...patch });
            return updated;
        });
        await expect(updateBuyerBillingDetails(billingInput, operationId)).rejects.toThrow();
    });

    it("rejects a malformed idempotency key before any provider request", async () => {
        await expect(updateBuyerBillingDetails(billingInput, "arbitrary-customer-reference")).rejects.toMatchObject({ code: "invalid_operation_id", status: 400 });
        expect(api.customerRetrieve).not.toHaveBeenCalled();
    });
});
