import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecipientPaymentSummary } from "@/lib/payments/recipient-summary-types";
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
import { RecipientOverviewView, RecipientTransactionHistoryView, validRecipientPaymentSummary } from "@/components/payments/RecipientOverview";

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
const renderHistory = (value: RecipientPaymentSummary | null, props: Partial<Parameters<typeof RecipientTransactionHistoryView>[0]> = {}) => renderToStaticMarkup(
    <RecipientTransactionHistoryView summary={value} loading={false} error={null} onRetry={vi.fn()} {...props} />,
);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("recipient financial overview", () => {
    it("uses a descriptive page heading while retaining Pay branding on the home widget", () => {
        const full = render(summary);
        expect(full).toMatch(/<h2[^>]*>Deine Zahlungsübersicht<\/h2>/);
        expect(full).not.toMatch(/class="[^"]*wordmark/);
        const home = render(summary, { compact: true });
        expect(home).toMatch(/class="[^"]*wordmark/);
        expect(home).toContain("Workfare Pay öffnen");
        expect(home).not.toContain("<h2");
        expect(home).toContain("lucide-wallet-cards");
    });
    it("separates available, pending, confirmed earnings and payouts without inventing a total balance", () => {
        const html = text(render(summary));
        for (const value of ["Verfügbar", "In Bearbeitung", "Gesamtverdienst", "Bereits ausgezahlt", "12,50", "33,00", "65,00", "15,00"]) expect(html).toContain(value);
        expect(html).not.toContain("45,50");
        expect(html).not.toContain("Bankkonto eröffnen");
        expect(html).not.toContain("So setzt sich deine Übersicht zusammen");
        expect(html).not.toContain("Stand ");
    });

    it("keeps home compact with only available funds and lifetime earnings", () => {
        const html = render(summary, { compact: true });
        expect(html).toContain('href="/app-home/settings/payments"');
        expect(html).toContain("Workfare Pay öffnen");
        expect(html).not.toContain("bezahlte Termine");
        expect(html).toContain("Testbetrieb");
        expect(html).not.toContain("Letzte Vorgänge");
        const terms = [...html.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]);
        expect(terms).toEqual(["Verfügbar", "Gesamtverdienst"]);
        expect(html).toContain("Verfügbar</dt><dd><span>12,50");
        expect(html).not.toContain("Stand ");
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
        expect(amounts).toContain("Gesamtverdienst</dt><dd><span>0,00");
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

    it("keeps disputed amounts outside earnings without introducing a general confirmation step", () => {
        const html = renderHistory({ ...summary, earnings: { ...summary.earnings, underReviewCents: 4_000, underReviewCount: 1 },
            recentPayments: [{ ...summary.recentPayments[0], state: "review_required" }] });
        expect(html).not.toMatch(/Eine Zahlung wird|erst nach Bestätigung|Nachrichten öffnen/);
        expect(html).toContain("Zahlung in Klärung");
        expect(html).toContain(`href="/app-home/activities?conversation=${applicationId}"`);
        expect(html).not.toContain("105,00");
    });

    it("never labels a partial payout scan as lifetime paid out", () => {
        const value = { ...summary, payouts: { ...summary.payouts!, coverage: "recent_only" as const, paidOutCents: null, inTransitCents: null } };
        const html = render(value);
        expect(html).toContain("Die Gesamtsumme deiner Auszahlungen ist gerade nicht verfügbar.");
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

    it("keeps the main summary focused on its figures and refresh control", () => {
        const html = render(summary, { onPayouts: vi.fn() });
        expect(html).not.toMatch(/Auszahlungen ansehen|Guthaben ansehen|Dein Guthaben|Letzte Vorgänge|Transaktionshistorie|<details/);
        expect(html).not.toContain("Pflanzen versorgen");
        const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toContain('aria-label="Zahlungsübersicht aktualisieren"');
    });
    it("disables summary refresh while a financial action is running", () => {
        const html = render(summary, { busy: true });
        expect(html.match(/<button\b[^>]*>/)?.[0]).toContain('disabled=""');
    });
    it("does not depict a proposed price as an incoming payment", () => {
        const html = renderHistory({ ...summary, payouts: null, recentPayments: [{ ...summary.recentPayments[0], state: "awaiting_confirmation" }] });
        expect(html).toContain("Preis vorgeschlagen");
        expect(html).toContain("lucide-file-text"); expect(html).not.toContain("lucide-arrow-down-left");
    });
    it("uses Workfare Pay wording when the available balance cannot be confirmed", () => {
        const html = render({ ...summary, funds: null, payouts: null, fundsUnavailableReason: "provider_unavailable" });
        expect(html).toContain("Dein Guthaben bei Workfare Pay konnte gerade nicht geladen werden.");
        expect(html).not.toMatch(/Stripe-(?:Guthaben|Kunden)stand/);
    });
    it("keeps bank payouts in transit separate from unsettled payments and paid-out totals", () => {
        const html = render({ ...summary, payouts: { ...summary.payouts!, inTransitCents: 700 } });
        expect(text(html)).toContain("7,00 € auf dem Weg zu deinem Bankkonto");
        expect(html).toContain("In Bearbeitung</dt><dd><span>33,00");
        expect(html).not.toContain("40,00");
    });
    it("shows the glass discovery action only before the first earnings", () => {
        const empty = { ...summary, payouts: null, recentPayments: [], earnings: { ...summary.earnings, confirmedCents: 0, refundedCents: 0, paidJobs: 0 } };
        const html = renderHistory(empty);
        expect(render(empty)).not.toContain("Jobs entdecken");
        expect(html).toContain("Noch keine Transaktionen.");
        expect(html).toMatch(/<a[^>]*class="app-glass-control [^"]*"[^>]*>Jobs entdecken/);
        for (const earnings of [{ confirmedCents: 100 }, { refundedCents: 100 }, { paidJobs: 1 }]) {
            const existing = renderHistory({ ...empty, earnings: { ...empty.earnings, ...earnings } });
            expect(existing).not.toContain("Dein erster Verdienst");
            expect(existing).not.toContain("Jobs entdecken");
        }
    });
});

describe("recipient overview focus",()=>{
 it("gives the two headline values equal priority and places secondary values below",()=>{
  const html=render(summary);const terms=[...html.matchAll(/<dt>(.*?)<\/dt>/g)].map(match=>match[1]);
  expect(terms).toEqual(["Verfügbar","Gesamtverdienst","In Bearbeitung","Bereits ausgezahlt"]);
  expect(html.match(/class="[^"]*primary[^"]*"/g)).toHaveLength(2);
 });
 it("keeps processing, review and unavailable-history notices off the home widget",()=>{
  const html=render({...summary,earnings:{...summary.earnings,underReviewCount:1,underReviewCents:4000},payouts:{...summary.payouts!,inTransitCents:700}}, {compact:true});
  expect(html).not.toMatch(/geprüft|Nachrichten öffnen|auf dem Weg|In Bearbeitung|Bereits ausgezahlt|Guthaben ansehen|Letzte/);
  expect(html.match(/<dt>/g)).toHaveLength(2);
 });
 it("keeps payment clarification on the affected movement and opens its own conversation",()=>{
  const html=renderHistory({...summary,earnings:{...summary.earnings,underReviewCount:1,underReviewCents:2000},recentPayments:[{...summary.recentPayments[0],state:"review_required"}]});
  const movement=html.match(new RegExp('<a[^>]*href="/app-home/activities\\?conversation='+applicationId+'"[^>]*>[\\s\\S]*?</a>'))?.[0];
  expect(movement).toContain("Pflanzen versorgen");expect(movement).toContain("Zahlung in Klärung");
  expect(html).not.toContain("erst nach Bestätigung");
 });
 it("keeps unavailable balances and the transaction history separate",()=>{
  const value={...summary,funds:null};
  expect(render(value)).not.toContain("Pflanzen versorgen");
  expect(renderHistory(value)).toContain("Pflanzen versorgen");
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

describe("settlement information inside Workfare", () => {
    it("explains bank processing without requesting another approval or duplicating the balance", () => {
        const html = render(summary);
        expect(html).toContain("Die Beträge in Bearbeitung werden für deine Bankauszahlung verarbeitet.");
        expect(html).not.toMatch(/Freigabe wird noch bestätigt|erst nach Bestätigung|bestätigen|Dein Guthaben/);
        expect(html).toMatch(/Verfügbar<\/dt><dd><span>12,50/);
        expect(html).toMatch(/In Bearbeitung<\/dt><dd><span>33,00/);
        expect(html.match(/<dl\b/g)).toHaveLength(1);
    });
    it("shows a verified availability date beside the summary and keeps bank information in its own utility", () => {
        const value = { ...summary, funds: { ...summary.funds!, pendingAvailableAt: "2026-10-28T00:00:00Z", bank: { bankName: "Testbank", last4: "6789", country: "DE", currency: "eur" as const } } };
        const html = render(value);
        expect(html).toMatch(/datetime="2026-10-28T00:00:00Z"/i);
        expect(html).toContain("voraussichtlich auszahlbar am");
        expect(html).not.toMatch(/Testbank|6789|Auszahlungseinstellungen ändern|Melden Sie sich an|<iframe|acct_|ba_/);
        expect(render(value, { compact: true })).not.toContain("voraussichtlich");
    });
    it("does not accept an invented or malformed availability timestamp", () => {
        expect(validRecipientPaymentSummary({ ...summary, funds: { ...summary.funds!, pendingAvailableAt: "unknown" } }, ownerId)).toBe(false);
    });
});

describe("separate transaction history", () => {
    it("starts collapsed as a utility row and keeps refresh outside its summary", () => {
        const html = renderHistory(summary);
        expect(html).toMatch(/^<details class="/);
        expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
        const heading = html.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0];
        expect(heading).toContain("Transaktionshistorie");
        expect(heading).not.toMatch(/<button|<a\b/);
        expect(html).toContain('aria-label="Transaktionshistorie aktualisieren"');
        expect(html).not.toMatch(/Guthaben ansehen|Dein Guthaben/);
    });
    it("preserves the payment and payout status, date, amount, and conversation destination", () => {
        const html = renderHistory(summary);
        for (const value of ["Zahlungen", "Bankauszahlungen", "Pflanzen versorgen", "Bezahlt", "20,00", "Automatische Bankauszahlung", "Ausgezahlt", "15,00", "22. Okt. 2026"]) expect(text(html)).toContain(value);
        expect(html).toContain(`href="/app-home/activities?conversation=${applicationId}"`);
    });
    it("does not add an external payout action without the caller's supported action", () => {
        expect(renderHistory(summary)).not.toContain("Alle Auszahlungen");
        expect(renderHistory(summary, { onPayouts: vi.fn() })).toContain("Alle Auszahlungen");
        expect(renderHistory({ ...summary, funds: null }, { onPayouts: vi.fn() })).not.toContain("Alle Auszahlungen");
    });
    it.each([{ busy: true }, { stripePayoutsEnabled: false }, { hasPayoutMethod: false }])("preserves payout-action readiness during %j", flags => {
        const html = renderHistory({ ...summary, funds: { ...summary.funds!, ...flags } }, { onPayouts: vi.fn(), busy: "busy" in flags && flags.busy });
        const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
        expect(buttons.find(button => button.includes("Alle Auszahlungen"))).toContain('disabled=""');
    });
    it("distinguishes loading, retryable failure, and a genuinely empty history", () => {
        const loading = renderHistory(null, { loading: true });
        const failed = renderHistory(null, { error: "Nicht erreichbar" });
        expect(loading).toContain('role="status"');
        expect(loading).not.toContain("Noch keine Transaktionen");
        expect(failed).toContain('role="alert"');
        expect(failed).toContain("Nicht erreichbar");
        expect(failed).not.toContain("Noch keine Transaktionen");
        expect(failed.match(/<button\b[^>]*>/)?.[0]).not.toContain('disabled=""');
    });
});
