import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
    runtime: vi.fn(),
    owner: vi.fn(),
    record: vi.fn(),
    claim: vi.fn(),
    rpc: vi.fn(),
    sdk: vi.fn(),
    identity: vi.fn(),
    syncIdentity: vi.fn(),
    customer: vi.fn(),
    claimCustomer: vi.fn(),
    saveCustomer: vi.fn(),
    createCustomer: vi.fn(),
    customerRead: vi.fn(),
    priceRead: vi.fn(),
    taxRead: vi.fn(),
    subRead: vi.fn(),
    subUpdate: vi.fn(),
    invoiceRead: vi.fn(),
    lines: vi.fn(),
    payments: vi.fn(),
    intent: vi.fn(),
    checkoutCreate: vi.fn(),
    checkoutRead: vi.fn(),
    checkoutList: vi.fn(),
    portal: vi.fn(),
}));
vi.mock("@/lib/payments/runtime.server", async (original) => ({
    ...(await original<typeof import("@/lib/payments/runtime.server")>()),
    requirePaymentRuntime: m.runtime,
}));
vi.mock("@/lib/payments/service.server", () => ({ requirePaymentProvider: m.owner }));
vi.mock("@/lib/payments/stripe-mode.server", async (original) => ({
    ...(await original<typeof import("@/lib/payments/stripe-mode.server")>()),
    paymentStripeSdk: () => m.sdk,
}));
vi.mock("@/lib/payments/subscription-repository.server", () => ({
    membershipRecord: m.record,
    claimMembershipCheckout: m.claim,
    membershipRpc: m.rpc,
}));
vi.mock("@/lib/payments/buyer-identity.server", () => ({
    getBuyerProfileIdentity: m.identity,
    syncBuyerCustomerIdentity: m.syncIdentity,
}));
vi.mock("@/lib/payments/repository.server", () => ({
    getPaymentCustomer: m.customer,
    claimPaymentCustomer: m.claimCustomer,
    savePaymentCustomer: m.saveCustomer,
}));
vi.mock("@/lib/payments/stripe-sandbox.server", () => ({
    createStripeSandboxAdapter: () => ({ createCustomer: m.createCustomer }),
}));
import {
    getMembershipSnapshot,
    startMembershipCheckout,
    syncMembership,
    createMembershipPortal,
    inspectMembershipInvoice,
    handleMembershipEvent,
} from "@/lib/payments/subscription-service.server";
import type Stripe from "stripe";
const owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222",
    op = "33333333-3333-4333-8333-333333333333",
    id = "44444444-4444-4444-8444-444444444444";
const start = 1792890000,
    end = 1795568400;
let record: Record<string, unknown>,
    subscription: Record<string, unknown>,
    invoice: Record<string, unknown>,
    line: Record<string, unknown>,
    payment: Record<string, unknown>,
    intent: Record<string, unknown>,
    charge: Record<string, unknown>;
const sdk = {
    customers: { retrieve: m.customerRead },
    prices: { retrieve: m.priceRead },
    taxRates: { retrieve: m.taxRead },
    subscriptions: { retrieve: m.subRead, update: m.subUpdate },
    invoices: { retrieve: m.invoiceRead, listLineItems: m.lines },
    invoicePayments: { list: m.payments },
    paymentIntents: { retrieve: m.intent },
    checkout: { sessions: { create: m.checkoutCreate, retrieve: m.checkoutRead, list: m.checkoutList } },
    billingPortal: { sessions: { create: m.portal } },
} as unknown as Stripe;
beforeEach(() => {
    vi.resetAllMocks();
    m.runtime.mockReturnValue({ mode: "sandbox", origin: "http://127.0.0.1:3000" });
    m.owner.mockImplementation(async (expected) => {
        if (expected !== owner) throw new Error("owner_mismatch");
        return owner;
    });
    m.sdk.mockResolvedValue(sdk);
    record = {
        userId: owner,
        mode: "sandbox",
        enabled: true,
        productRef: "prod_workfare_plan_v1",
        priceRef: "price_fixture",
        portalRef: "bpc_fixture",
        monthlyCents: 590,
        taxTreatment: "small_business",
        taxRateRef: null,
        termsVersion: "workfare-plan-v1",
        customerRef: "cus_fixture",
        subscriptionRef: null,
        status: "none",
        paidUntil: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        reviewRequired: false,
        generation: 0,
        checkedAt: null,
        entitled: false,
        contractReference: id,
        checkout: null,
    };
    subscription = {
        id: "sub_fixture",
        object: "subscription",
        livemode: false,
        customer: "cus_fixture",
        status: "active",
        currency: "eur",
        collection_method: "charge_automatically",
        cancel_at_period_end: false,
        pause_collection: null,
        trial_end: null,
        items: {
            has_more: false,
            data: [
                {
                    id: "si_fixture",
                    quantity: 1,
                    current_period_start: start,
                    current_period_end: end,
                    price: {
                        id: "price_fixture",
                        product: "prod_workfare_plan_v1",
                        unit_amount: 590,
                        currency: "eur",
                        recurring: { interval: "month", interval_count: 1 },
                    },
                },
            ],
        },
        latest_invoice: "in_fixture",
    };
    invoice = {
        id: "in_fixture",
        livemode: false,
        customer: "cus_fixture",
        currency: "eur",
        parent: { subscription_details: { subscription: "sub_fixture" } },
        status: "paid",
        amount_paid: 590,
        amount_remaining: 0,
        total: 590,
        amount_paid_off_stripe: 0,
    };
    line = {
        pricing: { price_details: { price: "price_fixture" } },
        parent: { subscription_item_details: { subscription_item: "si_fixture" } },
        period: { start, end },
        amount: 590,
        quantity: 1,
    };
    payment = {
        id: "inpay_fixture",
        livemode: false,
        invoice: "in_fixture",
        currency: "eur",
        amount_paid: 590,
        status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_fixture" },
    };
    charge = {
        id: "ch_fixture",
        livemode: false,
        customer: "cus_fixture",
        payment_intent: "pi_fixture",
        paid: true,
        status: "succeeded",
        amount_refunded: 0,
        refunded: false,
        disputed: false,
    };
    intent = {
        id: "pi_fixture",
        livemode: false,
        customer: "cus_fixture",
        currency: "eur",
        status: "succeeded",
        amount_received: 590,
        latest_charge: charge,
    };
    m.record.mockImplementation(async () => ({ ...record }));
    m.identity.mockResolvedValue({ name: "Fixture Provider", email: "provider@fixture.invalid" });
    m.customer.mockResolvedValue({ id, userId: owner, mode: "sandbox", stripeCustomerId: "cus_fixture" });
    m.customerRead.mockResolvedValue({ id: "cus_fixture", livemode: false, metadata: { workfare_pay_user: owner } });
    m.priceRead.mockResolvedValue({
        id: "price_fixture",
        product: "prod_workfare_plan_v1",
        livemode: false,
        active: true,
        type: "recurring",
        unit_amount: 590,
        currency: "eur",
        recurring: { interval: "month", interval_count: 1 },
    });
    m.subRead.mockImplementation(async () => subscription);
    m.invoiceRead.mockImplementation(async () => invoice);
    m.lines.mockImplementation(async () => ({ has_more: false, data: [line] }));
    m.payments.mockImplementation(async () => ({ has_more: false, data: [payment] }));
    m.intent.mockImplementation(async () => intent);
    m.rpc.mockImplementation(async (name, args) => {
        if (name === "pay_membership_sync_begin") return 1;
        if (name === "pay_membership_sync_apply") {
            record = {
                ...record,
                subscriptionRef: args.p_subscription_ref,
                status: args.p_status,
                paidUntil: args.p_paid_until,
                periodEnd: args.p_period_end,
                cancelAtPeriodEnd: args.p_cancel_at_period_end,
                reviewRequired: args.p_review_required,
                entitled: args.p_status === "active" && !!args.p_paid_until && !args.p_review_required,
            };
            return true;
        }
        if (name === "pay_membership_find") return owner;
        return null;
    });
    m.claim.mockImplementation(async () => ({
        ...record,
        checkout: {
            id,
            operationId: op,
            sessionRef: null,
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            priceRef: "price_fixture",
            termsVersion: "workfare-plan-v1",
        },
    }));
    m.checkoutCreate.mockResolvedValue({
        id: "cs_test_fixture",
        mode: "subscription",
        livemode: false,
        customer: "cus_fixture",
        client_reference_id: id,
        status: "open",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        url: "https://pay.workfa.re/c/pay/cs_test_fixture",
    });
    m.portal.mockResolvedValue({ customer: "cus_fixture", url: "https://billing.stripe.com/p/session/test_fixture" });
});
describe("paid membership access", () => {
    it("does not infer access from checkout or profile", async () => {
        expect((await getMembershipSnapshot(owner)).membership.entitled).toBe(false);
        expect(m.subRead).not.toHaveBeenCalled();
    });
    it("verifies invoice, line, collected payment and charge before extending", async () => {
        record.subscriptionRef = "sub_fixture";
        const result = await syncMembership(owner);
        expect(result.membership.entitled).toBe(true);
        expect(m.rpc.mock.calls.find((c) => c[0] === "pay_membership_sync_apply")?.[1]).toMatchObject({
            p_paid_until: new Date(end * 1000).toISOString(),
            p_invoice_ref: "in_fixture",
            p_review_required: false,
        });
    });
    it.each([
        "unpaid",
        "zero",
        "out-of-band",
        "wrong-amount",
        "wrong-period",
        "wrong-price",
        "credit",
        "refund",
        "dispute",
        "processing",
        "incomplete-lines",
    ])("does not grant access from %s evidence", async (cause) => {
        if (cause === "unpaid") invoice.status = "open";
        if (cause === "zero") invoice.amount_paid = 0;
        if (cause === "out-of-band") invoice.amount_paid_off_stripe = 590;
        if (cause === "wrong-amount") invoice.total = 591;
        if (cause === "wrong-period") line.period = { start, end: end + 1 };
        if (cause === "wrong-price") line.pricing = { price_details: { price: "price_other" } };
        if (cause === "credit") payment.payment = { type: "payment_record", payment_record: "pr_fixture" };
        if (cause === "refund") charge.amount_refunded = 1;
        if (cause === "dispute") charge.disputed = true;
        if (cause === "processing") intent.status = "processing";
        if (cause === "incomplete-lines") m.lines.mockResolvedValue({ has_more: true, data: [line] });
        const result = await inspectMembershipInvoice(
            sdk,
            subscription as unknown as Stripe.Subscription,
            record as never,
        );
        expect(result.paidUntil).toBe(null);
    });
    it.each(["foreign-invoice", "foreign-customer", "live-object", "wrong-subscription", "foreign-charge"])(
        "rejects %s",
        async (cause) => {
            if (cause === "foreign-invoice") invoice.id = "in_other";
            if (cause === "foreign-customer") invoice.customer = "cus_foreign";
            if (cause === "live-object") invoice.livemode = true;
            if (cause === "wrong-subscription")
                invoice.parent = { subscription_details: { subscription: "sub_foreign" } };
            if (cause === "foreign-charge") charge.customer = "cus_foreign";
            if (cause === "foreign-charge")
                expect(
                    (
                        await inspectMembershipInvoice(
                            sdk,
                            subscription as unknown as Stripe.Subscription,
                            record as never,
                        )
                    ).paidUntil,
                ).toBe(null);
            else
                await expect(
                    inspectMembershipInvoice(sdk, subscription as unknown as Stripe.Subscription, record as never),
                ).rejects.toThrow();
        },
    );
    it("does not expose a local fake purchase", async () => {
        m.runtime.mockReturnValue({ mode: "local_simulation", origin: "http://127.0.0.1:3000" });
        const value = await getMembershipSnapshot(owner);
        expect(value.checkoutAvailable).toBe(false);
        expect(value.membership.entitled).toBe(false);
        await expect(
            startMembershipCheckout(
                owner,
                { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
                op,
            ),
        ).rejects.toThrow();
        expect(m.checkoutCreate).not.toHaveBeenCalled();
    });
    it("rejects an owner change after network verification", async () => {
        record.subscriptionRef = "sub_fixture";
        m.record.mockResolvedValueOnce({ ...record }).mockResolvedValue({ ...record, customerRef: "cus_changed" });
        await expect(syncMembership(owner)).rejects.toThrow();
        expect(m.rpc.mock.calls.some((c) => c[0] === "pay_membership_sync_apply")).toBe(false);
    });
});
describe("deliberate subscription checkout", () => {
    it("uses server price, customer and idempotent operation", async () => {
        const value = await startMembershipCheckout(
            owner,
            { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
            op,
        );
        expect(value.url).toMatch(/^https:\/\/pay.workfa.re\//);
        const [params, options] = m.checkoutCreate.mock.calls[0];
        expect(params).toMatchObject({
            mode: "subscription",
            customer: "cus_fixture",
            line_items: [{ price: "price_fixture", quantity: 1 }],
            allow_promotion_codes: false,
            automatic_tax: { enabled: false },
        });
        expect(params).not.toHaveProperty("payment_method_types");
        expect(params).not.toHaveProperty("trial_period_days");
        expect(options.idempotencyKey).toBe(`workfare:membership-checkout:${id}`);
    });
    it.each([
        { consent: false, immediateStart: true, termsVersion: "workfare-plan-v1" },
        { consent: true, immediateStart: false, termsVersion: "workfare-plan-v1" },
        { consent: true, immediateStart: true, termsVersion: "obsolete" },
    ])("requires distinct current consent %#", async (input) => {
        await expect(startMembershipCheckout(owner, input, op)).rejects.toMatchObject({
            code: "explicit_consent_required",
        });
        expect(m.checkoutCreate).not.toHaveBeenCalled();
    });
    it("refuses an unavailable offer before creating Customer", async () => {
        record.enabled = false;
        await expect(
            startMembershipCheckout(
                owner,
                { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
                op,
            ),
        ).rejects.toThrow();
        expect(m.createCustomer).not.toHaveBeenCalled();
        expect(m.claim).not.toHaveBeenCalled();
    });
    it("resumes the same open Checkout after returning instead of charging a second subscription", async () => {
        record.checkout = {
            id,
            operationId: op,
            sessionRef: "cs_test_fixture",
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            priceRef: "price_fixture",
            termsVersion: "workfare-plan-v1",
        };
        m.claim.mockImplementation(async () => ({ ...record }));
        m.checkoutRead.mockResolvedValue({
            id: "cs_test_fixture",
            mode: "subscription",
            livemode: false,
            customer: "cus_fixture",
            client_reference_id: id,
            status: "open",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            url: "https://pay.workfa.re/c/pay/cs_test_fixture",
        });
        await startMembershipCheckout(
            owner,
            { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
            other,
        );
        expect(m.claim.mock.calls[0][2]).toBe(op);
        expect(m.checkoutCreate).not.toHaveBeenCalled();
    });
    it("rejects another price amount before creating session", async () => {
        m.priceRead.mockResolvedValue({
            id: "price_fixture",
            product: "prod_workfare_plan_v1",
            livemode: false,
            active: true,
            type: "recurring",
            unit_amount: 1,
            currency: "eur",
            recurring: { interval: "month", interval_count: 1 },
        });
        await expect(
            startMembershipCheckout(
                owner,
                { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
                op,
            ),
        ).rejects.toThrow();
        expect(m.checkoutCreate).not.toHaveBeenCalled();
    });
    it("never redirects to an arbitrary URL", async () => {
        m.checkoutCreate.mockResolvedValue({
            id: "cs_test_fixture",
            mode: "subscription",
            livemode: false,
            customer: "cus_fixture",
            client_reference_id: id,
            status: "open",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            url: "https://example.invalid/phish",
        });
        await expect(
            startMembershipCheckout(
                owner,
                { consent: true, immediateStart: true, termsVersion: "workfare-plan-v1" },
                op,
            ),
        ).rejects.toMatchObject({ code: "membership_redirect_unconfirmed" });
    });
    it("validates owned subscription before creating the restricted portal", async () => {
        record.subscriptionRef = "sub_fixture";
        const value = await createMembershipPortal(owner);
        expect(value.url).toContain("billing.stripe.com");
        expect(m.portal.mock.calls[0][0]).toMatchObject({ customer: "cus_fixture", configuration: "bpc_fixture" });
    });
});
describe("verified event routing", () => {
    it("resolves the invoice Customer graph and confirms latest subscription", async () => {
        record.subscriptionRef = "sub_fixture";
        await handleMembershipEvent({
            id: "evt_fixture",
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(m.rpc.mock.calls.find((c) => c[0] === "pay_membership_find")?.[1]).toEqual({
            p_mode: "sandbox",
            p_customer_ref: "cus_fixture",
        });
        expect(m.rpc.mock.calls.some((c) => c[0] === "pay_membership_sync_apply")).toBe(true);
    });
    it("ignores another product on the same Customer", async () => {
        record.subscriptionRef = "sub_fixture";
        (subscription.items as { data: { price: { id: string } }[] }).data[0].price.id = "price_other";
        await handleMembershipEvent({
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(m.rpc.mock.calls.some((c) => c[0] === "pay_membership_sync_apply")).toBe(false);
    });
    it("ignores connected-account events", async () => {
        await handleMembershipEvent({
            account: "acct_foreign",
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(m.rpc).not.toHaveBeenCalled();
    });
    it("never lets another subscription replace existing owner binding", async () => {
        record.subscriptionRef = "sub_owned";
        await handleMembershipEvent({
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(m.subRead).not.toHaveBeenCalled();
    });
    it("binds resubscription only through the current completed owned Checkout without browser return", async () => {
        record.subscriptionRef = "sub_old";
        record.status = "canceled";
        record.checkout = {
            id,
            operationId: op,
            sessionRef: "cs_test_new",
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            priceRef: "price_fixture",
            termsVersion: "workfare-plan-v1",
        };
        m.checkoutRead.mockResolvedValue({
            id: "cs_test_new",
            mode: "subscription",
            livemode: false,
            customer: "cus_fixture",
            client_reference_id: id,
            status: "complete",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            subscription: "sub_fixture",
        });
        await handleMembershipEvent({
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(record.subscriptionRef).toBe("sub_fixture");
        expect(record.entitled).toBe(true);
    });
    it("does not bind another subscription with a foreign Checkout reference", async () => {
        record.subscriptionRef = "sub_old";
        record.status = "canceled";
        record.checkout = {
            id,
            operationId: op,
            sessionRef: "cs_test_new",
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            priceRef: "price_fixture",
            termsVersion: "workfare-plan-v1",
        };
        m.checkoutRead.mockResolvedValue({
            id: "cs_test_new",
            mode: "subscription",
            livemode: false,
            customer: "cus_fixture",
            client_reference_id: other,
            status: "complete",
            subscription: "sub_fixture",
        });
        await handleMembershipEvent({
            type: "invoice.paid",
            livemode: false,
            data: { object: invoice },
        } as unknown as Stripe.Event);
        expect(m.rpc.mock.calls.some((c) => c[0] === "pay_membership_sync_apply")).toBe(false);
    });
    it("prioritizes the current pending Checkout during resubscription sync", async () => {
        record.subscriptionRef = "sub_old";
        record.status = "canceled";
        record.checkout = {
            id,
            operationId: op,
            sessionRef: "cs_test_new",
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            priceRef: "price_fixture",
            termsVersion: "workfare-plan-v1",
        };
        m.checkoutRead.mockResolvedValue({
            id: "cs_test_new",
            mode: "subscription",
            livemode: false,
            customer: "cus_fixture",
            client_reference_id: id,
            status: "complete",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            subscription: "sub_fixture",
        });
        expect((await syncMembership(owner)).membership.entitled).toBe(true);
        expect(m.subRead.mock.calls.every((c) => c[0] === "sub_fixture")).toBe(true);
    });
});

describe("tax and expired checkout controls",()=>{
 it("requires known tax treatment before taking a subscription order",async()=>{record.taxTreatment="pending";await expect(startMembershipCheckout(owner,{consent:true,immediateStart:true,termsVersion:"workfare-plan-v1"},op)).rejects.toMatchObject({code:"membership_tax_configuration_required"});expect(m.checkoutCreate).not.toHaveBeenCalled();});
 it("uses only an owned-mode inclusive German nineteen-percent rate",async()=>{record.taxTreatment="vat19";record.taxRateRef="txr_fixture";m.priceRead.mockResolvedValue({id:"price_fixture",product:"prod_workfare_plan_v1",livemode:false,active:true,type:"recurring",unit_amount:590,tax_behavior:"inclusive",currency:"eur",recurring:{interval:"month",interval_count:1}});m.taxRead.mockResolvedValue({id:"txr_fixture",livemode:false,active:true,inclusive:true,percentage:19,country:"DE",tax_type:"vat"});await startMembershipCheckout(owner,{consent:true,immediateStart:true,termsVersion:"workfare-plan-v1"},op);expect(m.checkoutCreate.mock.calls[0][0].subscription_data.default_tax_rates).toEqual(["txr_fixture"]);});
 it("does not enable an exclusive or foreign rate",async()=>{record.taxTreatment="vat19";record.taxRateRef="txr_fixture";m.priceRead.mockResolvedValue({id:"price_fixture",product:"prod_workfare_plan_v1",livemode:false,active:true,type:"recurring",unit_amount:590,tax_behavior:"inclusive",currency:"eur",recurring:{interval:"month",interval_count:1}});m.taxRead.mockResolvedValue({id:"txr_fixture",livemode:false,active:true,inclusive:false,percentage:19,country:"DE",tax_type:"vat"});await expect(startMembershipCheckout(owner,{consent:true,immediateStart:true,termsVersion:"workfare-plan-v1"},op)).rejects.toMatchObject({code:"membership_tax_unconfirmed"});expect(m.checkoutCreate).not.toHaveBeenCalled();});
 it("expires a manually expired Stripe session before starting a new operation",async()=>{record.checkout={id,operationId:op,sessionRef:"cs_test_expired",state:"pending",expiresAt:new Date(Date.now()+3600000).toISOString(),priceRef:"price_fixture",termsVersion:"workfare-plan-v1"};m.checkoutRead.mockResolvedValue({id:"cs_test_expired",mode:"subscription",livemode:false,customer:"cus_fixture",client_reference_id:id,status:"expired",expires_at:Math.floor(Date.now()/1000)+3600});const original=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,args)=>{if(name==="pay_membership_checkout_expire"){record.checkout={...(record.checkout as object),state:"expired"};return null;}return original(name,args);});m.claim.mockImplementation(async(_owner,_mode,operation)=>({...record,checkout:{id,operationId:operation,sessionRef:null,state:"pending",expiresAt:new Date(Date.now()+3600000).toISOString(),priceRef:"price_fixture",termsVersion:"workfare-plan-v1"}}));await startMembershipCheckout(owner,{consent:true,immediateStart:true,termsVersion:"workfare-plan-v1"},op);expect(m.rpc.mock.calls.some(c=>c[0]==="pay_membership_checkout_expire")).toBe(true);expect(m.claim.mock.calls[0][2]).not.toBe(op);expect(m.checkoutCreate).toHaveBeenCalledTimes(1);});
});

describe("asynchronous subscription collection",()=>{
 it("reconciles invoice ownership after the actual PaymentIntent succeeds",async()=>{record.subscriptionRef="sub_fixture";await handleMembershipEvent({type:"payment_intent.succeeded",livemode:false,data:{object:intent}}as unknown as Stripe.Event);expect(m.payments.mock.calls.some(c=>c[0].payment?.payment_intent==="pi_fixture")).toBe(true);expect(record.entitled).toBe(true);});
});
