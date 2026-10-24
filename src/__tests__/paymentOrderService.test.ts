import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock=vi.hoisted(()=>({auth:vi.fn(),create:vi.fn(),confirm:vi.fn(),get:vi.fn(),privateGet:vi.fn(),list:vi.fn(),begin:vi.fn(),apply:vi.fn(),authorize:vi.fn(),inspect:vi.fn(),capture:vi.fn(),cancel:vi.fn(),refund:vi.fn(),verify:vi.fn(),resolveDispute:vi.fn(),inspectRefund:vi.fn(),completion:vi.fn(),completionBegin:vi.fn()}));
vi.mock("@/lib/auth",()=>({getAuthState:mock.auth}));
vi.mock("@/lib/payments/order-repository.server",()=>({createPaymentOrder:mock.create,confirmPaymentOrder:mock.confirm,getPaymentOrder:mock.get,
    getPrivatePaymentOrder:mock.privateGet,readPaymentOrderOverview:mock.list,beginPaymentOrderOperation:mock.begin,applyPaymentOrderState:mock.apply,getCompletionPaymentContext:mock.completion,beginCompletionPayment:mock.completionBegin}));
vi.mock("@/lib/payments/order-stripe.server",()=>({createPaymentOrderStripeAdapter:()=>({authorize:mock.authorize,inspect:mock.inspect,capture:mock.capture,cancel:mock.cancel,refund:mock.refund,verifyWebhook:mock.verify,resolveDisputeOrder:mock.resolveDispute,inspectRefund:mock.inspectRefund})}));
import {proposeAppointmentPayment,confirmAppointmentPayment,readAppointmentPayment,listAppointmentPayments,actOnAppointmentPayment,syncAppointmentPayment,handlePaymentOrderWebhook} from "@/lib/payments/order-service.server";
import {PaymentFlowError} from "@/lib/payments/runtime.server";
import {paymentOrder,orderId,orderUser,orderRecipient,orderOperation,orderEnvironment} from "./fixtures/paymentOrders";

beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value]of Object.entries(orderEnvironment))vi.stubEnv(key,value);
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY","pk_test_publicFixture");
    mock.auth.mockResolvedValue({state:"ready",session:{user:{id:orderUser}},profile:{account_type:"job_provider"}});
    mock.completion.mockResolvedValue({orderId,providerId:orderUser,requested:false,operationId:null});
    mock.create.mockResolvedValue(paymentOrder({state:"awaiting_confirmation"}));mock.confirm.mockResolvedValue(paymentOrder({state:"ready"}));
    mock.get.mockResolvedValue(paymentOrder());mock.privateGet.mockResolvedValue(paymentOrder());mock.list.mockResolvedValue({orders:[paymentOrder()],quoteFeePolicy:"test-service-5-v1"});
    mock.begin.mockResolvedValue({...paymentOrder({intentRef:null}),operationId:orderOperation,replay:false});mock.apply.mockImplementation(async(_id,_event,state)=>({...paymentOrder(),state:state.state}));
    mock.authorize.mockResolvedValue({intentRef:"pi_orderFixture",clientSecret:"pi_orderFixture_secret_fixture"});
    mock.inspect.mockResolvedValue({state:"authorized",intentRef:"pi_orderFixture",captureBefore:"2035-01-01T00:00:00Z",refundRef:null});
    mock.capture.mockResolvedValue({state:"paid",intentRef:"pi_orderFixture",captureBefore:null,refundRef:null});
    mock.cancel.mockResolvedValue({state:"canceled",intentRef:"pi_orderFixture",captureBefore:null,refundRef:null});
    mock.refund.mockResolvedValue({state:"refunded",intentRef:"pi_orderFixture",captureBefore:null,refundRef:"re_orderFixture"});
    mock.resolveDispute.mockResolvedValue({ orderId, providerId: orderUser, intentRef: "pi_orderFixture" });
    mock.inspectRefund.mockResolvedValue({ verified: { state: "refunded", intentRef: "pi_orderFixture", captureBefore: null, refundRef: "re_orderFixture" }, disputed: false });
    mock.verify.mockResolvedValue({id:"evt_orderFixture",type:"payment_intent.amount_capturable_updated",data:{object:{id:"pi_orderFixture",object:"payment_intent",
        metadata:{workfare_pay_order:orderId,workfare_pay_provider:orderUser}}}});
});
afterEach(()=>vi.unstubAllEnvs());

describe("appointment price contract",()=>{
    it("proposes only a server-priced appointment/version and a bounded explicit minute agreement",async()=>{
        const input={appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,plannedMinutes:90,quoteFeePolicy:"test-service-5-v1",consent:true,operationId:orderOperation};
        expect((await proposeAppointmentPayment(input)).order.state).toBe("awaiting_confirmation");
        expect(mock.create).toHaveBeenCalledWith(orderUser,orderOperation,input.appointmentId,input.appointmentVersion,90,"test-service-5-v1");
    });
    it.each([undefined,false,"true",1])("never proposes a contract without explicit consent (%j)",async consent=>{
        await expect(proposeAppointmentPayment({appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,quoteFeePolicy:"test-service-5-v1",consent})).rejects.toMatchObject({code:"explicit_consent_required"});
        expect(mock.create).not.toHaveBeenCalled();
    });
    it.each([0,-1,481,1.5,"60",Number.NaN])("rejects unbounded/ambiguous hourly minutes (%j)",async plannedMinutes=>{
        await expect(proposeAppointmentPayment({appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,quoteFeePolicy:"test-service-5-v1",consent:true,plannedMinutes})).rejects.toMatchObject({code:"invalid_planned_minutes"});
        expect(mock.create).not.toHaveBeenCalled();
    });
    it.each([undefined,null,"unapproved-policy",500])("requires the allowlisted tariff from the displayed overview before proposing (%j)",async quoteFeePolicy=>{
        await expect(proposeAppointmentPayment({appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,quoteFeePolicy,consent:true})).rejects.toMatchObject({code:"invalid_quote_fee_policy"});
        expect(mock.create).not.toHaveBeenCalled();
    });
    it("preserves the explicit tariff-changed rejection instead of retrying with an unseen price",async()=>{
        mock.create.mockRejectedValue(new PaymentFlowError("PAYMENT_ORDER_TARIFF_CHANGED",409));
        await expect(proposeAppointmentPayment({appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,quoteFeePolicy:"local-zero-fee-v1",consent:true})).rejects.toMatchObject({code:"PAYMENT_ORDER_TARIFF_CHANGED"});
        expect(mock.create).toHaveBeenCalledTimes(1);
    });
    it("uses the authenticated recipient for exact-version acceptance; no client identity is accepted",async()=>{
        mock.auth.mockResolvedValue({state:"ready",session:{user:{id:orderRecipient}},profile:{account_type:"job_seeker"}});
        await confirmAppointmentPayment(orderId,{termsVersion:"appointment-price-v1",consent:true});
        expect(mock.confirm).toHaveBeenCalledWith(orderRecipient,orderId,"appointment-price-v1");
        await expect(confirmAppointmentPayment(orderId,{termsVersion:"other",consent:true})).rejects.toMatchObject({code:"invalid_payment_terms"});
    });
    it("reads only the actor's order and chat-scoped order list",async()=>{
        await readAppointmentPayment(orderId);
        expect(await listAppointmentPayments(paymentOrder().applicationId)).toMatchObject({orders:[{id:orderId}],quoteFeePolicy:"test-service-5-v1"});
        expect(mock.get).toHaveBeenCalledWith(orderUser,orderId);expect(mock.list).toHaveBeenCalledWith(orderUser,paymentOrder().applicationId);
        await expect(readAppointmentPayment("pi_client_supplied")).rejects.toMatchObject({code:"invalid_request"});
    });
    it.each(["no-session","incomplete-profile","guardian"])("requires a ready account (%s)",async state=>{
        mock.auth.mockResolvedValue({state:state==="guardian"?"ready":state,session:{user:{id:orderUser}},profile:{account_type:state==="guardian"?null:"job_provider"}});
        await expect(readAppointmentPayment(orderId)).rejects.toThrow();expect(mock.get).not.toHaveBeenCalled();
    });
    it("keeps the feature closed even if Stripe test credentials exist",async()=>{
        vi.stubEnv("WORKFARE_PAY_ORDER_PREVIEW","disabled");
        await expect(readAppointmentPayment(orderId)).rejects.toMatchObject({code:"payment_orders_disabled"});expect(mock.get).not.toHaveBeenCalled();
    });
});

describe("explicit order financial actions",()=>{
    it("uses a server-allocated stable operation and leaves card confirmation to Stripe.js",async()=>{
        const response=await actOnAppointmentPayment(orderId,{action:"authorize",consent:true,operationId:orderOperation});
        expect(response).toMatchObject({kind:"confirmation",clientSecret:"pi_orderFixture_secret_fixture",publishableKey:"pk_test_publicFixture"});
        expect(mock.begin).toHaveBeenCalledWith(orderUser,orderId,"authorize",orderOperation);
        expect(mock.authorize).toHaveBeenCalledWith(expect.objectContaining({id:orderId}),orderOperation);
        expect(mock.apply).toHaveBeenCalledWith(orderId,`order-action:authorize:${orderOperation}`,{state:"authorization_pending",intentRef:"pi_orderFixture",captureBefore:null,refundRef:null});
        expect(mock.capture).not.toHaveBeenCalled();
    });
    it.each(["capture","cancel","refund"])("executes %s only on the allocated provider-owned order",async action=>{
        await actOnAppointmentPayment(orderId,{action,consent:true,operationId:orderOperation});
        expect(mock.begin).toHaveBeenCalledWith(orderUser,orderId,action,orderOperation);
        expect(mock[action as "capture"|"cancel"|"refund"]).toHaveBeenCalledWith(expect.objectContaining({id:orderId}),orderOperation);
    });
    it.each([["capture_pending","capture"],["cancel_pending","cancel"],["refund_pending","refund"]]as const)("resumes interrupted %s using its original server operation",async(state,action)=>{
        mock.begin.mockResolvedValue({...paymentOrder({state}),operationId:orderOperation,replay:true});
        const anotherRequest="88888888-8888-4888-8888-888888888888";
        await actOnAppointmentPayment(orderId,{action,consent:true,operationId:anotherRequest});
        expect(mock.begin).toHaveBeenCalledWith(orderUser,orderId,action,anotherRequest);
        expect(mock[action]).toHaveBeenCalledWith(expect.objectContaining({id:orderId,state}),orderOperation);
        expect(mock.authorize).not.toHaveBeenCalled();
    });
    it("does not send another authorize/capture/refund when the operation already reached its terminal state",async()=>{
        for(const[action,state]of[["authorize","authorized"],["capture","paid"],["refund","refunded"]]as const){
            mock.begin.mockResolvedValue({...paymentOrder({state}),operationId:orderOperation,replay:true});
            expect((await actOnAppointmentPayment(orderId,{action,consent:true})).kind).toBe("state");
        }
        expect(mock.authorize).not.toHaveBeenCalled();expect(mock.capture).not.toHaveBeenCalled();expect(mock.refund).not.toHaveBeenCalled();
    });
    it("does not replay a financial action after a dispute or other review requirement was recorded", async () => {
        mock.begin.mockResolvedValue({ ...paymentOrder({ state: "review_required" }), operationId: orderOperation, replay: true });
        for (const action of ["capture", "cancel", "refund"]) expect((await actOnAppointmentPayment(orderId, { action, consent: true })).kind).toBe("state");
        expect(mock.capture).not.toHaveBeenCalled(); expect(mock.cancel).not.toHaveBeenCalled(); expect(mock.refund).not.toHaveBeenCalled();
    });
    it("reconciles an already authorized PSP intent before asking Stripe.js to confirm again",async()=>{
        mock.begin.mockResolvedValue({...paymentOrder(),operationId:orderOperation,replay:true});
        expect((await actOnAppointmentPayment(orderId,{action:"authorize",consent:true})).kind).toBe("state");
        expect(mock.inspect).toHaveBeenCalledOnce();expect(mock.authorize).not.toHaveBeenCalled();
    });
    it("directly cancels an unfunded quote without inventing a PaymentIntent",async()=>{
        mock.begin.mockResolvedValue({...paymentOrder({state:"canceled",intentRef:null}),operationId:orderOperation,replay:false});
        expect((await actOnAppointmentPayment(orderId,{action:"cancel",consent:true})).kind).toBe("state");
        expect(mock.cancel).not.toHaveBeenCalled();expect(mock.apply).not.toHaveBeenCalled();
    });
    it("simulates explicitly and never initializes Stripe for local authorize/capture/refund",async()=>{
        vi.stubEnv("WORKFARE_PAY_MODE","local_simulation");
        mock.begin.mockResolvedValue({...paymentOrder({mode:"local_simulation",intentRef:null}),operationId:orderOperation,replay:false});
        const result=await actOnAppointmentPayment(orderId,{action:"authorize",consent:true});
        expect(result.kind).toBe("local");
        expect(mock.apply.mock.calls[0][2]).toMatchObject({intentRef:`local_pi_${orderId}`,state:"authorized",refundRef:null});
        expect(mock.authorize).not.toHaveBeenCalled();expect(mock.capture).not.toHaveBeenCalled();
    });
    it("never treats a local sync callback as a payment confirmation",async()=>{
        vi.stubEnv("WORKFARE_PAY_MODE","local_simulation");await syncAppointmentPayment(orderId);
        expect(mock.inspect).not.toHaveBeenCalled();expect(mock.apply).not.toHaveBeenCalled();
    });
    it("does not allocate a pending authorization if the public key is missing",async()=>{
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY",undefined);vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",undefined);
        await expect(actOnAppointmentPayment(orderId,{action:"authorize",consent:true})).rejects.toMatchObject({code:"invalid_publishable_key"});expect(mock.begin).not.toHaveBeenCalled();
    });
    it.each([false,"true",undefined])("rejects financial actions without explicit consent (%j)",async consent=>{
        await expect(actOnAppointmentPayment(orderId,{action:"capture",consent})).rejects.toMatchObject({code:"explicit_consent_required"});expect(mock.begin).not.toHaveBeenCalled();
    });
    it("cannot act as a provider from a recipient account",async()=>{
        mock.auth.mockResolvedValue({state:"ready",session:{user:{id:orderRecipient}},profile:{account_type:"job_seeker"}});
        await expect(actOnAppointmentPayment(orderId,{action:"refund",consent:true})).rejects.toMatchObject({code:"payment_order_account_required"});expect(mock.begin).not.toHaveBeenCalled();
    });
    it("reconciles fresh PSP facts on return without trusting a client success status",async()=>{
        await syncAppointmentPayment(orderId);expect(mock.inspect).toHaveBeenCalledWith(paymentOrder());
        expect(mock.apply).toHaveBeenCalledWith(orderId,expect.stringMatching(/^order-sync:/),expect.objectContaining({state:"authorized"}));
    });
});

describe("order webhook ownership and races",()=>{
    it.each(["created", "updated", "failed"])("binds actual own refund evidence from %s even if the server response was interrupted", async stage => {
        mock.verify.mockResolvedValue({ id: "evt_refundFixture", type: `refund.${stage}`, data: { object: { id: "re_orderFixture", object: "refund",
            payment_intent: "pi_orderFixture", metadata: { workfare_pay_order: orderId, workfare_pay_provider: orderUser } } } });
        await handlePaymentOrderWebhook("signed refund", "signature");
        expect(mock.inspectRefund).toHaveBeenCalledWith(paymentOrder(), "re_orderFixture");
        expect(mock.apply).toHaveBeenCalledWith(orderId, "evt_refundFixture", expect.objectContaining({ state: "refunded", refundRef: "re_orderFixture" }));
        expect(mock.refund).not.toHaveBeenCalled();
    });
    it("records a simultaneous dispute before applying proved refund evidence, so review cannot disappear", async () => {
        mock.verify.mockResolvedValue({ id: "evt_refundDispute", type: "refund.created", data: { object: { id: "re_orderFixture", object: "refund",
            payment_intent: "pi_orderFixture", metadata: { workfare_pay_order: orderId, workfare_pay_provider: orderUser } } } });
        mock.inspectRefund.mockResolvedValue({ verified: { state: "refunded", intentRef: "pi_orderFixture", captureBefore: null, refundRef: "re_orderFixture" }, disputed: true });
        await handlePaymentOrderWebhook("signed refund", "signature");
        expect(mock.apply.mock.calls.map(call => [call[1], call[2].state])).toEqual([["evt_refundDispute:dispute", "review_required"], ["evt_refundDispute", "refunded"]]);
        expect(mock.refund).not.toHaveBeenCalled();
    });
    it.each(["created", "updated", "closed", "funds_withdrawn", "funds_reinstated"])("reconciles dispute %s through its fresh parent and exact persisted order", async stage => {
        const dispute = { id: "dp_orderFixture", object: "dispute", payment_intent: "pi_orderFixture", charge: "ch_orderFixture", metadata: {} };
        mock.verify.mockResolvedValue({ id: "evt_disputeFixture", type: `charge.dispute.${stage}`, data: { object: dispute } });
        mock.inspect.mockResolvedValue({ state: "review_required", intentRef: "pi_orderFixture", captureBefore: null, refundRef: null });
        expect(await handlePaymentOrderWebhook("signed dispute", "signature")).toEqual({ received: true });
        expect(mock.resolveDispute).toHaveBeenCalledWith(dispute);
        expect(mock.privateGet).toHaveBeenCalledWith(orderUser, orderId);
        expect(mock.apply).toHaveBeenCalledWith(orderId, "evt_disputeFixture", expect.objectContaining({ state: "review_required" }));
        expect(mock.refund).not.toHaveBeenCalled();
    });
    it("ignores substituted dispute metadata when its actual parent is not ours", async () => {
        mock.verify.mockResolvedValue({ id: "evt_disputeFixture", type: "charge.dispute.created", data: { object: { id: "dp_orderFixture", object: "dispute",
            metadata: { workfare_pay_order: orderId, workfare_pay_provider: orderUser } } } });
        mock.resolveDispute.mockResolvedValue({ intentRef: "pi_orderFixture" });
        await handlePaymentOrderWebhook("raw", "signature");
        expect(mock.privateGet).not.toHaveBeenCalled(); expect(mock.apply).not.toHaveBeenCalled();
    });
    it("uses raw signed metadata only to find the stored order, then rereads its exact PSP object",async()=>{
        expect(await handlePaymentOrderWebhook("raw payload","signature")).toEqual({received:true});
        expect(mock.verify).toHaveBeenCalledWith("raw payload","signature");expect(mock.privateGet).toHaveBeenCalledWith(orderUser,orderId);
        expect(mock.inspect).toHaveBeenCalledWith(paymentOrder());expect(mock.apply).toHaveBeenCalledWith(orderId,"evt_orderFixture",expect.objectContaining({state:"authorized"}));
    });
    it("retries a webhook racing the server's first intent binding rather than trusting its payload",async()=>{
        mock.privateGet.mockResolvedValue(paymentOrder({intentRef:null}));
        await expect(handlePaymentOrderWebhook("raw","signature")).rejects.toMatchObject({code:"payment_order_reference_pending",status:503});
        expect(mock.inspect).not.toHaveBeenCalled();expect(mock.apply).not.toHaveBeenCalled();
    });
    it.each([{account:"acct_other"},{type:"invoice.paid"},{data:{object:{id:"pi_other",object:"payment_intent",metadata:{workfare_pay_order:orderId,workfare_pay_provider:orderUser}}}},
        {data:{object:{id:"pi_orderFixture",object:"payment_intent",metadata:{}}}}])("ignores connected-account/unrelated/foreign events (%j)",async patch=>{
        const original=await mock.verify();mock.verify.mockResolvedValue({...original,...patch});
        await handlePaymentOrderWebhook("raw","signature");expect(mock.apply).not.toHaveBeenCalled();
    });
    it("ignores an unknown metadata order but preserves transient database failures for retry",async()=>{
        mock.privateGet.mockRejectedValueOnce(new PaymentFlowError("PAYMENT_ORDER_NOT_FOUND",409));
        expect(await handlePaymentOrderWebhook("raw","signature")).toEqual({received:true});
        mock.privateGet.mockRejectedValueOnce(new Error("private database failure"));
        await expect(handlePaymentOrderWebhook("raw","signature")).rejects.toThrow();
    });
});


describe("live new-payment stop preserves financial maintenance",()=>{
    function stopNewPayments(){for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_ORDERS:"disabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_fixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""}))vi.stubEnv(key,value);}
    it("blocks new proposals and authorization before persistence or Stripe",async()=>{
        stopNewPayments();
        await expect(proposeAppointmentPayment({appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,quoteFeePolicy:"workfare-service-5-v1",consent:true})).rejects.toMatchObject({code:"payment_orders_disabled"});
        await expect(actOnAppointmentPayment(orderId,{action:"authorize",consent:true})).rejects.toMatchObject({code:"payment_orders_disabled"});
        expect(mock.create).not.toHaveBeenCalled();expect(mock.begin).not.toHaveBeenCalled();expect(mock.authorize).not.toHaveBeenCalled();
    });
    it.each(["capture","cancel","refund"])("continues existing %s with the verified owner",async action=>{
        stopNewPayments();await actOnAppointmentPayment(orderId,{action,consent:true});
        expect(mock[action as "capture"|"cancel"|"refund"]).toHaveBeenCalledOnce();
    });
    it("keeps reads, sync and actual signed webhook reconciliation alive",async()=>{
        stopNewPayments();mock.privateGet.mockResolvedValue(paymentOrder({mode:"live",livePaymentsEnabled:true}));
        await readAppointmentPayment(orderId);await syncAppointmentPayment(orderId);await handlePaymentOrderWebhook("{}","signature");
        expect(mock.verify).toHaveBeenCalledExactlyOnceWith("{}","signature");expect(mock.apply).toHaveBeenCalledTimes(2);
    });
});
