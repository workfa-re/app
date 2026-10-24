import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const api=vi.hoisted(()=>({account:vi.fn(),customer:vi.fn(),updateCustomer:vi.fn(),createCustomer:vi.fn(),checkout:vi.fn(),webhook:vi.fn()}));
vi.mock("stripe",async original=>{
 const {default:Actual}=await original<typeof import("stripe")>();
 return {default:class extends Actual {
  constructor(...args:ConstructorParameters<typeof Actual>){super(...args);this.accounts.retrieve=api.account;this.customers.retrieve=api.customer;this.customers.update=api.updateCustomer;this.customers.create=api.createCustomer;this.checkout.sessions.create=api.checkout;this.webhooks.constructEvent=api.webhook;}
 }};
});
import { requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { inspectPaymentsConfiguration } from "@/lib/payments/config";
import { assertStripeModeObject,paymentStripeSdk,stripePublishableKey } from "@/lib/payments/stripe-mode.server";
import { createStripeSandboxAdapter } from "@/lib/payments/stripe-sandbox.server";
import { requirePaymentOrders } from "@/lib/payments/order-config.server";
import { quoteLiveServiceFee,LIVE_SERVICE_FEE_POLICY,validPaymentOrderFee } from "@/lib/payments/tariff";
import { POST as buyerWebhook } from "@/app/api/payments/webhook/route";
import { POST as recipientWebhook } from "@/app/api/payments/recipient/webhook/route";
import { POST as orderWebhook } from "@/app/api/payments/orders/webhook/route";
import { POST as snapshotWebhook } from "@/app/api/payments/recipient/webhook-snapshot/route";
import type { PaymentsEnvironment } from "@/lib/payments/config";
const user="11111111-1111-4111-8111-111111111111",setup="22222222-2222-4222-8222-222222222222";
const live:PaymentsEnvironment={WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_fixturePlatform",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixtureOnly",STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixtureOnly",STRIPE_WEBHOOK_SECRET:"whsec_offlineFixtureOnly"};
beforeEach(()=>{
 vi.resetAllMocks();api.account.mockResolvedValue({id:"acct_fixturePlatform",country:"DE"});api.customer.mockResolvedValue({id:"cus_fixture",livemode:true,metadata:{workfare_pay_user:user}});api.createCustomer.mockResolvedValue({id:"cus_fixture",livemode:true,metadata:{workfare_pay_user:user}});
 api.updateCustomer.mockImplementation(async(id,input)=>({id,livemode:true,email:input.email,metadata:{workfare_pay_user:user}}));
 api.checkout.mockResolvedValue({id:"cs_live_fixture",livemode:true,mode:"setup",ui_mode:"embedded_page",status:"open",customer:"cus_fixture",client_reference_id:setup,metadata:{workfare_pay_setup:setup,workfare_pay_user:user},expires_at:Math.floor(Date.now()/1000)+3600,client_secret:"cs_live_fixture_secret_offlineFixture"});
});
afterEach(()=>vi.unstubAllEnvs());
describe("strict production payment isolation",()=>{
 it("prefills live Checkout using the already bound Customer and keeps live mode verified",async()=>{
  await createStripeSandboxAdapter(live).createEmbeddedSetup("cus_fixture",user,setup,null,null,"light","provider@example.com");
  expect(api.updateCustomer).toHaveBeenCalledWith("cus_fixture",{email:"provider@example.com"},expect.objectContaining({idempotencyKey:expect.any(String)}));
  expect(api.updateCustomer.mock.invocationCallOrder[0]).toBeLessThan(api.checkout.mock.invocationCallOrder[0]);
  expect(api.checkout.mock.calls[0][0]).toMatchObject({customer:"cus_fixture",ui_mode:"embedded_page"});
  expect(api.checkout.mock.calls[0][0]).not.toHaveProperty("customer_email");
  expect(api.createCustomer).not.toHaveBeenCalled();
 });
 it.each(["rk_live_fixture","sk_live_fixture"])("accepts an explicit private live credential with the production project/origin and exposes no key (%s)",key=>{
  const environment={...live,STRIPE_SECRET_KEY:key};
  expect(requirePaymentRuntime(environment)).toEqual({mode:"live",origin:"https://app.workfa.re",platformAccountRef:"acct_fixturePlatform"});
  expect(inspectPaymentsConfiguration(environment)).toMatchObject({status:"live",livePaymentsEnabled:true});
  expect(JSON.stringify(inspectPaymentsConfiguration(environment))).not.toContain(key);
  expect(JSON.stringify(requirePaymentRuntime(environment))).not.toContain(key);
 });
 it.each([{WORKFARE_PAY_LIVE_ENABLED:"disabled"},{STRIPE_SECRET_KEY:"sk_test_fixture"},{STRIPE_SECRET_KEY:"rk_test_fixture"},{STRIPE_SECRET_KEY:""},{APP_ORIGIN:"http://app.workfa.re"},{APP_ORIGIN:"https://127.0.0.1"},{APP_ORIGIN:"https://localhost"},{APP_ORIGIN:"https://app.workfa.re/other"},{APP_ORIGIN:"https://app.workfa.re?redirect=1"},{WORKFARE_PAY_LIVE_PROJECT_REF:"bbbbbbbbbbbbbbbbbbbb"},{SUPABASE_URL:"https://bbbbbbbbbbbbbbbbbbbb.supabase.co"},{NEXT_PUBLIC_SUPABASE_URL:"https://bbbbbbbbbbbbbbbbbbbb.supabase.co"},{WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"not-account"},{WORKFARE_DEMO_ENABLED:"true"},{NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"true"},{WORKFARE_DEMO_MODE:"local"},{WORKFARE_DEMO_PROJECT_REF:"local"},{WORKFARE_DEMO_LOCAL_URL:"http://localhost:55321"}])("fails closed for mixed or incomplete live configuration (%j)",patch=>{
  expect(()=>requirePaymentRuntime({...live,...patch})).toThrow();
 });
 it.each(["sk_test_fixture","pk_live_fixture","sk_live_","rk_live_","sk_live_fixture invalid","rk_live_fixture\n"])("rejects a malformed or non-server live credential (%j)",key=>{
  expect(()=>requirePaymentRuntime({...live,STRIPE_SECRET_KEY:key})).toThrow();
 });
 it.each(["rk_live_fixture","sk_live_fixture"])("does not let the server credential bypass platform verification (%s)",async key=>{
  api.account.mockResolvedValue({id:"acct_other",country:"DE"});
  await expect(createStripeSandboxAdapter({...live,STRIPE_SECRET_KEY:key}).createCustomer(user,"operation")).rejects.toMatchObject({code:"stripe_platform_mismatch",status:503});
  expect(api.createCustomer).not.toHaveBeenCalled();
 });
 it("keeps production opt-in and project isolation mandatory for a standard live credential",()=>{
  const environment={...live,STRIPE_SECRET_KEY:"sk_live_fixture"};
  for(const patch of [{WORKFARE_PAY_LIVE_ENABLED:"disabled"},{WORKFARE_PAY_LIVE_PROJECT_REF:"bbbbbbbbbbbbbbbbbbbb"},{APP_ORIGIN:"http://localhost:3000"},{WORKFARE_DEMO_ENABLED:"true"}]){
   expect(()=>requirePaymentRuntime({...environment,...patch})).toThrow();
  }
 });
 it("requires matching live publishable keys and independently enables real orders",()=>{
  expect(stripePublishableKey(live)).toBe(live.STRIPE_PUBLISHABLE_KEY);
  expect(()=>stripePublishableKey({...live,STRIPE_PUBLISHABLE_KEY:"pk_test_fixture"})).toThrow();
  expect(()=>requirePaymentOrders(live)).toThrow();
  expect(requirePaymentOrders({...live,WORKFARE_PAY_LIVE_ORDERS:"enabled"}).mode).toBe("live");
 });
 it.each([null,{}, {livemode:false}])("never accepts a test or unknown object as live (%j)",value=>expect(()=>assertStripeModeObject(value,"live")).toThrow());
 it("verifies the actual authenticated platform before any object operation and caches it per adapter",async()=>{
  const adapter=createStripeSandboxAdapter(live);
  expect(api.account).not.toHaveBeenCalled();
  await adapter.createCustomer(user,"operation1");await adapter.createCustomer(user,"operation2");
  expect(api.account).toHaveBeenCalledExactlyOnceWith(null);
  expect(api.createCustomer).toHaveBeenCalledTimes(2);
 });
 it.each([{id:"acct_other",country:"DE"},{id:"acct_fixturePlatform",country:"US"}])("rejects a wrong platform before writes (%j)",async account=>{
  api.account.mockResolvedValue(account);
  await expect(createStripeSandboxAdapter(live).createCustomer(user,"operation")).rejects.toMatchObject({code:"stripe_platform_mismatch",status:503});
  expect(api.createCustomer).not.toHaveBeenCalled();
 });
 it("does not reclassify invalid platform configuration as a malformed webhook",async()=>{
  api.account.mockResolvedValue({id:"acct_wrong",country:"DE"});
  await expect(createStripeSandboxAdapter(live).verifyWebhook("{}","signed")).rejects.toMatchObject({code:"stripe_platform_mismatch",status:503});
  expect(api.webhook).not.toHaveBeenCalled();
 });
 it("checks live session, customer and client-secret ownership in embedded setup",async()=>{
  const value=await createStripeSandboxAdapter(live).createEmbeddedSetup("cus_fixture",user,setup,null);
  expect(value).toMatchObject({status:"pending",id:"cs_live_fixture"});
  expect(api.checkout).toHaveBeenCalledWith(expect.objectContaining({mode:"setup",allowed_payment_method_types:["card"]}),expect.any(Object));
  api.checkout.mockResolvedValue({...await api.checkout.mock.results[0].value,livemode:false});
  await expect(createStripeSandboxAdapter(live).createEmbeddedSetup("cus_fixture",user,setup,null)).rejects.toThrow();
 });
 it("never allows all payment types to bypass asynchronous-collection implementation",async()=>{
  await createStripeSandboxAdapter(live).createEmbeddedSetup("cus_fixture",user,setup,null);
  expect(api.checkout.mock.calls[0][0].allowed_payment_method_types).toEqual(["card"]);
  expect(api.checkout.mock.calls[0][0]).not.toHaveProperty("payment_method_types",["sepa_debit"]);
 });
 it("uses a five percent gross surcharge with no fabricated test tax",()=>{
  const tariff=quoteLiveServiceFee(1000);
  expect(tariff).toEqual({version:LIVE_SERVICE_FEE_POLICY,scope:"live",rateBasisPoints:500,grossCents:50,netCents:null,taxCents:null,tax:null});
  expect(validPaymentOrderFee({earningsCents:1000,serviceFeeCents:50,totalCents:1050,feePolicy:LIVE_SERVICE_FEE_POLICY,feeTariff:tariff})).toBe(true);
 });
 it.each([buyerWebhook,recipientWebhook,orderWebhook,snapshotWebhook])("returns 503 instead of acknowledging unread events when live runtime is incomplete",async handler=>{
  vi.stubEnv("WORKFARE_PAY_MODE","live");vi.stubEnv("WORKFARE_PAY_LIVE_ENABLED","disabled");
  const response=await handler(new Request("https://app.workfa.re/api/payments/webhook",{method:"POST",headers:{"stripe-signature":"signed"},body:"{}"}));
  expect(response.status).toBe(503);expect(await response.text()).not.toContain("received");
  expect(api.webhook).not.toHaveBeenCalled();
 });
 it("an SDK factory pins its environment snapshot",async()=>{
  const environment={...live};const sdk=paymentStripeSdk(environment);environment.WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT="acct_other";
  await expect(sdk()).resolves.toBeDefined();
 });
});
