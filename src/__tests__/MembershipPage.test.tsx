import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_DEFAULT_OFFER, type MembershipSnapshot } from "@/lib/payments/subscription-types";
import { quoteBundleServiceFee } from "@/lib/payments/tariff";
import { membershipExample, trustedMembershipUrl, validMembershipSnapshot } from "@/components/membership/membership-display";

vi.mock("@/components/payments/PaymentMotion", () => ({ PaymentMotion: () => <div aria-hidden="true" /> }));
vi.mock("@/components/payments/usePaymentOwner", () => ({ PAYMENT_OWNER_CHANGED: "Bitte neu anmelden.", usePaymentOwner: () => ({ isCurrentOwner: () => true, ownerChanged: false }) }));
import { MembershipCalculator, MembershipView } from "@/components/membership/MembershipPage";

const ownerId = "11111111-1111-4111-8111-111111111111";
const snapshot: MembershipSnapshot = { ownerId, kind: "live", offer: MEMBERSHIP_DEFAULT_OFFER, membership: { status: "none", entitled: false, currentPeriodEnd: null, cancelAtPeriodEnd: false, contractReference: null }, checkoutAvailable: true, manageAvailable: false };
const render = (value: MembershipSnapshot | null = snapshot, props: Partial<Parameters<typeof MembershipView>[0]> = {}) => renderToStaticMarkup(<MembershipView snapshot={value} loading={false} busy={null} error={null} message={null} confirmation={null} onAction={vi.fn()} onReload={vi.fn()} onConfirmation={vi.fn()} {...props} />);

describe("Workfare Plan display boundary", () => {
    it("requires exact ownership and a complete paid-membership snapshot", () => {
        expect(validMembershipSnapshot(snapshot, ownerId)).toBe(true);
        expect(validMembershipSnapshot({ ...snapshot, ownerId: "22222222-2222-4222-8222-222222222222" }, ownerId)).toBe(false);
        expect(validMembershipSnapshot({ ...snapshot, membership: { ...snapshot.membership, entitled: "true" } }, ownerId)).toBe(false);
        expect(validMembershipSnapshot({ ...snapshot, membership: { ...snapshot.membership, status: "trialing", entitled: true, currentPeriodEnd: "2026-11-25T00:00:00Z" } }, ownerId)).toBe(false);
        expect(validMembershipSnapshot({ ...snapshot, membership: { ...snapshot.membership, status: "active", entitled: true } }, ownerId)).toBe(false);
        expect(validMembershipSnapshot({ ...snapshot, membership: { ...snapshot.membership, status: "active", entitled: true, currentPeriodEnd: "2026-11-25T00:00:00Z" } }, ownerId)).toBe(true);
    });
    it.each(["http://checkout.stripe.com/c/pay/a", "https://checkout.stripe.com.evil.test/pay", "https://user:password@pay.workfa.re/checkout", "https://pay.workfa.re:8443/checkout", "/api/payments/membership", "javascript:alert(1)"])("rejects an untrusted handoff destination: %s", value => expect(trustedMembershipUrl(value)).toBe(false));
    it.each(["https://checkout.stripe.com/c/pay/cs_live_fixture", "https://billing.stripe.com/p/session/example", "https://pay.workfa.re/c/pay/cs_live_fixture"])("allows only the established payment hosts: %s", value => expect(trustedMembershipUrl(value)).toBe(true));
});

describe("honest plan calculation", () => {
    it.each([100, 125, 1700, 5000, 9834, 9999, 12345])("matches the tariff per job including component rounding at %i cents", amount => {
        const example = membershipExample(amount, 3, MEMBERSHIP_DEFAULT_OFFER)!;
        expect(example.without).toBe(quoteBundleServiceFee(amount, false).grossCents * 3);
        expect(example.withPlan).toBe(quoteBundleServiceFee(amount, true).grossCents * 3 + 590);
        expect(example.netSaving).toBe(example.without - example.withPlan);
    });
    it("shows when occasional use is cheaper without a plan", () => {
        const example = membershipExample(1700, 1, MEMBERSHIP_DEFAULT_OFFER)!;
        expect(example.netSaving).toBe(-488);
        expect(example.savedFees).toBe(102);
    });
    it("shows the full membership cost when no jobs are paid", () => {
        expect(membershipExample(5000, 0, MEMBERSHIP_DEFAULT_OFFER)).toMatchObject({ without: 0, withPlan: 590, netSaving: -590, totalEarnings: 0 });
    });
    it.each([[100, -1], [100, 101], [100, 1.5], [99, 1], [NaN, 1]])("refuses an invalid monthly example", (amount, jobs) => expect(membershipExample(amount, jobs, MEMBERSHIP_DEFAULT_OFFER)).toBeNull());
});

describe("membership page content", () => {
    it("shows the full recurring price without degrading normal use or promising planned features", () => {
        const html = render();
        expect(html).toContain("5,90"); expect(html).toContain("Zahlungspflichtig abonnieren");
        expect(html).toContain("Monatlich kündbar"); expect(html).toContain("Alle Jobs und Funktionen bleiben auch ohne Abo verfügbar");
        expect(html).toContain("Prozentpunkte weniger"); expect(html).not.toContain("50 % günstiger");
        expect(html).toContain('href="/legal/workfare-plan"'); expect(html).toContain('href="/membership/cancel"'); expect(html).toContain('href="/membership/withdraw"');
        expect(html).toContain("14-tägiges Widerrufsrecht bleibt bestehen");
        expect(html).toMatch(/type="checkbox"/); expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
        expect(html).toContain("Geplant. Noch nicht Bestandteil deines Abos");
        expect(html).toContain("Mehrere Einsatzorte"); expect(html).toContain("Gemeinsames Haushaltsbudget"); expect(html).toContain("Zahlung aufteilen");
        expect(html.match(/Demnächst/g)).toHaveLength(3);
        expect(html).not.toMatch(/Jobvorlagen|Sammelübersichten|Gemeinsam organisieren/);
        expect(html).not.toMatch(/kostenlos testen|Premium|Plus/);
    });
    it("does not expose an enabled purchase for an unavailable offer", () => {
        const html = render({ ...snapshot, checkoutAvailable: false });
        const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(value => value.includes("Zahlungspflichtig abonnieren"));
        expect(html).toContain("Die Buchung ist noch nicht freigeschaltet");
        expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?Zahlungspflichtig abonnieren/);
        expect(button ?? html).not.toContain("Dein Plan ist aktiv");
    });
    it("separates unpaid subscription status from an entitlement", () => {
        const html = render({ ...snapshot, membership: { ...snapshot.membership, status: "past_due" }, checkoutAvailable: false, manageAvailable: true });
        expect(html).toContain("noch nicht als bezahlt bestätigt"); expect(html).not.toContain("Dein Plan ist aktiv");
        expect(html).toContain("Buchungsstand prüfen"); expect(html).toContain("Rechnungen &amp; Zahlungsmittel");
    });
    it("shows cancellation end date and explicit reversible confirmation", () => {
        const active = { ...snapshot, membership: { ...snapshot.membership, status: "active" as const, entitled: true, currentPeriodEnd: "2026-11-25T10:00:00Z", contractReference: "44444444-4444-4444-8444-444444444444" }, checkoutAvailable: false, manageAvailable: true };
        const html = render(active, { confirmation: "cancel" });
        expect(html).toContain("Plan zum Laufzeitende kündigen?"); expect(html).toContain("Kündigung bestätigen");
        expect(html).toContain("25. November 2026"); expect(html).not.toContain("Zahlungspflichtig abonnieren");
        const canceled = render({ ...active, membership: { ...active.membership, cancelAtPeriodEnd: true } });
        expect(canceled).toContain("Aktiv bis"); expect(canceled).toContain("Kündigung zurücknehmen"); expect(canceled).not.toContain("Nächste Verlängerung am");
        expect(canceled).toContain("Vertragsreferenz kopieren"); expect(canceled).toContain("44444444-4444-4444-8444-444444444444");
        expect(canceled).toContain('href="/membership/cancel?contract=44444444-4444-4444-8444-444444444444"');
        expect(canceled).toContain('href="/membership/withdraw?contract=44444444-4444-4444-8444-444444444444"');
    });
    it("keeps a failed or loading status distinct from an active plan", () => {
        expect(render(null, { loading: true })).toContain("Dein Plan wird geladen");
        const html = render(null, { error: "Stand nicht bestätigt" });
        expect(html).toContain('role="alert"'); expect(html).not.toContain("Dein Plan ist aktiv"); expect(html).not.toContain("Zahlungspflichtig abonnieren");
    });
    it("includes the monthly subscription cost in the example", () => {
        const html = renderToStaticMarkup(<MembershipCalculator offer={MEMBERSHIP_DEFAULT_OFFER} />);
        expect(html).toMatch(/^<section\b/);
        expect(html).toContain('type="range"'); expect(html.match(/<input/g)).toHaveLength(1);
        expect(html).toContain('min="0"'); expect(html).toContain('max="12"');
        expect(html).toContain("Beispiel: je 50 € Vergütung"); expect(html).toContain("Jobs pro Monat");
        expect(html).toContain("6,10"); expect(html).toContain("Monatsbeitrag"); expect(html).toContain("günstiger mit Plan");
    });
});
