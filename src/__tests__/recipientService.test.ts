import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), claimRecipientAccount: vi.fn(), saveRecipientAccount: vi.fn(), getRecipientAccount: vi.fn(),
    createRecipientLocalSession: vi.fn(), finishRecipientLocalSession: vi.fn(), getRecipientSettingsSnapshot: vi.fn(), beginRecipientSync: vi.fn(),
    applyRecipientSync: vi.fn(), findRecipientByAccount: vi.fn(), createAccount: vi.fn(), createSession: vi.fn(), inspect: vi.fn(), verifyWebhook: vi.fn(), verifySnapshotWebhook: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthState: mocks.auth }));
vi.mock("@/lib/payments/recipient-repository.server", () => mocks);
vi.mock("@/lib/payments/recipient-stripe.server", () => ({ createRecipientStripeAdapter: () => ({ createAccount: mocks.createAccount,
    createSession: mocks.createSession, inspect: mocks.inspect, verifyWebhook: mocks.verifyWebhook, verifySnapshotWebhook: mocks.verifySnapshotWebhook }) }));
import { requireRecipientUser, finishLocalRecipientSession, handleRecipientWebhook, startRecipientSession, syncRecipientStatus } from "@/lib/payments/recipient-service.server";

const user = "11111111-1111-4111-8111-111111111111";
const operation = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const visitId = "44444444-4444-4444-8444-444444444444";
const contactEmail = `demo+${visitId}.peer-seeker@example.test`;
const verified = { status: "ready", requirementCount: 0, hasPayoutMethod: true, detailsSubmitted: true, transfersActive: true, payoutsEnabled: true };
beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "local_simulation", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-recipient-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_URL: "http://127.0.0.1:55321", APP_ORIGIN: "http://localhost:3001" })) vi.stubEnv(key, value);
    mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user } }, profile: { account_type: "job_seeker", birthdate: "2009-01-01" } });
    mocks.claimRecipientAccount.mockResolvedValue({ claimed: true, accountRef: null });
    mocks.createRecipientLocalSession.mockResolvedValue({ id: sessionId, status: "pending" });
    mocks.getRecipientSettingsSnapshot.mockResolvedValue({ ...verified, kind: "local" });
    mocks.getRecipientAccount.mockResolvedValue({ userId: user, accountRef: "acct_recipientFixture" });
    mocks.createAccount.mockResolvedValue("acct_recipientFixture");
    mocks.createSession.mockResolvedValue("fixture_single_owner_secret");
    mocks.beginRecipientSync.mockResolvedValue({ generation: 7, duplicate: false, accountRef: "acct_recipientFixture" });
    mocks.inspect.mockResolvedValue(verified);
});
afterEach(() => vi.unstubAllEnvs());
function sandbox(birthdate: string | null = "2000-01-01") {
    vi.stubEnv("WORKFARE_PAY_MODE", "sandbox"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offlineFixture");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_offlineFixture");
    vi.stubEnv("WORKFARE_PAY_RECIPIENT_SANDBOX", "enabled");
    mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user, email:contactEmail,email_confirmed_at:"2026-10-24T00:00:00Z",app_metadata:{demo_session_id:visitId,demo_identity:"peer-seeker"} } }, profile: { account_type: "job_seeker", birthdate, country: "DE", full_name:"Noah Muster",email:"unverified-profile-email@example.test" } });
}

describe("recipient setup service", () => {
    it("rejects the old tab's expected owner before any recipient or Stripe operation",async()=>{
        await expect(requireRecipientUser("22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({code:"owner_mismatch",status:409});
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();expect(mocks.getRecipientAccount).not.toHaveBeenCalled();expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it("starts only a labeled local simulation for a synthetic recipient, never Stripe", async () => {
        expect(await startRecipientSession({ component: "onboarding", consent: true, operationId: operation })).toEqual({ kind: "local", sessionId, component: "onboarding" });
        expect(mocks.saveRecipientAccount).toHaveBeenCalledWith(user, "local_simulation", operation, `local_recipient_${user}`);
        expect(mocks.createAccount).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
    });
    it.each([undefined, false, "true", 1])("requires explicit onboarding consent %j", async (consent) => {
        await expect(startRecipientSession({ component: "onboarding", consent })).rejects.toMatchObject({ code: "explicit_consent_required" });
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
    });
    it.each(["no-session", "incomplete-profile", "provider", "guardian"])("rejects actors without a ready seeker role %s", async (state) => {
        mocks.auth.mockResolvedValue({ state: ["provider", "guardian"].includes(state) ? "ready" : state, session: { user: { id: user } }, profile: { account_type: "job_provider" } });
        await expect(startRecipientSession({ component: "onboarding", consent: true })).rejects.toThrow();
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
    });
    it.each(["2009-01-01", null, "invalid"])("never starts real connected-account onboarding for minors or unknown age %j", async (birthdate) => {
        sandbox(birthdate);
        await expect(startRecipientSession({ component: "onboarding", consent: true })).rejects.toMatchObject({ code: "recipient_minor_review_required" });
        expect(mocks.createAccount).not.toHaveBeenCalled(); expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
    });
    it("requires a second explicit sandbox switch before any recipient mutation", async () => {
        sandbox(); vi.stubEnv("WORKFARE_PAY_RECIPIENT_SANDBOX", undefined);
        await expect(startRecipientSession({ component: "onboarding", consent: true })).rejects.toMatchObject({ code: "recipient_sandbox_not_enabled" });
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it("never creates a German recipient account for a user from another country", async () => {
        sandbox();mocks.auth.mockResolvedValue({state:"ready",session:{user:{id:user}},profile:{account_type:"job_seeker",birthdate:"2007-01-01",country:"FR"}});
        await expect(startRecipientSession({component:"onboarding",consent:true})).rejects.toMatchObject({code:"recipient_country_not_supported"});
        expect(mocks.createAccount).not.toHaveBeenCalled();expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
    });
    it("claims and binds only server-owned Accounts v2 references for adult sandbox users", async () => {
        sandbox();
        expect(await startRecipientSession({ component: "onboarding", consent: true, operationId: operation })).toEqual({ kind: "sandbox", clientSecret: "fixture_single_owner_secret", publishableKey: "pk_test_offlineFixture", component: "onboarding" });
        expect(mocks.createAccount).toHaveBeenCalledWith(user,{contactEmail,displayName:"Noah Muster"});
        expect(mocks.saveRecipientAccount).toHaveBeenCalledWith(user, "sandbox", operation, "acct_recipientFixture");
        expect(mocks.createSession).toHaveBeenCalledWith(user, "acct_recipientFixture", "onboarding");
    });
    it("creates a live adult recipient from the private immutable claim without demo authentication", async () => {
        for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture",STRIPE_PUBLISHABLE_KEY:"pk_live_offlineFixture",WORKFARE_DEMO_ENABLED:"false",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"false",WORKFARE_DEMO_MODE:"",WORKFARE_DEMO_PROJECT_REF:"",WORKFARE_DEMO_LOCAL_URL:""})) vi.stubEnv(key,value);
        mocks.auth.mockResolvedValue({state:"ready",session:{user:{id:user}},profile:{account_type:"job_seeker",birthdate:"2007-01-01",country:"DE"}});
        mocks.claimRecipientAccount.mockResolvedValue({claimed:true,accountRef:null,prefill:{contactEmail:"private-verified@fixture.invalid",displayName:"Recipient"}});
        expect(await startRecipientSession({component:"onboarding",consent:true,operationId:operation})).toEqual({kind:"live",clientSecret:"fixture_single_owner_secret",publishableKey:"pk_live_offlineFixture",component:"onboarding"});
        expect(mocks.createAccount).toHaveBeenCalledExactlyOnceWith(user,{contactEmail:"private-verified@fixture.invalid",displayName:"Recipient"});
        expect(mocks.saveRecipientAccount).toHaveBeenCalledWith(user,"live",operation,"acct_recipientFixture");
        mocks.claimRecipientAccount.mockResolvedValue({claimed:true,accountRef:null});mocks.createAccount.mockClear();
        await expect(startRecipientSession({component:"onboarding",consent:true})).rejects.toMatchObject({code:"recipient_claim_snapshot_required",status:503});
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });

    it("does not create a second account while another operation owns the claim", async () => {
        sandbox(); mocks.claimRecipientAccount.mockResolvedValue({ claimed: false, accountRef: null });
        await expect(startRecipientSession({ component: "onboarding", consent: true })).rejects.toMatchObject({ code: "recipient_setup_in_progress" });
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it("requires confirmed Auth email before Stripe Create and never substitutes profile contact or identity details",async()=>{
        sandbox();mocks.auth.mockResolvedValue({state:"ready",session:{user:{id:user,email:"recipient@example.test",email_confirmed_at:null}},
            profile:{account_type:"job_seeker",birthdate:"2007-01-01",country:"DE",full_name:"  Noah   Muster  ",street:"Private street",zip:"53359",email:"not-auth-email@example.test"}});
        await expect(startRecipientSession({component:"onboarding",consent:true})).rejects.toMatchObject({code:"recipient_verified_email_required"});
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it.each([{}, {demo_session_id:visitId,demo_identity:"guardian"}, {demo_session_id:visitId,demo_identity:"seeker"}])("rejects contact not matching its immutable synthetic Auth binding %j",async app_metadata=>{
        sandbox();mocks.auth.mockResolvedValue({state:"ready",session:{user:{id:user,email:contactEmail,email_confirmed_at:"2026-10-24T00:00:00Z",app_metadata}},profile:{account_type:"job_seeker",birthdate:"2007-01-01",country:"DE"}});
        await expect(startRecipientSession({component:"onboarding",consent:true})).rejects.toMatchObject({code:"recipient_sandbox_identity_required"});
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it("never overwrites already bound Stripe contact details when opening management",async()=>{
        sandbox();mocks.claimRecipientAccount.mockResolvedValue({claimed:false,accountRef:"acct_recipientFixture"});
        await startRecipientSession({component:"management",consent:true});
        expect(mocks.createAccount).not.toHaveBeenCalled();expect(mocks.createSession).toHaveBeenCalledWith(user,"acct_recipientFixture","management");
    });
    it.each(["balances", "payouts_list"])("requires verified readiness for read-only %s without creating an account", async (component) => {
        sandbox();
        await startRecipientSession({ component, consent: undefined });
        expect(mocks.createSession).toHaveBeenCalledWith(user, "acct_recipientFixture", component);
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled(); expect(mocks.createAccount).not.toHaveBeenCalled();
        expect(mocks.beginRecipientSync).toHaveBeenCalledWith(user,expect.stringMatching(/^account-session:/));
        expect(mocks.inspect.mock.invocationCallOrder[0]).toBeLessThan(mocks.createSession.mock.invocationCallOrder[0]);
        mocks.getRecipientSettingsSnapshot.mockResolvedValue({ status: "pending" });
        await expect(startRecipientSession({ component, consent: undefined })).rejects.toMatchObject({ code: "recipient_setup_required" });
    });
    it("persists a fresh payout restriction before refusing a read-only financial component",async()=>{
        sandbox();mocks.getRecipientSettingsSnapshot.mockResolvedValueOnce({...verified,kind:"sandbox"}).mockResolvedValueOnce({...verified,status:"restricted",payoutsEnabled:false});
        mocks.inspect.mockResolvedValue({...verified,status:"restricted",payoutsEnabled:false});
        await expect(startRecipientSession({component:"balances",consent:undefined})).rejects.toMatchObject({code:"recipient_setup_required"});
        expect(mocks.applyRecipientSync).toHaveBeenCalledWith(user,expect.stringMatching(/^account-session:/),7,"acct_recipientFixture",expect.objectContaining({status:"restricted",payoutsEnabled:false}));
        expect(mocks.createSession).not.toHaveBeenCalled();
    });
    it.each(["pending","restricted"])("allows the submitted owner's notification banner in %s without creating or replacing an account",async status=>{
        sandbox();mocks.getRecipientSettingsSnapshot.mockResolvedValue({...verified,status,detailsSubmitted:true,requirementCount:2,kind:"sandbox"});
        mocks.inspect.mockResolvedValue({...verified,status,detailsSubmitted:true,requirementCount:2});
        expect(await startRecipientSession({component:"notification_banner",consent:undefined})).toMatchObject({kind:"sandbox",component:"notification_banner"});
        expect(mocks.createSession).toHaveBeenCalledWith(user,"acct_recipientFixture","notification_banner");
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();expect(mocks.createAccount).not.toHaveBeenCalled();
        expect(mocks.beginRecipientSync).toHaveBeenCalled();
    });
    it("does not use a notification request to create an account or skip initial onboarding",async()=>{
        sandbox();mocks.getRecipientAccount.mockResolvedValue(null);
        await expect(startRecipientSession({component:"notification_banner",consent:undefined})).rejects.toMatchObject({code:"recipient_setup_required"});
        expect(mocks.createAccount).not.toHaveBeenCalled();expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
        mocks.getRecipientAccount.mockResolvedValue({userId:user,accountRef:"acct_recipientFixture"});
        mocks.getRecipientSettingsSnapshot.mockResolvedValue({...verified,detailsSubmitted:false});
        await expect(startRecipientSession({component:"notification_banner",consent:undefined})).rejects.toMatchObject({code:"recipient_onboarding_required"});
        expect(mocks.createSession).not.toHaveBeenCalled();
    });
    it("does not pretend the local simulation has real Stripe compliance notifications",async()=>{
        await expect(startRecipientSession({component:"notification_banner",consent:undefined})).rejects.toMatchObject({code:"recipient_banner_requires_sandbox"});
        expect(mocks.createRecipientLocalSession).not.toHaveBeenCalled();expect(mocks.createSession).not.toHaveBeenCalled();
    });
    it.each(["payouts", "payments", "financial_account", null, {}, ["onboarding"]])("rejects component escalation %j", async (component) => {
        await expect(startRecipientSession({ component, consent: true })).rejects.toThrow();
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });
    it("refuses arbitrary idempotency keys before persistence", async () => {
        await expect(startRecipientSession({ component: "onboarding", consent: true, operationId: "acct_other" })).rejects.toMatchObject({ code: "invalid_operation_id" });
        expect(mocks.claimRecipientAccount).not.toHaveBeenCalled();
    });
    it("completes or cancels local setup under the authenticated owner, with fresh DB snapshot", async () => {
        expect(await finishLocalRecipientSession(sessionId, "complete")).toEqual({ ok: true, snapshot: { ...verified, kind: "local" } });
        expect(mocks.finishRecipientLocalSession).toHaveBeenCalledWith(user, sessionId, "complete");
        await finishLocalRecipientSession(sessionId, "cancel");
        expect(mocks.finishRecipientLocalSession).toHaveBeenLastCalledWith(user, sessionId, "cancel");
        sandbox();
        await expect(finishLocalRecipientSession(sessionId, "complete")).rejects.toMatchObject({ code: "local_simulation_required" });
    });
    it("never treats a UI exit as completed Stripe onboarding", async () => {
        sandbox(); await syncRecipientStatus();
        expect(mocks.inspect).toHaveBeenCalledWith(user, "acct_recipientFixture");
        expect(mocks.applyRecipientSync).toHaveBeenCalledWith(user, expect.stringMatching(/^sync:/), 7, "acct_recipientFixture", verified);
    });
    it("verifies signed events and fetches only the server-bound account afresh", async () => {
        sandbox(); mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", accountRef: "acct_recipientFixture" });
        mocks.findRecipientByAccount.mockResolvedValue({ userId: user, accountRef: "acct_recipientFixture" });
        expect(await handleRecipientWebhook("untouched-body", "signature")).toEqual({ received: true });
        expect(mocks.verifyWebhook).toHaveBeenCalledWith("untouched-body", "signature");
        expect(mocks.applyRecipientSync).toHaveBeenCalledWith(user, "evt_fixture", 7, "acct_recipientFixture", verified);
    });
    it("acknowledges unrelated accounts and duplicate deliveries without financial state changes", async () => {
        sandbox(); mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", accountRef: "acct_unknown" });
        mocks.findRecipientByAccount.mockResolvedValue(null);
        await handleRecipientWebhook("body", "signature"); expect(mocks.beginRecipientSync).not.toHaveBeenCalled();
        mocks.findRecipientByAccount.mockResolvedValue({ userId: user, accountRef: "acct_unknown" });
        mocks.beginRecipientSync.mockResolvedValue({ generation: 7, duplicate: true, accountRef: "acct_unknown" });
        await handleRecipientWebhook("body", "signature"); expect(mocks.inspect).not.toHaveBeenCalled();
    });
    it("re-reads bank removal events under the separately verified snapshot owner", async () => {
        sandbox();mocks.verifySnapshotWebhook.mockResolvedValue({ id: "evt_bank_removed", accountRef: "acct_recipientFixture" });
        mocks.findRecipientByAccount.mockResolvedValue({userId:user,accountRef:"acct_recipientFixture"});
        mocks.inspect.mockResolvedValue({...verified,status:"restricted",hasPayoutMethod:false,payoutsEnabled:false});
        await handleRecipientWebhook("raw-snapshot","snapshot-signature","snapshot");
        expect(mocks.verifyWebhook).not.toHaveBeenCalled();expect(mocks.verifySnapshotWebhook).toHaveBeenCalledWith("raw-snapshot","snapshot-signature");
        expect(mocks.applyRecipientSync).toHaveBeenCalledWith(user,"evt_bank_removed",7,"acct_recipientFixture",expect.objectContaining({hasPayoutMethod:false,payoutsEnabled:false}));
    });
});
