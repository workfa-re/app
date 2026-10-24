import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const service=vi.hoisted(()=>({proposeAppointmentPayment:vi.fn(),listAppointmentPayments:vi.fn(),readAppointmentPayment:vi.fn(),confirmAppointmentPayment:vi.fn(),actOnAppointmentPayment:vi.fn(),syncAppointmentPayment:vi.fn(),handlePaymentOrderWebhook:vi.fn()}));
vi.mock("@/lib/payments/order-service.server",()=>service);
import {POST as create,GET as list} from "@/app/api/payments/orders/route";
import {GET as read} from "@/app/api/payments/orders/[orderId]/route";
import {POST as confirm} from "@/app/api/payments/orders/[orderId]/confirm/route";
import {POST as act} from "@/app/api/payments/orders/[orderId]/action/route";
import {POST as sync} from "@/app/api/payments/orders/[orderId]/sync/route";
import {POST as webhook} from "@/app/api/payments/orders/webhook/route";
import {orderEnvironment,orderId,orderOperation,paymentOrder} from "./fixtures/paymentOrders";
const context=()=>({params:Promise.resolve({orderId})});
const request=(body:unknown={},headers:Record<string,string>={})=>new Request(`${orderEnvironment.APP_ORIGIN}/api/payments/orders`,{method:"POST",headers:{origin:orderEnvironment.APP_ORIGIN,"content-type":"application/json","sec-fetch-site":"same-origin",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
beforeEach(()=>{
    vi.resetAllMocks();for(const[key,value]of Object.entries(orderEnvironment))vi.stubEnv(key,value);
    service.proposeAppointmentPayment.mockResolvedValue({order:paymentOrder()});service.listAppointmentPayments.mockResolvedValue({orders:[],quoteFeePolicy:"test-service-5-v1"});
    service.readAppointmentPayment.mockResolvedValue({order:paymentOrder()});service.confirmAppointmentPayment.mockResolvedValue({order:paymentOrder()});
    service.actOnAppointmentPayment.mockResolvedValue({kind:"confirmation",clientSecret:"pi_orderFixture_secret_fixture",publishableKey:"pk_test_fixture"});
    service.syncAppointmentPayment.mockResolvedValue({order:paymentOrder()});service.handlePaymentOrderWebhook.mockResolvedValue({received:true});
});
afterEach(()=>vi.unstubAllEnvs());
describe("order mutation boundaries",()=>{
    it("accepts only an appointment version, explicit minutes and consent; never accepts client prices or recipients",async()=>{
        const body={appointmentId:paymentOrder().appointmentId,appointmentVersion:paymentOrder().appointmentVersion,plannedMinutes:60,quoteFeePolicy:"test-service-5-v1",consent:true};
        expect((await create(request(body,{"idempotency-key":orderOperation}))).status).toBe(200);
        expect(service.proposeAppointmentPayment).toHaveBeenCalledWith({...body,operationId:orderOperation});
        service.proposeAppointmentPayment.mockClear();
        for(const forged of [{amount:1},{earningsCents:1},{customerId:"cus_other"},{accountRef:"acct_other"},{recipientId:"other"},{feePolicy:"free"},{serviceFeeCents:0},{feeTariff:{scope:"live"}}]){
            expect((await create(request({...body,...forged}))).status).toBe(400);
        }
        expect(service.proposeAppointmentPayment).not.toHaveBeenCalled();
    });
    it.each([create,confirm,act,sync])("requires same-origin JSON for each financial mutation",async handler=>{
        expect((await handler(request({}, {origin:"https://evil.example"}),context())).status).toBe(403);
        expect((await handler(request({}, {"content-type":"text/plain"}),context())).status).toBe(415);
        expect(service.actOnAppointmentPayment).not.toHaveBeenCalled();expect(service.proposeAppointmentPayment).not.toHaveBeenCalled();
    });
    it("passes exact recipient terms and consent to owner-checked service",async()=>{
        expect((await confirm(request({termsVersion:"appointment-price-v1",consent:true}),context())).status).toBe(200);
        expect(service.confirmAppointmentPayment).toHaveBeenCalledWith(orderId,{termsVersion:"appointment-price-v1",consent:true});
        expect((await confirm(request({termsVersion:"appointment-price-v1",consent:true,userId:"other"}),context())).status).toBe(400);
    });
    it("puts a confirmation secret only in a non-cacheable response, never a redirect",async()=>{
        const response=await act(request({action:"authorize",consent:true},{"idempotency-key":orderOperation}),context());
        expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("location")).toBeNull();
        expect(await response.json()).toMatchObject({clientSecret:"pi_orderFixture_secret_fixture"});
        expect(service.actOnAppointmentPayment).toHaveBeenCalledWith(orderId,{action:"authorize",consent:true,operationId:orderOperation});
    });
    it("never accepts a payment status or PSP identifier as sync evidence",async()=>{
        expect((await sync(request(),context())).status).toBe(200);expect(service.syncAppointmentPayment).toHaveBeenCalledWith(orderId);
        service.syncAppointmentPayment.mockClear();
        for(const forged of[{status:"paid"},{intentRef:"pi_other"},{amount:3000}])expect((await sync(request(forged),context())).status).toBe(400);
        expect(service.syncAppointmentPayment).not.toHaveBeenCalled();
    });
    it("sanitizes PSP and database errors without leaking secrets",async()=>{
        service.actOnAppointmentPayment.mockRejectedValue(new Error("sk_test_private pi_private_secret_private cus_private person@example.com"));
        const response=await act(request({action:"capture",consent:true}),context());expect(response.status).toBe(503);
        const text=await response.text();for(const secret of["sk_test_private","pi_private","cus_private","person@example.com"])expect(text).not.toContain(secret);
    });
});
describe("owner-bound reads and signed order events",()=>{
    it("only accepts a single application ID for listing, with no browser-owned identity",async()=>{
        const base=`${orderEnvironment.APP_ORIGIN}/api/payments/orders`;
        const response=await list(new Request(`${base}?applicationId=${paymentOrder().applicationId}`));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({orders:[],quoteFeePolicy:"test-service-5-v1"});
        expect(service.listAppointmentPayments).toHaveBeenCalledWith(paymentOrder().applicationId);
        service.listAppointmentPayments.mockClear();
        for(const query of["",`applicationId=x&applicationId=y`,`applicationId=x&userId=other`])expect((await list(new Request(`${base}?${query}`))).status).toBe(400);
        expect(service.listAppointmentPayments).not.toHaveBeenCalled();
    });
    it("keeps order reads non-cacheable and delegates ownership to the verified actor",async()=>{
        const response=await read(new Request(`${orderEnvironment.APP_ORIGIN}/api/payments/orders/${orderId}`),context());
        expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.readAppointmentPayment).toHaveBeenCalledWith(orderId);
    });
    it("requires a bounded signature and preserves the exact webhook bytes",async()=>{
        expect((await webhook(request("raw"))).status).toBe(400);
        expect((await webhook(request("raw",{"stripe-signature":"x".repeat(2001)}))).status).toBe(400);
        const payload='{ "id":"evt_fixture","data": {} }\n';
        const response=await webhook(new Request(`${orderEnvironment.APP_ORIGIN}/api/payments/orders/webhook`,{method:"POST",headers:{"stripe-signature":"signed"},body:payload}));
        expect(response.status).toBe(200);expect(service.handlePaymentOrderWebhook).toHaveBeenCalledWith(payload,"signed");
    });
});
