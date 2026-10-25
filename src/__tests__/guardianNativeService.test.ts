import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), read: vi.fn(), save: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getUser: api.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: api.rpc }) }));
vi.mock("@/lib/payments/recipient-stripe.server", () => ({ createRecipientStripeAdapter: () => ({ readNativeGuardianSetup: api.read, saveNativeGuardianSetup: api.save }) }));
vi.mock("@/lib/payments/guardian-recipient.server", () => ({ syncGuardianRecipient: api.sync }));
import { readNativeGuardianSetup, saveNativeGuardianSetup } from "@/lib/payments/guardian-native.server";
import { GET, POST } from "@/app/api/payments/guardian/verification/route";

const parent = "11111111-1111-4111-8111-111111111111", child = "22222222-2222-4222-8222-222222222222";
const consent = "33333333-3333-4333-8333-333333333333", operation = "44444444-4444-4444-8444-444444444444", other = "55555555-5555-4555-8555-555555555555";
const accountRef = "acct_nativeFixture";
const binding = { guardianId: parent, consentId: consent, guardianName: "Paula Beispiel", guardianEmail: "parent@fixture.invalid", guardianBirthdate: "1980-01-01", childBirthdate: "2010-01-01" };
const address = { line1: "Beispielweg 1", postalCode: "53359", city: "Rheinbach", country: "DE" as const };
const record = (patch: Record<string, unknown> = {}) => ({ id: other, userId: child, mode: "live", accountRef, generation: 5, birthdate: binding.childBirthdate, displayName: "Kim Beispiel", minorBinding: binding, ...patch });
const context = (status = "onboarding") => ({ ownerId: parent, kind: "live", children: [{ childId: child, status }] });
const state = (patch: Record<string, unknown> = {}) => ({ guardianGivenName: "Paula", guardianSurname: "Beispiel", childGivenName: "Kim", childSurname: "Beispiel",
    guardianAddress: null, childAddress: null, guardianAddressRequired: false, childAddressRequired: true,
    canSubmit: true, needsAdditionalVerification: false, requirements: ["identity.individual.address.line1"], ready: false, ...patch });
const input = () => ({ childId: child, consent: true, guardian: { givenName: "Paula", surname: "Beispiel" }, child: { givenName: "Kim", surname: "Beispiel", address } });
const acceptances = new Map<string, Record<string, unknown>>();
const acceptance = (args: Record<string, unknown>) => {
    const key = String(args.p_operation_id);
    if (!acceptances.has(key)) acceptances.set(key, { ownerId: parent, childId: child, accountRef, consentId: consent, inputHash: args.p_input_hash, declarationVersion: "workfare-pay-guardian-2026-10-24-v1", date: new Date().toISOString(), ip: args.p_ip, userAgent: args.p_user_agent });
    return acceptances.get(key);
};
const evidence = () => ({ date: new Date().toISOString(), ip: "203.0.113.10", userAgent: "Workfare native fixture" });

beforeEach(() => {
    vi.resetAllMocks(); acceptances.clear();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "live", WORKFARE_PAY_LIVE_ENABLED: "enabled", WORKFARE_PAY_LIVE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa", WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT: "acct_platformFixture", APP_ORIGIN: "https://app.workfa.re", SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", STRIPE_SECRET_KEY: "rk_live_offlineFixture", WORKFARE_DEMO_ENABLED: "false", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "false", WORKFARE_DEMO_MODE: "", WORKFARE_DEMO_PROJECT_REF: "", WORKFARE_DEMO_LOCAL_URL: "" })) vi.stubEnv(key, value);
    api.user.mockResolvedValue({ data: { user: { id: parent, email_confirmed_at: "2026-10-24T00:00:00Z" } }, error: null });
    api.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "pay_guardian_recipient_context" ? context() : name === "pay_guardian_native_acceptance" ? acceptance(args) : record() }));
    api.read.mockResolvedValue(state()); api.save.mockResolvedValue(undefined); api.sync.mockResolvedValue({ ok: true, ownerId: parent });
});
afterEach(() => vi.unstubAllEnvs());

describe("native parent-only representative setup", () => {
    it("returns only the currently bound parent's actual prefill, never an account, bank, session or private consent reference", async () => {
        const result = await readNativeGuardianSetup(child, parent);
        expect(result).toMatchObject({ ownerId: parent, childId: child, kind: "live", guardianName: binding.guardianName, childName: "Kim Beispiel", guardianBirthdate: binding.guardianBirthdate, childBirthdate: binding.childBirthdate, childAddressRequired: true, guardianAddressRequired: false, childSameAddress: false, ready: false });
        expect(JSON.stringify(result)).not.toMatch(/accountRef|acct_|minorBinding|consentId|guardianEmail|parent@|clientSecret|bank_account|iban/);
        expect(api.read).toHaveBeenCalledExactlyOnceWith(child, accountRef, binding);
        expect(api.save).not.toHaveBeenCalled(); expect(api.sync).not.toHaveBeenCalled();
    });
    it("does not infer a shared address when only one person's address is known", async () => {
        api.read.mockResolvedValue(state({ guardianAddress: address }));
        expect(await readNativeGuardianSetup(child, parent)).toMatchObject({ childSameAddress: false });
        api.read.mockResolvedValue(state({ guardianAddress: address, childAddress: address }));
        expect(await readNativeGuardianSetup(child, parent)).toMatchObject({ childSameAddress: true });
    });
    it("sends only explicitly confirmed names and currently required addresses, then reconciles actual readiness", async () => {
        await saveNativeGuardianSetup(input(), operation, parent, evidence());
        expect(api.save).toHaveBeenCalledExactlyOnceWith(child, accountRef, binding,
            { guardian: { givenName: "Paula", surname: "Beispiel" }, child: { givenName: "Kim", surname: "Beispiel", address } }, expect.objectContaining({ ip: "203.0.113.10" }), operation);
        expect(api.sync).toHaveBeenCalledExactlyOnceWith(child, parent);
        expect(api.save.mock.invocationCallOrder[0]).toBeLessThan(api.sync.mock.invocationCallOrder[0]);
    });
    it("does not silently transmit an address that Stripe has not requested", async () => {
        const value = input();
        await saveNativeGuardianSetup({ ...value, guardian: { ...value.guardian, address } }, operation, parent, evidence());
        expect(api.save.mock.calls[0][3].guardian).not.toHaveProperty("address");
        api.read.mockResolvedValue(state({ childAddressRequired: false })); api.save.mockClear();
        await saveNativeGuardianSetup(value, other, parent, evidence());
        expect(api.save.mock.calls[0][3].child).not.toHaveProperty("address");
    });
    it.each([undefined, false, "true", 1])("does not reuse the Workfare permission as a fresh Stripe terms acceptance (%j)", async accepted => {
        await expect(saveNativeGuardianSetup({ ...input(), consent: accepted }, operation, parent, evidence())).rejects.toMatchObject({ code: "explicit_consent_required" });
        expect(api.rpc).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
    });
    it.each([{ child: { givenName: "Someone", surname: "Else", address } }, { guardian: { givenName: "Other", surname: "Parent" } }])("rejects a different legal identity %j", async patch => {
        await expect(saveNativeGuardianSetup({ ...input(), ...patch }, operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_identity_mismatch" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("accepts equivalent normalized spacing without rewriting stored legal identities", async () => {
        await saveNativeGuardianSetup({ ...input(), guardian: { givenName: "  Paula ", surname: "Beispiel" } }, operation, parent, evidence());
        expect(api.save.mock.calls[0][3].guardian.givenName).toBe("Paula"); expect(api.save.mock.calls[0][2]).toEqual(binding);
    });
    it.each([{ accountRef: "acct_other" }, { guardianId: other }, { ready: true }, { childBirthdate: "2000-01-01" }, { guardian: { givenName: "Paula", surname: "Beispiel", birthdate: "2000-01-01" } }])("accepts no owner, readiness or birthdate overrides %j", async patch => {
        await expect(saveNativeGuardianSetup({ ...input(), ...patch }, operation, parent, evidence())).rejects.toMatchObject({ code: "invalid_guardian_details" }); expect(api.save).not.toHaveBeenCalled();
    });
    it.each([{ country: "US" }, { postalCode: "123" }, { line1: "bad\naddress" }, { city: "" }])("validates supplied actual address fields %j", async patch => {
        await expect(saveNativeGuardianSetup({ ...input(), child: { ...input().child, address: { ...address, ...patch } } }, operation, parent, evidence())).rejects.toMatchObject({ code: "invalid_guardian_details" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("requires an address only once it is actually due", async () => {
        await expect(saveNativeGuardianSetup({ ...input(), child: { givenName: "Kim", surname: "Beispiel" } }, operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_address_required" });
        api.read.mockResolvedValue(state({ guardianAddressRequired: true }));
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_address_required" }); expect(api.save).not.toHaveBeenCalled();
    });
    it.each([{ canSubmit: false }, { needsAdditionalVerification: true }])("keeps unsupported or documentary requirements outside the minimal form %j", async patch => {
        api.read.mockResolvedValue(state(patch));
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_additional_verification_required" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("does not turn a successful POST or a parent's checkbox into payout readiness", async () => {
        const result = await saveNativeGuardianSetup(input(), operation, parent, evidence());
        expect(result.ready).toBe(false); expect(api.sync).toHaveBeenCalledOnce();
    });
    it.each([true, false])("returns the actual ready/pending state on an already submitted retry without replacing acceptance (%j)", async ready => {
        api.read.mockResolvedValue(state({ ready, canSubmit: false, requirements: [], needsAdditionalVerification: false }));
        expect(await saveNativeGuardianSetup(input(), operation, parent, evidence())).toMatchObject({ ready });
        expect(api.save).not.toHaveBeenCalled(); expect(api.sync).toHaveBeenCalledExactlyOnceWith(child, parent);
        expect(api.rpc).not.toHaveBeenCalledWith("pay_guardian_native_acceptance", expect.anything());
    });
    it.each([{ ready: true }, { childAddressRequired: "true" }, { guardianAddress: { ...address, country: "US" } }])("rejects inconsistent provider projections %j", async patch => {
        api.read.mockResolvedValue(state(patch));
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "recipient_guardian_unavailable" });
    });
    it.each([{ ip: "invalid" }, { userAgent: "bad\nagent" }, { userAgent: "" }, { date: "2000-01-01T00:00:00Z" }, { date: "not-a-date" }])("requires actual fresh acceptance evidence %j", async patch => {
        await expect(saveNativeGuardianSetup(input(), operation, parent, { ...evidence(), ...patch })).rejects.toMatchObject({ code: "recipient_acceptance_evidence_required" }); expect(api.save).not.toHaveBeenCalled();
    });
});

describe("native guardian authorization and concurrency", () => {
    it("rejects unauthenticated and unconfirmed sessions before reading private child information", async () => {
        api.user.mockResolvedValue({ data: { user: null }, error: null });
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "authentication_required", status: 401 });
        api.user.mockResolvedValue({ data: { user: { id: parent } }, error: null });
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "authentication_required" }); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("rejects a stale parent tab or a child's session", async () => {
        api.user.mockResolvedValue({ data: { user: { id: child, email_confirmed_at: "2026-10-24T00:00:00Z" } }, error: null });
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "owner_mismatch" }); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("does not create a recipient or claim an account on GET", async () => {
        api.rpc.mockResolvedValue({ data: context("not_started"), error: null });
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "recipient_bank_setup_required" });
        expect(api.rpc).toHaveBeenCalledExactlyOnceWith("pay_guardian_recipient_context", { p_guardian_id: parent }); expect(api.read).not.toHaveBeenCalled();
    });
    it("requires the current approved relationship before private account lookup", async () => {
        api.rpc.mockResolvedValue({ data: { ...context(), children: [] }, error: null });
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "guardian_consent_required", status: 403 }); expect(api.read).not.toHaveBeenCalled();
    });
    it.each([{ userId: other }, { minorBinding: { ...binding, guardianId: other } }, { birthdate: "2000-01-01" }])("rejects wrong private recipient ownership or immutable identity %j", async patch => {
        api.rpc.mockImplementation(async name => ({ error: null, data: name === "pay_guardian_recipient_context" ? context() : record(patch) }));
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "recipient_guardian_unavailable" }); expect(api.read).not.toHaveBeenCalled();
    });
    it.each([{ id: operation }, { accountRef: "acct_replaced" }, { displayName: "Different Child" },
        { minorBinding: { ...binding, consentId: other } }, { minorBinding: { ...binding, guardianName: "Different Parent" } },
        { minorBinding: { ...binding, guardianEmail: "new@fixture.invalid" } }, { minorBinding: { ...binding, guardianBirthdate: "1981-01-01" } },
    ])("invalidates reads and writes when the bound identity changes %j", async patch => {
        let reads = 0;
        api.rpc.mockImplementation(async name => ({ error: null, data: name === "pay_guardian_recipient_context" ? context() : ++reads === 1 ? record() : record(patch) }));
        await expect(readNativeGuardianSetup(child, parent)).rejects.toMatchObject({ code: "recipient_setup_changed" });
        reads = 0;
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_setup_changed" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("accepts a concurrent status sync without treating it as a different child account", async () => {
        let reads = 0;
        api.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "pay_guardian_recipient_context" ? context()
            : name === "pay_guardian_native_acceptance" ? acceptance(args) : record({ generation: ++reads === 1 ? 5 : 6 }) }));
        expect(await readNativeGuardianSetup(child, parent)).toMatchObject({ childId: child, ready: false });
        reads = 0;
        await saveNativeGuardianSetup(input(), operation, parent, evidence());
        expect(api.rpc).toHaveBeenCalledWith("pay_guardian_native_acceptance", expect.objectContaining({ p_generation: 6, p_account_ref: accountRef, p_consent_id: consent, p_operation_id: operation }));
        expect(api.save).toHaveBeenCalledOnce();
    });
    it("retries one strict acceptance conflict only after a same-identity sync advanced its version", async () => {
        let reads = 0, submissions = 0;
        api.rpc.mockImplementation(async (name, args) => {
            if (name === "pay_guardian_recipient_context") return { error: null, data: context() };
            if (name === "pay_guardian_native_acceptance") {
                if (++submissions === 1) return { error: { message: "RECIPIENT_ACCEPTANCE_CONFLICT" }, data: null };
                return { error: null, data: acceptance(args) };
            }
            return { error: null, data: record({ generation: ++reads <= 2 ? 5 : 6 }) };
        });
        await saveNativeGuardianSetup(input(), operation, parent, evidence());
        const submitted = api.rpc.mock.calls.filter(([name]) => name === "pay_guardian_native_acceptance").map(([, args]) => args);
        expect(submitted).toHaveLength(2);
        expect(submitted[0]).toMatchObject({ p_generation: 5 });
        expect(submitted[1]).toEqual({ ...submitted[0], p_generation: 6 });
        expect(api.save).toHaveBeenCalledOnce();
    });
    it.each([false, true])("does not retry a persistent or same-version acceptance conflict (%j)", async newerVersion => {
        let reads = 0;
        api.rpc.mockImplementation(async name => name === "pay_guardian_recipient_context" ? { error: null, data: context() }
            : name === "pay_guardian_native_acceptance" ? { error: { message: "RECIPIENT_ACCEPTANCE_CONFLICT" }, data: null }
                : { error: null, data: record({ generation: ++reads <= 2 || !newerVersion ? 5 : 6 }) });
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "RECIPIENT_ACCEPTANCE_CONFLICT" });
        expect(api.rpc.mock.calls.filter(([name]) => name === "pay_guardian_native_acceptance")).toHaveLength(newerVersion ? 2 : 1);
        expect(api.save).not.toHaveBeenCalled(); expect(api.sync).not.toHaveBeenCalled();
    });
    it("rechecks a revoked parent relationship before retrying a competing status sync", async () => {
        let contexts = 0;
        api.rpc.mockImplementation(async name => name === "pay_guardian_recipient_context" ? { error: null, data: ++contexts <= 2 ? context() : { ...context(), children: [] } }
            : name === "pay_guardian_native_acceptance" ? { error: { message: "RECIPIENT_ACCEPTANCE_CONFLICT" }, data: null }
                : { error: null, data: record() });
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "guardian_consent_required" });
        expect(api.rpc.mock.calls.filter(([name]) => name === "pay_guardian_native_acceptance")).toHaveLength(1);
        expect(api.save).not.toHaveBeenCalled();
    });
    it("rejects a replaced account instead of retrying the acceptance against it", async () => {
        let reads = 0;
        api.rpc.mockImplementation(async name => name === "pay_guardian_recipient_context" ? { error: null, data: context() }
            : name === "pay_guardian_native_acceptance" ? { error: { message: "RECIPIENT_ACCEPTANCE_CONFLICT" }, data: null }
                : { error: null, data: record({ accountRef: ++reads <= 2 ? accountRef : "acct_replaced" }) });
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_setup_changed" });
        expect(api.rpc.mock.calls.filter(([name]) => name === "pay_guardian_native_acceptance")).toHaveLength(1);
        expect(api.save).not.toHaveBeenCalled();
    });
    it("honors a parent revocation between provider read and submission", async () => {
        let reads = 0;
        api.rpc.mockImplementation(async name => name === "pay_guardian_recipient_context" ? { data: ++reads === 1 ? context() : { ...context(), children: [] }, error: null } : { data: record(), error: null });
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "guardian_consent_required" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("persists only a versioned input hash and first acceptance evidence before the provider write", async () => {
        await saveNativeGuardianSetup(input(), operation, parent, evidence());
        const saved = api.rpc.mock.calls.find(([name]) => name === "pay_guardian_native_acceptance");
        expect(saved?.[1]).toMatchObject({ p_guardian_id: parent, p_child_id: child, p_account_ref: accountRef, p_generation: 5, p_consent_id: consent, p_operation_id: operation, p_input_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(JSON.stringify(saved?.[1])).not.toMatch(/Beispielweg|53359|Rheinbach|Paula|Kim/);
        expect(api.rpc.mock.invocationCallOrder[api.rpc.mock.calls.findIndex(([name]) => name === "pay_guardian_native_acceptance")]).toBeLessThan(api.save.mock.invocationCallOrder[0]);
    });
    it("reuses the actual first acceptance date, IP and user agent after a lost response", async () => {
        api.save.mockRejectedValueOnce(new Error("lost response"));
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toThrow("lost response");
        const first = api.save.mock.calls[0][4];
        await saveNativeGuardianSetup(input(), operation, parent, { ...evidence(), ip: "203.0.113.20", userAgent: "Different browser fixture" });
        expect(api.save.mock.calls[1][4]).toEqual(first);
    });
    it.each([{ ownerId: other }, { accountRef: "acct_other" }, { consentId: other }, { inputHash: createHash("sha256").update("different").digest("hex") }, { ip: "invalid" }, { date: new Date(Date.now() + 120_000).toISOString() }])("does not write to Stripe when durable acceptance is not exactly bound %j", async patch => {
        api.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "pay_guardian_recipient_context" ? context() : name === "pay_guardian_native_acceptance" ? { ...acceptance(args), ...patch } : record() }));
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toMatchObject({ code: "recipient_acceptance_unconfirmed" }); expect(api.save).not.toHaveBeenCalled();
    });
    it("does not hide an unconfirmed Stripe save behind a success projection", async () => {
        api.save.mockRejectedValue(new Error("uncertain provider response"));
        await expect(saveNativeGuardianSetup(input(), operation, parent, evidence())).rejects.toThrow("uncertain provider response"); expect(api.sync).not.toHaveBeenCalled();
    });
});

describe("native representative HTTP boundaries", () => {
    const endpoint = "https://app.workfa.re/api/payments/guardian/verification";
    const post = (body: unknown = input(), headers: Record<string, string> = {}) => new Request(endpoint, { method: "POST", headers: { origin: "https://app.workfa.re", "content-type": "application/json", "x-workfare-owner": parent, "idempotency-key": operation, "cf-connecting-ip": "203.0.113.10", "user-agent": "Workfare native fixture", ...headers }, body: JSON.stringify(body) });
    it("permits same-origin GET without a JSON Origin header and returns no-cache data", async () => {
        const response = await GET(new Request(`${endpoint}?childId=${child}`, { headers: { "x-workfare-owner": parent } }));
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.json()).ownerId).toBe(parent);
    });
    it.each(["", `?childId=${child}&childId=${other}`, `?childId=${child}&accountRef=acct_wrong`])("rejects missing, duplicate or unexpected GET parameters %s", async query => {
        expect((await GET(new Request(endpoint + query, { headers: { "x-workfare-owner": parent } }))).status).toBe(400); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("rejects cross-site reads and writes before private access", async () => {
        expect((await GET(new Request(`${endpoint}?childId=${child}`, { headers: { origin: "https://outside.invalid", "x-workfare-owner": parent } }))).status).toBe(403);
        expect((await POST(post(input(), { origin: "https://outside.invalid" }))).status).toBe(403); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("requires the expected authenticated owner on both routes", async () => {
        expect((await GET(new Request(`${endpoint}?childId=${child}`))).status).toBe(409);
        expect((await POST(post(input(), { "x-workfare-owner": "" }))).status).toBe(409); expect(api.rpc).not.toHaveBeenCalled();
    });
    it("does not invent an IP or trust arbitrary X-Forwarded-For as acceptance evidence", async () => {
        const response = await POST(post(input(), { "cf-connecting-ip": "", "x-forwarded-for": "203.0.113.20" }));
        expect(response.status).toBe(400); expect((await response.json()).code).toBe("recipient_acceptance_ip_required"); expect(api.save).not.toHaveBeenCalled();
    });
    it("records the request's fresh acceptance evidence on an explicit parent POST", async () => {
        const response = await POST(post());
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(api.save.mock.calls[0][4]).toMatchObject({ ip: "203.0.113.10", userAgent: "Workfare native fixture" });
        expect(Math.abs(Date.now() - Date.parse(api.save.mock.calls[0][4].date))).toBeLessThan(60_000);
    });
    it("bounds body input and never echoes raw errors or identity data", async () => {
        expect((await POST(post({ ...input(), note: "x".repeat(5_000) }))).status).toBe(413);
        api.read.mockRejectedValue(new Error("secret Stripe data parent@fixture.invalid acct_other"));
        const response = await GET(new Request(`${endpoint}?childId=${child}`, { headers: { "x-workfare-owner": parent } }));
        expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/parent@|acct_other|secret Stripe/);
    });
});
