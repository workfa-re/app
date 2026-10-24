import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipientMinorBinding } from "@/lib/payments/recipient-minor-types";

vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({
    account: vi.fn(), accountUpdate: vi.fn(), accountCreate: vi.fn(), platform: vi.fn(), record: vi.fn(),
    persons: vi.fn(), personCreate: vi.fn(), personUpdate: vi.fn(), personRetrieve: vi.fn(),
    legacyPersons: vi.fn(), external: vi.fn(), attach: vi.fn(), sessions: vi.fn(),
    payout: vi.fn(), transfer: vi.fn(), charge: vi.fn(),
}));
vi.mock("@/lib/payments/recipient-repository.server", () => ({ getRecipientAccount: api.record }));
vi.mock("stripe", async original => {
    const { default: Actual } = await original<typeof import("stripe")>();
    return { default: class extends Actual {
        constructor(...args: ConstructorParameters<typeof Actual>) {
            super(...args);
            this.v2.core.accounts.retrieve = api.account;
            this.v2.core.accounts.update = api.accountUpdate;
            this.v2.core.accounts.create = api.accountCreate;
            this.v2.core.accounts.persons.list = api.persons;
            this.v2.core.accounts.persons.create = api.personCreate;
            this.v2.core.accounts.persons.update = api.personUpdate;
            this.v2.core.accounts.persons.retrieve = api.personRetrieve;
            this.accounts.retrieve = api.platform;
            this.accounts.listPersons = api.legacyPersons;
            this.accounts.listExternalAccounts = api.external;
            this.accounts.createExternalAccount = api.attach;
            this.accountSessions.create = api.sessions;
            this.payouts.create = api.payout;
            this.transfers.create = api.transfer;
            this.charges.create = api.charge;
        }
    } };
});

import { createRecipientStripeAdapter } from "@/lib/payments/recipient-stripe.server";

const childId = "11111111-1111-4111-8111-111111111111";
const guardianId = "22222222-2222-4222-8222-222222222222";
const consentId = "33333333-3333-4333-8333-333333333333";
const accountRef = "acct_nativeChildFixture";
const operationId = "44444444-4444-4444-8444-444444444444";
const childBirthdate = `${new Date().getUTCFullYear() - 16}-01-15`;
const binding: RecipientMinorBinding = {
    guardianId, consentId, childBirthdate, guardianBirthdate: "1980-03-12",
    guardianName: "Paula Beispiel", guardianEmail: "parent@fixture.invalid",
};
const environment = {
    WORKFARE_PAY_MODE: "live", WORKFARE_PAY_LIVE_ENABLED: "enabled", WORKFARE_PAY_LIVE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
    WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT: "acct_platformFixture", APP_ORIGIN: "https://app.workfa.re",
    SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    STRIPE_SECRET_KEY: "rk_live_offlineFixture",
};
const metadata = {
    workfare_pay_user: childId, workfare_pay_role: "recipient", workfare_pay_minor_guardian: guardianId,
    workfare_pay_minor_consent: consentId, workfare_pay_minor_birthdate: childBirthdate,
};
const birthdate = (value: string) => { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; };
const childPerson = () => ({
    id: "person_childFixture", object: "v2.core.account_person", account: accountRef, livemode: true,
    date_of_birth: birthdate(childBirthdate), given_name: null, surname: null,
    relationship: { representative: true, legal_guardian: null },
});
const account = () => ({
    id: accountRef, object: "v2.core.account", livemode: true, dashboard: "none", metadata,
    applied_configurations: ["recipient"], closed: false,
    identity: { country: "DE", entity_type: "individual", individual: childPerson(), attestations: { terms_of_service: { account: null } } },
    defaults: { responsibilities: { fees_collector: "application", losses_collector: "application", requirements_collector: "application" }, profile: { business_url: null } },
    configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "restricted" }, payouts: { status: "restricted" } } } } },
    requirements: { entries: ["identity.individual.given_name", "identity.individual.surname", "identity.individual.address.line1", "identity.individual.address.city", "identity.individual.address.postal_code", "identity.attestations.terms_of_service.account.date", "identity.attestations.terms_of_service.account.ip", "defaults.profile.business_url"].map(description => ({ description, awaiting_action_from: "user" })) },
});
const record = () => ({ userId: childId, accountRef, birthdate: childBirthdate, displayName: "Noah Beispiel", minorBinding: binding });
const guardianPerson = () => ({
    id: "person_guardianFixture", object: "v2.core.account_person", account: accountRef, livemode: true,
    given_name: "Paula", surname: "Beispiel", date_of_birth: birthdate(binding.guardianBirthdate),
    email: binding.guardianEmail, relationship: { legal_guardian: true }, metadata: {},
});
const address = () => ({ line1: "Beispielweg 1", city: "Rheinbach", postalCode: "53359", country: "DE" as const });
const input = () => ({
    guardian: { givenName: "Paula", surname: "Beispiel", address: address() },
    child: { givenName: "Noah", surname: "Beispiel", address: address() },
});
const evidence = () => ({ ip: "192.0.2.1", userAgent: "Workfare offline fixture", date: new Date().toISOString() });

beforeEach(() => {
    vi.resetAllMocks();
    api.platform.mockImplementation(async id => id === null ? { id: "acct_platformFixture", country: "DE" } : { id: accountRef, object: "account", metadata, details_submitted: false, payouts_enabled: false });
    api.account.mockResolvedValue(account());
    api.record.mockResolvedValue(record());
    api.persons.mockResolvedValue({ object: "list", data: [], has_more: false, next_page_url: null });
    api.legacyPersons.mockResolvedValue({ object: "list", data: [], has_more: false });
    api.external.mockResolvedValue({ object: "list", data: [{ id: "ba_existingChildBank", object: "bank_account", account: accountRef, currency: "eur", default_for_currency: true, status: "new" }], has_more: false });
    api.accountUpdate.mockResolvedValue(account());
    api.personCreate.mockResolvedValue(guardianPerson());
    api.personUpdate.mockResolvedValue(guardianPerson());
    api.personRetrieve.mockResolvedValue(guardianPerson());
});

// These exercise the adapter with a real SDK-shaped client and deliberately
// invalid server evidence. No Stripe endpoint is contacted by this file.
describe("native guardian verification adapter", () => {
    it("does not create a second parent account or expose a payment session to read requirements", async () => {
        await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(api.accountCreate).not.toHaveBeenCalled();
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.sessions).not.toHaveBeenCalled();
        expect(api.attach).not.toHaveBeenCalled();
    });

    it.each([
        { userId: guardianId }, { accountRef: "acct_someoneElse" }, { minorBinding: null },
        { minorBinding: { ...binding, consentId: "55555555-5555-4555-8555-555555555555" } },
        { minorBinding: { ...binding, guardianId: "66666666-6666-4666-8666-666666666666" } },
        { birthdate: "2000-01-01" },
    ])("rejects a changed private child or guardian binding before accepting parent data: %j", async patch => {
        api.record.mockResolvedValue({ ...record(), ...patch });
        await expect(createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding)).rejects.toThrow();
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.personUpdate).not.toHaveBeenCalled();
    });

    it.each([
        { livemode: false }, { id: "acct_other" }, { closed: true }, { dashboard: "express" },
        { metadata: { ...metadata, workfare_pay_user: guardianId } },
        { metadata: { ...metadata, workfare_pay_minor_guardian: childId } },
        { metadata: { ...metadata, workfare_pay_minor_consent: "some_other_consent" } },
        { identity: { ...account().identity, country: "US" } },
        { identity: { ...account().identity, entity_type: "company" } },
        { identity: { ...account().identity, individual: { ...childPerson(), date_of_birth: { year: 1980, month: 1, day: 1 } } } },
        { defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } } },
    ])("rejects incompatible account evidence instead of using its metadata as identity: %j", async patch => {
        api.account.mockResolvedValue({ ...account(), ...patch });
        await expect(createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding)).rejects.toThrow();
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.sessions).not.toHaveBeenCalled();
    });
});

describe("native guardian agreement and identity writes", () => {
    const write = (details = input(), proof = evidence()) => createRecipientStripeAdapter(environment)
        .saveNativeGuardianSetup(childId, accountRef, binding, details, proof, operationId);

    function expectNoWrites() {
        expect(api.accountCreate).not.toHaveBeenCalled();
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.personUpdate).not.toHaveBeenCalled();
        expect(api.attach).not.toHaveBeenCalled();
        expect(api.payout).not.toHaveBeenCalled();
        expect(api.transfer).not.toHaveBeenCalled();
        expect(api.charge).not.toHaveBeenCalled();
        expect(api.sessions).not.toHaveBeenCalled();
    }

    it.each([
        { child: { ...input().child, givenName: "Different" } },
        { child: { ...input().child, surname: "Person" } },
        { guardian: { ...input().guardian, givenName: "Someone" } },
        { guardian: { ...input().guardian, surname: "Else" } },
    ])("does not replace the child or adult identity with edited form data %j", async patch => {
        await expect(write({ ...input(), ...patch })).rejects.toMatchObject({ code: "guardian_native_identity_mismatch" });
        expectNoWrites();
    });

    it.each([
        { ip: "not-an-ip" }, { ip: "" }, { ip: "192.0.2.1, 198.51.100.2" },
        { date: "not-a-date" }, { date: "2000-01-01T00:00:00.000Z" },
        { date: "2099-01-01T00:00:00.000Z" },
        { userAgent: "agent\nforged" },
    ])("does not report an untrue or malformed terms acceptance %j", async patch => {
        await expect(write(input(), { ...evidence(), ...patch })).rejects.toThrow();
        expectNoWrites();
    });

    it.each(["", "operation-in-url", "not-a-uuid"])('refuses a malformed operation id "%s"', async operation => {
        await expect(createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operation)).rejects.toThrow();
        expectNoWrites();
    });

    it.each([
        "identity.individual.documents.primary_verification.front_back.front",
        "identity.individual.id_numbers",
        "identity.business_details.registration_number",
        "legal_guardian.verification.document",
        "risk.review.additional_document",
    ])("preserves a targeted remediation path for unsupported requirement %s", async description => {
        api.account.mockResolvedValue({ ...account(), requirements: { entries: [{ awaiting_action_from: "user", description }] } });
        const state = await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(state).toMatchObject({ canSubmit: false, needsAdditionalVerification: true, ready: false });
        await expect(write()).rejects.toMatchObject({ code: "guardian_native_remediation_required" });
        expectNoWrites();
    });

    it("does not interpret an omitted Stripe requirements include as completion", async () => {
        api.account.mockResolvedValue({ ...account(), requirements: null });
        await expect(write()).rejects.toThrow();
        expectNoWrites();
    });

    it.each([
        { next_page_url: "https://api.stripe.com/v2/next" },
        { data: [guardianPerson(), { ...guardianPerson(), id: "person_duplicate" }] },
        { data: [{ ...guardianPerson(), account: "acct_other" }] },
        { data: [{ ...guardianPerson(), livemode: false }] },
        { data: [{ ...guardianPerson(), date_of_birth: { year: 1970, month: 1, day: 1 } }] },
        { data: [{ ...guardianPerson(), given_name: "Somebody" }] },
        { data: [{ ...guardianPerson(), email: "other@fixture.invalid" }] },
    ])("never adopts ambiguous, differently owned or changed guardian person evidence %j", async patch => {
        api.persons.mockResolvedValue({ object: "list", data: [], has_more: false, next_page_url: null, ...patch });
        await expect(write()).rejects.toThrow();
        expectNoWrites();
    });
});

function successfulWrites() {
    api.personCreate.mockImplementation(async (_ref, params) => ({ ...guardianPerson(), ...params }));
    api.personUpdate.mockImplementation(async (_ref, _id, params) => ({ ...guardianPerson(), ...params }));
    api.accountUpdate.mockImplementation(async (_ref, params) => ({
        ...account(),
        identity: {
            ...account().identity,
            ...params.identity,
            individual: { ...childPerson(), ...params.identity?.individual },
        },
        defaults: { ...account().defaults, ...params.defaults },
    }));
}

describe("native guardian writes keep payment and identity responsibilities separate", () => {
    it("creates a legal guardian on the child's existing account and sends only genuine, current agreement evidence", async () => {
        successfulWrites();
        const proof = evidence();
        await createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId);
        expect(api.personCreate).toHaveBeenCalledOnce();
        const [ref, params, options] = api.personCreate.mock.calls[0];
        expect(ref).toBe(accountRef);
        expect(params).toMatchObject({
            given_name: "Paula", surname: "Beispiel", email: binding.guardianEmail,
            date_of_birth: birthdate(binding.guardianBirthdate), relationship: { legal_guardian: true },
            additional_terms_of_service: { account: { date: proof.date, ip: proof.ip, user_agent: proof.userAgent } },
            metadata: { workfare_pay_guardian: guardianId, workfare_pay_minor_consent: consentId, workfare_pay_operation: operationId },
        });
        expect(params).not.toHaveProperty("address"); // Stripe requested only the child's address.
        expect(options.idempotencyKey).toContain(accountRef);
        expect(options.idempotencyKey).toContain(consentId);
        expect(options.idempotencyKey).not.toMatch(/parent@|Paula|1980|192\.0\.2/);
        expect(api.accountUpdate).toHaveBeenCalledOnce();
        const [childRef, update] = api.accountUpdate.mock.calls[0];
        expect(childRef).toBe(accountRef);
        expect(update.identity.individual).toEqual({ given_name: "Noah", surname: "Beispiel", address: { line1: "Beispielweg 1", city: "Rheinbach", postal_code: "53359", country: "DE" } });
        expect(update.identity.attestations.terms_of_service.account).toEqual({ date: proof.date, ip: proof.ip, user_agent: proof.userAgent });
        expect(update.defaults.profile.product_description).toContain("Workfare");
        expect(update.defaults.profile).not.toHaveProperty("business_url");
        expect(api.accountCreate).not.toHaveBeenCalled();
        expect(api.attach).not.toHaveBeenCalled();
        expect(api.sessions).not.toHaveBeenCalled();
        expect(api.payout).not.toHaveBeenCalled();
        expect(api.transfer).not.toHaveBeenCalled();
        expect(api.charge).not.toHaveBeenCalled();
        expect(JSON.stringify([params, update])).not.toMatch(/"verified"|"payouts_enabled"|"transfers_active"|"external_account"|"bank_account"/);
    });

    it("sends a guardian address only when Stripe actually requests it", async () => {
        successfulWrites();
        const row = account();
        row.requirements.entries.push({ awaiting_action_from: "user", description: "legal_guardian.address.line1" });
        api.account.mockResolvedValue(row);
        const state = await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(state.guardianAddressRequired).toBe(true);
        await createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operationId);
        expect(api.personCreate.mock.calls[0][1].address).toEqual({ line1: "Beispielweg 1", city: "Rheinbach", postal_code: "53359", country: "DE" });
    });

    it("updates the same matching parent instead of creating a second guardian", async () => {
        successfulWrites();
        api.persons.mockResolvedValue({ data: [guardianPerson()], next_page_url: null });
        const proof = evidence();
        await createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId);
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.personUpdate).toHaveBeenCalledExactlyOnceWith(accountRef, "person_guardianFixture", expect.objectContaining({
            additional_terms_of_service: { account: { date: proof.date, ip: proof.ip, user_agent: proof.userAgent } },
        }), expect.objectContaining({ idempotencyKey: expect.stringContaining(operationId) }));
    });

    it("replays a lost Create response with exactly the same payload and stable account/consent key", async () => {
        successfulWrites();
        const saved = { ...guardianPerson() };
        api.personCreate.mockRejectedValueOnce(new Error("response lost after provider accepted request"))
            .mockImplementationOnce(async (_ref, params) => ({ ...saved, ...params }));
        const adapter = createRecipientStripeAdapter(environment), proof = evidence();
        await expect(adapter.saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId)).rejects.toThrow();
        expect(api.accountUpdate).not.toHaveBeenCalled();
        await adapter.saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId);
        expect(api.personCreate.mock.calls[1]).toEqual(api.personCreate.mock.calls[0]);
        expect(api.accountUpdate).toHaveBeenCalledOnce();
    });

    it("replays matching person and account writes without changing the recorded agreement time", async () => {
        successfulWrites();
        api.persons.mockResolvedValue({ data: [guardianPerson()], next_page_url: null });
        const adapter = createRecipientStripeAdapter(environment), proof = evidence();
        await adapter.saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId);
        await adapter.saveNativeGuardianSetup(childId, accountRef, binding, input(), proof, operationId);
        expect(api.personUpdate.mock.calls[1]).toEqual(api.personUpdate.mock.calls[0]);
        expect(api.accountUpdate.mock.calls[1]).toEqual(api.accountUpdate.mock.calls[0]);
        expect(api.personCreate).not.toHaveBeenCalled();
    });

    it.each([
        { id: "not_a_person" }, { account: "acct_other" }, { livemode: false },
        { relationship: { legal_guardian: false } }, { given_name: "Another" },
        { date_of_birth: { year: 1970, month: 1, day: 1 } }, { email: "other@fixture.invalid" },
        { metadata: { workfare_pay_guardian: childId, workfare_pay_minor_consent: consentId } },
        { metadata: { workfare_pay_guardian: guardianId, workfare_pay_minor_consent: "other_consent" } },
    ])("refuses contradictory saved guardian evidence before a second identity or agreement write %j", async patch => {
        successfulWrites();
        api.personCreate.mockImplementation(async (_ref, params) => ({ ...guardianPerson(), ...params, ...patch }));
        await expect(createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operationId)).rejects.toThrow();
        expect(api.accountUpdate).not.toHaveBeenCalled();
    });

    it.each(["ip", "user_agent", "date"] as const)("requires the returned guardian agreement's %s to match the actual acceptance", async field => {
        successfulWrites();
        api.personCreate.mockImplementation(async (_ref, params) => ({ ...guardianPerson(), ...params,
            additional_terms_of_service: { account: { ...params.additional_terms_of_service.account, [field]: field === "date" ? "2000-01-01T00:00:00.000Z" : "changed" } },
        }));
        await expect(createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operationId)).rejects.toThrow();
        expect(api.accountUpdate).not.toHaveBeenCalled();
    });
});

describe("parent-only remediation session", () => {
    function sessionResult() {
        api.sessions.mockImplementation(async params => ({ account: accountRef, client_secret: "native_parent_fixture_secret", livemode: true,
            expires_at: Math.floor(Date.now() / 1000) + 300, components: params.components }));
    }
    it("omits Stripe registration and bank entry only for the explicitly selected parent remediation session", async () => {
        sessionResult();
        await createRecipientStripeAdapter(environment).createSession(childId, accountRef, "onboarding", { guardianVerification: true });
        expect(api.sessions).toHaveBeenCalledExactlyOnceWith({ account: accountRef, components: { account_onboarding: { enabled: true,
            features: { external_account_collection: false, disable_stripe_user_authentication: true } } } });
        expect(api.accountCreate).not.toHaveBeenCalled();
        expect(api.attach).not.toHaveBeenCalled();
    });
    it.each(["management", "balances", "payouts_list", "notification_banner"] as const)("does not expand the parent exception to %s", async component => {
        sessionResult();
        await expect(createRecipientStripeAdapter(environment).createSession(childId, accountRef, component, { guardianVerification: true })).rejects.toThrow();
        expect(api.sessions).not.toHaveBeenCalled();
    });
    it.each([
        { metadata: { workfare_pay_user: childId, workfare_pay_role: "recipient" } },
        { defaults: { responsibilities: { fees_collector: "application", losses_collector: "application", requirements_collector: "stripe" } } },
    ])("does not skip authentication for an account that does not support the parent-only flow %j", async patch => {
        sessionResult(); api.account.mockResolvedValue({ ...account(), ...patch });
        await expect(createRecipientStripeAdapter(environment).createSession(childId, accountRef, "onboarding", { guardianVerification: true })).rejects.toThrow();
        expect(api.sessions).not.toHaveBeenCalled();
    });
    it.each([
        { external_account_collection: true, disable_stripe_user_authentication: true },
        { external_account_collection: false, disable_stripe_user_authentication: false },
    ])("rejects an AccountSession that silently grants different features %j", async features => {
        sessionResult(); api.sessions.mockResolvedValue({ account: accountRef, client_secret: "native_parent_fixture_secret", livemode: true,
            expires_at: Math.floor(Date.now() / 1000) + 300, components: { account_onboarding: { enabled: true, features } } });
        await expect(createRecipientStripeAdapter(environment).createSession(childId, accountRef, "onboarding", { guardianVerification: true })).rejects.toThrow();
    });
});

describe("native account confirmation and bounded person reads", () => {
    it("uses Stripe's supported person list limit and refuses overflow", async () => {
        await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(api.persons).toHaveBeenCalledExactlyOnceWith(accountRef, { limit: 20 });
        api.persons.mockResolvedValue({ data: Array.from({ length: 21 }, (_, index) => ({ ...guardianPerson(), id: `person_fixture${index}`, relationship: {} })), next_page_url: null });
        await expect(createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding)).rejects.toThrow();
    });
    it.each(["account", "mode", "child-name", "child-birthdate", "guardian", "consent", "agreement-date", "agreement-ip", "agreement-agent"])("does not confirm a contradictory updated %s", async kind => {
        successfulWrites();
        const apply = api.accountUpdate.getMockImplementation()!;
        api.accountUpdate.mockImplementation(async (ref, params) => {
            const updated = await apply(ref, params);
            if (kind === "account") updated.id = "acct_other";
            if (kind === "mode") updated.livemode = false;
            if (kind === "child-name") updated.identity.individual.given_name = "Someone";
            if (kind === "child-birthdate") updated.identity.individual.date_of_birth = { year: 1980, month: 1, day: 1 };
            if (kind === "guardian") updated.metadata = { ...updated.metadata, workfare_pay_minor_guardian: childId };
            if (kind === "consent") updated.metadata = { ...updated.metadata, workfare_pay_minor_consent: "different" };
            if (kind === "agreement-date") updated.identity.attestations.terms_of_service.account.date = "2000-01-01T00:00:00.000Z";
            if (kind === "agreement-ip") updated.identity.attestations.terms_of_service.account.ip = "198.51.100.2";
            if (kind === "agreement-agent") updated.identity.attestations.terms_of_service.account.user_agent = "different";
            return updated;
        });
        await expect(createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operationId)).rejects.toThrow();
        expect(api.attach).not.toHaveBeenCalled();
        expect(api.payout).not.toHaveBeenCalled();
        expect(api.transfer).not.toHaveBeenCalled();
        expect(api.charge).not.toHaveBeenCalled();
    });
});

describe("native verification has a real stopping point", () => {
    it("does not send parents through the same form again while Stripe processes submitted information", async () => {
        const proof = evidence(), row = account();
        api.account.mockResolvedValue({ ...row, requirements: { entries: [{ description: "identity.individual.verification", awaiting_action_from: "stripe" }] },
            identity: { ...row.identity,
                individual: { ...childPerson(), given_name: "Noah", surname: "Beispiel" },
                attestations: { terms_of_service: { account: { date: proof.date, ip: proof.ip, user_agent: proof.userAgent } } },
            },
        });
        api.persons.mockResolvedValue({ data: [{ ...guardianPerson(), additional_terms_of_service: { account: { date: proof.date, ip: proof.ip, user_agent: proof.userAgent } } }], next_page_url: null });
        const result = await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(result).toMatchObject({ ready: false, canSubmit: false, needsAdditionalVerification: false, requirements: [] });
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
    });

    it("routes an unimplemented child email requirement to remediation instead of promising a form that cannot satisfy it", async () => {
        api.account.mockResolvedValue({ ...account(), requirements: { entries: [{ description: "identity.individual.email", awaiting_action_from: "user" }] } });
        const result = await createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding);
        expect(result).toMatchObject({ ready: false, canSubmit: false, needsAdditionalVerification: true });
        await expect(createRecipientStripeAdapter(environment).saveNativeGuardianSetup(childId, accountRef, binding, input(), evidence(), operationId)).rejects.toMatchObject({ code: "guardian_native_remediation_required" });
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.accountUpdate).not.toHaveBeenCalled();
    });
});

describe("verified account capabilities and genuine v2 guardian evidence", () => {
    const timestamp = Date.now();
    const accepted = new Date(timestamp - 1_000).toISOString();
    const readyAccount = () => ({ ...account(), requirements: { entries: [] },
        identity: { ...account().identity, attestations: { terms_of_service: { account: { date: accepted, ip: "192.0.2.1", user_agent: "Workfare test" } } } },
        configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "active" }, payouts: { status: "active" } } } } },
    });
    const acceptedGuardian = () => ({ ...guardianPerson(), additional_terms_of_service: { account: { date: accepted, ip: "192.0.2.1", user_agent: "Workfare test" } } });
    const page = () => ({ data: [acceptedGuardian()], next_page_url: null });
    async function proof(persons: unknown = page(), recipient: unknown = readyAccount()) {
        const { guardianEvidenceFromV2Persons } = await import("@/lib/payments/recipient-guardian-evidence.server");
        return guardianEvidenceFromV2Persons(persons as Parameters<typeof guardianEvidenceFromV2Persons>[0], recipient as Parameters<typeof guardianEvidenceFromV2Persons>[1], binding, timestamp);
    }

    it("uses a real v2 parent person and true terms acceptance without inventing a v1 verified status or assuming identical IDs", async () => {
        const actual = acceptedGuardian();
        expect(actual).not.toHaveProperty("verification");
        const result = await proof({ data: [actual], next_page_url: null });
        expect(result).toEqual({ evidence: { personRef: actual.id, tosAcceptedAt: accepted }, reason: null });
        expect(result.evidence?.personRef).not.toBe("person_legacyDifferentGuardian");
    });

    it.each([
        { livemode: false }, { closed: true },
        { metadata: { ...metadata, workfare_pay_minor_guardian: childId } },
        { metadata: { ...metadata, workfare_pay_minor_consent: "another" } },
        { metadata: { ...metadata, workfare_pay_minor_birthdate: "2000-01-01" } },
        { configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "restricted" }, payouts: { status: "active" } } } } } },
        { configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "active" }, payouts: { status: "restricted" } } } } } },
        { configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } } } },
        { identity: { ...account().identity, attestations: { terms_of_service: { account: null } } } },
        { identity: { ...account().identity, attestations: { terms_of_service: { account: { date: "not-a-date" } } } } },
        { identity: { ...account().identity, attestations: { terms_of_service: { account: { date: "2099-01-01T00:00:00.000Z" } } } } },
        { requirements: undefined }, { requirements: { entries: undefined } },
        { requirements: { entries: [{ description: "legal_guardian", awaiting_action_from: "user" }] } },
        { requirements: { entries: [{ description: "legal_guardian", awaiting_action_from: "stripe" }] } },
    ])("requires current live active account capabilities and no outstanding verification work %j", async patch => {
        expect((await proof(page(), { ...readyAccount(), ...patch })).evidence).toBeNull();
    });

    it.each([
        { id: "invalid_person" }, { account: "acct_other" }, { livemode: false },
        { given_name: "Another" }, { surname: "Parent" }, { email: "another@fixture.invalid" },
        { date_of_birth: { year: 2000, month: 1, day: 1 } },
        { relationship: { legal_guardian: false } },
        { additional_terms_of_service: null }, { additional_terms_of_service: { account: { date: null } } },
        { additional_terms_of_service: { account: { date: "not-a-date" } } },
        { additional_terms_of_service: { account: { date: "2099-01-01T00:00:00.000Z" } } },
    ])("does not infer guardian evidence from incomplete or mismatched v2 person data %j", async patch => {
        expect((await proof({ data: [{ ...acceptedGuardian(), ...patch }], next_page_url: null })).evidence).toBeNull();
    });

    it.each([
        { data: [] },
        { data: [acceptedGuardian(), { ...acceptedGuardian(), id: "person_duplicateGuardian" }] },
        { next_page_url: "https://api.stripe.com/v2/next" },
        { next_page_url: undefined },
    ])("requires a complete unambiguous v2 guardian list %j", async patch => {
        expect((await proof({ ...page(), ...patch })).evidence).toBeNull();
    });
});

describe("unsplittable historical profile names", () => {
    it("offers profile correction instead of a child name form with no possible valid submission", async () => {
        api.record.mockResolvedValue({ ...record(), displayName: "Noah" });
        await expect(createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, binding)).rejects.toMatchObject({ code: "guardian_profile_correction_required" });
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.personUpdate).not.toHaveBeenCalled();
    });
    it("offers profile correction instead of silently inventing the guardian's surname", async () => {
        const mononymBinding = { ...binding, guardianName: "Paula" };
        api.record.mockResolvedValue({ ...record(), minorBinding: mononymBinding });
        await expect(createRecipientStripeAdapter(environment).readNativeGuardianSetup(childId, accountRef, mononymBinding)).rejects.toMatchObject({ code: "guardian_profile_correction_required" });
        expect(api.accountUpdate).not.toHaveBeenCalled();
        expect(api.personCreate).not.toHaveBeenCalled();
        expect(api.personUpdate).not.toHaveBeenCalled();
    });
});
