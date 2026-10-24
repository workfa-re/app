import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Stripe, StripeIbanElement, TokenResult } from "@stripe/stripe-js";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
vi.mock("@/components/providers/ThemeProvider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
import { MinorPayoutSetup, MinorPayoutSetupView, validMinorBankContext, type MinorBankContext } from "@/components/payments/MinorPayoutSetup";
import BankIbanForm from "@/components/payments/BankIbanForm";
import { InitialBankAttempt } from "@/components/payments/bank-iban-attempt";
import { PaymentRequestError, paymentRequest } from "@/components/payments/payment-client";

const owner = "11111111-1111-4111-8111-111111111111";
const parent = "22222222-2222-4222-8222-222222222222";
const otherParent = "33333333-3333-4333-8333-333333333333";
const context: MinorBankContext = { ownerId: owner, kind: "live", hasPayoutMethod: false, ready: false, canStart: true, needsRestart: false, guardians: [{ guardianId: parent, name: "Alex Beispiel" }], reasonCode: "recipient_setup_required", publishableKey: "pk_live_offlineFixture", holderName: "Kim Beispiel" };
const render = (patch: Partial<MinorBankContext> = {}) => renderToStaticMarkup(<MinorPayoutSetupView context={{ ...context, ...patch }} guardianId={parent} busy={false} onGuardianChange={vi.fn()}><span>Bankfeld</span></MinorPayoutSetupView>);
const form = (patch: Partial<Parameters<typeof BankIbanForm>[0]> = {}) => renderToStaticMarkup(<BankIbanForm publishableKey={context.publishableKey} holderName={context.holderName} needsRestart={false} accepted={false} onAccepted={vi.fn()} isCurrentOwner={() => true} onSave={vi.fn()} {...patch} />);

describe("minor supplies their own bank after parent approval", () => {
    it("keeps actual approval visible while offering the youth's own bank entry", () => {
        const html = render();
        expect(html).toContain("Elternfreigabe hinterlegt"); expect(html).toContain("Alex Beispiel");
        expect(html).toContain("Ergänze hier selbst deine Bankverbindung"); expect(html).toContain("Bankfeld");
        expect(html).not.toMatch(/Auszahlung bereit|\/guardian\/access|Identität|Passwort|Personalausweis/);
    });
    it("uses an iframe mount, never an app-controlled IBAN input", () => {
        const html = form();
        expect(html).toContain("IBAN – sicherer Bereich von Stripe"); expect(html).toContain("direkt an Stripe übertragen");
        expect(html).toContain('autoComplete="name"'); expect(html).toContain('value="Kim Beispiel"');
        expect(html).not.toMatch(/<input[^>]*(?:name="iban"|autoComplete="iban"|placeholder="DE)/i);
        expect(html).not.toMatch(/name="(?:card|document|birthdate)"|clientSecret|AccountSession/);
    });
    it("requires unchecked consent and a completed safe bank field", () => {
        const html = form();
        expect(html).not.toContain('checked=""'); expect(html).toContain('type="checkbox"');
        expect(html).toMatch(/type="submit"[^>]*disabled=""/);
        expect(form({ accepted: true })).toContain('checked=""');
        expect(form({ accepted: true })).toMatch(/type="submit"[^>]*disabled=""/);
    });
    it("explains restart independently without preselecting consent", () => {
        expect(render({ needsRestart: true, reasonCode: "recipient_guardian_binding_conflict" })).toContain("Elternfreigabe bleibt bestehen");
        const html = form({ needsRestart: true });
        expect(html).toContain("ungenutzte Einrichtung neu beginnen"); expect(html).not.toContain('checked=""');
    });
    it("does not offer replacement or repeat setup when a bank is already present", () => {
        const html = render({ hasPayoutMethod: true });
        expect(html).toContain("Bankverbindung hinterlegt"); expect(html).not.toContain("Bankfeld"); expect(html).not.toContain("Bankverbindung verwalten");
        expect(html).not.toContain("Auszahlung bereit");
        expect(render({ hasPayoutMethod: true, ready: true, reasonCode: null })).toContain("Auszahlung bereit");
    });
    it("gives a concrete parent next step for an actually outstanding representative requirement", () => {
        const html = render({ hasPayoutMethod: true, requiresGuardianAction: true });
        expect(html).toContain("fehlen noch Angaben deines Elternteils bei Stripe");
        expect(html).toContain("Auszahlung begleiten"); expect(html).toContain("Link für deine Eltern kopieren");
        expect(html).not.toContain("Bankfeld"); expect(html).not.toContain("Stripe prüft die Angaben");
        expect(render({ hasPayoutMethod: true, ready: true, reasonCode: null, requiresGuardianAction: true })).not.toContain("Link für deine Eltern kopieren");
        expect(render({ hasPayoutMethod: true, requiresGuardianAction: false })).not.toContain("Link für deine Eltern kopieren");
    });
    it("does not send a ready account into family repair", () => {
        const html = render({ hasPayoutMethod: true, ready: true, canStart: false, reasonCode: null });
        expect(html).toContain("Auszahlung bereit"); expect(html).not.toContain('href="/guardian/access"'); expect(html).not.toContain("Bankfeld");
    });
    it("offers parent selection only for multiple verified approvals", () => {
        expect(render()).not.toContain("<select");
        const html = render({ guardians: [...context.guardians, { guardianId: otherParent, name: "Sam Beispiel" }] });
        expect(html).toContain("<select"); expect(html).toContain("Sam Beispiel");
    });
    it("routes a missing approval to family instead of mounting bank setup", () => {
        const html = render({ canStart: false, guardians: [], reasonCode: "guardian_consent_required" });
        expect(html).toContain('href="/guardian/access"'); expect(html).toContain("Elternfreigabe anfordern"); expect(html).not.toContain("Bankfeld");
    });
    it("does not fetch, create accounts, or render Stripe sessions during server rendering", () => {
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        try {
            const html = renderToStaticMarkup(<MinorPayoutSetup ownerId={owner} />);
            expect(html).toContain("Deine Bankverbindung"); expect(html).toContain("Aktueller Stand wird geladen");
            expect(html).not.toMatch(/clientSecret|AccountSession|Auszahlung bereit/); expect(fetch).not.toHaveBeenCalled();
        } finally { vi.unstubAllGlobals(); }
    });
});

describe("bank context stays scoped to the current live recipient", () => {
    it("accepts a consistent current-owner projection", () => {
        expect(validMinorBankContext(context, owner)).toBe(true);
        expect(validMinorBankContext({ ...context, canStart: false, guardians: [], reasonCode: "guardian_consent_required" }, owner)).toBe(true);
        expect(validMinorBankContext({ ...context, preferredGuardianId: parent }, owner)).toBe(true);
        expect(validMinorBankContext({ ...context, preferredGuardianId: null }, owner)).toBe(true);
    });
    it.each([
        { ownerId: parent }, { kind: "sandbox" }, { kind: "local" }, { ready: true }, { canStart: true, guardians: [] },
        { guardians: [context.guardians[0], context.guardians[0]] }, { guardians: [{ guardianId: owner, name: "Own account" }] },
        { guardians: [{ guardianId: "invalid", name: "Parent" }] }, { guardians: [{ guardianId: parent, name: "" }] },
        { guardians: [{ guardianId: parent, name: "\u0000" }] }, { guardians: [{ guardianId: parent, name: "x".repeat(201) }] },
        { needsRestart: true, hasPayoutMethod: true }, { reasonCode: "all_clear" }, { reasonCode: "guardian_consent_required" },
        { ready: "true" }, { hasPayoutMethod: 1 }, { needsRestart: undefined }, { preferredGuardianId: otherParent },
        { preferredGuardianId: owner }, { preferredGuardianId: "invalid" }, { preferredGuardianId: 42 },
        { hasPayoutMethod: true, ready: true, canStart: false, guardians: [], reasonCode: null },
        { publishableKey: "pk_test_fixture" }, { publishableKey: "sk_live_private" }, { publishableKey: undefined },
        { holderName: "" }, { holderName: "\u0000" }, { holderName: "x".repeat(201) }, { holderName: undefined },
        { requiresGuardianAction: "true" }, { requiresGuardianAction: 1 },
        { hasPayoutMethod: true, ready: true, reasonCode: null, requiresGuardianAction: true },
    ])("rejects unsafe or contradictory projection %j", patch => expect(validMinorBankContext({ ...context, ...patch }, owner)).toBe(false));
    it.each([null, undefined, [], true, "context"])("rejects absent or non-object projection %j", value => expect(validMinorBankContext(value, owner)).toBe(false));
});

const validToken = { token: { id: "btok_safeFixture", type: "bank_account", livemode: true, bank_account: { currency: "eur" } } } as TokenResult;
const iban = {} as StripeIbanElement;
function setup(result: TokenResult = validToken) {
    const createToken = vi.fn().mockResolvedValue(result);
    return { stripe: { createToken } as unknown as Pick<Stripe, "createToken">, createToken, iban, holderName: "  Kim Beispiel  ", isCurrentOwner: () => true, onSave: vi.fn().mockResolvedValue(undefined) };
}

describe("IBAN tokenization and uncertain bank saves", () => {
    it("passes only Stripe's iframe element and holder name directly to Stripe", async () => {
        const attempt = new InitialBankAttempt(), input = setup();
        await attempt.save(input);
        expect(input.createToken).toHaveBeenCalledExactlyOnceWith(iban, { currency: "eur", account_holder_name: "Kim Beispiel", account_holder_type: "individual" });
        expect(input.onSave).toHaveBeenCalledExactlyOnceWith("btok_safeFixture"); expect(attempt.hasToken).toBe(false);
    });
    it("retains the single-use token only in memory for a failed or uncertain API response", async () => {
        const attempt = new InitialBankAttempt(), input = setup();
        input.onSave.mockRejectedValueOnce(new Error("request_timed_out"));
        await expect(attempt.save(input)).rejects.toThrow("request_timed_out"); expect(attempt.hasToken).toBe(true);
        await attempt.save(input);
        expect(input.createToken).toHaveBeenCalledTimes(1); expect(input.onSave).toHaveBeenNthCalledWith(2, "btok_safeFixture"); expect(attempt.hasToken).toBe(false);
    });
    it("allows a fresh token only after the server confirms a before-write invalid-token rejection", async () => {
        const attempt = new InitialBankAttempt(), input = setup();
        input.onSave.mockRejectedValueOnce(new PaymentRequestError("Bitte erneut eingeben.", "recipient_bank_token_invalid"));
        await expect(attempt.save(input)).rejects.toThrow("Bitte erneut eingeben."); expect(attempt.hasToken).toBe(false);
        await attempt.save(input); expect(input.createToken).toHaveBeenCalledTimes(2); expect(input.onSave).toHaveBeenCalledTimes(2);
    });
    it("retains a token for other server failures whose outcome can be uncertain", async () => {
        const attempt = new InitialBankAttempt(), input = setup();
        input.onSave.mockRejectedValueOnce(new PaymentRequestError("Stand prüfen.", "recipient_setup_unavailable"));
        await expect(attempt.save(input)).rejects.toThrow("Stand prüfen."); expect(attempt.hasToken).toBe(true);
        await attempt.save(input); expect(input.createToken).toHaveBeenCalledTimes(1);
    });
    it("does not tokenize or send anything after an owner switch", async () => {
        const attempt = new InitialBankAttempt(), input = setup(); input.isCurrentOwner = () => false;
        await expect(attempt.save(input)).rejects.toThrow("Bitte öffne Workfare Pay");
        expect(input.createToken).not.toHaveBeenCalled(); expect(input.onSave).not.toHaveBeenCalled();
    });
    it("drops a token returned after the owner changed while Stripe was responding", async () => {
        const attempt = new InitialBankAttempt(), input = setup(); let current = true;
        input.isCurrentOwner = () => current; input.createToken.mockImplementation(async () => { current = false; return validToken; });
        await expect(attempt.save(input)).rejects.toThrow("Bitte öffne Workfare Pay");
        expect(input.onSave).not.toHaveBeenCalled(); expect(attempt.hasToken).toBe(false);
    });
    it("clears an uncertain token on unmount and cannot submit it again", async () => {
        const attempt = new InitialBankAttempt(), input = setup(); input.onSave.mockRejectedValueOnce(new Error("network"));
        await expect(attempt.save(input)).rejects.toThrow("network"); attempt.dispose();
        expect(attempt.hasToken).toBe(false); await expect(attempt.save(input)).rejects.toThrow("Bitte öffne Workfare Pay"); expect(input.onSave).toHaveBeenCalledTimes(1);
    });
    it.each([
        { token: { ...validToken.token, id: "tok_card" } }, { token: { ...validToken.token, livemode: false } },
        { token: { ...validToken.token, type: "card" } }, { token: { ...validToken.token, bank_account: { currency: "usd" } } },
        { token: { ...validToken.token, bank_account: undefined } }, { token: { ...validToken.token, id: `btok_${"a".repeat(196)}` } },
        { error: { message: "Bitte prüfe deine IBAN." } }, {},
    ])("does not submit a wrong-mode, non-bank or failed token %j", async result => {
        const attempt = new InitialBankAttempt(), input = setup(result as TokenResult);
        await expect(attempt.save(input)).rejects.toThrow(); expect(input.onSave).not.toHaveBeenCalled(); expect(attempt.hasToken).toBe(false);
    });
    it("prevents concurrent tokenization and duplicate app saves", async () => {
        const attempt = new InitialBankAttempt(), input = setup(); let resolve!: (value: TokenResult) => void;
        input.createToken.mockReturnValue(new Promise<TokenResult>(done => { resolve = done; }));
        const pending = attempt.save(input); await attempt.save(input); resolve(validToken); await pending;
        expect(input.createToken).toHaveBeenCalledTimes(1); expect(input.onSave).toHaveBeenCalledTimes(1);
    });
    it("sends only the bank token and explicit consent to the existing authenticated API", async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...context, hasPayoutMethod: true }) }); vi.stubGlobal("fetch", fetch);
        try {
            await paymentRequest("/api/payments/recipient/bank", { consent: true, bankToken: "btok_safeFixture", guardianId: parent, restart: true }, "stable-operation", owner);
            expect(fetch).toHaveBeenCalledWith("/api/payments/recipient/bank", expect.objectContaining({ headers: { "Content-Type": "application/json", "idempotency-key": "stable-operation", "X-Workfare-Owner": owner }, body: JSON.stringify({ consent: true, bankToken: "btok_safeFixture", guardianId: parent, restart: true }) }));
        } finally { vi.unstubAllGlobals(); }
    });
});
