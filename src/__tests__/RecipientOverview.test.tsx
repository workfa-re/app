import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecipientPaymentSummary } from "@/lib/payments/recipient-summary-types";
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
import { RecipientOverviewView, validRecipientPaymentSummary } from "@/components/payments/RecipientOverview";

const ownerId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const summary: RecipientPaymentSummary = {
    ownerId, kind: "sandbox", currency: "eur", checkedAt: "2026-10-24T10:00:00Z",
    earnings: { scope: "confirmed_workfare_payments", confirmedCents: 6_500, refundedCents: 1_500, underReviewCents: 0, underReviewCount: 0, paidJobs: 4 },
    funds: { kind: "sandbox", currency: "eur", availableCents: 1_250, pendingCents: 3_300, schedule: "daily", stripePayoutsEnabled: true,
        hasPayoutMethod: true, canRequestPayout: false, canRetainBalance: false, disabledReason: "retention_monitor_required", maxHoldingDays: 90, checkedAt: "2026-10-24T10:00:00Z" },
    payouts: { paidOutCents: 1_500, inTransitCents: 0, coverage: "complete", checkedAt: "2026-10-24T10:00:00Z", recent: [
        { id: "po_fixture123", amountCents: 1_500, status: "paid", arrivalAt: "2026-10-23T00:00:00Z", createdAt: "2026-10-22T10:00:00Z", automatic: true },
    ] },
    fundsUnavailableReason: null,
    recentPayments: [{ id: "33333333-3333-4333-8333-333333333333", applicationId, title: "Pflanzen versorgen", earningsCents: 2_000, state: "paid", startsAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T12:00:00Z" }],
};
const render = (value: RecipientPaymentSummary | null, props: Partial<Parameters<typeof RecipientOverviewView>[0]> = {}) => renderToStaticMarkup(
    <RecipientOverviewView summary={value} loading={false} error={null} onRetry={vi.fn()} {...props} />,
);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("recipient financial overview", () => {
    it("separates available, pending, confirmed earnings and payouts without inventing a total balance", () => {
        const html = text(render(summary));
        for (const value of ["Verfügbar", "In Bearbeitung", "Bestätigt verdient", "Bereits ausgezahlt", "12,50", "33,00", "65,00", "15,00"]) expect(html).toContain(value);
        expect(html).not.toContain("45,50");
        expect(html).not.toContain("Bankkonto eröffnen");
        expect(html).toContain("Eine Bankauszahlung ist ein eigener Schritt");
    });

    it("makes confirmed earnings prominent on the home page and links to the single Pay surface", () => {
        const html = render(summary, { compact: true });
        expect(html).toContain('href="/app-home/settings/payments"');
        expect(html).toContain("Workfare Pay öffnen");
        expect(html).toContain("4 bezahlte Termine");
        expect(html).toContain("Testbetrieb");
        expect(html).not.toContain("Letzte Vorgänge");
    });
    it("shows live earnings without relabeling sandbox funds as real money", () => {
        const live = { ...summary, kind: "live" as const, funds: { ...summary.funds!, kind: "live" as const } };
        expect(validRecipientPaymentSummary(live, ownerId)).toBe(true);
        const html = render(live, { compact: true });
        expect(html).toContain("65,00"); expect(html).toContain("12,50");
        expect(html).not.toMatch(/Testbetrieb|Simulation|Kein Echtgeld/);
        expect(validRecipientPaymentSummary({ ...summary, kind: "live" }, ownerId)).toBe(false);
        expect(validRecipientPaymentSummary({ ...live, fundsUnavailableReason: "local_simulation" }, ownerId)).toBe(false);
    });

    it("keeps loading or failed data distinct from a confirmed zero", () => {
        const pending = render(null, { loading: true });
        const failed = render(null, { error: "Nicht erreichbar" });
        expect(pending).toContain('role="status"'); expect(pending).not.toContain("0,00");
        expect(failed).toContain('role="alert"'); expect(failed).toContain("Erneut versuchen"); expect(failed).not.toContain("0,00");
    });

    it("does not turn missing minor payout readiness into a zero Stripe balance", () => {
        const html = render({ ...summary, funds: null, payouts: null, earnings: { ...summary.earnings, confirmedCents: 0, paidJobs: 0 }, fundsUnavailableReason: "minor_review_required" });
        const amounts = html.match(/<dl[^>]*>[\s\S]*?<\/dl>/)?.[0];
        expect(amounts).toContain("Bestätigt verdient</dt><dd><span>0,00");
        expect(amounts).toContain("Verfügbar</dt><dd><span>—</span>");
        expect(amounts).toContain("In Bearbeitung</dt><dd><span>—</span>");
        expect(amounts).toContain("Bereits ausgezahlt</dt><dd><span>—</span>");
        expect(html).toContain("Bankauszahlungen für Minderjährige sind noch nicht freigegeben");
        expect(html).not.toContain("Auszahlungen ansehen");
    });

    it("preserves a verified negative available balance", () => {
        const html = render({ ...summary, funds: { ...summary.funds!, availableCents: -500 } });
        expect(html).toContain("-5,00");
    });

    it("excludes disputed amounts from promises and keeps a direct path to the related conversation", () => {
        const html = render({ ...summary, earnings: { ...summary.earnings, underReviewCents: 4_000, underReviewCount: 1 } });
        expect(html).toContain("Ein Zahlungsvorgang wird");
        expect(html).toContain("noch nicht enthalten");
        expect(html).toContain(`href="/app-home/activities?conversation=${applicationId}"`);
        expect(html).not.toContain("105,00");
    });

    it("never labels a partial payout scan as lifetime paid out", () => {
        const value = { ...summary, payouts: { ...summary.payouts!, coverage: "recent_only" as const, paidOutCents: null, inTransitCents: null } };
        const html = render(value);
        expect(html).toContain("Die Auszahlungen zeigen die letzten Vorgänge");
        expect(html).toMatch(/Bereits ausgezahlt<\/dt><dd><span>—/);
    });
    it("keeps proven balances visible and explains an unavailable payout history", () => {
        const value = { ...summary, payouts: null, fundsUnavailableReason: "provider_unavailable" as const };
        const html = render(value);
        expect(html).toContain("Der Auszahlungsverlauf ist gerade nicht verfügbar.");
        expect(html).toContain("Verfügbar</dt><dd><span>12,50");
        expect(html).not.toContain("Der aktuelle Stripe-Guthabenstand konnte nicht bestätigt werden");
        expect(render(value, { compact: true })).not.toContain("Der Auszahlungsverlauf ist gerade nicht verfügbar.");
    });

    it("offers payout controls only when the caller has a working Stripe action", () => {
        expect(render(summary)).not.toContain("Auszahlungen ansehen");
        const html = render(summary, { onPayouts: vi.fn(), onFunds: vi.fn() });
        expect(html).toContain("Auszahlungen ansehen"); expect(html).toContain("Guthaben bei Stripe");
        expect(html).not.toContain("Jetzt auszahlen"); expect(html).not.toContain("Geld behalten");
    });
    it("keeps Stripe controls in place but disabled while a financial action is running", () => {
        const html = render(summary, { busy: true, onPayouts: vi.fn(), onFunds: vi.fn() });
        const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
        for (const label of ["Auszahlungen ansehen", "Guthaben bei Stripe"]) {
            const button = buttons.find(value => value.includes(label));
            expect(button).toBeDefined(); expect(button).toContain('disabled=""');
        }
        expect(buttons.find(value => value.includes('aria-label="Zahlungsübersicht aktualisieren"'))).toContain('disabled=""');
    });
    it.each([{ stripePayoutsEnabled: false }, { hasPayoutMethod: false }])("disables Stripe controls when the latest required payout readiness is absent (%j)", flags => {
        const html = render({ ...summary, funds: { ...summary.funds!, ...flags } }, { onPayouts: vi.fn(), onFunds: vi.fn() });
        const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
        for (const label of ["Auszahlungen ansehen", "Guthaben bei Stripe"]) expect(buttons.find(value => value.includes(label))).toContain('disabled=""');
    });
    it("does not depict a proposed price as an incoming payment", () => {
        const html = render({ ...summary, payouts: null, recentPayments: [{ ...summary.recentPayments[0], state: "awaiting_confirmation" }] });
        expect(html).toContain("Letzte Vorgänge"); expect(html).toContain("Preis vorgeschlagen");
        expect(html).toContain("lucide-file-text"); expect(html).not.toContain("lucide-arrow-down-left");
    });
});

describe("financial response validation", () => {
    it("accepts only a bound, complete own response, including negative available funds", () => {
        expect(validRecipientPaymentSummary(summary, ownerId)).toBe(true);
        expect(validRecipientPaymentSummary({ ...summary, funds: { ...summary.funds!, availableCents: -500 } }, ownerId)).toBe(true);
        expect(validRecipientPaymentSummary({ ...summary, funds: null, payouts: null, fundsUnavailableReason: "recipient_setup_required" }, ownerId)).toBe(true);
        expect(validRecipientPaymentSummary({ ...summary, kind: "local", funds: null, payouts: null, fundsUnavailableReason: "local_simulation" }, ownerId)).toBe(true);
    });
    it.each([
        { ownerId: applicationId }, { kind: ["sandbox"] }, { kind: "live" }, { currency: "usd" }, { checkedAt: "unknown" },
        { earnings: { ...summary.earnings, confirmedCents: 1.2 } }, { earnings: { ...summary.earnings, confirmedCents: Number.MAX_SAFE_INTEGER + 1 } },
        { funds: { ...summary.funds!, canRequestPayout: true } },
        { payouts: { ...summary.payouts!, coverage: "recent_only" } },
        { payouts: { ...summary.payouts!, coverage: ["complete"] } },
        { payouts: { ...summary.payouts!, paidOutCents: null } },
        { payouts: { ...summary.payouts!, inTransitCents: null } },
        { kind: "local", fundsUnavailableReason: "local_simulation" },
        { kind: "local", funds: null, payouts: null, fundsUnavailableReason: "recipient_setup_required" },
        { recentPayments: [{ ...summary.recentPayments[0], applicationId: "https://evil.test" }] },
        { recentPayments: [{ ...summary.recentPayments[0], state: "made_up" }] },
    ])("rejects malformed or unconfirmed financial data (%j)", patch => {
        expect(validRecipientPaymentSummary({ ...summary, ...patch }, ownerId)).toBe(false);
    });
});
