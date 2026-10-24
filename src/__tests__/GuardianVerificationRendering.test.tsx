import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
import { GuardianVerificationForm, GuardianVerificationError, GuardianVerificationView, validGuardianVerificationContext, type GuardianVerificationContext } from "@/components/guardian/GuardianVerificationForm";
import { paymentRequest } from "@/components/payments/payment-client";

const parent = "11111111-1111-4111-8111-111111111111", child = "22222222-2222-4222-8222-222222222222";
const address = { line1: "Beispielweg 3", postalCode: "53359", city: "Rheinbach", country: "DE" as const };
const context: GuardianVerificationContext = { ownerId: parent, childId: child, kind: "live", guardianName: "Alex Beispiel", childName: "Kim Beispiel", guardianBirthdate: "1980-01-05", childBirthdate: "2011-04-15", guardianGivenName: null, guardianSurname: null, childGivenName: null, childSurname: null, guardianAddress: null, childAddress: null, childSameAddress: false, guardianAddressRequired: false, childAddressRequired: true, canSubmit: true, needsAdditionalVerification: false, requirements: ["identity.individual.address.city"], ready: false };
const render = (patch: Partial<GuardianVerificationContext> = {}, props: Partial<Parameters<typeof GuardianVerificationView>[0]> = {}) => renderToStaticMarkup(<GuardianVerificationView context={{ ...context, ...patch }} busy={false} submitted={false} onSave={vi.fn()} onAdditionalVerification={vi.fn()} {...props} />);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
afterEach(() => vi.unstubAllGlobals());

describe("native parent payout confirmation", () => {
    it("keeps parents inside Workfare with known identities and only current missing requirements", () => {
        const html = render();
        expect(text(html)).toContain("Ein eigener Stripe-Zugang ist nicht nötig");
        expect(html).toContain("Alex Beispiel"); expect(html).toContain("Kim Beispiel");
        expect(html).toContain("1980"); expect(html).toContain("2011");
        expect(html).toContain("Wohnanschrift deines Kindes"); expect(html).not.toContain("Deine Wohnanschrift");
        expect(html).not.toContain("Mein Kind wohnt an derselben Adresse");
        expect(html).not.toMatch(/<iframe|Kontoverbindung|Unternehmen|Gewerbe|Stripe-Konto erstellen|name="(?:iban|birthdate|email|document)"/);
    });
    it("does not treat prior Workfare permission as current Stripe agreement acceptance", () => {
        const html = render();
        expect(html).toContain('type="checkbox"'); expect(html).not.toContain('checked=""');
        expect(html).toMatch(/type="submit"[^>]*disabled=""/);
        expect(html).toContain('href="https://stripe.com/connect-account/legal/full"');
        expect(html).toContain('href="https://stripe.com/privacy"');
        expect(text(html)).toContain("Stripe verarbeitet die erforderlichen Angaben");
        expect(text(html)).toContain("als gesetzliche Vertretung für Kim Beispiel");
    });
    it("collects an adult address only when the current Stripe requirements require it", () => {
        expect(render()).not.toContain("Deine Wohnanschrift");
        const html = render({ guardianAddressRequired: true });
        expect(html).toContain("Deine Wohnanschrift"); expect(html).toContain("Wohnanschrift deines Kindes");
        expect(html).toContain("Mein Kind wohnt an derselben Adresse"); expect(html).not.toContain('checked=""');
        expect(render({ guardianAddressRequired: false, childAddressRequired: false })).not.toContain("Straße und Hausnummer");
    });
    it("never assumes a shared home address from unknown addresses", () => {
        const html = render({ guardianAddressRequired: true, guardianAddress: address, childAddress: null });
        expect(html).not.toContain('checked=""'); expect(html).toContain("Wohnanschrift deines Kindes");
        const actualShared = render({ guardianAddressRequired: true, guardianAddress: address, childAddress: address, childSameAddress: true });
        expect(actualShared).toContain('checked=""'); expect(actualShared).not.toContain("Wohnanschrift deines Kindes");
        expect(actualShared).toMatch(/type="submit"[^>]*disabled=""/);
    });
    it("uses profile names as visible, editable suggestions without submitting during render", () => {
        const save = vi.fn(), html = render({}, { onSave: save });
        expect(html).toContain('value="Alex"'); expect(html).toContain('value="Beispiel"');
        expect(html).toContain('value="Kim"'); expect(save).not.toHaveBeenCalled();
    });
    it("does not infer readiness from submission, and keeps additional requirements actionable", () => {
        const after = text(render({ canSubmit: false }, { submitted: true }));
        expect(after).toContain("Deine Angaben wurden übermittelt"); expect(after).not.toContain("ist eingerichtet");
        const additional = render({ canSubmit: false, needsAdditionalVerification: true }, { submitted: true });
        expect(text(additional)).toContain("Zusätzliche Prüfung"); expect(additional).not.toContain('type="submit"');
        const moreFields = render({ guardianAddressRequired: true }, { submitted: true });
        expect(text(moreFields)).toContain("Bitte ergänze noch"); expect(moreFields).toContain("Deine Wohnanschrift");
    });
    it("shows ready only after a ready server response", () => {
        const html = render({ canSubmit: false, ready: true, requirements: [] });
        expect(text(html)).toBe("Die Auszahlung für Kim Beispiel ist eingerichtet."); expect(html).not.toContain("<form");
    });
    it("locks exactly submitted details during an uncertain retry", () => {
        const html = render({ guardianAddressRequired: true, guardianAddress: address, childAddress: address }, { retryLocked: true });
        expect(html).toContain("Übermittlung erneut bestätigen"); expect(html).toMatch(/<fieldset[^>]*disabled=""/);
        expect(html).toMatch(/type="checkbox"[^>]*disabled=""/);
    });
    it("binds the context to the selected parent and child, validates dates, and rejects readiness contradictions", () => {
        expect(validGuardianVerificationContext(context, parent, child)).toBe(true);
        for (const patch of [{ kind: "sandbox" }, { ownerId: child }, { childId: parent }, { childId: "other" }, { guardianBirthdate: "1980-99-01" }, { childBirthdate: "2011-02-30" }, { ready: true, canSubmit: true }, { ready: true, canSubmit: false, needsAdditionalVerification: true }, { guardianAddressRequired: "yes" }, { guardianAddress: { ...address, country: "US" } }, { childGivenName: "Kim\n" }, { requirements: ["x".repeat(501)] }]) {
            expect(validGuardianVerificationContext({ ...context, ...patch }, parent, child)).toBe(false);
        }
        expect(validGuardianVerificationContext(context, parent, parent)).toBe(false);
    });
    it("does not send identity or consent data while the new form renders", () => {
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        const html = renderToStaticMarkup(<GuardianVerificationForm ownerId={parent} childId={child} onClose={vi.fn()} onUpdated={vi.fn()} onAdditionalVerification={vi.fn()} />);
        expect(text(html)).toContain("Auszahlung freigeben"); expect(fetch).not.toHaveBeenCalled();
    });
    it("keeps an authoritative reload available after uncertain or additional-verification errors", () => {
        const reload = vi.fn();
        const error = renderToStaticMarkup(<GuardianVerificationError message="Weitere Prüfung erforderlich" busy={false} onReload={reload} />);
        expect(text(error)).toContain("Aktuellen Stand laden"); expect(error).toContain('role="alert"');
        expect(error).not.toMatch(/disabled=""|<iframe|Stripe-Zugang/); expect(reload).not.toHaveBeenCalled();
        const pending = renderToStaticMarkup(<GuardianVerificationError message="Stand wird geladen" busy onReload={reload} />);
        expect(pending).toMatch(/type="button"[^>]*disabled=""/);
        const profileFix = renderToStaticMarkup(<GuardianVerificationError message="Vollständige Namen benötigen eine sichere Korrektur" busy={false} canReload={false} onReload={reload} />);
        expect(profileFix).not.toContain("<button"); expect(profileFix).toContain('role="alert"');
        const locked = render({}, { retryLocked: true });
        expect(locked).toContain("Übermittlung erneut bestätigen");
        const authoritative = render({ canSubmit: false, needsAdditionalVerification: true, requirements: ["identity.individual.documents.primary_verification"] });
        expect(text(authoritative)).toContain("Zusätzliche Prüfung");
        expect(authoritative).not.toContain('type="submit"');
    });
    it("sends only the explicit nested confirmation with current owner and a stable operation", async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => context }); vi.stubGlobal("fetch", fetch);
        const body = { childId: child, consent: true, guardian: { givenName: "Alex", surname: "Beispiel" }, child: { givenName: "Kim", surname: "Beispiel", address } };
        await paymentRequest("/api/payments/guardian/verification", body, "same-operation", parent);
        expect(fetch).toHaveBeenCalledWith("/api/payments/guardian/verification", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json", "idempotency-key": "same-operation", "X-Workfare-Owner": parent }, body: JSON.stringify(body) }));
        expect(JSON.stringify(body)).not.toMatch(/birthdate|email|verified|accountRef|guardianId|clientSecret/);
    });
});
