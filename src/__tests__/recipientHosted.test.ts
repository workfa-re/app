import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({user:vi.fn(),account:vi.fn(),link:vi.fn()}));
vi.mock("@/lib/payments/recipient-service.server",()=>({requireRecipientUser:mocks.user}));
vi.mock("@/lib/payments/recipient-repository.server",()=>({getRecipientAccount:mocks.account}));
vi.mock("@/lib/payments/recipient-stripe.server",()=>({createRecipientStripeAdapter:()=>({createHostedOnboarding:mocks.link})}));
import { createHostedConsent, readHostedConsent, hostedCookieFromHeader } from "@/lib/payments/recipient-hosted-state.server";
import { startHostedRecipient, refreshHostedRecipient } from "@/lib/payments/recipient-hosted.server";
import { POST } from "@/app/api/payments/recipient/hosted/route";
import { GET } from "@/app/api/payments/recipient/hosted/refresh/route";
const user="11111111-1111-4111-8111-111111111111",account="acct_recipientFixture",operation="22222222-2222-4222-8222-222222222222";
const secret="offline-hosted-consent-fixture-secret-value";
const origin="http://localhost:3001";
beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"sandbox",WORKFARE_PAY_RECIPIENT_SANDBOX:"enabled",STRIPE_SECRET_KEY:"sk_test_offlineFixture",WORKFARE_DEMO_ENABLED:"true",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"true",WORKFARE_DEMO_MODE:"local",WORKFARE_DEMO_PROJECT_REF:"local-recipient-tests",WORKFARE_DEMO_LOCAL_URL:"http://127.0.0.1:55321",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:55321",SUPABASE_URL:"http://127.0.0.1:55321",APP_ORIGIN:origin,WORKFARE_DEMO_RATE_SECRET:secret}))vi.stubEnv(key,value);
    mocks.user.mockResolvedValue(user);mocks.account.mockResolvedValue({accountRef:account});
    mocks.link.mockResolvedValue({url:"https://connect.stripe.com/setup/c/fixture",expiresAt:new Date(Date.now()+300_000).toISOString()});
});
afterEach(()=>vi.unstubAllEnvs());
describe("short owner-bound hosted consent",()=>{
    it("preserves only the allowlisted job return path and conceals the Stripe account reference",()=>{
        const path=`/app-home/jobs?job=${operation}`;
        const state=createHostedConsent(user,account,path,secret);
        expect(readHostedConsent(state.value,user,account,secret).returnTo).toBe(path);
        expect(Buffer.from(state.value.split('.')[0],'base64url').toString()).not.toContain(account);
    });
    it.each(["user","account","signature","expired","future"])("rejects a different %s binding without creating a provider credential",reason=>{
        const now=Date.now(),state=createHostedConsent(user,account,null,secret,now);
        expect(()=>readHostedConsent(state.value,reason==='user'?operation:user,reason==='account'?'acct_other':account,reason==='signature'?'another-secret-with-enough-characters':secret,reason==='expired'?now+601_000:reason==='future'?now-2_000:now)).toThrow();
    });
    it.each(["", "a.b", "a."+"f".repeat(64), "x".repeat(2_100)])("rejects malformed state %s",value=>expect(()=>readHostedConsent(value,user,account,secret)).toThrow());
    it("rejects duplicate cookies instead of selecting an ambiguous consent",()=>{
        expect(hostedCookieFromHeader("wf-pay-recipient-hosted=a; wf-pay-recipient-hosted=b")).toBeNull();
        expect(hostedCookieFromHeader("another=a; wf-pay-recipient-hosted=expected")).toBe("expected");
    });
});
describe("existing-recipient hosted service",()=>{
    it("requires explicit consent and never silently enrolls or creates another account",async()=>{
        await expect(startHostedRecipient({consent:false})).rejects.toMatchObject({code:"explicit_consent_required"});
        expect(mocks.account).not.toHaveBeenCalled();expect(mocks.link).not.toHaveBeenCalled();
        mocks.account.mockResolvedValue(null);
        await expect(startHostedRecipient({consent:true})).rejects.toMatchObject({code:"recipient_account_required"});
        expect(mocks.link).not.toHaveBeenCalled();
    });
    it("uses fixed origin/refresh URLs and retains the exact original job",async()=>{
        const path=`/app-home/jobs?job=${operation}`;
        const result=await startHostedRecipient({consent:true,returnTo:path,operationId:operation});
        expect(result.payload).toMatchObject({kind:"sandbox",requiresExternalBrowser:true});
        const urls=mocks.link.mock.calls[0][2];expect(urls.refreshUrl).toBe(`${origin}/api/payments/recipient/hosted/refresh`);
        expect(new URL(urls.returnUrl).searchParams.get("returnTo")).toBe(path);
        expect(new URL(urls.returnUrl).searchParams.get("recipientHosted")).toBe("returned");
        expect(mocks.account).toHaveBeenCalledWith(user,"sandbox");
    });
    it.each(["https://evil.example", "/app-home/jobs?job=wrong", "/app-home/settings/payments?success=true"])("rejects an untrusted return destination %s",async returnTo=>{
        await expect(startHostedRecipient({consent:true,returnTo})).rejects.toThrow();expect(mocks.link).not.toHaveBeenCalled();
    });
    it("will not bypass the database cohort/model assertion",async()=>{
        mocks.account.mockRejectedValue(new Error("recipient cohort unavailable"));
        await expect(startHostedRecipient({consent:true})).rejects.toThrow();expect(mocks.link).not.toHaveBeenCalled();
    });
    it("does not enable hosted links for local simulation or live keys",async()=>{
        vi.stubEnv("WORKFARE_PAY_MODE","local_simulation");
        await expect(startHostedRecipient({consent:true})).rejects.toThrow();expect(mocks.link).not.toHaveBeenCalled();
        vi.stubEnv("WORKFARE_PAY_MODE","sandbox");vi.stubEnv("STRIPE_SECRET_KEY","sk_live_refusedFixture");
        await expect(startHostedRecipient({consent:true})).rejects.toThrow();expect(mocks.link).not.toHaveBeenCalled();
    });
    it("refreshes the same owner/account only, without extending consent or claiming readiness",async()=>{
        const start=await startHostedRecipient({consent:true});mocks.link.mockClear();
        await refreshHostedRecipient(start.cookie);
        expect(mocks.link).toHaveBeenCalledWith(user,account,expect.anything(),expect.any(String));
        mocks.user.mockResolvedValue(operation);
        await expect(refreshHostedRecipient(start.cookie)).rejects.toThrow();expect(mocks.link).toHaveBeenCalledTimes(1);
    });
});
describe("hosted HTTP boundaries",()=>{
    const request=(body:unknown={consent:true},headers:Record<string,string>={})=>new Request(`${origin}/api/payments/recipient/hosted`,{method:"POST",headers:{origin,"content-type":"application/json","x-workfare-owner":"11111111-1111-4111-8111-111111111111","idempotency-key":operation,...headers},body:JSON.stringify(body)});
    it("returns a private one-time owner response and an HttpOnly consent cookie",async()=>{
        const response=await POST(request());expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
        expect(response.headers.get("set-cookie")).toContain("Max-Age=600");
        expect(await response.json()).toMatchObject({kind:"sandbox",requiresExternalBrowser:true});
    });
    it.each([{origin:"https://evil.example"},{"sec-fetch-site":"cross-site"}] as Record<string,string>[])("rejects cross-site link creation %j",async headers=>{
        expect((await POST(request({consent:true},headers))).status).toBe(403);expect(mocks.link).not.toHaveBeenCalled();
    });
    it("rejects browser-provided account IDs or destinations",async()=>{
        expect((await POST(request({consent:true,account:"acct_other",returnUrl:"https://evil.example"}))).status).toBe(400);
        expect(mocks.link).not.toHaveBeenCalled();
    });
    it("permits the genuine top-level Stripe refresh navigation, but no cross-site fetch",async()=>{
        const start=await POST(request());const cookie=start.headers.get("set-cookie")!.split(';')[0];mocks.link.mockClear();
        const url=`${origin}/api/payments/recipient/hosted/refresh`;
        const bad=await GET(new Request(url,{headers:{cookie,"sec-fetch-site":"cross-site","sec-fetch-mode":"cors","sec-fetch-dest":"empty"}}));
        expect(bad.status).toBe(403);expect(mocks.link).not.toHaveBeenCalled();
        const good=await GET(new Request(url,{headers:{cookie,"sec-fetch-site":"cross-site","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}}));
        expect(good.status).toBe(303);expect(good.headers.get("location")).toBe("https://connect.stripe.com/setup/c/fixture");expect(good.headers.get("cache-control")).toContain("no-store");
        expect(good.headers.get("set-cookie")).toBeNull();
    });
    it("does not issue a refreshed link for leaked or missing consent",async()=>{
        const response=await GET(new Request(`${origin}/api/payments/recipient/hosted/refresh`));
        expect(response.status).toBe(409);expect(mocks.link).not.toHaveBeenCalled();
    });
});
