import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),create:vi.fn(),session:vi.fn(),saveBank:vi.fn(),inspect:vi.fn(),bank:vi.fn(),unused:vi.fn(),save:vi.fn(),begin:vi.fn(),apply:vi.fn(),bankSummary:vi.fn()}));
vi.mock("@/lib/auth",()=>({getAuthState:mock.auth}));
vi.mock("@/lib/supabase/admin",()=>({getSupabaseAdminClient:()=>({rpc:mock.rpc})}));
vi.mock("@/lib/payments/recipient-stripe.server",()=>({createRecipientStripeAdapter:()=>({createAccount:mock.create,createSession:mock.session,saveInitialBankMethod:mock.saveBank,inspect:mock.inspect,inspectBankSetup:mock.bank,inspectUnusedSetup:mock.unused,readBankSummary:mock.bankSummary})}));
vi.mock("@/lib/payments/recipient-repository.server",()=>({saveRecipientAccount:mock.save,beginRecipientSync:mock.begin,applyRecipientSync:mock.apply}));
import {minorSetupContext,readMinorBankSetup,restartUnusedMinorSetup,startMinorBankSetup} from "@/lib/payments/minor-bank.server";
import {PaymentFlowError} from "@/lib/payments/runtime.server";
import {GET,POST} from "@/app/api/payments/recipient/bank/route";

const child="11111111-1111-4111-8111-111111111111",parent="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333",operation="44444444-4444-4444-8444-444444444444",recordId="55555555-5555-4555-8555-555555555555";
const birthdate=`${new Date().getUTCFullYear()-16}-01-01`;
const binding={guardianId:parent,consentId:other,childBirthdate:birthdate,guardianBirthdate:"1980-01-01",guardianEmail:"parent@fixture.invalid",guardianName:"Parent Fixture"};
const accountRef="acct_childBankFixture",prefill={contactEmail:"child@fixture.invalid",displayName:"Child Fixture"};
const auth=()=>({state:"ready",session:{user:{id:child,email:prefill.contactEmail,email_confirmed_at:"2026-10-24T00:00:00Z"}},profile:{full_name:"Child Fixture",account_type:"job_seeker",birthdate,country:"DE"}});
const record=(patch={})=>({id:recordId,userId:child,mode:"live",accountRef,generation:4,minorBinding:binding,...patch});
const context=(patch={})=>({userId:child,guardians:[{guardianId:parent,name:"Parent Fixture"}],recipient:null,canRestart:false,bindingCurrent:false,hasPayoutMethod:false,ready:false,...patch});
const claim=(patch={})=>({claimed:true,accountRef:null,minorBinding:binding,prefill,...patch});
const bankToken="btok_childFixture";
const input={consent:true,bankToken,operationId:operation};
beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixture",NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixture",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""}))vi.stubEnv(key,value);
    mock.auth.mockResolvedValue(auth());
    let accountSaved=false,bankAttached=false;
    mock.rpc.mockImplementation(async name=>({error:null,data:name==="pay_recipient_minor_setup_context"?context(accountSaved?{recipient:record(),bindingCurrent:true,hasPayoutMethod:bankAttached}:{}):name==="pay_recipient_minor_claim"?claim():{ok:true,childId:child,guardianId:parent,generation:5}}));
    mock.save.mockImplementation(async()=>{accountSaved=true;});
    mock.saveBank.mockImplementation(async()=>{bankAttached=true;});
    mock.create.mockResolvedValue(accountRef);
    mock.begin.mockResolvedValue({duplicate:false,generation:4,accountRef});
    mock.inspect.mockResolvedValue({status:"pending",requirementCount:1,hasPayoutMethod:true,detailsSubmitted:false,transfersActive:false,payoutsEnabled:false});
    mock.bank.mockResolvedValue(true);mock.bankSummary.mockResolvedValue(null);
    mock.unused.mockResolvedValue(undefined);
});
afterEach(()=>vi.unstubAllEnvs());

describe("youth-owned bank setup authorization",()=>{
    it("saves a child-owned Stripe bank token after current parental approval without issuing financial or identity authority",async()=>{
        const result=await startMinorBankSetup(input,child);
        expect(result).toMatchObject({ownerId:child,kind:"live",ready:false,publishableKey:"pk_live_offlineFixture",holderName:"Child Fixture"});
        expect(mock.rpc).toHaveBeenCalledWith("pay_recipient_minor_claim",{p_child_id:child,p_guardian_id:parent,p_operation_id:operation});
        expect(mock.create).toHaveBeenCalledExactlyOnceWith(child,prefill,binding);
        expect(mock.save).toHaveBeenCalledExactlyOnceWith(child,"live",operation,accountRef);
        expect(mock.saveBank).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding,bankToken,operation);
        expect(JSON.stringify(result)).not.toMatch(/clientSecret|component|guardianEmail|guardianBirthdate|acct_child|parent@|btok_/);
        expect(mock.session).not.toHaveBeenCalled();expect(mock.unused).not.toHaveBeenCalled();
    });
    it("reuses an already claimed account for an idempotent initial bank submission without issuing sessions",async()=>{
        mock.rpc.mockImplementation(async name=>({error:null,data:name==="pay_recipient_minor_setup_context"?context({recipient:record(),bindingCurrent:true}):claim({claimed:false,accountRef})}));
        await startMinorBankSetup(input,child);await startMinorBankSetup(input,child);
        expect(mock.create).not.toHaveBeenCalled();expect(mock.save).not.toHaveBeenCalled();expect(mock.saveBank).toHaveBeenCalledTimes(2);expect(mock.session).not.toHaveBeenCalled();
    });
    it("rejects an account switch before any family read or Stripe access",async()=>{
        await expect(startMinorBankSetup(input,other)).rejects.toMatchObject({code:"owner_mismatch",status:409});
        await expect(readMinorBankSetup(other)).rejects.toMatchObject({code:"owner_mismatch"});
        expect(mock.rpc).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();
    });
    it("requires a real authenticated session",async()=>{
        mock.auth.mockResolvedValue({state:"no-session"});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"authentication_required",status:401});
        expect(mock.rpc).not.toHaveBeenCalled();
    });
    it.each([
        {account_type:"job_provider"},{birthdate:`${new Date().getUTCFullYear()-18}-01-01`},
        {birthdate:`${new Date().getUTCFullYear()-13}-01-01`},{birthdate:null},{birthdate:"invalid"},{country:"US"},
    ])("requires the actual DE seeker profile aged 14–17: %j",async patch=>{
        const value=auth();Object.assign(value.profile,patch);mock.auth.mockResolvedValue(value);
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_minor_account_required",status:403});
        expect(mock.rpc).not.toHaveBeenCalled();expect(mock.session).not.toHaveBeenCalled();
    });
    it.each([null,"","x".repeat(201),"Child\nFixture"])("does not derive the bank holder name from an incomplete or unsafe profile %j",async full_name=>{
        const value=auth();Object.assign(value.profile,{full_name});mock.auth.mockResolvedValue(value);
        await expect(readMinorBankSetup(child)).rejects.toMatchObject({code:"recipient_minor_account_required"});
        expect(mock.rpc).not.toHaveBeenCalled();
    });
    it.each(["incomplete-profile","email-unconfirmed","family-only"])("does not accept incomplete auth state %s",async state=>{
        mock.auth.mockResolvedValue({...auth(),state});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_minor_account_required"});expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("requires the child's own verified email",async()=>{
        const value=auth();Object.assign(value.session.user,{email_confirmed_at:null});mock.auth.mockResolvedValue(value);
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_minor_account_required"});expect(mock.rpc).not.toHaveBeenCalled();
    });
    it.each([false,undefined,"true",1])("never starts from missing or implicit consent %j",async consent=>{
        await expect(startMinorBankSetup({...input,consent},child)).rejects.toMatchObject({code:"explicit_consent_required"});expect(mock.rpc).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();
    });
    it.each([{operationId:"invalid"},{guardianId:"invalid"},{restart:false},{restart:"true"},{restart:null}])("rejects malformed setup options before private reads %j",async patch=>{
        await expect(startMinorBankSetup({...input,...patch},child)).rejects.toMatchObject({code:"invalid_request"});expect(mock.rpc).not.toHaveBeenCalled();
    });
    it.each([undefined,null,42,"btok_","btok_"+"a".repeat(300)])("requires a bounded Stripe bank token %j",async bankToken=>{
        await expect(startMinorBankSetup({...input,bankToken},child)).rejects.toMatchObject({code:"recipient_bank_token_invalid"});
        expect(mock.rpc).not.toHaveBeenCalled();expect(mock.saveBank).not.toHaveBeenCalled();
    });
    it("does not store or return a raw account or payment credential in place of a Stripe bank token",async()=>{
        for(const bankToken of ["DE89370400440532013000","4000000000000002","pm_fake","tok_card","ba_fake"]){
            await expect(startMinorBankSetup({...input,bankToken},child)).rejects.toMatchObject({code:"recipient_bank_token_invalid"});
        }
        expect(mock.rpc).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();expect(mock.saveBank).not.toHaveBeenCalled();
    });
    it("requires a matching live public key before any private claim",async()=>{
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY","pk_test_wrongMode");
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"invalid_publishable_key"});expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("shows the need for parental approval without attempting Stripe setup",async()=>{
        mock.rpc.mockResolvedValue({data:context({guardians:[]}),error:null});
        expect(await readMinorBankSetup(child)).toMatchObject({ownerId:child,canStart:false,ready:false,reasonCode:"guardian_consent_required"});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"guardian_consent_required"});expect(mock.create).not.toHaveBeenCalled();expect(mock.session).not.toHaveBeenCalled();
    });
    it("requires a deliberate choice when multiple eligible parents have no existing setup binding",async()=>{
        mock.rpc.mockResolvedValue({data:context({guardians:[{guardianId:parent,name:"Parent One"},{guardianId:other,name:"Parent Two"}]}),error:null});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_guardian_choice_required"});expect(mock.session).not.toHaveBeenCalled();
    });
    it("rejects an unrelated selected guardian instead of placing them in account metadata",async()=>{
        await expect(startMinorBankSetup({...input,guardianId:other},child)).rejects.toMatchObject({code:"guardian_consent_required"});expect(mock.create).not.toHaveBeenCalled();expect(mock.session).not.toHaveBeenCalled();
    });
    it.each([{userId:other},{recipient:record({userId:other})}])("rejects a mismatched owner in the private context %j",async patch=>{
        mock.rpc.mockResolvedValue({data:context(patch),error:null});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_setup_unavailable",status:503});expect(mock.session).not.toHaveBeenCalled();
    });
    it("honors revocation from the final database claim even if an earlier context was valid",async()=>{
        mock.rpc.mockImplementation(async name=>name==="pay_recipient_minor_setup_context"?{data:context(),error:null}:{data:null,error:{message:"RECIPIENT_GUARDIAN_REQUIRED"}});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"RECIPIENT_GUARDIAN_REQUIRED"});expect(mock.session).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();
    });
    it.each([{bindingCurrent:false},{recipient:record({accountRef:"acct_other"})},{recipient:record({minorBinding:{...binding,guardianId:other}})},{recipient:record({minorBinding:{...binding,consentId:recordId}})}])("rechecks the current parent binding after account creation and before adding the bank %j",async patch=>{
        let claimed=false;
        mock.rpc.mockImplementation(async name=>{
            if(name==="pay_recipient_minor_claim"){claimed=true;return {error:null,data:claim()};}
            return {error:null,data:context(claimed?{recipient:record(),bindingCurrent:true,...patch}:{})};
        });
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"guardian_consent_required"});
        expect(mock.saveBank).not.toHaveBeenCalled();
    });
    it("rejects a claim with a different bound parent",async()=>{
        mock.rpc.mockImplementation(async name=>({data:name==="pay_recipient_minor_setup_context"?context():claim({minorBinding:{...binding,guardianId:other}}),error:null}));
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_setup_unavailable"});expect(mock.create).not.toHaveBeenCalled();
    });
    it("never publishes private parent or bank identity in the child's read projection",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:true,hasPayoutMethod:true,ready:false}),error:null});
        const result=await readMinorBankSetup(child);
        expect(result).toMatchObject({hasPayoutMethod:true,ready:false});
        expect(JSON.stringify(result)).not.toMatch(/guardianBirthdate|guardianEmail|parent@|accountRef|minorBinding/);
    });
    it("confirms a saved bank separately when identity is incomplete, without marking payouts ready",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:true}),error:null});
        mock.inspect.mockRejectedValue(new PaymentFlowError("recipient_identity_unconfirmed",409));
        expect(await readMinorBankSetup(child)).toMatchObject({hasPayoutMethod:true,ready:false});
        expect(mock.bank).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding);
        expect(mock.apply).toHaveBeenCalledExactlyOnceWith(child,expect.any(String),4,accountRef,expect.objectContaining({status:"pending",hasPayoutMethod:true,detailsSubmitted:false,transfersActive:false,payoutsEnabled:false,guardianEvidence:null,guardianReason:"guardian_kyc_required"}));
    });
    it("overrides cached readiness when the fresh Stripe identity check is incomplete",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:true,hasPayoutMethod:true,ready:true}),error:null});
        mock.inspect.mockRejectedValue(new PaymentFlowError("recipient_identity_unconfirmed",409));
        expect(await readMinorBankSetup(child)).toMatchObject({hasPayoutMethod:true,ready:false});
        expect(mock.apply).toHaveBeenCalledWith(child,expect.any(String),4,accountRef,expect.objectContaining({status:"pending",transfersActive:false,payoutsEnabled:false}));
    });
    it.each([{accountRef:"acct_replacedRecipient"},{minorBinding:{...binding,consentId:operation}},null])("does not reuse an old bank read after concurrent account or consent change %j",async patch=>{
        mock.rpc.mockResolvedValueOnce({data:context({recipient:record(),bindingCurrent:true}),error:null})
            .mockResolvedValueOnce({data:context({recipient:patch===null?null:record(patch),bindingCurrent:true}),error:null});
        mock.inspect.mockRejectedValue(new PaymentFlowError("recipient_identity_unconfirmed",409));
        mock.bank.mockResolvedValue(true);
        await expect(readMinorBankSetup(child)).rejects.toMatchObject({code:"recipient_setup_changed",status:409});
    });
    it("returns only the existing valid parent binding as an available approval",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:true,guardians:[{guardianId:parent,name:"Parent One"},{guardianId:other,name:"Parent Two"}]}),error:null});
        expect(await readMinorBankSetup(child)).toMatchObject({guardians:[{guardianId:parent,name:"Parent One"}],preferredGuardianId:parent});
    });
    it("retains multiple eligible parent choices when an unused setup needs recovery",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:false,canRestart:true,guardians:[{guardianId:parent,name:"Parent One"},{guardianId:other,name:"Parent Two"}]}),error:null});
        const result=await readMinorBankSetup(child);
        expect(result.guardians).toHaveLength(2);expect(result.needsRestart).toBe(true);expect(result.requiresGuardianAction).toBe(false);
    });
    it.each(["guardian_kyc_required","guardian_terms_required","guardian_identity_mismatch"])("makes the required parent action explicit after a bank has been saved (%s)",async guardianReason=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record({guardianReason}),bindingCurrent:true,hasPayoutMethod:true}),error:null});
        expect(await readMinorBankSetup(child)).toMatchObject({hasPayoutMethod:true,ready:false,requiresGuardianAction:true});
    });
    it("does not invent a parent action for a fully verified recipient",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record({guardianReason:null}),bindingCurrent:true,hasPayoutMethod:true,ready:true}),error:null});
        expect(await readMinorBankSetup(child)).toMatchObject({ready:true,requiresGuardianAction:false});
    });
    it("uses fresh identity incompleteness as a parent action without claiming that the bank is missing",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record({guardianReason:null}),bindingCurrent:true,hasPayoutMethod:true}),error:null});
        mock.inspect.mockRejectedValue(new PaymentFlowError("recipient_identity_unconfirmed",409));
        expect(await readMinorBankSetup(child)).toMatchObject({hasPayoutMethod:true,ready:false,requiresGuardianAction:true});
    });
    it("rejects unknown readiness values instead of converting them to success",async()=>{
        mock.rpc.mockResolvedValue({data:context({ready:"true"}),error:null});
        await expect(readMinorBankSetup(child)).rejects.toMatchObject({code:"recipient_setup_unavailable"});
    });
    it("never reads an abandoned account's bank details through a newly approved parent",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),bindingCurrent:false,canRestart:true}),error:null});
        expect(await readMinorBankSetup(child)).toMatchObject({ready:false,hasPayoutMethod:false,needsRestart:true});
        expect(mock.bank).not.toHaveBeenCalled();expect(mock.inspect).not.toHaveBeenCalled();
    });
    it("rejects mismatched private context independently of the HTTP route",async()=>{
        mock.rpc.mockResolvedValue({data:context({userId:other}),error:null});
        await expect(minorSetupContext(child,child)).rejects.toMatchObject({code:"recipient_setup_unavailable"});
    });
    it("rechecks the nested recipient owner in the final projection after reconciliation",async()=>{
        mock.rpc.mockResolvedValueOnce({data:context(),error:null}).mockResolvedValueOnce({data:context({recipient:record({userId:other})}),error:null});
        await expect(readMinorBankSetup(child)).rejects.toMatchObject({code:"recipient_setup_unavailable"});
    });
});

describe("abandoned setup replacement",()=>{
    const stale=()=>context({recipient:record({minorBinding:{...binding,guardianId:other}}),canRestart:true});
    it("requires an explicit restart before checking or replacing the earlier account",async()=>{
        mock.rpc.mockResolvedValue({data:stale(),error:null});
        await expect(startMinorBankSetup(input,child)).rejects.toMatchObject({code:"recipient_restart_consent_required"});
        expect(mock.unused).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalledWith("pay_recipient_restart_setup",expect.anything());
    });
    it("verifies the exact earlier account before a version-bound restart and reclaims the new setup",async()=>{
        let restarted=false;
        mock.rpc.mockImplementation(async name=>{
            if(name==="pay_recipient_restart_setup"){restarted=true;return {error:null,data:{ok:true,childId:child,guardianId:parent,generation:5}};}
            return {error:null,data:name==="pay_recipient_minor_setup_context"?(restarted?context({recipient:record(),bindingCurrent:true}):stale()):claim()};
        });
        await startMinorBankSetup({...input,restart:true},child);
        expect(mock.unused).toHaveBeenCalledExactlyOnceWith(child,accountRef,{...binding,guardianId:other});
        expect(mock.rpc).toHaveBeenCalledWith("pay_recipient_restart_setup",expect.objectContaining({p_actor_id:child,p_child_id:child,p_guardian_id:parent,p_expected_account_ref:accountRef,p_expected_generation:4,p_operation_id:operation,p_verified_empty:true}));
        const call=mock.rpc.mock.calls.findIndex(([name])=>name==="pay_recipient_restart_setup");
        expect(mock.unused.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[call]);
        expect(mock.saveBank).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding,bankToken,operation);
    });
    it("does not skip a stale consent just because the same parent granted a new approval",async()=>{
        mock.rpc.mockImplementation(async name=>({error:null,data:name==="pay_recipient_minor_setup_context"?context({recipient:record(),canRestart:true}):{ok:true,childId:child,guardianId:parent,generation:5}}));
        await restartUnusedMinorSetup(child,child,parent,operation);
        expect(mock.unused).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding);
        expect(mock.rpc).toHaveBeenCalledWith("pay_recipient_restart_setup",expect.anything());
    });
    it("never restarts after Stripe finds money, a bank account or verification history",async()=>{
        mock.rpc.mockResolvedValue({data:stale(),error:null});mock.unused.mockRejectedValue(new PaymentFlowError("recipient_restart_review_required",409));
        await expect(startMinorBankSetup({...input,restart:true},child)).rejects.toMatchObject({code:"recipient_restart_review_required"});
        expect(mock.rpc).not.toHaveBeenCalledWith("pay_recipient_restart_setup",expect.anything());expect(mock.create).not.toHaveBeenCalled();expect(mock.session).not.toHaveBeenCalled();
    });
    it("does not replace an active approved setup on a harmless repeated restart request",async()=>{
        mock.rpc.mockResolvedValue({data:context({recipient:record(),canRestart:false,bindingCurrent:true}),error:null});
        await restartUnusedMinorSetup(child,child,parent,operation);
        expect(mock.unused).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalledWith("pay_recipient_restart_setup",expect.anything());
    });
});

describe("minor bank HTTP boundaries",()=>{
    const request=(body:unknown={consent:true,bankToken},headers:Record<string,string>={})=>new Request("https://app.workfa.re/api/payments/recipient/bank",{method:"POST",headers:{origin:"https://app.workfa.re","content-type":"application/json","idempotency-key":operation,"x-workfare-owner":child,...headers},body:JSON.stringify(body)});
    it("returns a private noncached child setup projection",async()=>{
        const response=await GET(new Request("https://app.workfa.re/api/payments/recipient/bank",{headers:{"x-workfare-owner":child}}));
        expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toMatchObject({ownerId:child,kind:"live",ready:false});
    });
    it("requires the current UI owner and same-origin request before reading private data",async()=>{
        expect((await POST(request(undefined,{"x-workfare-owner":""}))).status).toBe(409);
        expect((await POST(request(undefined,{origin:"https://evil.invalid"}))).status).toBe(403);
        expect((await GET(new Request("https://app.workfa.re/api/payments/recipient/bank",{headers:{origin:"https://evil.invalid","x-workfare-owner":child}}))).status).toBe(403);
        expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("rejects cross-site fetch metadata and caller-supplied query state before reading family data",async()=>{
        expect((await GET(new Request("https://app.workfa.re/api/payments/recipient/bank",{headers:{"x-workfare-owner":child,"sec-fetch-site":"cross-site"}}))).status).toBe(403);
        expect((await GET(new Request("https://app.workfa.re/api/payments/recipient/bank?accountRef=acct_other",{headers:{"x-workfare-owner":child}}))).status).toBe(400);
        expect(mock.rpc).not.toHaveBeenCalled();
    });
    it.each([{accountRef:"acct_forged"},{childId:other},{ownerId:other},{ready:true},{birthdate:"1980-01-01"},{component:"account_onboarding"},{operationId:operation}])("rejects caller-supplied authority or private state %j",async extra=>{
        expect((await POST(request({consent:true,...extra}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("returns a safe bank status after the explicit child action",async()=>{
        const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({ownerId:child,kind:"live",ready:false});expect(mock.saveBank).toHaveBeenCalledExactlyOnceWith(child,accountRef,binding,bankToken,operation);
    });
    it("does not expose internal provider errors or personal data",async()=>{
        mock.saveBank.mockRejectedValue(new Error("private bank or parent identity"));
        const response=await POST(request());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toMatch(/private bank|parent identity/);
    });
});

describe("bank setup observations",()=>{
 it("does not ask the child to retry solely because another read advanced the observation generation",async()=>{
  let calls=0;mock.rpc.mockImplementation(async()=>({error:null,data:context({recipient:record({generation:++calls===1?4:5}),bindingCurrent:true,hasPayoutMethod:true,ready:false})}));
  expect(await readMinorBankSetup(child)).toMatchObject({ownerId:child,hasPayoutMethod:true});
 });
});
