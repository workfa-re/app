import {createHash} from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const monthlySchedule = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/recipient-payout-settings.server", () => ({ initializeRecipientMonthlySchedule: monthlySchedule }));
const api = vi.hoisted(() => ({ create: vi.fn(), update:vi.fn(),retrieve: vi.fn(), legacy: vi.fn(), external: vi.fn(), session: vi.fn(), link:vi.fn(),balance:vi.fn(),settings:vi.fn(),persons:vi.fn(),privateRecord:vi.fn(),payouts:vi.fn(),transfers:vi.fn(),charges:vi.fn(),token:vi.fn(),attach:vi.fn(),balanceTransactions:vi.fn() }));
vi.mock("@/lib/payments/recipient-repository.server",()=>({getRecipientAccount:api.privateRecord}));
vi.mock("stripe", async (original) => {
    const { default: Actual } = await original<typeof import("stripe")>();
    return { default: class extends Actual {
        constructor(...args: ConstructorParameters<typeof Actual>) {
            super(...args); this.v2.core.accounts.create = api.create; this.v2.core.accounts.update=api.update;this.v2.core.accounts.retrieve = api.retrieve;
            this.accounts.retrieve = api.legacy;this.tokens.retrieve=api.token;this.accounts.createExternalAccount=api.attach; this.accounts.listExternalAccounts = api.external; this.accountSessions.create = api.session;
            this.accounts.listPersons=api.persons; this.v2.core.accountLinks.create=api.link;
            this.balance.retrieve=api.balance;this.balanceSettings.retrieve=api.settings;this.balanceTransactions.list=api.balanceTransactions;
            this.payouts.list=api.payouts;this.transfers.list=api.transfers;this.charges.list=api.charges;
        }
    } };
});
import Stripe from "stripe";
import { createRecipientStripeAdapter } from "@/lib/payments/recipient-stripe.server";
import type { RecipientAccountPrefill } from "@/lib/payments/recipient-types";
const user = "11111111-1111-4111-8111-111111111111";
const accountRef = "acct_recipientFixture";
const env = { WORKFARE_PAY_MODE: "sandbox", WORKFARE_PAY_RECIPIENT_SANDBOX: "enabled", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
    WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-recipient-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    APP_ORIGIN: "http://localhost:3001", STRIPE_SECRET_KEY: "sk_test_offlineFixture", STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_offlineFixture", STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET: "whsec_separateSnapshotFixture" };
const metadata = { workfare_pay_user: user, workfare_pay_role: "recipient" };
const account = () => ({ id: accountRef, livemode: false, metadata, applied_configurations: ["recipient"], dashboard: "none",
    identity: { country: "de", entity_type: "individual" }, defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
    configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "active" }, payouts: { status: "active" } } } } }, requirements: { entries: [] } });
const legacy = () => ({ id: accountRef, object:"account", metadata, details_submitted: true, payouts_enabled: true });
const bank = () => ({ id: "ba_fixture", object: "bank_account", account: accountRef, currency: "eur", default_for_currency: true, status: "new" });
beforeEach(() => {
    vi.resetAllMocks(); api.create.mockResolvedValue(account());api.update.mockResolvedValue(account()); api.retrieve.mockResolvedValue(account()); api.legacy.mockResolvedValue(legacy());
    api.external.mockResolvedValue({ data: [bank()] }); api.session.mockResolvedValue({ account: accountRef, client_secret: "fixture_owner_secret", livemode: false, expires_at: 2_100_000_000 });
    api.link.mockResolvedValue({account:accountRef,livemode:false,url:"https://connect.stripe.com/setup/c/fixture",expires_at:new Date(Date.now()+300_000).toISOString(),use_case:{type:"account_onboarding"}});
    api.balance.mockResolvedValue({object:"balance",livemode:false,available:[{currency:"eur",amount:1200}],pending:[{currency:"eur",amount:3400}]});
    api.balanceTransactions.mockResolvedValue({object:"list",data:[],has_more:false});
    api.settings.mockResolvedValue({object:"balance_settings",payments:{payouts:{status:"enabled",schedule:{interval:"daily"}}}});
});
describe("narrow Accounts v2 sandbox adapter", () => {
    it("creates a recipient configuration with explicit responsibilities and stable idempotency", async () => {
        const adapter = createRecipientStripeAdapter(env);
        expect(Object.keys(adapter).sort()).toEqual(["createAccount", "createSession", "inspectUnusedSetup", "inspectBankSetup", "saveInitialBankMethod", "readNativeGuardianSetup", "saveNativeGuardianSetup", "createHostedOnboarding", "readPayoutOverview", "readBankSummary", "inspect", "verifyWebhook", "verifySnapshotWebhook"].sort());
        expect(await adapter.createAccount(user,{contactEmail:"recipient@example.test"})).toBe(accountRef);
        expect(monthlySchedule).toHaveBeenCalledWith(expect.any(Stripe),user,accountRef,"sandbox");
        const [params, opts] = api.create.mock.calls[0];
        expect(params).toMatchObject({ contact_email:"recipient@example.test", dashboard: "none", identity: { country: "de", entity_type: "individual" },
            configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
            defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } }, metadata });
        expect(params).not.toHaveProperty("type"); expect(params.configuration.recipient.capabilities.stripe_balance).not.toHaveProperty("payouts");
        expect(opts.idempotencyKey).toBe(`workfare-pay:recipient:${user}`);
    });
    it.each(["onboarding", "management"] as const)("creates only the %s component, preserving Stripe authentication and bank collection", async (component) => {
        expect(await createRecipientStripeAdapter(env).createSession(user, accountRef, component)).toBe("fixture_owner_secret");
        expect(api.session.mock.calls[0][0]).toEqual({ account: accountRef, components: { [component === "onboarding" ? "account_onboarding" : "account_management"]:
            { enabled: true, features: { external_account_collection: true, disable_stripe_user_authentication: false } } } });
    });
    it("prefills contact and display fields idempotently without setting legal identity or bank data",async()=>{
        const adapter=createRecipientStripeAdapter(env);
        const prefill={contactEmail:"recipient@example.test",displayName:"Noah Muster"};
        await adapter.createAccount(user,prefill);await adapter.createAccount(user,prefill);
        expect(api.create.mock.calls[0][0]).toHaveProperty("contact_email","recipient@example.test");
        expect(api.create.mock.calls[0][0].identity).toEqual({country:"de",entity_type:"individual"});
        expect(api.update.mock.calls[0][0]).toBe(accountRef);
        expect(api.update.mock.calls[0][1]).toEqual({display_name:"Noah Muster",include:["configuration.recipient","requirements","identity","defaults"]});
        expect(api.update.mock.calls[0][2]).toEqual(api.update.mock.calls[1][2]);
        await adapter.createAccount(user,{...prefill,displayName:"Noah Neues Profil"});
        expect(api.create.mock.calls[2][1]).toEqual(api.create.mock.calls[0][1]);
        expect(api.create.mock.calls[2][0]).toEqual(api.create.mock.calls[0][0]);
        expect(api.update.mock.calls[2][2]).not.toEqual(api.update.mock.calls[0][2]);
    });
    it("sends the required email on initial Create even when Stripe rejects missing contact before applying recipient configuration",async()=>{
        api.create.mockImplementation(async params=>{
            if(!params.contact_email) throw new Error("configuration.recipient requires contact_email");
            return account();
        });
        expect(await createRecipientStripeAdapter(env).createAccount(user,{contactEmail:"recipient@example.test"})).toBe(accountRef);
        expect(api.update).not.toHaveBeenCalled();
    });
    it("creates a hosted link only for the existing freshly owned v2 test account",async()=>{
        const urls={refreshUrl:"http://localhost:3001/api/payments/recipient/hosted/refresh",returnUrl:"http://localhost:3001/app-home/settings/payments?recipientHosted=returned"};
        const link=await createRecipientStripeAdapter(env).createHostedOnboarding(user,accountRef,urls,"operation-fixture");
        expect(link.url).toBe("https://connect.stripe.com/setup/c/fixture");
        expect(api.link.mock.calls[0]).toEqual([{account:accountRef,use_case:{type:"account_onboarding",account_onboarding:{refresh_url:urls.refreshUrl,return_url:urls.returnUrl,collection_options:{fields:"currently_due",future_requirements:"omit"}}}},
            {idempotencyKey:`workfare-pay:recipient-hosted:${user}:operation-fixture`}]);
        expect(api.create).not.toHaveBeenCalled();
        expect(api.retrieve.mock.invocationCallOrder[0]).toBeLessThan(api.link.mock.invocationCallOrder[0]);
    });
    it.each([{livemode:true},{account:"acct_other"},{expires_at:"invalid"},{expires_at:"2020-01-01T00:00:00Z"},{url:"https://evil.example/setup/steal"},{url:"http://connect.stripe.com/setup/x"},{url:"https://connect.stripe.com.evil.example/setup/x"},{url:"https://connect.stripe.com@evil.example/setup/x"}])("rejects unconfirmed or unsafe hosted responses %j",async patch=>{
        api.link.mockResolvedValue({account:accountRef,livemode:false,url:"https://connect.stripe.com/setup/c/fixture",expires_at:new Date(Date.now()+300_000).toISOString(),use_case:{type:"account_onboarding"},...patch});
        await expect(createRecipientStripeAdapter(env).createHostedOnboarding(user,accountRef,{refreshUrl:"http://localhost:3001/api/payments/recipient/hosted/refresh",returnUrl:"http://localhost:3001/app-home/settings/payments?recipientHosted=returned"},"fixture")).rejects.toThrow();
    });
    it.each(["https://outside.example/return","http://localhost:3001/other","http://localhost:3001/app-home/settings/payments?recipientHosted=returned&returnTo=https://evil.example"]) ("rejects caller-controlled hosted destinations %s",async returnUrl=>{
        await expect(createRecipientStripeAdapter(env).createHostedOnboarding(user,accountRef,{refreshUrl:"http://localhost:3001/api/payments/recipient/hosted/refresh",returnUrl},"fixture")).rejects.toThrow();
        expect(api.link).not.toHaveBeenCalled();
    });
    it("retries an unknown Create result with identical contact payload and idempotency key despite a changed display name",async()=>{
        api.create.mockRejectedValueOnce(new Error("connection interrupted after request"));
        const adapter=createRecipientStripeAdapter(env);
        await expect(adapter.createAccount(user,{contactEmail:"recipient@example.test",displayName:"Noah Muster"})).rejects.toThrow();
        await adapter.createAccount(user,{contactEmail:"recipient@example.test",displayName:"Noah Updated"});
        expect(api.create.mock.calls[1]).toEqual(api.create.mock.calls[0]);
        expect(api.update.mock.calls[0][1]).toMatchObject({display_name:"Noah Updated"});
    });
    it.each([{}, {contactEmail:"not-an-email"},{contactEmail:"recipient@example.test",displayName:"x".repeat(201)},{contactEmail:"name\n@example.test"}])("rejects absent or malformed required contact before creating an account %j",async prefill=>{
        await expect(createRecipientStripeAdapter(env).createAccount(user,prefill as RecipientAccountPrefill)).rejects.toMatchObject({code:"invalid_recipient_prefill"});
        expect(api.create).not.toHaveBeenCalled();
    });
    it("makes balances and payout history read-only without manual or instant payouts", async () => {
        const adapter = createRecipientStripeAdapter(env); await adapter.createSession(user, accountRef, "balances");
        expect(api.session.mock.calls[0][0].components).toEqual({ balances: { enabled: true, features: { external_account_collection: false, instant_payouts: false, standard_payouts: false, edit_payout_schedule: false } } });
        await adapter.createSession(user, accountRef, "payouts_list");
        expect(api.session.mock.calls[1][0].components).toEqual({ payouts_list: { enabled: true } });
    });
    it("reads the exact owned account's available and pending EUR separately without enabling unsupported retention",async()=>{
        const result=await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef);
        expect(result).toMatchObject({kind:"sandbox",currency:"eur",availableCents:1200,pendingCents:3400,schedule:"daily",stripePayoutsEnabled:true,hasPayoutMethod:true,canRequestPayout:false,canRetainBalance:false,disabledReason:"retention_monitor_required",maxHoldingDays:90});
        expect(api.balance).toHaveBeenCalledWith({},{stripeAccount:accountRef});
        expect(api.settings).toHaveBeenCalledWith({},{stripeAccount:accountRef});
        expect(JSON.stringify(result)).not.toContain(accountRef);expect(api.create).not.toHaveBeenCalled();
    });
    it("never counts pending funds as available or hides a negative EUR balance",async()=>{
        api.balance.mockResolvedValue({object:"balance",livemode:false,available:[{currency:"eur",amount:-100}],pending:[{currency:"eur",amount:25000}]});
        expect(await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).toMatchObject({availableCents:-100,pendingCents:25000,canRequestPayout:false});
    });
    it("reports an already manual schedule truthfully while still refusing retention without an operable deadline guard",async()=>{
        api.settings.mockResolvedValue({object:"balance_settings",payments:{payouts:{status:"enabled",schedule:{interval:"manual"}}}});
        expect(await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).toMatchObject({schedule:"manual",canRequestPayout:false,canRetainBalance:false,disabledReason:"retention_monitor_required"});
    });
    it("does not offer currency controls for another nonzero currency",async()=>{
        api.balance.mockResolvedValue({object:"balance",livemode:false,available:[{currency:"eur",amount:1200},{currency:"usd",amount:9000}],pending:[]});
        expect(await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).toMatchObject({availableCents:1200,disabledReason:"currency_not_supported",canRequestPayout:false});
    });
    it("uses fresh actual bank and capability state rather than cached ready claims",async()=>{
        api.external.mockResolvedValue({data:[]});
        expect(await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).toMatchObject({hasPayoutMethod:false,disabledReason:"recipient_setup_required"});
    });
    it.each([{livemode:true},{object:"payout"},{available:[{currency:"eur",amount:1.5}]},{available:[{currency:"eur",amount:Number.MAX_SAFE_INTEGER},{currency:"eur",amount:1}]}])("rejects unverified balance state %j",async patch=>{
        api.balance.mockResolvedValue({object:"balance",livemode:false,available:[],pending:[],...patch});
        await expect(createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).rejects.toThrow();
    });
    it("grants only the notification banner while preserving Stripe authentication and bank update handling",async()=>{
        const row=account();row.configuration.recipient.capabilities.stripe_balance.payouts.status="restricted";api.retrieve.mockResolvedValue(row);
        expect(await createRecipientStripeAdapter(env).createSession(user,accountRef,"notification_banner")).toBe("fixture_owner_secret");
        expect(api.session.mock.calls[0][0]).toEqual({account:accountRef,components:{notification_banner:{enabled:true,features:{external_account_collection:true,disable_stripe_user_authentication:false}}}});
    });
    it("checks capabilities again immediately before issuing a read-only session",async()=>{
        const row=account();row.configuration.recipient.capabilities.stripe_balance.payouts.status="restricted";api.retrieve.mockResolvedValue(row);
        await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"balances")).rejects.toMatchObject({code:"recipient_setup_required"});
        expect(api.session).not.toHaveBeenCalled();
    });
    it("requires both transfer and payout capabilities plus a valid payout destination", async () => {
        expect(await createRecipientStripeAdapter(env).inspect(user, accountRef)).toEqual({ status: "ready", requirementCount: 0, hasPayoutMethod: true, detailsSubmitted: true, transfersActive: true, payoutsEnabled: true });
        expect(api.retrieve.mock.calls[0][1].include).toEqual(["configuration.recipient", "requirements", "identity", "defaults"]);
        expect(api.external).toHaveBeenCalledWith(accountRef, { object: "bank_account", limit: 100 });
    });
    it.each([true,null,"false",0,undefined])("rejects a present non-false v1 livemode flag %j",async livemode=>{
        api.legacy.mockResolvedValue({...legacy(),livemode});
        await expect(createRecipientStripeAdapter(env).inspect(user,accountRef)).rejects.toThrow();
        expect(api.external).not.toHaveBeenCalled();
    });
    it.each([{id:"acct_another"},{metadata:{...metadata,workfare_pay_user:"someone_else"}},{metadata:{...metadata,workfare_pay_role:"provider"}}])("still rejects a mismatched v1 account without a mode field %j",async patch=>{
        api.legacy.mockResolvedValue({...legacy(),...patch});
        await expect(createRecipientStripeAdapter(env).inspect(user,accountRef)).rejects.toMatchObject({code:"recipient_object_mismatch"});
        expect(api.external).not.toHaveBeenCalled();
    });
    it.each([true,undefined,null])("never reads v1 account or bank state without a freshly verified v2 test flag %j",async livemode=>{
        api.retrieve.mockResolvedValue({...account(),livemode});
        await expect(createRecipientStripeAdapter(env).inspect(user,accountRef)).rejects.toThrow();
        expect(api.legacy).not.toHaveBeenCalled();expect(api.external).not.toHaveBeenCalled();
    });
    it.each(["missingPayouts", "transfersPending", "noRequirements", "noBank", "failedBank", "wrongCurrency", "notDefault", "unsubmitted", "legacyPayoutsOff", "userRequirements"])("does not falsely mark incomplete state ready: %s", async (reason) => {
        const row = account();
        if (reason === "missingPayouts") delete (row.configuration.recipient.capabilities.stripe_balance as Record<string, unknown>).payouts;
        if (reason === "transfersPending") row.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status = "pending";
        if (reason === "noRequirements") delete (row as Record<string, unknown>).requirements;
        if (reason === "noBank") api.external.mockResolvedValue({ data: [] });
        if (reason === "failedBank") api.external.mockResolvedValue({ data: [{ ...bank(), status: "errored" }] });
        if (reason === "wrongCurrency") api.external.mockResolvedValue({ data: [{ ...bank(), currency: "usd" }] });
        if (reason === "notDefault") api.external.mockResolvedValue({ data: [{ ...bank(), default_for_currency: false }] });
        if (reason === "unsubmitted") api.legacy.mockResolvedValue({ ...legacy(), details_submitted: false });
        if (reason === "legacyPayoutsOff") api.legacy.mockResolvedValue({ ...legacy(), payouts_enabled: false });
        if (reason === "userRequirements") row.requirements.entries = [{ awaiting_action_from: "user" }] as never[];
        api.retrieve.mockResolvedValue(row);
        expect((await createRecipientStripeAdapter(env).inspect(user, accountRef)).status).not.toBe("ready");
    });
    it("revokes a verified closed or deactivated recipient without trying to collect bank data", async () => {
        api.retrieve.mockResolvedValue({ ...account(), closed: true });
        expect(await createRecipientStripeAdapter(env).inspect(user, accountRef)).toMatchObject({ status: "restricted", transfersActive: false, payoutsEnabled: false });
        expect(api.external).not.toHaveBeenCalled();
        const deactivated=account();deactivated.configuration.recipient.applied=false;api.retrieve.mockResolvedValue(deactivated);
        expect((await createRecipientStripeAdapter(env).inspect(user, accountRef)).status).toBe("restricted");
    });
    it("treats missing include data as unknown instead of preserving readiness", async () => {
        api.retrieve.mockResolvedValue({ ...account(), configuration: null });
        expect(await createRecipientStripeAdapter(env).inspect(user, accountRef)).toMatchObject({ status: "pending", transfersActive: false, payoutsEnabled: false });
        expect(api.external).not.toHaveBeenCalled();
    });
    it.each([{ livemode: true }, { metadata: { ...metadata, workfare_pay_user: "other" } }, { identity: { country: "us", entity_type: "individual" } },
        { dashboard: "full" }, { defaults: null }, { configuration: null }, { closed: true }])("rejects unowned, live or unapproved account objects %j", async (patch) => {
        api.retrieve.mockResolvedValue({ ...account(), ...patch });
        await expect(createRecipientStripeAdapter(env).createSession(user, accountRef, "management")).rejects.toThrow();
        expect(api.session).not.toHaveBeenCalled();
    });
    it("rejects a live, expired or mismatched embedded owner secret", async () => {
        for (const patch of [{ livemode: true }, { account: "acct_other" }, { expires_at: 1 }]) {
            api.session.mockResolvedValue({ account: accountRef, client_secret: "fixture", livemode: false, expires_at: 2_100_000_000, ...patch });
            await expect(createRecipientStripeAdapter(env).createSession(user, accountRef, "onboarding")).rejects.toThrow();
        }
    });
    it("uses real SDK verification for thin events and ignores unrelated event families", async () => {
        const payload = JSON.stringify({ id: "evt_fixture", object: "v2.core.event", livemode: false, type: "v2.core.account[requirements].updated",
            created: "2026-10-24T00:00:00Z", related_object: { id: accountRef, type: "v2.core.account", url: `/v2/core/accounts/${accountRef}` } });
        const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_CONNECT_WEBHOOK_SECRET });
        expect(await createRecipientStripeAdapter(env).verifyWebhook(payload, header)).toEqual({ id: "evt_fixture", accountRef });
        await expect(createRecipientStripeAdapter(env).verifyWebhook(`${payload} `, header)).rejects.toMatchObject({ code: "invalid_webhook_signature" });
        const unknown = payload.replace("v2.core.account[requirements].updated", "v2.core.financial_account.updated");
        expect(await createRecipientStripeAdapter(env).verifyWebhook(unknown, Stripe.webhooks.generateTestHeaderString({ payload: unknown, secret: env.STRIPE_CONNECT_WEBHOOK_SECRET }))).toBeNull();
        const live = payload.replace('"livemode":false', '"livemode":true');
        await expect(createRecipientStripeAdapter(env).verifyWebhook(live, Stripe.webhooks.generateTestHeaderString({ payload: live, secret: env.STRIPE_CONNECT_WEBHOOK_SECRET }))).rejects.toThrow();
    });
    it.each(["person.updated","person.deleted"])("uses a signed %s only to locate the connected account for fresh guardian verification",async type=>{
        const payload=JSON.stringify({id:"evt_guardianFixture",object:"event",livemode:false,type,account:accountRef,data:{object:{id:"person_other",account:"acct_untrustedPayload",relationship:{legal_guardian:true},verification:{status:"verified"}}}});
        const signature=Stripe.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET});
        expect(await createRecipientStripeAdapter(env).verifySnapshotWebhook(payload,signature)).toEqual({id:"evt_guardianFixture",accountRef});
        expect(api.create).not.toHaveBeenCalled();expect(api.persons).not.toHaveBeenCalled();
    });
    it("verifies external-bank snapshots with their own secret and never infers account ownership from bank data", async () => {
        const payload=JSON.stringify({id:"evt_bankFixture",object:"event",livemode:false,type:"account.external_account.deleted",account:accountRef,data:{object:{...bank(),deleted:true}}});
        const sign=(body:string,secret=env.STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET)=>Stripe.webhooks.generateTestHeaderString({payload:body,secret});
        expect(await createRecipientStripeAdapter(env).verifySnapshotWebhook(payload,sign(payload))).toEqual({id:"evt_bankFixture",accountRef});
        await expect(createRecipientStripeAdapter(env).verifySnapshotWebhook(payload,sign(payload,env.STRIPE_CONNECT_WEBHOOK_SECRET))).rejects.toMatchObject({code:"invalid_webhook_signature"});
        const noAccount=payload.replace(`"account":"${accountRef}",`,"");
        expect(await createRecipientStripeAdapter(env).verifySnapshotWebhook(noAccount,sign(noAccount))).toBeNull();
        const live=payload.replace('"livemode":false','"livemode":true');
        await expect(createRecipientStripeAdapter(env).verifySnapshotWebhook(live,sign(live))).rejects.toThrow();
    });
});


describe("live guardian KYC without identity substitution",()=>{
    const childBirthdate=`${new Date().getUTCFullYear()-16}-01-01`;
    const guardianId="22222222-2222-4222-8222-222222222222",consentId="33333333-3333-4333-8333-333333333333";
    const binding={guardianId,consentId,childBirthdate,guardianBirthdate:"1980-03-12",guardianEmail:"parent@fixture.invalid",guardianName:"Paula Beispiel"};
    const liveEnv={WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture"};
    const liveAccount=()=>({...account(),livemode:true,metadata:{...metadata,workfare_pay_minor_guardian:guardianId,workfare_pay_minor_consent:consentId,workfare_pay_minor_birthdate:childBirthdate},identity:{country:"de",entity_type:"individual",individual:{given_name:"Child",surname:"Beispiel",date_of_birth:{year:Number(childBirthdate.slice(0,4)),month:1,day:1}}}});
    const person=()=>({id:"person_guardianFixture",account:accountRef,relationship:{legal_guardian:true},dob:{year:1980,month:3,day:12},email:binding.guardianEmail,first_name:"Paula",last_name:"Beispiel",verification:{status:"verified"},additional_tos_acceptances:{account:{date:Math.floor(Date.now()/1000)-60}}});
    function setup(){
        api.legacy.mockImplementation(async id=>id===null?{id:"acct_platformFixture",country:"DE"}:legacy());
        api.retrieve.mockResolvedValue(liveAccount());api.create.mockResolvedValue(liveAccount());api.update.mockResolvedValue(liveAccount());
        api.privateRecord.mockResolvedValue({userId:user,accountRef,birthdate:childBirthdate,displayName:"Child Beispiel",minorBinding:binding});
        api.persons.mockResolvedValue({object:"list",data:[person()],has_more:false});
        api.link.mockResolvedValue({account:accountRef,livemode:true,url:"https://connect.stripe.com/setup/c/guardianFixture",expires_at:new Date(Date.now()+300_000).toISOString(),use_case:{type:"account_onboarding"}});
    }
    it("creates the youth-owned account with the actual frozen youth DOB and no fabricated Stripe acceptance",async()=>{
        setup();await createRecipientStripeAdapter(liveEnv).createAccount(user,{contactEmail:"child@fixture.invalid"},binding);
        const params=api.create.mock.calls[0][0];
        expect(params.identity.individual.date_of_birth).toEqual({year:Number(childBirthdate.slice(0,4)),month:1,day:1});
        expect(params.metadata).toMatchObject({workfare_pay_user:user,workfare_pay_minor_guardian:guardianId,workfare_pay_minor_consent:consentId});
        expect(params).not.toHaveProperty("tos_acceptance");expect(params).not.toHaveProperty("additional_terms_of_service");expect(params.identity.individual).not.toHaveProperty("relationship");
    });
    it("requires a freshly verified bound adult guardian and real Stripe agreement acceptance",async()=>{
        setup();const result=await createRecipientStripeAdapter(liveEnv).inspect(user,accountRef);
        expect(result.status).toBe("ready");expect(result.guardianEvidence).toMatchObject({personRef:"person_guardianFixture"});
        expect(api.persons).toHaveBeenCalledExactlyOnceWith(accountRef,{relationship:{legal_guardian:true},limit:100});
    });
    it.each([{verification:{status:"pending"}},{relationship:{legal_guardian:false}},{account:"acct_other"},{dob:{year:2011,month:3,day:12}},{email:"different@fixture.invalid"},{first_name:"Other"},{additional_tos_acceptances:{account:{date:null}}}])("will not infer readiness from an insufficient guardian record (%j)",async patch=>{
        setup();api.persons.mockResolvedValue({object:"list",data:[{...person(),...patch}],has_more:false});
        const result=await createRecipientStripeAdapter(liveEnv).inspect(user,accountRef);
        expect(result.status).not.toBe("ready");expect(result.guardianEvidence).toBeNull();expect(result.guardianReason).not.toBeNull();
    });
    it("rejects changed youth DOB instead of treating active capabilities as complete identity proof",async()=>{
        setup();const value=liveAccount();value.identity.individual.date_of_birth.year-=1;api.retrieve.mockResolvedValue(value);
        await expect(createRecipientStripeAdapter(liveEnv).inspect(user,accountRef)).rejects.toMatchObject({code:"recipient_identity_mismatch"});
    });
    it("does not release an adult-profile route whose actual Stripe identity is a minor",async()=>{
        setup();api.privateRecord.mockResolvedValue({userId:user,accountRef,birthdate:"2007-01-01",displayName:"Adult Beispiel",minorBinding:null});
        const value={...liveAccount(),metadata};api.retrieve.mockResolvedValue(value);
        await expect(createRecipientStripeAdapter(liveEnv).inspect(user,accountRef)).rejects.toMatchObject({code:"recipient_identity_mismatch"});
    });
    it.each([{given_name:"Someone"},{surname:"Else"},{given_name:undefined},{surname:""}])("refuses changed or missing legal youth names independently of matching DOB (%j)",async patch=>{
        setup();const value=liveAccount();Object.assign(value.identity.individual,patch);api.retrieve.mockResolvedValue(value);
        await expect(createRecipientStripeAdapter(liveEnv).inspect(user,accountRef)).rejects.toMatchObject({code:patch.given_name===undefined || patch.surname==="" ? expect.stringMatching(/^recipient_identity_(?:unconfirmed|mismatch)$/) : "recipient_identity_mismatch"});
        expect(api.persons).not.toHaveBeenCalled();
    });
    it("also binds an actual adult's canonical Stripe name and DOB before readiness",async()=>{
        setup();const birthdate=`${new Date().getUTCFullYear()-19}-01-01`,value={...account(),livemode:true,identity:{country:"de",entity_type:"individual",individual:{given_name:"Adult",surname:"Beispiel",date_of_birth:{year:Number(birthdate.slice(0,4)),month:1,day:1}}}};
        api.retrieve.mockResolvedValue(value);api.privateRecord.mockResolvedValue({userId:user,accountRef,birthdate,displayName:"Adult Beispiel",minorBinding:null});
        expect((await createRecipientStripeAdapter(liveEnv).inspect(user,accountRef)).status).toBe("ready");
        value.identity.individual.surname="Other";
        await expect(createRecipientStripeAdapter(liveEnv).inspect(user,accountRef)).rejects.toMatchObject({code:"recipient_identity_mismatch"});
    });
    it("refuses financial views before guardian proof and uses only the parent-authenticated fixed hosted destinations",async()=>{
        setup();api.persons.mockResolvedValue({object:"list",data:[],has_more:false});
        await expect(createRecipientStripeAdapter(liveEnv).readPayoutOverview(user,accountRef)).rejects.toMatchObject({code:"guardian_kyc_required"});
        expect(api.balance).not.toHaveBeenCalled();
        const urls={refreshUrl:"https://app.workfa.re/api/payments/guardian/recipients/hosted/refresh",returnUrl:`https://app.workfa.re/guardian/access?recipientHosted=returned&childId=${user}`};
        await expect(createRecipientStripeAdapter(liveEnv).createHostedOnboarding(user,accountRef,urls,"operation",user)).resolves.toMatchObject({url:expect.stringContaining("connect.stripe.com/setup/")});
    });
    it("classifies an actual country/guardian API refusal without leaking its message or inventing another account",async()=>{
        setup();api.create.mockRejectedValue({code:"invalid_request",param:"identity.individual.date_of_birth",message:"Guardian unsupported for child@fixture.invalid"});
        const result=createRecipientStripeAdapter(liveEnv).createAccount(user,{contactEmail:"child@fixture.invalid"},binding);
        await expect(result).rejects.toMatchObject({code:"recipient_country_model_unsupported",status:409});
        await expect(result).rejects.not.toHaveProperty("message",expect.stringContaining("child@"));
        expect(api.create).toHaveBeenCalledOnce();
    });
});

describe("safe unused minor setup and bank-only capabilities",()=>{
    const childBirthdate=`${new Date().getUTCFullYear()-16}-01-01`;
    const guardianId="22222222-2222-4222-8222-222222222222",consentId="33333333-3333-4333-8333-333333333333";
    const binding={guardianId,consentId,childBirthdate,guardianBirthdate:"1980-03-12",guardianEmail:"parent@fixture.invalid",guardianName:"Paula Beispiel"};
    const liveEnv={WORKFARE_PAY_MODE:"live",WORKFARE_PAY_LIVE_ENABLED:"enabled",WORKFARE_PAY_LIVE_PROJECT_REF:"aaaaaaaaaaaaaaaaaaaa",WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT:"acct_platformFixture",APP_ORIGIN:"https://app.workfa.re",SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",STRIPE_SECRET_KEY:"rk_live_offlineFixture"};
    const liveAccount=()=>({...account(),livemode:true,metadata:{...metadata,workfare_pay_minor_guardian:guardianId,workfare_pay_minor_consent:consentId,workfare_pay_minor_birthdate:childBirthdate},identity:{country:"de",entity_type:"individual",individual:{date_of_birth:{year:Number(childBirthdate.slice(0,4)),month:1,day:1}}},requirements:{entries:[{awaiting_action_from:"user"}]}});
    const empty=()=>({object:"list",data:[],has_more:false});
    const zero=()=>({object:"balance",livemode:true,available:[{currency:"eur",amount:0}],pending:[]});
    function setup(){
        api.legacy.mockImplementation(async id=>id===null?{id:"acct_platformFixture",country:"DE"}:{...legacy(),details_submitted:false});
        api.retrieve.mockResolvedValue(liveAccount());api.create.mockResolvedValue(liveAccount());api.update.mockResolvedValue(liveAccount());
        api.privateRecord.mockResolvedValue({userId:user,accountRef,birthdate:childBirthdate,displayName:"Child Beispiel",minorBinding:binding});
        api.external.mockResolvedValue(empty());api.persons.mockResolvedValue(empty());api.balance.mockResolvedValue(zero());
        api.payouts.mockResolvedValue(empty());api.transfers.mockResolvedValue(empty());api.charges.mockResolvedValue(empty());
        api.session.mockImplementation(async params=>({account:accountRef,client_secret:"fixture_bank_only_secret",livemode:true,expires_at:2_100_000_000,components:params.components}));
    }
    it("authorizes a replacement only after fresh empty account, bank, identity and money-history reads",async()=>{
        setup();await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).resolves.toBeUndefined();
        expect(api.external).toHaveBeenCalledExactlyOnceWith(accountRef,{limit:1});
        expect(api.persons).toHaveBeenCalledExactlyOnceWith(accountRef,{relationship:{legal_guardian:true},limit:1});
        expect(api.balance).toHaveBeenCalledExactlyOnceWith({},{stripeAccount:accountRef});
        expect(api.payouts).toHaveBeenCalledExactlyOnceWith({limit:1},{stripeAccount:accountRef});
        expect(api.transfers).toHaveBeenCalledExactlyOnceWith({destination:accountRef,limit:1});
        expect(api.charges).toHaveBeenCalledExactlyOnceWith({limit:1},{stripeAccount:accountRef});
        expect(api.create).not.toHaveBeenCalled();expect(api.update).not.toHaveBeenCalled();expect(api.session).not.toHaveBeenCalled();
    });
    it.each(["bank","guardian","payout","transfer","charge"])("refuses replacement when %s history exists",async kind=>{
        setup();const methods={bank:api.external,guardian:api.persons,payout:api.payouts,transfer:api.transfers,charge:api.charges};
        methods[kind as keyof typeof methods].mockResolvedValue({object:"list",data:[{id:"existing_fixture"}],has_more:false});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_review_required"});
    });
    it.each(["available","pending","connect_reserved"])("refuses replacement with nonzero %s money",async key=>{
        setup();api.balance.mockResolvedValue({...zero(),[key]:[{currency:"eur",amount:key==="pending"?1:-1}]});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_review_required"});
    });
    it.each([{livemode:false},{available:null},{pending:undefined},{object:"payout"},{available:[{amount:0.5}]},{available:[{amount:NaN}]}])("refuses unknown or incompatible balance evidence %j",async patch=>{
        setup();api.balance.mockResolvedValue({...zero(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_review_required"});
    });
    it.each([{details_submitted:true},{details_submitted:undefined},{livemode:false},{id:"acct_other"}])("refuses a submitted, different or contradictory legacy account %j",async patch=>{
        setup();api.legacy.mockImplementation(async id=>id===null?{id:"acct_platformFixture",country:"DE"}:{...legacy(),details_submitted:false,...patch});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_review_required"});
    });
    it.each([{requirements:null},{requirements:{entries:[{awaiting_action_from:"stripe"}]}},{requirements:{}}])("does not interpret missing or pending verification as empty setup %j",async patch=>{
        setup();api.retrieve.mockResolvedValue({...liveAccount(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_review_required"});
    });
    it.each([{livemode:false},{metadata:{...metadata,workfare_pay_minor_guardian:"other"}},{metadata:{...metadata,workfare_pay_minor_guardian:guardianId,workfare_pay_minor_consent:"other"}},{metadata:{...metadata,workfare_pay_user:"other"}},{identity:{country:"US",entity_type:"individual"}}])("rejects wrong ownership, mode or frozen minor identity before restart %j",async patch=>{
        setup();api.retrieve.mockResolvedValue({...liveAccount(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).inspectUnusedSetup(user,accountRef,binding)).rejects.toThrow();
        expect(api.external).not.toHaveBeenCalled();
    });
    it("does not inspect real restart evidence in a sandbox adapter",async()=>{
        await expect(createRecipientStripeAdapter(env).inspectUnusedSetup(user,accountRef,binding)).rejects.toMatchObject({code:"recipient_restart_unavailable"});
        expect(api.retrieve).not.toHaveBeenCalled();
    });
    it("binds minor account idempotency to the actual consent snapshot without putting identity data in the key",async()=>{
        setup();const adapter=createRecipientStripeAdapter(liveEnv);
        await adapter.createAccount(user,{contactEmail:"child@fixture.invalid"},binding);
        await adapter.createAccount(user,{contactEmail:"child@fixture.invalid"},binding);
        await adapter.createAccount(user,{contactEmail:"child@fixture.invalid"},{...binding,consentId:"44444444-4444-4444-8444-444444444444"});
        const keys=api.create.mock.calls.map(call=>call[1].idempotencyKey);
        expect(keys[0]).toMatch(new RegExp(`^workfare-pay:minor-recipient:${user}:[a-f0-9]{32}$`));
        expect(keys[1]).toBe(keys[0]);expect(keys[2]).not.toBe(keys[0]);
        expect(keys.join(" ")).not.toMatch(/parent@|1980|Paula/);
    });
    it("reports an owned saved bank independently from legal identity or full payout readiness",async()=>{
        setup();api.external.mockResolvedValue({object:"list",data:[bank()],has_more:false});
        expect(await createRecipientStripeAdapter(liveEnv).inspectBankSetup(user,accountRef,binding)).toBe(true);
        expect(api.persons).not.toHaveBeenCalled();expect(api.balance).not.toHaveBeenCalled();
        api.external.mockResolvedValue(empty());expect(await createRecipientStripeAdapter(liveEnv).inspectBankSetup(user,accountRef,binding)).toBe(false);
    });
    it.each([{account:"acct_other"},{currency:"usd"},{default_for_currency:false},{status:"errored"}])("does not call a missing or invalid destination saved %j",async patch=>{
        setup();api.external.mockResolvedValue({object:"list",data:[{...bank(),...patch}],has_more:false});
        expect(await createRecipientStripeAdapter(liveEnv).inspectBankSetup(user,accountRef,binding)).toBe(false);
    });
    const bankToken="btok_bankFixture",operation="44444444-4444-4444-8444-444444444444";
    const bankMetadata=()=>({workfare_pay_user:user,workfare_bank_operation:operation,workfare_bank_token_hash:createHash("sha256").update(bankToken).digest("hex")});
    const savedBank=()=>({...bank(),metadata:bankMetadata()});
    const freshToken=()=>({id:bankToken,object:"token",type:"bank_account",livemode:true,used:false,bank_account:{...bank(),account:undefined,currency:"eur"}});
    function bankSetup(){
        setup();api.token.mockResolvedValue(freshToken());api.attach.mockResolvedValue(savedBank());
        api.external.mockResolvedValueOnce(empty()).mockResolvedValue({object:"list",data:[savedBank()],has_more:false});
    }
    it("adds an initial bank token to the exact child account with a stable account-scoped idempotency key",async()=>{
        bankSetup();await createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation);
        expect(api.token).toHaveBeenCalledExactlyOnceWith(bankToken);
        expect(api.attach).toHaveBeenCalledExactlyOnceWith(accountRef,{external_account:bankToken,default_for_currency:true,metadata:bankMetadata()},{idempotencyKey:`workfare-pay:initial-bank:${accountRef}`});
        expect(api.retrieve.mock.invocationCallOrder[0]).toBeLessThan(api.attach.mock.invocationCallOrder[0]);
        expect(api.external.mock.invocationCallOrder[0]).toBeLessThan(api.attach.mock.invocationCallOrder[0]);
        expect(api.create).not.toHaveBeenCalled();expect(api.update).not.toHaveBeenCalled();expect(api.session).not.toHaveBeenCalled();
        expect(api.persons).not.toHaveBeenCalled();expect(api.balance).not.toHaveBeenCalled();expect(api.payouts).not.toHaveBeenCalled();expect(api.transfers).not.toHaveBeenCalled();expect(api.charges).not.toHaveBeenCalled();
    });
    it("recognizes the same completed operation before attempting to reuse a one-time bank token",async()=>{
        setup();api.external.mockResolvedValue({object:"list",data:[savedBank()],has_more:false});
        await createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation);
        expect(api.token).not.toHaveBeenCalled();expect(api.attach).not.toHaveBeenCalled();
    });
    it.each([{metadata:{}},{metadata:{...bankMetadata(),workfare_bank_operation:"55555555-5555-4555-8555-555555555555"}},{metadata:{...bankMetadata(),workfare_bank_token_hash:"different"}}])("does not replace an existing bank with unrelated replay metadata %j",async patch=>{
        setup();api.external.mockResolvedValue({object:"list",data:[{...savedBank(),...patch}],has_more:false});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toMatchObject({code:"recipient_bank_already_saved"});
        expect(api.token).not.toHaveBeenCalled();expect(api.attach).not.toHaveBeenCalled();
    });
    it("does not change an existing payout card or make a new bank its replacement default",async()=>{
        setup();api.external.mockResolvedValue({object:"list",data:[{id:"card_existingPayout",object:"card",account:accountRef,currency:"eur",default_for_currency:true}],has_more:false});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toMatchObject({code:"recipient_bank_already_saved"});
        expect(api.external).toHaveBeenCalledExactlyOnceWith(accountRef,{limit:100});
        expect(api.token).not.toHaveBeenCalled();expect(api.attach).not.toHaveBeenCalled();expect(api.update).not.toHaveBeenCalled();
    });
    it.each([{livemode:false},{used:true},{used:undefined},{type:"card"},{object:"bank_account"},{id:"btok_another"},{bank_account:null},{bank_account:{currency:"usd"}}])("rejects actual token evidence which cannot authorize a fresh EUR bank %j",async patch=>{
        bankSetup();api.token.mockResolvedValue({...freshToken(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
        expect(api.attach).not.toHaveBeenCalled();
    });
    it.each(["tok_card","","btok_","btok_has spaces","btok_"+"a".repeat(300)])("rejects an invalid bank token before requesting Stripe %s",async value=>{
        setup();await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,value,operation)).rejects.toThrow();
        expect(api.token).not.toHaveBeenCalled();expect(api.attach).not.toHaveBeenCalled();
    });
    it.each([{livemode:false},{metadata:{...metadata,workfare_pay_minor_guardian:"other"}},{metadata:{...metadata,workfare_pay_minor_guardian:guardianId,workfare_pay_minor_consent:"other"}},{metadata:{...metadata,workfare_pay_user:"other"}},{identity:{country:"US",entity_type:"individual"}}])("checks live owner and frozen child/guardian identity before attaching a bank %j",async patch=>{
        bankSetup();api.retrieve.mockResolvedValue({...liveAccount(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
        expect(api.token).not.toHaveBeenCalled();expect(api.attach).not.toHaveBeenCalled();
    });
    it.each([{account:"acct_other"},{currency:"usd"},{default_for_currency:false},{status:"errored"},{object:"card"},{metadata:{workfare_pay_user:"other"}}])("does not confirm a contradictory attachment response %j",async patch=>{
        bankSetup();api.attach.mockResolvedValue({...savedBank(),...patch});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
    });
    it("does not confirm saving until a fresh bank list includes the actual saved destination",async()=>{
        bankSetup();api.external.mockReset().mockResolvedValue(empty());
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
        expect(api.attach).toHaveBeenCalledOnce();
    });
    it.each([{object:"list",data:[],has_more:true},{object:"list",data:[]},{object:"bank_account",data:[],has_more:false}])("refuses incomplete current destination evidence %j",async page=>{
        bankSetup();api.external.mockReset().mockResolvedValue(page);
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
        expect(api.attach).not.toHaveBeenCalled();
    });

    it.each([{userId:"someone-else"},{accountRef:"acct_other"},{minorBinding:null},{minorBinding:{...binding,consentId:"55555555-5555-4555-8555-555555555555"}}])("rechecks the current private payout binding before using a bank token %j",async patch=>{
        bankSetup();api.privateRecord.mockResolvedValue({userId:user,accountRef,birthdate:childBirthdate,displayName:"Child Beispiel",minorBinding:binding,...patch});
        await expect(createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation)).rejects.toThrow();
        expect(api.attach).not.toHaveBeenCalled();expect(api.token).not.toHaveBeenCalled();
    });
    it("does not treat a saved destination as proof that the guardian accepted Stripe's agreement",async()=>{
        bankSetup();await createRecipientStripeAdapter(liveEnv).saveInitialBankMethod(user,accountRef,binding,bankToken,operation);
        const writes=JSON.stringify(api.attach.mock.calls);
        expect(writes).not.toMatch(/tos_accept|verification|legal_guardian|transfers|payouts/);
        expect(api.update).not.toHaveBeenCalled();expect(api.session).not.toHaveBeenCalled();expect(api.persons).not.toHaveBeenCalled();
    });

});

describe("recipient bank-only management",()=>{
 const features={external_account_collection:true,disable_stripe_user_authentication:true,instant_payouts:false,standard_payouts:false,edit_payout_schedule:false};
 const bankAccount=()=>({...account(),defaults:{responsibilities:{...account().defaults.responsibilities,requirements_collector:"application"}}});
 it("issues only bank collection with payout, schedule and identity authority excluded",async()=>{
  api.retrieve.mockResolvedValue(bankAccount());api.session.mockImplementation(async(params)=>({...params,client_secret:"fixture_owner_secret",livemode:false,expires_at:2100000000}));
  expect(await createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).toBe("fixture_owner_secret");
  expect(api.session).toHaveBeenCalledExactlyOnceWith({account:accountRef,components:{payouts:{enabled:true,features}}});
  expect(api.create).not.toHaveBeenCalled(); expect(api.attach).not.toHaveBeenCalled();
 });
 it("cannot disable Stripe authentication for a different requirement collector",async()=>{
  await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).rejects.toMatchObject({code:"recipient_object_mismatch"});expect(api.session).not.toHaveBeenCalled();
 });
 it.each([{standard_payouts:true},{instant_payouts:true},{edit_payout_schedule:true},{disable_stripe_user_authentication:false},{external_account_collection:false}])("refuses a broadened or mismatched provider session %j",async patch=>{
  api.retrieve.mockResolvedValue(bankAccount());api.session.mockResolvedValue({account:accountRef,client_secret:"fixture_owner_secret",livemode:false,expires_at:2100000000,components:{payouts:{enabled:true,features:{...features,...patch}}}});
  await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).rejects.toMatchObject({code:"recipient_object_mismatch"});
 });
 it("returns only the bank label and final digits, never its IDs or full account data",async()=>{
  api.external.mockResolvedValue({object:"list",has_more:false,data:[{...bank(),bank_name:"Fixture Bank",country:"de",last4:"6789",iban:"DE0012345678901234567890",routing_number:"private",account_holder_name:"Child Fixture"}]});
  const result=await createRecipientStripeAdapter(env).readBankSummary(user,accountRef);
  expect(result).toEqual({bankName:"Fixture Bank",last4:"6789",country:"DE",currency:"eur"}); expect(JSON.stringify(result)).not.toMatch(/acct_|ba_|DE0012|routing|holder/);
 });
 it("rejects an incomplete bank list before selecting a destination",async()=>{
  api.external.mockResolvedValue({object:"list",has_more:true,data:[bank()]});await expect(createRecipientStripeAdapter(env).readBankSummary(user,accountRef)).rejects.toThrow();
 });
});

describe("verified settlement dates",()=>{
 it("shows a date only when actual pending transactions cover the entire displayed pending amount",async()=>{
  api.balanceTransactions.mockResolvedValue({object:"list",has_more:false,data:[{currency:"eur",status:"pending",net:1000,available_on:1900000000},{currency:"eur",status:"pending",net:2400,available_on:1900100000}]});
  const result=await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef);expect(result.pendingAvailableAt).toBe(new Date(1900100000000).toISOString());
  expect(api.balanceTransactions).toHaveBeenCalledWith({currency:"eur",limit:100},{stripeAccount:accountRef});
 });
 it.each([{object:"list",has_more:true,data:[]},{object:"list",has_more:false,data:[{currency:"eur",status:"pending",net:1,available_on:1900000000}]},{object:"list",has_more:false,data:[{currency:"eur",status:"pending",net:3400,available_on:null}]}])("does not guess a date from partial or malformed evidence",async transactions=>{
  api.balanceTransactions.mockResolvedValue(transactions);expect((await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).pendingAvailableAt).toBeNull();
 });
 it("keeps proven balances available when the optional date lookup fails",async()=>{
  api.balanceTransactions.mockRejectedValue(new Error("provider not available"));expect(await createRecipientStripeAdapter(env).readPayoutOverview(user,accountRef)).toMatchObject({pendingCents:3400,pendingAvailableAt:null});
 });
});

describe("bank editor isolation",()=>{
 it("refuses an otherwise valid response that grants an unrelated identity editor",async()=>{
  const row=account();api.retrieve.mockResolvedValue({...row,defaults:{responsibilities:{...row.defaults.responsibilities,requirements_collector:"application"}}});
  api.session.mockResolvedValue({account:accountRef,client_secret:"fixture_owner_secret",livemode:false,expires_at:2100000000,components:{payouts:{enabled:true,features:{external_account_collection:true,disable_stripe_user_authentication:true,instant_payouts:false,standard_payouts:false,edit_payout_schedule:false}},account_management:{enabled:true,features:{}}}});
  await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).rejects.toMatchObject({code:"recipient_object_mismatch"});
 });
});

describe("bank session model and owner guards",()=>{
 it.each(["express","collector-stripe","missing-collector","foreign-owner","live-object"])("never grants bank collection under an unverified %s setup",async cause=>{
  const row={...account(),defaults:{responsibilities:{...account().defaults.responsibilities,requirements_collector:"application"}}};
  if(cause==="express")row.dashboard="express";
  if(cause==="collector-stripe")row.defaults.responsibilities.requirements_collector="stripe";
  if(cause==="missing-collector")delete (row.defaults.responsibilities as Record<string,unknown>).requirements_collector;
  if(cause==="foreign-owner")row.metadata={...metadata,workfare_pay_user:"other"};
  if(cause==="live-object")row.livemode=true;
  api.retrieve.mockResolvedValue(row);
  await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).rejects.toThrow();expect(api.session).not.toHaveBeenCalled();
 });
 it("does not hand a minor a bank editor without matching stored guardian consent binding",async()=>{
  const row={...account(),metadata:{...metadata,workfare_pay_minor_guardian:"parent",workfare_pay_minor_consent:"consent",workfare_pay_minor_birthdate:"2010-01-01"},identity:{country:"de",entity_type:"individual",individual:{date_of_birth:{year:2010,month:1,day:1}}},defaults:{responsibilities:{...account().defaults.responsibilities,requirements_collector:"application"}}};api.retrieve.mockResolvedValue(row);
  await expect(createRecipientStripeAdapter(env).createSession(user,accountRef,"bank_management")).rejects.toMatchObject({code:"guardian_identity_mismatch"});expect(api.session).not.toHaveBeenCalled();
 });
});
