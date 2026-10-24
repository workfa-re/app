import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({user:vi.fn(),account:vi.fn(),overview:vi.fn()}));
vi.mock("@/lib/payments/recipient-service.server",()=>({requireRecipientUser:mocks.user}));
vi.mock("@/lib/payments/recipient-repository.server",()=>({getRecipientAccount:mocks.account}));
vi.mock("@/lib/payments/recipient-stripe.server",()=>({createRecipientStripeAdapter:()=>({readPayoutOverview:mocks.overview})}));
import { PaymentFlowError } from "@/lib/payments/runtime.server";
import { getRecipientPayoutOverview } from "@/lib/payments/recipient-payouts.server";
import { GET } from "@/app/api/payments/recipient/payouts/route";
const origin="http://localhost:3001",user="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"sandbox",WORKFARE_PAY_RECIPIENT_SANDBOX:"enabled",STRIPE_SECRET_KEY:"sk_test_offlineFixture",WORKFARE_DEMO_ENABLED:"true",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"true",WORKFARE_DEMO_MODE:"local",WORKFARE_DEMO_PROJECT_REF:"local-recipient-tests",WORKFARE_DEMO_LOCAL_URL:"http://127.0.0.1:55321",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:55321",SUPABASE_URL:"http://127.0.0.1:55321",APP_ORIGIN:origin}))vi.stubEnv(key,value);
    mocks.user.mockResolvedValue(user);mocks.account.mockResolvedValue({accountRef:"acct_fixture"});
    mocks.overview.mockResolvedValue({kind:"sandbox",currency:"eur",availableCents:1234,pendingCents:5678,schedule:"daily",stripePayoutsEnabled:true,hasPayoutMethod:true,canRequestPayout:false,canRetainBalance:false,disabledReason:"retention_monitor_required",maxHoldingDays:90,checkedAt:new Date().toISOString()});
});
afterEach(()=>vi.unstubAllEnvs());
describe("recipient payout overview",()=>{
    it("derives the account only from the authenticated user and private cohort-checked repository",async()=>{
        expect(await getRecipientPayoutOverview()).toMatchObject({availableCents:1234,pendingCents:5678,canRequestPayout:false});
        expect(mocks.account).toHaveBeenCalledWith(user,"sandbox");expect(mocks.overview).toHaveBeenCalledWith(user,"acct_fixture");
    });
    it.each(["local_simulation","disabled"])("does not invent real balances in %s",async mode=>{
        vi.stubEnv("WORKFARE_PAY_MODE",mode);await expect(getRecipientPayoutOverview()).rejects.toThrow();expect(mocks.overview).not.toHaveBeenCalled();
    });
    it("does not create a missing account",async()=>{
        mocks.account.mockResolvedValue(null);await expect(getRecipientPayoutOverview()).rejects.toMatchObject({code:"recipient_account_required"});expect(mocks.overview).not.toHaveBeenCalled();
    });
    it("preserves model/cohort and authentication refusals",async()=>{
        mocks.user.mockRejectedValue(new Error("not an adult recipient"));await expect(getRecipientPayoutOverview()).rejects.toThrow();expect(mocks.account).not.toHaveBeenCalled();
        mocks.user.mockResolvedValue(user);mocks.account.mockRejectedValue(new Error("not in sandbox cohort"));await expect(getRecipientPayoutOverview()).rejects.toThrow();expect(mocks.overview).not.toHaveBeenCalled();
    });
    it("returns no-store owner information and rejects all caller account/query input",async()=>{
        const response=await GET(new Request(`${origin}/api/payments/recipient/payouts`,{headers:{"sec-fetch-site":"same-origin","x-workfare-owner":user}}));
        expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toMatchObject({canRequestPayout:false});
        mocks.overview.mockClear();expect((await GET(new Request(`${origin}/api/payments/recipient/payouts?account=acct_other`))).status).toBe(400);expect(mocks.overview).not.toHaveBeenCalled();
    });
    it("refuses a missing UI owner before financial reads",async()=>{
        const response=await GET(new Request(`${origin}/api/payments/recipient/payouts`));
        expect(response.status).toBe(409);expect(mocks.overview).not.toHaveBeenCalled();expect(mocks.account).not.toHaveBeenCalled();
    });
    it("preserves an authenticated owner mismatch before Stripe or account reads",async()=>{
        mocks.user.mockRejectedValue(new PaymentFlowError("owner_mismatch",409));
        const response=await GET(new Request(`${origin}/api/payments/recipient/payouts`,{headers:{"x-workfare-owner":"22222222-2222-4222-8222-222222222222"}}));
        expect(response.status).toBe(409);expect(mocks.user).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222",true);
        expect(mocks.account).not.toHaveBeenCalled();expect(mocks.overview).not.toHaveBeenCalled();
    });
    it.each([{origin:"https://evil.example"},{"sec-fetch-site":"cross-site"}] as Record<string,string>[])("rejects cross-site access %j",async headers=>{
        expect((await GET(new Request(`${origin}/api/payments/recipient/payouts`,{headers}))).status).toBe(403);expect(mocks.overview).not.toHaveBeenCalled();
    });
    it("does not serialize provider data or replace provider errors with a fake zero balance",async()=>{
        mocks.overview.mockRejectedValue(new Error("private provider account and bank data"));
        const response=await GET(new Request(`${origin}/api/payments/recipient/payouts`,{headers:{"x-workfare-owner":user}}));expect(response.status).toBe(503);
        const body=await response.text();expect(body).not.toContain("private provider");expect(body).not.toContain("availableCents");
    });
});
