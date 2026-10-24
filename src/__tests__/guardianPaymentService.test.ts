import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),create:vi.fn(),createSession:vi.fn(),link:vi.fn(),inspect:vi.fn(),save:vi.fn(),begin:vi.fn(),apply:vi.fn()}));
vi.mock("@/lib/supabaseServer",()=>({supabaseServer:async()=>({auth:{getUser:mock.user}})}));
vi.mock("@/lib/supabase/admin",()=>({getSupabaseAdminClient:()=>({rpc:mock.rpc})}));
vi.mock("@/lib/payments/recipient-stripe.server",()=>({createRecipientStripeAdapter:()=>({createAccount:mock.create,createSession:mock.createSession,createHostedOnboarding:mock.link,inspect:mock.inspect})}));
vi.mock("@/lib/payments/recipient-repository.server",()=>({saveRecipientAccount:mock.save,beginRecipientSync:mock.begin,applyRecipientSync:mock.apply}));
import {getGuardianRecipientContext,startGuardianRecipient,syncGuardianRecipient,refreshGuardianRecipient} from "@/lib/payments/guardian-recipient.server";
import {GET,POST} from "@/app/api/payments/guardian/recipients/route";
import {POST as sync} from "@/app/api/payments/guardian/recipients/sync/route";
const parent="11111111-1111-4111-8111-111111111111",child="22222222-2222-4222-8222-222222222222",operation="33333333-3333-4333-8333-333333333333",other="44444444-4444-4444-8444-444444444444";
const binding={guardianId:parent,consentId:other,childBirthdate:`${new Date().getUTCFullYear()-16}-01-01`,guardianBirthdate:"1980-01-01",guardianEmail:"parent@fixture.invalid",guardianName:"Paula Beispiel"};
const accountRef="acct_minorFixture",prefill={contactEmail:"child@fixture.invalid",displayName:"Child"};
const claim=()=>({claimed:true,accountRef:null,minorBinding:binding,prefill});
const context=()=>({ownerId:parent,kind:"live",children:[{childId:child,name:"Child",status:"not_started",canStartPayout:true,reasonCode:"guardian_kyc_required"}]});
const input={childId:child,consent:true,operationId:operation};
beforeEach(()=>{
 vi.resetAllMocks();
 for(const[key,value]of Object.entries({WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixture",NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixture",WORKFARE_PAY_HOSTED_STATE_SECRET:"offline-guardian-private-signing-fixture-only",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""}))vi.stubEnv(key,value);
 mock.user.mockResolvedValue({data:{user:{id:parent,email_confirmed_at:"2026-10-24T00:00:00Z"}},error:null});
 mock.rpc.mockImplementation(async(name)=>({error:null,data:name==="pay_guardian_recipient_context"?context():name==="pay_guardian_recipient_claim"?claim():{userId:child,accountRef,minorBinding:binding,birthdate:binding.childBirthdate}}));
 mock.create.mockResolvedValue(accountRef);mock.link.mockResolvedValue({url:"https://connect.stripe.com/setup/c/minorFixture",expiresAt:new Date(Date.now()+300000).toISOString()});
 mock.createSession.mockResolvedValue("fixture_guardian_single_account_session");
 mock.begin.mockResolvedValue({duplicate:false,generation:7,accountRef});
 mock.inspect.mockResolvedValue({status:"ready",requirementCount:0,hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true,guardianEvidence:{personRef:"person_guardianFixture",tosAcceptedAt:new Date(Date.now()-60000).toISOString()},guardianReason:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe("parent-authenticated youth payout onboarding",()=>{
 it("binds the immutable youth identity to the current approved parent and creates only the child account",async()=>{
  const result=await startGuardianRecipient(input,parent);
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("pay_guardian_recipient_claim",{p_guardian_id:parent,p_child_id:child,p_operation_id:operation});
  expect(mock.create).toHaveBeenCalledExactlyOnceWith(child,prefill,binding);
  expect(mock.save).toHaveBeenCalledExactlyOnceWith(child,"live",operation,accountRef);
  expect(result.payload).toMatchObject({ownerId:parent,kind:"live",requiresExternalBrowser:true});
  expect(JSON.stringify(result.payload)).not.toContain(accountRef);expect(JSON.stringify(result.payload)).not.toContain("1980");expect(JSON.stringify(result.payload)).not.toContain("parent@");
  const urls=mock.link.mock.calls[0][2];expect(new URL(urls.returnUrl).searchParams.get("childId")).toBe(child);expect(new URL(urls.returnUrl).pathname).toBe("/guardian/access");
  expect(result.cookie).toContain("HttpOnly; SameSite=Lax; Secure");expect(result.cookie).not.toContain(accountRef);
 });
 it.each([undefined,false,"true"])("does not start Stripe without an explicit parent action %j",async consent=>{
  await expect(startGuardianRecipient({...input,consent},parent)).rejects.toMatchObject({code:"explicit_consent_required"});expect(mock.rpc).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();
 });
 it("stops a stale-tab account switch before any private family read or Stripe operation",async()=>{
  mock.user.mockResolvedValue({data:{user:{id:other,email_confirmed_at:"2026-10-24T00:00:00Z"}},error:null});
  await expect(startGuardianRecipient(input,parent)).rejects.toMatchObject({code:"owner_mismatch",status:409});
  await expect(getGuardianRecipientContext(parent)).rejects.toMatchObject({code:"owner_mismatch",status:409});expect(mock.rpc).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();
 });
 it("keeps the database's current consent decision authoritative before account creation",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"RECIPIENT_GUARDIAN_REQUIRED"}});
  await expect(startGuardianRecipient(input,parent)).rejects.toMatchObject({code:"RECIPIENT_GUARDIAN_REQUIRED"});expect(mock.create).not.toHaveBeenCalled();expect(mock.link).not.toHaveBeenCalled();
 });
 it("does not create another child account on a retry and generates a fresh bounded hosted link",async()=>{
  mock.rpc.mockResolvedValue({data:{...claim(),accountRef,claimed:false},error:null});
  await startGuardianRecipient(input,parent);await startGuardianRecipient(input,parent);
  expect(mock.create).not.toHaveBeenCalled();expect(mock.link).toHaveBeenCalledTimes(2);expect(mock.link.mock.calls[0][3]).not.toBe(mock.link.mock.calls[1][3]);
 });
 it("refreshes a returned Stripe link only within the signed original parent/child/account consent",async()=>{
  const result=await startGuardianRecipient(input,parent);mock.link.mockClear();
  if(!result.cookie)throw new Error("Hosted flow requires its signed refresh cookie");
  await refreshGuardianRecipient(result.cookie.split(";")[0]);expect(mock.link).toHaveBeenCalledOnce();
  mock.user.mockResolvedValue({data:{user:{id:other,email_confirmed_at:"2026-10-24T00:00:00Z"}},error:null});
  await expect(refreshGuardianRecipient(result.cookie.split(";")[0])).rejects.toThrow();expect(mock.link).toHaveBeenCalledOnce();
 });
 it("performs fresh child/guardian verification on return and never treats the URL as completion",async()=>{
  expect(await syncGuardianRecipient(child,parent)).toEqual({ok:true,ownerId:parent});
  expect(mock.inspect).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding);
  expect(mock.apply).toHaveBeenCalledWith(child,expect.stringMatching(/^guardian-sync:/),7,accountRef,expect.objectContaining({guardianEvidence:expect.any(Object)}));
 });
 it("requires a working refresh secret before claims or external account creation",async()=>{
  vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET",undefined);
  await expect(startGuardianRecipient(input,parent)).rejects.toMatchObject({code:"recipient_hosted_not_configured"});expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("validates the public owner echo and never returns another parent's context",async()=>{
  mock.rpc.mockResolvedValue({data:{...context(),ownerId:other},error:null});await expect(getGuardianRecipientContext(parent)).rejects.toMatchObject({code:"recipient_guardian_unavailable"});
 });
});
describe("guardian payout HTTP authorization",()=>{
 const request=(body:unknown={childId:child,consent:true},headers:Record<string,string>={})=>new Request("https://app.workfa.re/api/payments/guardian/recipients",{method:"POST",headers:{origin:"https://app.workfa.re","content-type":"application/json","idempotency-key":operation,"x-workfare-owner":parent,...headers},body:JSON.stringify(body)});
 it("exposes only an owner-bound noncached family projection",async()=>{
  const response=await GET(new Request("https://app.workfa.re/api/payments/guardian/recipients",{headers:{"x-workfare-owner":parent}}));expect(response.status).toBe(200);expect(await response.json()).toEqual(context());expect(response.headers.get("cache-control")).toBe("no-store");
 });
 it("requires UI ownership and an allowed origin before any family operation",async()=>{
  expect((await POST(request(undefined,{"x-workfare-owner":""}))).status).toBe(409);
  expect((await POST(request(undefined,{origin:"https://other.invalid"}))).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("returns only the official hosted result and the bound refresh cookie",async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect((await response.json()).ownerId).toBe(parent);expect(response.headers.get("set-cookie")).toContain("HttpOnly");
 });
 it("serves an embedded live session in place with no hosted refresh cookie",async()=>{
  const response=await POST(request({childId:child,consent:true,uiMode:"embedded"}));
  expect(response.status).toBe(200);expect(response.headers.get("set-cookie")).toBeNull();expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(await response.json()).toMatchObject({ownerId:parent,childId:child,component:"onboarding",kind:"live",publishableKey:"pk_live_offlineFixture",clientSecret:"fixture_guardian_single_account_session"});
  expect(mock.link).not.toHaveBeenCalled();expect(mock.createSession).toHaveBeenCalledExactlyOnceWith(child,accountRef,"onboarding");
 });
 it("accepts no client account, guardian, ready flag or personal Stripe data",async()=>{
  for(const extra of [{accountRef:"acct_other"},{guardianId:other},{ready:true},{birthdate:"2000-01-01"}])expect((await POST(request({childId:child,consent:true,...extra}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("syncs the scoped child only after the current parent is authenticated",async()=>{
  expect((await sync(request({childId:child}))).status).toBe(200);expect(mock.create).not.toHaveBeenCalled();
 });
});


describe("embedded parent-authenticated youth payout onboarding", () => {
 it("returns an owner/child-bound live onboarding session without a hosted redirect or cookie", async () => {
  const result = await startGuardianRecipient({ ...input, uiMode: "embedded" }, parent);
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("pay_guardian_recipient_claim", { p_guardian_id: parent, p_child_id: child, p_operation_id: operation });
  expect(mock.createSession).toHaveBeenCalledExactlyOnceWith(child, accountRef, "onboarding");
  expect(mock.link).not.toHaveBeenCalled();
  expect(result.cookie).toBeNull();
  expect(result.payload).toEqual({ ownerId: parent, childId: child, kind: "live", component: "onboarding", clientSecret: "fixture_guardian_single_account_session", publishableKey: "pk_live_offlineFixture" });
  expect(JSON.stringify(result.payload)).not.toMatch(/acct_minor|1980|parent@|guardianId|minorBinding/);
 });
 it("does not require a hosted refresh-signing secret for the embedded session", async () => {
  vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", undefined);
  expect((await startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).cookie).toBeNull();
  expect(mock.createSession).toHaveBeenCalledOnce();
 });
 it("renews the existing child's session without creating another recipient account", async () => {
  mock.rpc.mockResolvedValue({ data: { ...claim(), accountRef, claimed: false }, error: null });
  await startGuardianRecipient({ ...input, uiMode: "embedded" }, parent);
  await startGuardianRecipient({ ...input, uiMode: "embedded" }, parent);
  expect(mock.create).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  expect(mock.createSession).toHaveBeenCalledTimes(2); expect(mock.link).not.toHaveBeenCalled();
 });
 it("rejects an account switch before reading a child claim or creating a session", async () => {
  mock.user.mockResolvedValue({ data: { user: { id: other, email_confirmed_at: "2026-10-24T00:00:00Z" } }, error: null });
  await expect(startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).rejects.toMatchObject({ code: "owner_mismatch", status: 409 });
  expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.createSession).not.toHaveBeenCalled();
 });
 it.each([null, { id: parent, email_confirmed_at: null }])("requires a currently authenticated email-confirmed parent %j", async user => {
  mock.user.mockResolvedValue({ data: { user }, error: null });
  await expect(startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).rejects.toMatchObject({ code: "authentication_required", status: 401 });
  expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.createSession).not.toHaveBeenCalled();
 });
 it("requires current family consent before opening the embedded component", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: "RECIPIENT_GUARDIAN_REQUIRED" } });
  await expect(startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).rejects.toMatchObject({ code: "RECIPIENT_GUARDIAN_REQUIRED" });
  expect(mock.createSession).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
 });
 it("rejects a returned claim belonging to another guardian", async () => {
  mock.rpc.mockResolvedValue({ data: { ...claim(), minorBinding: { ...binding, guardianId: other } }, error: null });
  await expect(startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).rejects.toMatchObject({ code: "recipient_guardian_unavailable" });
  expect(mock.createSession).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
 });
 it.each([undefined, "pk_test_wrongMode", "sk_live_private", "pk_live_contains whitespace"])("rejects missing or incompatible public key %j before claims or Stripe writes", async key => {
  vi.stubEnv("STRIPE_PUBLISHABLE_KEY", key); vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  await expect(startGuardianRecipient({ ...input, uiMode: "embedded" }, parent)).rejects.toMatchObject({ code: "invalid_publishable_key", status: 503 });
  expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled(); expect(mock.createSession).not.toHaveBeenCalled();
 });
 it.each(["hosted", "sandbox", "management", null, true, {}])("rejects unsupported caller-supplied UI mode %j", async uiMode => {
  await expect(startGuardianRecipient({ ...input, uiMode }, parent)).rejects.toMatchObject({ code: "invalid_request" });
  expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.createSession).not.toHaveBeenCalled();
 });
});
