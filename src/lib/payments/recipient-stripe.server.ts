import "server-only";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import type { PaymentsEnvironment } from "./config";
import { requirePaymentRuntime, PaymentFlowError } from "./runtime.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import type { PaymentMode } from "./types";
import { isRecipientSandboxEnabled } from "./recipient-config";
import type { RecipientAccountPrefill, RecipientComponent, VerifiedRecipientState } from "./recipient-types";
import { sanitizeRecipientReturnPath } from "./recipient-return-path";
import type { RecipientPayoutOverview } from "./recipient-types";
import type { RecipientMinorBinding } from "./recipient-minor-types";
import { getRecipientAccount } from "./recipient-repository.server";
import { guardianEvidenceFromPersons, guardianEvidenceFromV2Persons, minorStripeBirthdate, minorProviderError, stripeBirthdate } from "./recipient-guardian-evidence.server";
import { ageInBerlin } from "@/lib/age";
import { createNativeGuardianStripeAdapter } from "./recipient-native-guardian.server";
import { summarizeRecipientBank } from "./recipient-bank-summary";

const accountId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const reject = (): never => { throw new PaymentFlowError("recipient_object_mismatch", 409); };
const include: Stripe.V2.Core.AccountRetrieveParams["include"] = ["configuration.recipient", "requirements", "identity", "defaults"];

function assertAccountOwner(account: Stripe.V2.Core.Account, userId: string, expectedId?: string, mode: PaymentMode = "sandbox") {
    assertStripeModeObject(account, mode);
    if ((expectedId && account.id !== expectedId) || !/^acct_[a-zA-Z0-9]+$/.test(account.id)
        || account.metadata?.workfare_pay_user !== userId || account.metadata?.workfare_pay_role !== "recipient") reject();
}
function assertOwnedAccount(account: Stripe.V2.Core.Account, userId: string, expectedId?: string, mode: PaymentMode = "sandbox") {
    assertAccountOwner(account, userId, expectedId, mode);
    if (account.closed
        || account.identity?.country?.toUpperCase() !== "DE" || account.identity?.entity_type !== "individual"
        || account.dashboard !== "none" || account.defaults?.responsibilities?.fees_collector !== "application"
        || account.defaults?.responsibilities?.losses_collector !== "application"
        || !account.applied_configurations.includes("recipient") || account.configuration?.recipient?.applied !== true) reject();
}

/** Mode-bound recipient onboarding and read-only financial components. */
export function createRecipientStripeAdapter(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    if (runtime.mode === "local_simulation" || (runtime.mode === "sandbox" && !isRecipientSandboxEnabled(environment))) {
        throw new PaymentFlowError("recipient_sandbox_not_enabled", 503);
    }
    const mode = runtime.mode;
    const sdk = paymentStripeSdk(environment);
    async function retrieve(userId: string, accountRef: string) {
        const account = await (await sdk()).v2.core.accounts.retrieve(accountRef, { include });
        assertOwnedAccount(account, userId, accountRef, mode);
        return account;
    }
    async function verifyGuardian(account: Stripe.V2.Core.Account, userId: string, explicit?: RecipientMinorBinding | null, requireIdentity=false) {
        const birthdate=stripeBirthdate(account.identity?.individual?.date_of_birth);
        const metadataGuardian=account.metadata?.workfare_pay_minor_guardian;
        const isMinor=metadataGuardian || (birthdate && (ageInBerlin(birthdate) ?? 0)<18);
        if (!isMinor && !(mode==="live" && requireIdentity)) return null;
        const stored=mode==="live" ? await getRecipientAccount(userId,mode) : null;
        if (mode==="live") {
            const individual=account.identity?.individual;
            if (!stored || stored.userId!==userId || stored.accountRef!==account.id) throw new PaymentFlowError("recipient_identity_mismatch",409);
            if (!stored.birthdate || !birthdate || !stored.displayName || !individual?.given_name?.trim() || !individual.surname?.trim()) {
                throw new PaymentFlowError("recipient_identity_unconfirmed",409);
            }
            const normalize=(name:string)=>name.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("de-DE");
            if (birthdate!==stored.birthdate || normalize(`${individual.given_name} ${individual.surname}`)!==normalize(stored.displayName)) {
                throw new PaymentFlowError("recipient_identity_mismatch",409);
            }
        }
        if (!isMinor) return null;
        const binding=stored?.minorBinding ?? explicit;
        if (!binding || (stored && (stored.userId!==userId || stored.accountRef!==account.id))
            || metadataGuardian!==binding.guardianId || account.metadata?.workfare_pay_minor_consent!==binding.consentId
            || account.metadata?.workfare_pay_minor_birthdate!==binding.childBirthdate || birthdate!==binding.childBirthdate) {
            return {evidence:null,reason:"guardian_identity_mismatch" as const};
        }
        const persons=await (await sdk()).accounts.listPersons(account.id,{relationship:{legal_guardian:true},limit:100});
        const legacy = guardianEvidenceFromPersons(persons,account.id,binding);
        if (legacy.evidence || mode !== "live" || !account.identity?.attestations?.terms_of_service?.account?.date
            || !Array.isArray(account.requirements?.entries) || account.requirements.entries.length > 0) return legacy;
        const v2Persons = await (await sdk()).v2.core.accounts.persons.list(account.id,{limit:20});
        return guardianEvidenceFromV2Persons(v2Persons,account,binding);
    }
    async function inspect(userId: string, accountRef: string, minor?: RecipientMinorBinding | null): Promise<VerifiedRecipientState> {
            const stripe = await sdk();
            const account = await stripe.v2.core.accounts.retrieve(accountRef, { include });
            assertAccountOwner(account, userId, accountRef, mode);
            const unavailable = (status: "pending" | "restricted"): VerifiedRecipientState => ({ status, requirementCount: 0,
                hasPayoutMethod: false, detailsSubmitted: false, transfersActive: false, payoutsEnabled: false });
            if (account.closed) return unavailable("restricted");
            if (!account.configuration?.recipient || !account.identity || !account.defaults) return unavailable("pending");
            if (!account.configuration.recipient.applied || account.identity.country?.toUpperCase() !== "DE"
                || account.identity.entity_type !== "individual" || account.dashboard !== "none"
                || account.defaults.responsibilities?.fees_collector !== "application"
                || account.defaults.responsibilities?.losses_collector !== "application") return unavailable("restricted");
            const legacy = await stripe.accounts.retrieve(accountRef);
            // Accounts v1 has no livemode field in its schema. Its missing flag
            // is safe only after the fresh, owned v2 test-account verification
            // above, using this same SDK instance and captured test-key context.
            if ("livemode" in legacy) assertStripeModeObject(legacy, mode);
            if (legacy.id !== accountRef || legacy.metadata?.workfare_pay_user !== userId || legacy.metadata?.workfare_pay_role !== "recipient") reject();
            const external = await stripe.accounts.listExternalAccounts(accountRef, { object: "bank_account", limit: 100 });
            const hasPayoutMethod = external.data.some((item) => item.object === "bank_account" && item.currency === "eur"
                && item.default_for_currency === true && ["new", "validated", "verified"].includes(item.status)
                && (!item.account || accountId(item.account) === accountRef));
            const capability = account.configuration?.recipient?.capabilities?.stripe_balance;
            const transfersActive = capability?.stripe_transfers?.status === "active";
            const payoutsEnabled = capability?.payouts?.status === "active" && legacy.payouts_enabled === true;
            const detailsSubmitted = legacy.details_submitted === true;
            // Missing include-dependent fields are unknown, never evidence of readiness.
            const entries = account.requirements?.entries;
            const requirementCount = entries ? entries.filter((entry) => entry.awaiting_action_from === "user").length : 0;
            const restricted = [capability?.stripe_transfers?.status, capability?.payouts?.status].some((value) => ["rejected", "restricted", "unsupported"].includes(value ?? ""));
            const status = !entries ? "pending" : restricted ? "restricted"
                : transfersActive && payoutsEnabled && hasPayoutMethod && detailsSubmitted && requirementCount === 0 ? "ready"
                : detailsSubmitted ? "pending" : "onboarding";
            const guardian=await verifyGuardian(account,userId,minor,status==="ready");
            return { status:guardian && !guardian.evidence && status==="ready" ? "pending" : status, requirementCount, hasPayoutMethod, detailsSubmitted, transfersActive, payoutsEnabled,
                ...(guardian ? {guardianEvidence:guardian.evidence,guardianReason:guardian.reason} : {}) };
        }
    const nativeGuardian = createNativeGuardianStripeAdapter({ mode, sdk, retrieve, inspect });
    return Object.freeze({
        async createAccount(userId: string, prefill: RecipientAccountPrefill, minor?: RecipientMinorBinding) {
            if (minor && mode!=="live") throw new PaymentFlowError("recipient_minor_live_required",409);
            const minorDob=minor ? minorStripeBirthdate(minor) : null;
            try {
            if (!prefill || (typeof prefill.contactEmail !== "string" || prefill.contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefill.contactEmail) || /[\u0000-\u001f\u007f]/.test(prefill.contactEmail))
                || (prefill.displayName !== undefined && (typeof prefill.displayName !== "string" || prefill.displayName.length < 1 || prefill.displayName.length > 200 || /[\u0000-\u001f\u007f]/.test(prefill.displayName)))) {
                throw new PaymentFlowError("invalid_recipient_prefill");
            }
            const account = await (await sdk()).v2.core.accounts.create({
                contact_email: prefill.contactEmail,
                identity: { country: "de", entity_type: "individual", ...(minorDob ? { individual: { date_of_birth: minorDob } } : {}) }, dashboard: "none",
                defaults: { currency: "eur", locales: ["de-DE"], responsibilities: { fees_collector: "application", losses_collector: "application" } },
                configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
                metadata: { workfare_pay_user: userId, workfare_pay_role: "recipient", ...(minor ? {workfare_pay_minor_guardian:minor.guardianId,workfare_pay_minor_consent:minor.consentId,workfare_pay_minor_birthdate:minor.childBirthdate} : {}) }, include,
            }, { idempotencyKey: minor
                ? `workfare-pay:minor-recipient:${userId}:${createHash("sha256").update(JSON.stringify(minor)).digest("hex").slice(0,32)}`
                : `workfare-pay:recipient:${userId}` });
            assertOwnedAccount(account, userId, undefined, mode);
            if (prefill.displayName) {
                // The issued contact email is immutable in this sandbox. Keep
                // mutable display names out of Create's idempotency payload.
                const update = { display_name: prefill.displayName, include };
                const fingerprint = createHash("sha256").update(JSON.stringify(update)).digest("hex");
                const updated = await (await sdk()).v2.core.accounts.update(account.id, update,
                    { idempotencyKey: `workfare-pay:recipient-contact:${userId}:${fingerprint}` });
                assertOwnedAccount(updated, userId, account.id, mode);
            }
            const { initializeRecipientMonthlySchedule } = await import("./recipient-payout-settings.server");
            await initializeRecipientMonthlySchedule(await sdk(), userId, account.id, mode);
            return account.id;
            } catch(error) { if (minor) minorProviderError(error); throw error; }
        },
        async createSession(userId: string, accountRef: string, component: RecipientComponent, options?: { guardianVerification: true }) {
            const account = await retrieve(userId, accountRef);
            const guardianVerification = options?.guardianVerification === true;
            if (guardianVerification && (component !== "onboarding" || !account.metadata?.workfare_pay_minor_guardian
                || account.defaults?.responsibilities?.requirements_collector !== "application")) reject();
            if (component === "balances" || component === "payouts_list" || component === "bank_management") {
                const guardian=await verifyGuardian(account,userId,undefined,true);
                if (guardian && !guardian.evidence) throw new PaymentFlowError(guardian.reason ?? "guardian_kyc_required",409);
                const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
                if (balance?.stripe_transfers?.status !== "active" || balance?.payouts?.status !== "active"
                    || !account.requirements?.entries || account.requirements.entries.some(entry => entry.awaiting_action_from === "user")) {
                    throw new PaymentFlowError("recipient_setup_required", 409);
                }
            }
            if (component === "bank_management" && account.defaults?.responsibilities?.requirements_collector !== "application") reject();
            const features = { external_account_collection: !guardianVerification, disable_stripe_user_authentication: guardianVerification };
            const components: Stripe.AccountSessionCreateParams.Components = component === "onboarding"
                ? { account_onboarding: { enabled: true, features } }
                : component === "management" ? { account_management: { enabled: true, features } }
                : component === "bank_management" ? { payouts: { enabled: true, features: { external_account_collection: true,
                    disable_stripe_user_authentication: true, instant_payouts: false, standard_payouts: false, edit_payout_schedule: false } } }
                : component === "balances" ? { balances: { enabled: true, features: { external_account_collection: false, instant_payouts: false, standard_payouts: false, edit_payout_schedule: false } } }
                : component === "notification_banner" ? { notification_banner: { enabled: true, features } }
                : { payouts_list: { enabled: true } };
            const session = await (await sdk()).accountSessions.create({ account: accountRef, components });
            assertStripeModeObject(session, mode);
            if (session.account !== accountRef || !session.client_secret || session.expires_at <= Date.now() / 1_000) reject();
            if (guardianVerification && (session.components?.account_onboarding?.enabled !== true
                || session.components.account_onboarding.features.disable_stripe_user_authentication !== true
                || session.components.account_onboarding.features.external_account_collection !== false)) reject();
            if (component === "bank_management") {
                const bank = session.components?.payouts;
                if (!bank?.enabled || bank.features.external_account_collection !== true || bank.features.disable_stripe_user_authentication !== true
                    || bank.features.instant_payouts !== false || bank.features.standard_payouts !== false || bank.features.edit_payout_schedule !== false
                    || Object.entries(session.components).some(([name, value]) => name !== "payouts" && value.enabled)) reject();
            }
            // A single-user client secret is returned only to the authenticated owner.
            return session.client_secret;
        },
        async inspectUnusedSetup(userId:string,accountRef:string,binding:RecipientMinorBinding):Promise<void> {
            if(mode!=="live")throw new PaymentFlowError("recipient_restart_unavailable",409);
            const account=await retrieve(userId,accountRef);
            if(account.metadata?.workfare_pay_minor_guardian!==binding.guardianId
                || account.metadata?.workfare_pay_minor_consent!==binding.consentId
                || account.metadata?.workfare_pay_minor_birthdate!==binding.childBirthdate
                || stripeBirthdate(account.identity?.individual?.date_of_birth)!==binding.childBirthdate)reject();
            const stripe=await sdk();
            const [legacy,banks,guardians,balance,payouts,transfers,charges]=await Promise.all([
                stripe.accounts.retrieve(accountRef),
                stripe.accounts.listExternalAccounts(accountRef,{limit:1}),
                stripe.accounts.listPersons(accountRef,{relationship:{legal_guardian:true},limit:1}),
                stripe.balance.retrieve({}, {stripeAccount:accountRef}),
                stripe.payouts.list({limit:1},{stripeAccount:accountRef}),
                stripe.transfers.list({destination:accountRef,limit:1}),
                stripe.charges.list({limit:1},{stripeAccount:accountRef}),
            ]);
            const empty=(page:{object:string;data:unknown[];has_more:boolean})=>page.object==="list"&&page.data.length===0&&page.has_more===false;
            const zero=(entries:{amount:number}[]|undefined)=>Array.isArray(entries)&&entries.length<=100&&entries.every(entry=>Number.isSafeInteger(entry.amount)&&entry.amount===0);
            if(legacy.id!==accountRef||("livemode" in legacy&&legacy.livemode!==true)||legacy.details_submitted!==false||!empty(banks)||!empty(guardians)
                ||balance.object!=="balance"||balance.livemode!==true||!zero(balance.available)||!zero(balance.pending)
                ||(balance.connect_reserved!==undefined&&!zero(balance.connect_reserved))
                ||!empty(payouts)||!empty(transfers)||!empty(charges)
                ||!Array.isArray(account.requirements?.entries)
                ||account.requirements.entries.some(entry=>entry.awaiting_action_from!=="user")) {
                throw new PaymentFlowError("recipient_restart_review_required",409);
            }
        },
        async inspectBankSetup(userId:string,accountRef:string,binding:RecipientMinorBinding):Promise<boolean>{
            const account=await retrieve(userId,accountRef);
            if(mode!=="live"||account.metadata?.workfare_pay_minor_guardian!==binding.guardianId
                ||account.metadata?.workfare_pay_minor_consent!==binding.consentId
                ||account.metadata?.workfare_pay_minor_birthdate!==binding.childBirthdate
                ||stripeBirthdate(account.identity?.individual?.date_of_birth)!==binding.childBirthdate)reject();
            const banks=await (await sdk()).accounts.listExternalAccounts(accountRef,{object:"bank_account",limit:100});
            if(banks.object!=="list"||banks.has_more!==false||banks.data.length>100)reject();
            return banks.data.some(bank=>bank.object==="bank_account"&&accountId(bank.account)===accountRef&&bank.currency==="eur"
                &&bank.default_for_currency===true&&["new","validated","verified"].includes(bank.status??""));
        },
        async readBankSummary(userId: string, accountRef: string, minor?: RecipientMinorBinding | null) {
            const account = await retrieve(userId, accountRef);
            // A masked read also works while KYC is pending. It grants no bank
            // editor or financial authority; its caller authenticates the child
            // or the current linked parent before passing the stored binding.
            if (account.metadata?.workfare_pay_minor_guardian) {
                const binding = minor ?? (await getRecipientAccount(userId, mode))?.minorBinding;
                if (!binding || account.metadata.workfare_pay_minor_guardian !== binding.guardianId
                    || account.metadata.workfare_pay_minor_consent !== binding.consentId
                    || account.metadata.workfare_pay_minor_birthdate !== binding.childBirthdate) reject();
            }
            const banks = await (await sdk()).accounts.listExternalAccounts(accountRef, { object: "bank_account", limit: 100 });
            if (banks.object !== "list" || banks.has_more || !Array.isArray(banks.data) || banks.data.length > 100) reject();
            const defaults = banks.data.filter(bank => bank.object === "bank_account" && accountId(bank.account) === accountRef
                && bank.currency === "eur" && bank.default_for_currency === true && ["new", "validated", "verified"].includes(bank.status));
            if (defaults.length > 1) reject();
            return defaults.length === 1 ? summarizeRecipientBank(defaults[0], accountRef) : null;
        },
        async saveInitialBankMethod(userId:string,accountRef:string,binding:RecipientMinorBinding,bankToken:string,operationId:string):Promise<void>{
            if(mode!=="live"||!/^btok_[A-Za-z0-9]{1,200}$/.test(bankToken)
                ||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(operationId)) {
                throw new PaymentFlowError("recipient_bank_token_invalid");
            }
            const account=await retrieve(userId,accountRef);
            const stored=await getRecipientAccount(userId,mode);
            const sameBinding=(candidate:RecipientMinorBinding|null|undefined)=>!!candidate
                &&Object.entries(binding).every(([key,value])=>candidate[key as keyof RecipientMinorBinding]===value);
            if(!stored||stored.userId!==userId||stored.accountRef!==accountRef||!sameBinding(stored.minorBinding)
                ||account.metadata?.workfare_pay_minor_guardian!==binding.guardianId
                ||account.metadata?.workfare_pay_minor_consent!==binding.consentId
                ||account.metadata?.workfare_pay_minor_birthdate!==binding.childBirthdate
                ||stripeBirthdate(account.identity?.individual?.date_of_birth)!==binding.childBirthdate)reject();
            const stripe=await sdk();
            const tokenHash=createHash("sha256").update(bankToken).digest("hex");
            const matches=(bank:Stripe.ExternalAccount)=>bank.object==="bank_account"&&accountId(bank.account)===accountRef
                &&bank.currency==="eur"&&bank.default_for_currency===true&&["new","validated","verified"].includes(bank.status)
                &&bank.metadata?.workfare_pay_user===userId&&bank.metadata?.workfare_bank_operation===operationId
                &&bank.metadata?.workfare_bank_token_hash===tokenHash;
            const list=async()=>{
                const banks=await stripe.accounts.listExternalAccounts(accountRef,{limit:100});
                if(banks.object!=="list"||banks.has_more!==false||banks.data.length>100
                    ||banks.data.some(bank=>!["bank_account","card"].includes(bank.object)||accountId(bank.account)!==accountRef))reject();
                return banks.data;
            };
            // Reconcile a lost success response before inspecting the single-use
            // token. Never replace an existing bank through this initial setup.
            const existing=await list();
            if(existing.length){
                if(existing.length===1&&matches(existing[0]))return;
                throw new PaymentFlowError("recipient_bank_already_saved",409);
            }
            const token=await stripe.tokens.retrieve(bankToken);
            assertStripeModeObject(token,mode);
            if(token.object!=="token"||token.id!==bankToken||token.type!=="bank_account"||token.used!==false
                ||token.bank_account?.object!=="bank_account"||token.bank_account.currency!=="eur") {
                throw new PaymentFlowError("recipient_bank_token_invalid");
            }
            const saved=await stripe.accounts.createExternalAccount(accountRef,{
                external_account:bankToken,default_for_currency:true,
                metadata:{workfare_pay_user:userId,workfare_bank_operation:operationId,workfare_bank_token_hash:tokenHash},
            },{idempotencyKey:`workfare-pay:initial-bank:${accountRef}`});
            if(!matches(saved))throw new PaymentFlowError("recipient_bank_unconfirmed",409);
            const confirmed=await list();
            if(confirmed.length!==1||confirmed[0].id!==saved.id||!matches(confirmed[0]))throw new PaymentFlowError("recipient_bank_unconfirmed",409);
        },
        ...nativeGuardian,
        async createHostedOnboarding(userId: string, accountRef: string, urls: { refreshUrl: string; returnUrl: string }, operationId: string, guardianChildId?: string) {
            await retrieve(userId, accountRef);
            const origin = requirePaymentRuntime(environment).origin;
            for (const value of [urls.refreshUrl, urls.returnUrl]) {
                const target = new URL(value);
                if (target.origin !== origin || target.username || target.password || target.hash) reject();
            }
            const refresh = new URL(urls.refreshUrl), returned = new URL(urls.returnUrl);
            if (guardianChildId ? (refresh.pathname!=="/api/payments/guardian/recipients/hosted/refresh" || refresh.search || returned.pathname!=="/guardian/access"
                || returned.searchParams.get("recipientHosted")!=="returned" || returned.searchParams.get("childId")!==guardianChildId
                || [...returned.searchParams.keys()].some(key=>!["recipientHosted","childId"].includes(key)) || returned.searchParams.size!==2) : (refresh.pathname !== "/api/payments/recipient/hosted/refresh" || refresh.search
                || returned.pathname !== "/app-home/settings/payments" || returned.searchParams.getAll("recipientHosted").length !== 1
                || returned.searchParams.get("recipientHosted") !== "returned"
                || [...returned.searchParams.keys()].some(key => !["recipientHosted", "returnTo"].includes(key))
                || returned.searchParams.getAll("returnTo").length > 1
                || (returned.searchParams.has("returnTo") && !sanitizeRecipientReturnPath(returned.searchParams.get("returnTo"))))) reject();
            const link = await (await sdk()).v2.core.accountLinks.create({ account: accountRef,
                use_case: { type: "account_onboarding", account_onboarding: { refresh_url: urls.refreshUrl, return_url: urls.returnUrl,
                    collection_options: { fields: "currently_due", future_requirements: "omit" } } },
            }, { idempotencyKey: `workfare-pay:recipient-hosted:${userId}:${operationId}` });
            assertStripeModeObject(link, mode);
            let target: URL;
            try { target = new URL(link.url); } catch { return reject(); }
            const expiresAt = Date.parse(link.expires_at);
            if (link.account !== accountRef || link.use_case.type !== "account_onboarding"
                || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 30 * 60_000
                || target.protocol !== "https:" || target.hostname !== "connect.stripe.com" || target.port || target.username || target.password
                || !target.pathname.startsWith("/setup/") || target.hash || link.url.length > 4_096) reject();
            return { url: link.url, expiresAt: link.expires_at };
        },
        async readPayoutOverview(userId: string, accountRef: string, minor?: RecipientMinorBinding | null): Promise<RecipientPayoutOverview> {
            const account = await retrieve(userId, accountRef);
            const guardian = await verifyGuardian(account,userId,minor,true);
            if (guardian && !guardian.evidence) throw new PaymentFlowError(guardian.reason ?? "guardian_kyc_required",409);
            const stripe = await sdk();
            const [balance, settings, legacy, external] = await Promise.all([
                stripe.balance.retrieve({}, { stripeAccount: accountRef }),
                stripe.balanceSettings.retrieve({}, { stripeAccount: accountRef }),
                stripe.accounts.retrieve(accountRef),
                stripe.accounts.listExternalAccounts(accountRef, { object: "bank_account", limit: 100 }),
            ]);
            assertStripeModeObject(balance, mode);
            if ("livemode" in legacy) assertStripeModeObject(legacy, mode);
            if ("livemode" in settings) assertStripeModeObject(settings, mode);
            if (legacy.id !== accountRef || legacy.metadata?.workfare_pay_user !== userId || legacy.metadata?.workfare_pay_role !== "recipient"
                || balance.object !== "balance" || settings.object !== "balance_settings" || !Array.isArray(balance.available) || !Array.isArray(balance.pending)) reject();
            const sumEur = (values: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) => {
                if (values.some(value => typeof value.currency !== "string" || !Number.isSafeInteger(value.amount))) return reject();
                const amount = values.filter(value => value.currency === "eur").reduce((total, value) => total + value.amount, 0);
                if (!Number.isSafeInteger(amount)) return reject();
                return amount;
            };
            const availableCents = sumEur(balance.available), pendingCents = sumEur(balance.pending);
            let pendingAvailableAt: string | null = null;
            if (pendingCents > 0) {
                try {
                    const transactions = await stripe.balanceTransactions.list({ currency: "eur", limit: 100 }, { stripeAccount: accountRef });
                    if (transactions.object === "list" && !transactions.has_more && Array.isArray(transactions.data)) {
                        const pending = transactions.data.filter(row => row.currency === "eur" && row.status === "pending");
                        if (pending.length && pending.every(row => Number.isSafeInteger(row.net) && Number.isSafeInteger(row.available_on) && row.available_on > 0)
                            && pending.reduce((sum, row) => sum + row.net, 0) === pendingCents) {
                            pendingAvailableAt = new Date(Math.max(...pending.map(row => row.available_on)) * 1000).toISOString();
                        }
                    }
                } catch { /* Availability is optional; never invent a date when the provider cannot prove it. */ }
            }
            const hasOtherCurrency = [...balance.available, ...balance.pending].some(value => value.currency !== "eur" && value.amount !== 0);
            const hasPayoutMethod = external.data.some(value => value.object === "bank_account" && value.currency === "eur"
                && value.default_for_currency === true && ["new", "validated", "verified"].includes(value.status)
                && (!value.account || accountId(value.account) === accountRef));
            const capabilities = account.configuration?.recipient?.capabilities?.stripe_balance;
            const stripePayoutsEnabled = capabilities?.stripe_transfers?.status === "active" && capabilities?.payouts?.status === "active"
                && legacy.payouts_enabled === true && legacy.details_submitted === true && settings.payments?.payouts?.status === "enabled"
                && !!account.requirements?.entries && account.requirements.entries.every(value => value.awaiting_action_from !== "user");
            const schedule = settings.payments?.payouts?.schedule?.interval;
            return { kind: mode, currency: "eur", availableCents, pendingCents,
                schedule: ["daily", "weekly", "monthly", "manual"].includes(schedule ?? "") ? schedule as RecipientPayoutOverview["schedule"] : "unknown",
                stripePayoutsEnabled, hasPayoutMethod, canRequestPayout: false, canRetainBalance: false,
                disabledReason: !stripePayoutsEnabled || !hasPayoutMethod ? "recipient_setup_required"
                    : hasOtherCurrency ? "currency_not_supported" : "retention_monitor_required",
                maxHoldingDays: 90, checkedAt: new Date().toISOString(), pendingAvailableAt,
                bank: external.data.filter(bank => bank.object === "bank_account" && bank.default_for_currency === true && bank.currency === "eur").length === 1
                    ? summarizeRecipientBank(external.data.find(bank => bank.object === "bank_account" && bank.default_for_currency === true && bank.currency === "eur"), accountRef) : null };
        },
        inspect,
        async verifyWebhook(payload: string, signature: string) {
            const secret = environment.STRIPE_CONNECT_WEBHOOK_SECRET;
            if (!secret || !/^whsec_[a-zA-Z0-9]+$/.test(secret)) throw new PaymentFlowError("recipient_webhook_not_configured", 503);
            let notification: Stripe.V2.Core.EventNotification;
            const stripe = await sdk();
            try { notification = stripe.parseEventNotification(payload, signature, secret); }
            catch { throw new PaymentFlowError("invalid_webhook_signature", 400); }
            assertStripeModeObject(notification, mode);
            // Thin events trigger a fresh read; their payload never becomes financial state.
            if (!("related_object" in notification) || !notification.related_object || !("id" in notification.related_object)
                || notification.related_object.type !== "v2.core.account" || !/^acct_[a-zA-Z0-9]+$/.test(notification.related_object.id)) return null;
            const allowed = ["v2.core.account[configuration.recipient].capability_status_updated", "v2.core.account[configuration.recipient].updated", "v2.core.account[requirements].updated",
                "v2.core.account[future_requirements].updated", "v2.core.account[identity].updated", "v2.core.account.updated", "v2.core.account.closed"];
            if (!allowed.includes(notification.type)) return null;
            return { id: notification.id, accountRef: notification.related_object.id };
        },
        async verifySnapshotWebhook(payload: string, signature: string) {
            const secret = environment.STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET;
            if (!secret || !/^whsec_[a-zA-Z0-9]+$/.test(secret)) throw new PaymentFlowError("recipient_snapshot_webhook_not_configured", 503);
            let event: Stripe.Event;
            const stripe = await sdk();
            try { event = stripe.webhooks.constructEvent(payload, signature, secret); }
            catch { throw new PaymentFlowError("invalid_webhook_signature", 400); }
            assertStripeModeObject(event, mode);
            const allowed = ["account.updated", "account.external_account.created", "account.external_account.updated", "account.external_account.deleted", "person.updated", "person.deleted"];
            if (!allowed.includes(event.type) || !event.account || !/^acct_[a-zA-Z0-9]+$/.test(event.account)) return null;
            // The signed event only locates the owner; changed bank data is read
            // again from Stripe rather than copied from an event snapshot.
            return { id: event.id, accountRef: event.account };
        },
    });
}
