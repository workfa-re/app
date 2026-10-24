import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ customer: vi.fn(), method: vi.fn(), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(), refund: vi.fn(), getRefund: vi.fn(), listRefunds: vi.fn(), recipient: vi.fn(), transfer: vi.fn(), fee: vi.fn(), reversal: vi.fn(), platform: vi.fn() }));
vi.mock("@/lib/payments/recipient-stripe.server", () => ({ createRecipientStripeAdapter: () => ({ inspect: api.recipient }) }));
vi.mock("stripe", async original => {
    const { default: Actual } = await original<typeof import("stripe")>();
    return { default: class extends Actual {
        constructor(...args: ConstructorParameters<typeof Actual>) {
            super(...args);
            this.accounts.retrieve = api.platform; this.customers.retrieve = api.customer; this.paymentMethods.retrieve = api.method;
            this.paymentIntents.create = api.create; this.paymentIntents.retrieve = api.retrieve; this.paymentIntents.capture = api.capture; this.paymentIntents.cancel = api.cancel;
            this.refunds.create = api.refund; this.refunds.retrieve = api.getRefund; this.refunds.list = api.listRefunds;
            this.transfers.retrieve = api.transfer; this.transfers.retrieveReversal = api.reversal; this.applicationFees.retrieve = api.fee;
        }
    } };
});
import Stripe from "stripe";
import { createPaymentOrderStripeAdapter } from "@/lib/payments/order-stripe.server";
import { paymentOrder, orderUser, orderRecipient, orderId, orderOperation, orderEnvironment } from "./fixtures/paymentOrders";
import { quoteTestServiceFee, TEST_SERVICE_FEE_POLICY, quoteLiveServiceFee, LIVE_SERVICE_FEE_POLICY } from "@/lib/payments/tariff";

const metadata = { workfare_pay_order: orderId, workfare_pay_provider: orderUser, workfare_pay_recipient: orderRecipient, workfare_pay_terms: "appointment-price-v1" };
const charge = () => ({ id: "ch_orderFixture", livemode: false, payment_intent: "pi_orderFixture", customer: "cus_orderFixture", amount: 3000, currency: "eur", paid: true,
    transfer: "tr_orderFixture", amount_refunded: 0, disputed: false, payment_method_details: { card: { capture_before: Math.floor(Date.now()/1000)+3600 } } });
const intent = (patch: Record<string, unknown> = {}) => ({ id: "pi_orderFixture", livemode: false, customer: "cus_orderFixture", payment_method: "pm_orderFixture", currency: "eur", amount: 3000,
    amount_received: 0, amount_capturable: 3000, capture_method: "manual", allowed_payment_method_types: ["card"], application_fee_amount: 0, transfer_data: { destination: "acct_orderFixture" },
    status: "requires_capture", metadata, client_secret: "pi_orderFixture_secret_fixture", latest_charge: charge(), ...patch });
const refund = (patch: Record<string, unknown> = {}) => ({ id: "re_orderFixture", payment_intent: "pi_orderFixture", charge: "ch_orderFixture", amount: 3000, currency: "eur",
    metadata: { workfare_pay_order: orderId, workfare_pay_provider: orderUser }, transfer_reversal: "trr_orderFixture", status: "succeeded", ...patch });
const pricedOrder = () => paymentOrder({ feePolicy: TEST_SERVICE_FEE_POLICY, feeTariff: quoteTestServiceFee(3000), serviceFeeCents: 150, totalCents: 3150 });
const feeMetadata = { ...metadata, workfare_pay_fee_policy: TEST_SERVICE_FEE_POLICY, workfare_pay_fee_gross_cents: "150", workfare_pay_tax_assumption: "sandbox-de-vat19-assumption-v1" };
const feeCharge = (patch: Record<string, unknown> = {}) => ({ ...charge(), amount: 3150, application_fee_amount: 150, application_fee: "fee_orderFixture", ...patch });
const feeIntent = (patch: Record<string, unknown> = {}) => intent({ amount: 3150, application_fee_amount: 150, metadata: feeMetadata, latest_charge: feeCharge(), status: "succeeded", amount_received: 3150, amount_capturable: 0, ...patch });
const transfer = (patch: Record<string, unknown> = {}) => ({ id: "tr_orderFixture", object: "transfer", livemode: false, amount: 3150, currency: "eur", destination: "acct_orderFixture",
    source_transaction: "ch_orderFixture", destination_payment: "py_destinationFixture", amount_reversed: 0, reversed: false, ...patch });
const applicationFee = (patch: Record<string, unknown> = {}) => ({ id: "fee_orderFixture", object: "application_fee", livemode: false, amount: 150, currency: "eur", account: "acct_orderFixture",
    originating_transaction: "ch_orderFixture", charge: "py_destinationFixture", amount_refunded: 0, refunded: false, refunds: { data: [], has_more: false }, ...patch });
const refundedFee = () => applicationFee({ amount_refunded: 150, refunded: true, refunds: { data: [{ id: "fr_orderFixture", amount: 150, currency: "eur", fee: "fee_orderFixture" }], has_more: false } });
const reversal = (patch: Record<string, unknown> = {}) => ({ id: "trr_orderFixture", object: "transfer_reversal", transfer: "tr_orderFixture", source_refund: "re_orderFixture", amount: 3150, currency: "eur", ...patch });

beforeEach(() => {
    vi.resetAllMocks();
    api.customer.mockResolvedValue({ id: "cus_orderFixture", livemode: false, metadata: { workfare_pay_user: orderUser } });
    api.method.mockResolvedValue({ id: "pm_orderFixture", livemode: false, customer: "cus_orderFixture", type: "card" });
    api.recipient.mockResolvedValue({ status: "ready", transfersActive: true, payoutsEnabled: true, hasPayoutMethod: true });
    api.create.mockResolvedValue(intent({ status: "requires_confirmation", latest_charge: null, amount_capturable: 0 }));
    api.retrieve.mockResolvedValue(intent()); api.capture.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000 }));
    api.cancel.mockResolvedValue(intent({ status: "canceled" })); api.refund.mockResolvedValue(refund()); api.getRefund.mockResolvedValue(refund());
    api.listRefunds.mockResolvedValue({ data: [], has_more: false });
    api.transfer.mockResolvedValue(transfer()); api.fee.mockResolvedValue(applicationFee()); api.reversal.mockResolvedValue(reversal());
});

describe("live destination charge boundaries", () => {
    const liveEnvironment = { WORKFARE_PAY_MODE:"live", WORKFARE_PAY_LIVE_ENABLED:"enabled", WORKFARE_PAY_LIVE_ORDERS:"enabled", WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa", WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture", APP_ORIGIN:"https://app.workfa.re", SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co", NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co", STRIPE_SECRET_KEY:"rk_live_offlineFixtureOnly" };
    const liveOrder = () => paymentOrder({mode:"live",livePaymentsEnabled:true,feePolicy:LIVE_SERVICE_FEE_POLICY,feeTariff:quoteLiveServiceFee(3000),serviceFeeCents:150,totalCents:3150,intentRef:null});
    it("allocates the actual five percent fee without sending test VAT claims", async () => {
        api.platform.mockResolvedValue({id:"acct_platformFixture",country:"DE"});
        api.customer.mockResolvedValue({id:"cus_orderFixture",livemode:true,metadata:{workfare_pay_user:orderUser}});
        api.method.mockResolvedValue({id:"pm_orderFixture",livemode:true,customer:"cus_orderFixture",type:"card"});
        api.create.mockResolvedValue(feeIntent({livemode:true,amount_received:0,amount_capturable:0,status:"requires_confirmation",latest_charge:null,metadata:{...metadata,workfare_pay_fee_policy:LIVE_SERVICE_FEE_POLICY,workfare_pay_fee_gross_cents:"150"}}));
        await createPaymentOrderStripeAdapter(liveEnvironment).authorize(liveOrder(),orderOperation);
        expect(api.create).toHaveBeenCalledWith(expect.objectContaining({amount:3150,application_fee_amount:150,transfer_data:{destination:"acct_orderFixture"},metadata:expect.objectContaining({workfare_pay_fee_policy:LIVE_SERVICE_FEE_POLICY})}),expect.any(Object));
        expect(api.create.mock.calls[0][0].metadata).not.toHaveProperty("workfare_pay_tax_assumption");
        expect(api.platform).toHaveBeenCalledExactlyOnceWith(null);
    });
    it("rejects a sandbox order or a test tariff before any live write", async () => {
        const adapter=createPaymentOrderStripeAdapter(liveEnvironment);
        await expect(adapter.authorize(paymentOrder(),orderOperation)).rejects.toThrow();
        await expect(adapter.authorize({...liveOrder(),feePolicy:TEST_SERVICE_FEE_POLICY,feeTariff:quoteTestServiceFee(3000)},orderOperation)).rejects.toThrow();
        expect(api.create).not.toHaveBeenCalled();expect(api.platform).not.toHaveBeenCalled();
    });
});

describe("test-only destination order adapter", () => {
    it("charges earnings plus the immutable test fee and allocates that fee to the platform", async () => {
        api.create.mockResolvedValue(feeIntent({ status: "requires_confirmation", latest_charge: null, amount_received: 0 }));
        await createPaymentOrderStripeAdapter(orderEnvironment).authorize({ ...pricedOrder(), intentRef: null }, orderOperation);
        expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 3150, application_fee_amount: 150,
            transfer_data: { destination: "acct_orderFixture" }, metadata: feeMetadata }), expect.any(Object));
        expect(pricedOrder().totalCents - pricedOrder().serviceFeeCents).toBe(3000);
    });
    it("confirms paid only after reading the actual owned destination transfer and application fee", async () => {
        api.retrieve.mockResolvedValue(feeIntent());
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).inspect(pricedOrder())).state).toBe("paid");
        expect(api.transfer).toHaveBeenCalledWith("tr_orderFixture"); expect(api.fee).toHaveBeenCalledWith("fee_orderFixture");
    });
    it.each([{ account: "acct_other" }, { amount: 149 }, { originating_transaction: "ch_other" }, { charge: "py_other" }, { livemode: true }])
    ("rejects substituted application-fee ownership or money (%j)", async patch => {
        api.retrieve.mockResolvedValue(feeIntent()); api.fee.mockResolvedValue(applicationFee(patch));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(pricedOrder())).rejects.toThrow();
        expect(api.refund).not.toHaveBeenCalled();
    });
    it.each([{ destination: "acct_other" }, { amount: 3000 }, { source_transaction: "ch_other" }, { currency: "usd" }, { livemode: true }])
    ("does not infer full recipient earnings from a mismatched transfer (%j)", async patch => {
        api.retrieve.mockResolvedValue(feeIntent()); api.transfer.mockResolvedValue(transfer(patch));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(pricedOrder())).rejects.toThrow();
    });
    it("returns a paid order to review when an external fee refund or transfer reversal changed its allocation", async () => {
        api.retrieve.mockResolvedValue(feeIntent()); api.fee.mockResolvedValue(applicationFee({ amount_refunded: 1 }));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).inspect(pricedOrder())).state).toBe("review_required");
        api.fee.mockResolvedValue(applicationFee()); api.transfer.mockResolvedValue(transfer({ amount_reversed: 1 }));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(pricedOrder(), orderOperation)).state).toBe("review_required");
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("refunds the gross total, application fee and destination transfer with fresh complete proof", async () => {
        api.retrieve.mockResolvedValueOnce(feeIntent()).mockResolvedValue(feeIntent({ latest_charge: feeCharge({ amount_refunded: 3150 }) }));
        api.transfer.mockResolvedValueOnce(transfer()).mockResolvedValue(transfer({ amount_reversed: 3150, reversed: true }));
        api.fee.mockResolvedValueOnce(applicationFee()).mockResolvedValue(refundedFee());
        api.refund.mockResolvedValue(refund({ amount: 3150 }));
        const result = await createPaymentOrderStripeAdapter(orderEnvironment).refund({ ...pricedOrder(), state: "refund_pending" }, orderOperation);
        expect(result).toMatchObject({ state: "refunded", refundRef: "re_orderFixture" });
        expect(api.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 3150, reverse_transfer: true, refund_application_fee: true }), expect.any(Object));
        expect(api.reversal).toHaveBeenCalledWith("tr_orderFixture", "trr_orderFixture");
        expect(api.transfer).toHaveBeenCalledTimes(2); expect(api.fee).toHaveBeenCalledTimes(2);
    });
    it.each([{ amount: 3000 }, { transfer: "tr_other" }, { source_refund: "re_other" }, { currency: "usd" }])
    ("rejects an unrelated or partial reversal while verifying a fee refund (%j)", async patch => {
        api.retrieve.mockResolvedValue(feeIntent({ latest_charge: feeCharge({ amount_refunded: 3150 }) }));
        api.getRefund.mockResolvedValue(refund({ amount: 3150 })); api.transfer.mockResolvedValue(transfer({ amount_reversed: 3150, reversed: true }));
        api.fee.mockResolvedValue(refundedFee()); api.reversal.mockResolvedValue(reversal(patch));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspectRefund(pricedOrder(), "re_orderFixture")).rejects.toThrow();
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("does not call a succeeded customer refund complete before the platform fee has actually been returned", async () => {
        api.retrieve.mockResolvedValue(feeIntent({ latest_charge: feeCharge({ amount_refunded: 3150 }) }));
        api.getRefund.mockResolvedValue(refund({ amount: 3150 })); api.transfer.mockResolvedValue(transfer({ amount_reversed: 3150, reversed: true }));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspectRefund(pricedOrder(), "re_orderFixture"))
            .rejects.toMatchObject({ code: "payment_order_refund_evidence_pending", status: 503 });
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("creates a customer-owned manual authorization without confirming or capturing", async () => {
        const result = await createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder({ intentRef: null }), orderOperation);
        expect(result).toEqual({ intentRef: "pi_orderFixture", clientSecret: "pi_orderFixture_secret_fixture" });
        expect(api.create).toHaveBeenCalledWith({ amount: 3000, currency: "eur", customer: "cus_orderFixture", payment_method: "pm_orderFixture", allowed_payment_method_types: ["card"],
            capture_method: "manual", confirm: false, application_fee_amount: 0, transfer_data: { destination: "acct_orderFixture" }, metadata },
        { idempotencyKey: `workfare-pay:order:${orderId}:authorize:${orderOperation}` });
        expect(api.recipient).toHaveBeenCalledWith(orderRecipient,"acct_orderFixture");
        expect(api.capture).not.toHaveBeenCalled(); expect(api.refund).not.toHaveBeenCalled();
    });
    it.each([
        { livemode: true }, { currency: "usd" }, { amount: 3001 }, { capture_method: "automatic" }, { customer: "cus_other" },
        { payment_method: "pm_other" }, { metadata: {} }, { transfer_data: { destination: "acct_other" } }, { application_fee_amount: 1 },
        { allowed_payment_method_types: ["sepa_debit"] }, { allowed_payment_method_types: ["card", "sepa_debit"] }, { allowed_payment_method_types: null },
    ])("rejects substituted or live financial objects (%j)", async patch => {
        api.retrieve.mockResolvedValue(intent(patch));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder())).rejects.toThrow();
    });
    it("does not authorize with another user's card or an unready recipient", async () => {
        api.method.mockResolvedValue({ id: "pm_orderFixture", livemode: false, customer: "cus_other", type: "card" });
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder(),orderOperation)).rejects.toThrow();
        expect(api.create).not.toHaveBeenCalled();
        api.method.mockResolvedValue({ id: "pm_orderFixture", livemode: false, customer: "cus_orderFixture", type: "card" });
        api.recipient.mockResolvedValue({ status: "restricted", transfersActive: false });
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder(),orderOperation)).rejects.toMatchObject({ code: "payment_order_recipient_not_ready" });
        expect(api.create).not.toHaveBeenCalled();
    });
    it.each([["sepa_debit", "sepa_async_collection_unavailable"], ["paypal", "payment_order_method_not_supported"]])("never sends %s through the manual card authorization flow", async (type, code) => {
        api.method.mockResolvedValue({ id: "pm_orderFixture", livemode: false, customer: "cus_orderFixture", type });
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder({ intentRef: null }), orderOperation)).rejects.toMatchObject({ code });
        expect(api.create).not.toHaveBeenCalled();
        expect(api.capture).not.toHaveBeenCalled();
        expect(api.recipient).not.toHaveBeenCalled();
    });
    it("resumes the stored intent instead of creating another after PSP idempotency retention expires",async()=>{
        api.retrieve.mockResolvedValue(intent({status:"requires_action",latest_charge:null}));
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder(),orderOperation))
            .toEqual({intentRef:"pi_orderFixture",clientSecret:"pi_orderFixture_secret_fixture"});
        expect(api.create).not.toHaveBeenCalled();
    });
    it("treats the intent client secret as an opaque owner-bound string",async()=>{
        const client_secret=`pi_orderFixture_secret_${"offline".repeat(80)}-._~+/=|`;
        api.create.mockResolvedValue(intent({client_secret,status:"requires_confirmation",latest_charge:null}));
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).authorize(paymentOrder({intentRef:null}),orderOperation)).toHaveProperty("clientSecret",client_secret);
    });
    it("uses the actual PSP capture deadline and never substitutes a guessed seven-day window", async () => {
        const result=await createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder());
        expect(result.state).toBe("authorized");
        expect(result.captureBefore).toBe(new Date(charge().payment_method_details.card.capture_before*1000).toISOString());
        api.retrieve.mockResolvedValue(intent({ latest_charge: { ...charge(), payment_method_details: { card: {} } } }));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder())).rejects.toThrow();
    });
    it("captures the exact agreed total only after retrieving a usable authorization", async () => {
        api.retrieve.mockResolvedValueOnce(intent()).mockResolvedValueOnce(intent()).mockResolvedValue(intent({ status:"succeeded",amount_received:3000,amount_capturable:0 }));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).capture(paymentOrder({ state:"capture_pending" }),orderOperation)).state).toBe("paid");
        expect(api.capture).toHaveBeenCalledWith("pi_orderFixture",{amount_to_capture:3000},{idempotencyKey:`workfare-pay:order:${orderId}:capture:${orderOperation}`});
    });
    it("does not capture an expired authorization or claim a partial receipt is full payment", async () => {
        api.retrieve.mockResolvedValue(intent({ latest_charge:{...charge(),payment_method_details:{card:{capture_before:1}}} }));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).capture(paymentOrder(),orderOperation)).rejects.toMatchObject({code:"payment_order_authorization_expired"});
        expect(api.capture).not.toHaveBeenCalled();
        api.retrieve.mockResolvedValue(intent({status:"succeeded",amount_received:2000}));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder())).rejects.toThrow();
    });
    it("fails closed if the expanded Charge is missing, live or belongs to another intent",async()=>{
        for(const latest_charge of["ch_unexpanded",{...charge(),livemode:true},{...charge(),payment_intent:"pi_other"}]){
            api.retrieve.mockResolvedValue(intent({latest_charge}));
            await expect(createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder())).rejects.toThrow();
        }
    });
    it("cancels only the owned authorization and preserves the original operation key", async () => {
        api.retrieve.mockResolvedValueOnce(intent()).mockResolvedValue(intent({status:"canceled"}));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).cancel(paymentOrder(),orderOperation)).state).toBe("canceled");
        expect(api.cancel).toHaveBeenCalledWith("pi_orderFixture",{cancellation_reason:"requested_by_customer"},{idempotencyKey:`workfare-pay:order:${orderId}:cancel:${orderOperation}`});
    });
    it("cancels an interrupted SCA intent without a capture or refund",async()=>{
        api.retrieve.mockResolvedValueOnce(intent({status:"requires_action",latest_charge:null})).mockResolvedValue(intent({status:"canceled",latest_charge:null}));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).cancel(paymentOrder(),orderOperation)).state).toBe("canceled");
        expect(api.cancel).toHaveBeenCalledOnce();expect(api.capture).not.toHaveBeenCalled();expect(api.refund).not.toHaveBeenCalled();
    });
    it("refunds the full owned charge and reverses the destination transfer explicitly", async () => {
        api.retrieve.mockResolvedValue(intent({status:"succeeded",amount_received:3000,amount_capturable:0}));
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder({state:"refund_pending"}),orderOperation))
            .toEqual({state:"refunded",intentRef:"pi_orderFixture",refundRef:"re_orderFixture",captureBefore:null});
        expect(api.refund).toHaveBeenCalledWith({payment_intent:"pi_orderFixture",amount:3000,reverse_transfer:true,refund_application_fee:false,
            metadata:{workfare_pay_order:orderId,workfare_pay_provider:orderUser}}, {idempotencyKey:`workfare-pay:order:${orderId}:refund:${orderOperation}`});
    });
    it("never sends a new refund for a currently disputed charge, including after a persisted refund", async () => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000, latest_charge: { ...charge(), disputed: true } }));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder({ state: "refund_pending" }), orderOperation)).state).toBe("review_required");
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder({ state: "refunded", refundRef: "re_orderFixture" })))
            .toMatchObject({ state: "review_required", refundRef: "re_orderFixture" });
        expect(api.refund).not.toHaveBeenCalled(); expect(api.getRefund).not.toHaveBeenCalled();
    });
    it("recovers the own full refund when a Charge webhook arrives before its local reference was saved", async () => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000, latest_charge: { ...charge(), amount_refunded: 3000 } }));
        api.listRefunds.mockResolvedValue({ data: [refund()], has_more: false });
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).inspect(paymentOrder({ state: "refund_pending", refundRef: null })))
            .toMatchObject({ state: "refunded", refundRef: "re_orderFixture" });
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("reads own refund evidence separately from a simultaneous dispute without sending money", async () => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000, latest_charge: { ...charge(), disputed: true, amount_refunded: 3000 } }));
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).inspectRefund(paymentOrder({ state: "review_required", refundRef: null }), "re_orderFixture"))
            .toMatchObject({ disputed: true, verified: { state: "refunded", refundRef: "re_orderFixture" } });
        expect(api.refund).not.toHaveBeenCalled(); expect(api.capture).not.toHaveBeenCalled();
    });
    it("cannot bind a substituted refund reference or another provider's refund during read-only recovery", async () => {
        const adapter = createPaymentOrderStripeAdapter(orderEnvironment);
        await expect(adapter.inspectRefund(paymentOrder({ refundRef: "re_original" }), "re_other")).rejects.toMatchObject({ code: "payment_order_object_mismatch" });
        expect(api.getRefund).not.toHaveBeenCalled();
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000 }));
        api.getRefund.mockResolvedValue(refund({ metadata: { workfare_pay_order: orderId, workfare_pay_provider: "another-provider" } }));
        await expect(adapter.inspectRefund(paymentOrder(), "re_orderFixture")).rejects.toMatchObject({ code: "payment_order_object_mismatch" });
    });
    it.each(["pending", "succeeded"])("recovers an interrupted own %s refund without creating another", async status => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000, latest_charge: { ...charge(), amount_refunded: status === "succeeded" ? 3000 : 0 } }));
        api.listRefunds.mockResolvedValue({ data: [refund({ status, transfer_reversal: status === "succeeded" ? "trr_orderFixture" : null })], has_more: false });
        const result = await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder({ state: "refund_pending" }), orderOperation);
        expect(result).toMatchObject({ state: status === "succeeded" ? "refunded" : "refund_pending", refundRef: "re_orderFixture" });
        expect(api.listRefunds).toHaveBeenCalledWith({ payment_intent: "pi_orderFixture", limit: 20 });
        expect(api.refund).not.toHaveBeenCalled();
    });
    it.each([
        { data: [refund({ amount: 1000 })], has_more: false },
        { data: [refund({ metadata: {} })], has_more: false },
        { data: [refund({ metadata: { workfare_pay_order: orderId, workfare_pay_provider: "another-provider" } })], has_more: false },
        { data: [refund(), refund({ id: "re_other" })], has_more: false },
        { data: [], has_more: true },
    ])("does not create a full refund over external, partial or ambiguous refund history (%j)", async history => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000 }));
        api.listRefunds.mockResolvedValue(history);
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(), orderOperation)).state).toBe("review_required");
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("keeps externally refunded money under review even if a bounded refund list is empty", async () => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000, latest_charge: { ...charge(), amount_refunded: 1000 } }));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(), orderOperation)).state).toBe("review_required");
        expect(api.refund).not.toHaveBeenCalled();
    });
    it.each([{ payment_intent: "pi_other" }, { charge: "ch_other" }, { currency: "usd" }])("checks each refund-list entry's actual parent (%j)", async patch => {
        api.retrieve.mockResolvedValue(intent({ status: "succeeded", amount_received: 3000 }));
        api.listRefunds.mockResolvedValue({ data: [refund(patch)], has_more: false });
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(), orderOperation)).rejects.toMatchObject({ code: "payment_order_object_mismatch" });
        expect(api.refund).not.toHaveBeenCalled();
    });
    it("resolves a signed dispute through fresh parent metadata instead of independently editable dispute metadata", async () => {
        const dispute = { id: "dp_orderFixture", object: "dispute", livemode: false, payment_intent: "pi_orderFixture", charge: "ch_orderFixture", metadata: { workfare_pay_order: "someone-else" } } as unknown as Stripe.Dispute;
        expect(await createPaymentOrderStripeAdapter(orderEnvironment).resolveDisputeOrder(dispute))
            .toEqual({ orderId, providerId: orderUser, intentRef: "pi_orderFixture" });
        expect(api.retrieve).toHaveBeenCalledWith("pi_orderFixture", { expand: ["latest_charge"] });
        expect(api.refund).not.toHaveBeenCalled(); expect(api.capture).not.toHaveBeenCalled();
    });
    it.each([{ livemode: true }, { payment_intent: "pi_other" }, { charge: "ch_other" }, { id: "re_notDispute" }])("rejects substituted dispute parents (%j)", async patch => {
        const dispute = { id: "dp_orderFixture", object: "dispute", livemode: false, payment_intent: "pi_orderFixture", charge: "ch_orderFixture", ...patch } as unknown as Stripe.Dispute;
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).resolveDisputeOrder(dispute)).rejects.toThrow();
    });
    it.each([{amount:2999},{payment_intent:"pi_other"},{charge:"ch_other"},{metadata:{}},{currency:"usd"},{transfer_reversal:null}])("rejects unrelated or incompletely reversed refunds (%j)",async patch=>{
        api.retrieve.mockResolvedValue(intent({status:"succeeded",amount_received:3000}));api.refund.mockResolvedValue(refund(patch));
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(),orderOperation)).rejects.toThrow();
    });
    it("keeps pending/failed refunds distinct and does not claim recipient bank delivery",async()=>{
        api.retrieve.mockResolvedValue(intent({status:"succeeded",amount_received:3000}));api.refund.mockResolvedValue(refund({status:"pending",transfer_reversal:null}));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(),orderOperation)).state).toBe("refund_pending");
        api.refund.mockResolvedValue(refund({status:"failed",transfer_reversal:null}));
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).refund(paymentOrder(),orderOperation)).state).toBe("review_required");
    });
    it("constructs genuine test HMAC verification and rejects changed bytes/live events",async()=>{
        const event=JSON.stringify({id:"evt_orderFixture",object:"event",type:"payment_intent.succeeded",livemode:false,data:{object:intent()}});
        const signature=Stripe.webhooks.generateTestHeaderString({payload:event,secret:orderEnvironment.STRIPE_PAYMENT_WEBHOOK_SECRET});
        expect((await createPaymentOrderStripeAdapter(orderEnvironment).verifyWebhook(event,signature)).id).toBe("evt_orderFixture");
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).verifyWebhook(event+" ",signature)).rejects.toMatchObject({code:"invalid_webhook_signature"});
        const live=event.replace('"livemode":false','"livemode":true');const liveSignature=Stripe.webhooks.generateTestHeaderString({payload:live,secret:orderEnvironment.STRIPE_PAYMENT_WEBHOOK_SECRET});
        await expect(createPaymentOrderStripeAdapter(orderEnvironment).verifyWebhook(live,liveSignature)).rejects.toThrow();
    });
    it.each([{WORKFARE_PAY_ORDER_PREVIEW:"disabled"},{WORKFARE_PAY_ORDER_SANDBOX:"disabled"},{STRIPE_SECRET_KEY:"sk_live_forbidden"}])("stays closed without every explicit test guard (%j)",patch=>{
        expect(()=>createPaymentOrderStripeAdapter({...orderEnvironment,...patch})).toThrow();expect(api.create).not.toHaveBeenCalled();
    });
});
