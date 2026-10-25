import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const api=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),funds:vi.fn(),bank:vi.fn(),history:vi.fn()}));
vi.mock("@/lib/supabaseServer",()=>({supabaseServer:async()=>({auth:{getUser:api.user}})}));
vi.mock("@/lib/supabase/admin",()=>({getSupabaseAdminClient:()=>({rpc:api.rpc})}));
vi.mock("@/lib/payments/recipient-stripe.server",()=>({createRecipientStripeAdapter:()=>({readPayoutOverview:api.funds,readBankSummary:api.bank})}));
vi.mock("@/lib/payments/guardian-recipient.server",()=>({syncGuardianRecipient:vi.fn()}));
vi.mock("@/lib/payments/recipient-summary-stripe.server",()=>({readRecipientPayoutHistory:api.history}));
vi.mock("@/lib/supabaseClient",()=>({supabaseBrowser:{auth:{onAuthStateChange:vi.fn()}}}));
import {readGuardianFinance} from "@/lib/payments/guardian-finance.server";
import {GuardianFinanceView,validGuardianFinanceSnapshot} from "@/components/guardian/GuardianFinanceOverview";
import {GET} from "@/app/api/payments/guardian/finances/route";
import type {GuardianFinanceSnapshot} from "@/lib/payments/guardian-finance-types";

const parent="11111111-1111-4111-8111-111111111111",child="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
const binding={guardianId:parent,consentId:other,guardianName:"Paula Beispiel",guardianEmail:"private-parent@fixture.invalid",guardianBirthdate:"1980-01-01",childBirthdate:"2010-01-01"};
const record=(patch:Record<string,unknown>={})=>({id:other,userId:child,mode:"live",accountRef:"acct_guardianFinanceFixture",generation:5,birthdate:binding.childBirthdate,displayName:"Kim Beispiel",minorBinding:binding,...patch});
const context=()=>({ownerId:parent,kind:"live",children:[{childId:child,status:"ready"}]});
const bank={bankName:"Beispielbank",last4:"1234",country:"DE",currency:"eur" as const};
const payout={id:"po_privateFixture",amountCents:1000,status:"paid" as const,createdAt:"2026-10-24T12:00:00Z",arrivalAt:"2026-10-26T12:00:00Z",automatic:true};
const view:GuardianFinanceSnapshot={ownerId:parent,childId:child,kind:"live",currency:"eur",confirmedCents:3400,availableCents:1500,pendingCents:1700,paidOutCents:1000,bank,recentPayouts:[{amountCents:payout.amountCents,status:payout.status,createdAt:payout.createdAt,arrivalAt:payout.arrivalAt}],partial:false,checkedAt:"2026-10-25T12:00:00Z"};
const text=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
beforeEach(()=>{
 vi.resetAllMocks();
 for(const[key,value]of Object.entries({WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""}))vi.stubEnv(key,value);
 api.user.mockResolvedValue({data:{user:{id:parent,email_confirmed_at:"2026-10-24T00:00:00Z"}},error:null});
 api.rpc.mockImplementation(async name=>({error:null,data:name==="pay_guardian_recipient_context"?context():name==="pay_guardian_recipient_earnings"?{ownerId:parent,childId:child,currency:"eur",confirmedCents:3400}:record()}));
 api.funds.mockResolvedValue({kind:"live",currency:"eur",availableCents:1500,pendingCents:1700});api.bank.mockResolvedValue(bank);
 api.history.mockResolvedValue({coverage:"complete",paidOutCents:1000,inTransitCents:0,recent:[payout],checkedAt:view.checkedAt});
});
afterEach(()=>vi.unstubAllEnvs());

describe("read-only guardian finance",()=>{
 it("reads only the current approved parent's exact bound child and strips all private provider identifiers",async()=>{
  api.bank.mockResolvedValue({...bank,iban:"DE00123400000000000000",account:"acct_private",routing_number:"private"});
  const result=await readGuardianFinance(child,parent);
  expect(result).toMatchObject({...view,checkedAt:expect.any(String)});
  expect(result.bank).toEqual(bank);
  expect(result.recentPayouts).toEqual([{amountCents:1000,status:"paid",createdAt:payout.createdAt,arrivalAt:payout.arrivalAt}]);
  expect(JSON.stringify(result)).not.toMatch(/acct_|po_|iban|routing_number|guardianEmail|private-parent|minorBinding|applicationId|clientSecret|address/);
  expect(api.funds).toHaveBeenCalledExactlyOnceWith(child,"acct_guardianFinanceFixture",binding);
  expect(api.bank).toHaveBeenCalledExactlyOnceWith(child,"acct_guardianFinanceFixture",binding);
  expect(api.rpc.mock.calls.every(([name])=>["pay_guardian_recipient_context","pay_guardian_recipient_get","pay_guardian_recipient_earnings"].includes(name))).toBe(true);
 });
 it("checks the owner/model before reading payout history and bounds the public list to five items",async()=>{
  api.history.mockResolvedValue({coverage:"complete",paidOutCents:8000,inTransitCents:0,recent:Array.from({length:8},(_,i)=>({...payout,id:`po_fixture${i}`})),checkedAt:view.checkedAt});
  const result=await readGuardianFinance(child,parent);
  expect(result.recentPayouts).toHaveLength(5);
  expect(api.funds.mock.invocationCallOrder[0]).toBeLessThan(api.history.mock.invocationCallOrder[0]);
 });
 it("does not fabricate an available balance or bank payout total when the recipient needs further checks",async()=>{
  api.funds.mockRejectedValue(new Error("private Stripe requirement data"));
  const result=await readGuardianFinance(child,parent);
  expect(result).toMatchObject({confirmedCents:3400,availableCents:null,pendingCents:null,paidOutCents:null,recentPayouts:[],partial:true});
  expect(api.history).not.toHaveBeenCalled();
 });
 it("preserves actual known funds when only the payout history is temporarily unavailable",async()=>{
  api.history.mockRejectedValue(new Error("private provider failure"));
  expect(await readGuardianFinance(child,parent)).toMatchObject({availableCents:1500,pendingCents:1700,paidOutCents:null,partial:true});
 });
 it("shows a partial-history total as unknown rather than using a recent-page sum",async()=>{
  api.history.mockResolvedValue({coverage:"recent_only",paidOutCents:null,inTransitCents:null,recent:[payout],checkedAt:view.checkedAt});
  expect(await readGuardianFinance(child,parent)).toMatchObject({paidOutCents:null,partial:true});
 });
 it("rejects an unconfirmed or stale owner before reading any private child information",async()=>{
  api.user.mockResolvedValue({data:{user:null},error:null});
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"authentication_required"});
  api.user.mockResolvedValue({data:{user:{id:child,email_confirmed_at:view.checkedAt}},error:null});
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"owner_mismatch"});
  expect(api.rpc).not.toHaveBeenCalled();expect(api.funds).not.toHaveBeenCalled();
 });
 it("requires an existing currently bound child setup, never creates or adopts a recipient",async()=>{
  api.rpc.mockResolvedValue({data:{...context(),children:[{childId:child,status:"not_started"}]},error:null});
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"recipient_bank_setup_required"});expect(api.funds).not.toHaveBeenCalled();
 });
 it.each([{ownerId:other},{childId:other},{currency:"usd"},{confirmedCents:-1},{confirmedCents:1.5}])("rejects a wrongly scoped earnings aggregate %j",async patch=>{
  api.rpc.mockImplementation(async name=>({error:null,data:name==="pay_guardian_recipient_context"?context():name==="pay_guardian_recipient_earnings"?{ownerId:parent,childId:child,currency:"eur",confirmedCents:3400,...patch}:record()}));
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"guardian_finance_unavailable"});expect(api.funds).not.toHaveBeenCalled();
 });
 it.each([{kind:"sandbox"},{currency:"usd"},{availableCents:NaN},{pendingCents:1.5}])("rejects wrong or ambiguous provider amounts %j",async patch=>{
  api.funds.mockResolvedValue({kind:"live",currency:"eur",availableCents:1500,pendingCents:1700,...patch});
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"guardian_finance_unavailable"});
 });
 it("does not expose a malformed bank summary",async()=>{
  api.bank.mockResolvedValue({...bank,last4:"DE00123400000000000000"});
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"guardian_finance_unavailable"});
 });
 it("rechecks parent permission after provider reads so revocation suppresses the entire response",async()=>{
  let contexts=0;
  api.rpc.mockImplementation(async name=>({error:null,data:name==="pay_guardian_recipient_context"?++contexts===1?context():{...context(),children:[]}:name==="pay_guardian_recipient_earnings"?{ownerId:parent,childId:child,currency:"eur",confirmedCents:3400}:record()}));
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"guardian_consent_required"});
 });
 it("allows a competing status sync, but rejects actual account replacement before returning data",async()=>{
  let reads=0;
  api.rpc.mockImplementation(async name=>({error:null,data:name==="pay_guardian_recipient_context"?context():name==="pay_guardian_recipient_earnings"?{ownerId:parent,childId:child,currency:"eur",confirmedCents:3400}:record({generation:++reads===1?5:6})}));
  expect(await readGuardianFinance(child,parent)).toMatchObject({confirmedCents:3400});
  reads=0;
  api.rpc.mockImplementation(async name=>({error:null,data:name==="pay_guardian_recipient_context"?context():name==="pay_guardian_recipient_earnings"?{ownerId:parent,childId:child,currency:"eur",confirmedCents:3400}:record({accountRef:++reads===1?"acct_guardianFinanceFixture":"acct_replaced"})}));
  await expect(readGuardianFinance(child,parent)).rejects.toMatchObject({code:"recipient_setup_changed"});
 });
});

describe("guardian finance HTTP and presentation",()=>{
 const endpoint=`https://app.workfa.re/api/payments/guardian/finances?childId=${child}`;
 it("serves only same-origin, owner-bound GET with no-store and no-referrer headers",async()=>{
  const response=await GET(new Request(endpoint,{headers:{"x-workfare-owner":parent}}));
  expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 });
 it.each(["",`?childId=${child}&childId=${other}`,`?childId=${child}&accountRef=acct_other`])("rejects missing, duplicate or private target parameters %s",async query=>{
  expect((await GET(new Request("https://app.workfa.re/api/payments/guardian/finances"+query,{headers:{"x-workfare-owner":parent}}))).status).toBe(400);expect(api.funds).not.toHaveBeenCalled();
 });
 it("blocks cross-site reads and requires the expected authenticated owner",async()=>{
  expect((await GET(new Request(endpoint,{headers:{origin:"https://outside.invalid","x-workfare-owner":parent}}))).status).toBe(403);
  expect((await GET(new Request(endpoint))).status).toBe(409);expect(api.funds).not.toHaveBeenCalled();
 });
 it("renders a clear read-only summary with masked bank details and no chat or payout action",()=>{
  const html=renderToStaticMarkup(<GuardianFinanceView snapshot={view} busy={false} error={null} onRefresh={vi.fn()}/>),content=text(html);
  expect(content.indexOf("Insgesamt verdient")).toBeLessThan(content.indexOf("Bereits ausgezahlt"));
  expect(content).toContain("Beispielbank");expect(content).toContain("•••• 1234");
  expect(content).toContain("Bankverbindung und Auszahlung verwaltet dein Kind");
  expect(content).not.toMatch(/Jetzt auszahlen|Bankverbindung ändern|Zum Chat|Termine|privateFixture/);
  expect(html.match(/<button/g)).toHaveLength(1);expect(html).not.toContain("<input");
 });
 it("represents missing amounts with a dash and retains earned amounts truthfully",()=>{
  const html=renderToStaticMarkup(<GuardianFinanceView snapshot={{...view,availableCents:null,pendingCents:null,paidOutCents:null,bank:null,recentPayouts:[],partial:true}} busy={false} error={null} onRefresh={vi.fn()}/>);
  expect(text(html)).toContain("34,00");expect(text(html)).toContain("Einzelne Auszahlungsdaten sind noch nicht verfügbar");expect(text(html)).not.toContain("0,00");
 });
 it("accepts only the exact parent-child live summary and rejects ambiguous values",()=>{
  expect(validGuardianFinanceSnapshot(view,parent,child)).toBe(true);
  for(const patch of [{ownerId:other},{childId:other},{kind:"sandbox"},{currency:"usd"},{confirmedCents:-1},{availableCents:NaN},{bank:{...bank,last4:"too-long"}},{recentPayouts:Array(6).fill(payout)},{recentPayouts:[{...payout,status:"unknown"}]}])expect(validGuardianFinanceSnapshot({...view,...patch},parent,child)).toBe(false);
 });
});
