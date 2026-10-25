import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: { onAuthStateChange: vi.fn() } } }));
import BuyerAccountPanel, { BuyerAccountView, overviewResponse, readBuyerAccountOverview, saveBuyerAccountBilling } from "@/components/payments/BuyerAccountPanel";
import type { BuyerAccountSnapshot } from "@/lib/payments/buyer-account-types";

const ownerId = "11111111-1111-4111-8111-111111111111";
const anotherOwner = "22222222-2222-4222-8222-222222222222";
const local: BuyerAccountSnapshot = { ownerId, kind: "local", customerExists: false, billing: { available: false, details: null },
    history: { state: "local_simulation", payments: [], invoices: [], hasMore: { payments: false, invoices: false } } };
const sandbox: BuyerAccountSnapshot = { ownerId, kind: "sandbox", customerExists: true, billing: { available: true, details: {
    name: "Robin Muster", email: "billing@example.test", address: { line1: "Musterweg 4", line2: null, postalCode: "53359", city: "Rheinbach", country: "DE" },
} }, history: { state: "available", payments: [{ id: "ch_fixture", createdAt: "2026-10-24T10:00:00.000Z", description: "Gartenhilfe",
    status: "authorized", amountMinor: 3000, capturedAmountMinor: 0, refundedAmountMinor: 0, currency: "eur", receiptUrl: null }],
    invoices: [], hasMore: { payments: false, invoices: false } } };
function render(snapshot: BuyerAccountSnapshot | null, loading = false, error: string | null = null, children?: React.ReactNode) {
    return renderToStaticMarkup(<BuyerAccountView snapshot={snapshot} loading={loading} error={error} onRetry={vi.fn()} onBillingSaved={vi.fn()}>{children}</BuyerAccountView>);
}
afterEach(() => vi.unstubAllGlobals());

describe("compact payment history and billing UI", () => {
    it("accepts real live history while rejecting mixed simulation and live projections", () => {
        const live = { ...sandbox, kind: "live" as const };
        expect(overviewResponse(live, ownerId)).toBe(true);
        expect(overviewResponse(live, ownerId, "live")).toBe(true);
        expect(overviewResponse(sandbox, ownerId, "live")).toBe(false);
        expect(overviewResponse(live, ownerId, "sandbox")).toBe(false);
        expect(overviewResponse({ ...local, kind: "live" }, ownerId)).toBe(false);
        expect(overviewResponse({ ...sandbox, kind: ["live"] }, ownerId)).toBe(false);
        const html = render(live);
        expect(html).toContain("30,00"); expect(html).not.toMatch(/Testbetrieb|Simulation|Test-Zahlung/);
    });
    it("never accepts another session owner's history beneath the current page", async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...sandbox, ownerId: anotherOwner }) });
        vi.stubGlobal("fetch", fetch);
        await expect(readBuyerAccountOverview(ownerId)).rejects.toThrow("nicht vollständig");
        expect(fetch).toHaveBeenCalledWith("/api/payments/account", expect.objectContaining({ headers: { "X-Workfare-Owner": ownerId }, credentials: "same-origin", cache: "no-store" }));
        expect(overviewResponse({ ...sandbox, ownerId: anotherOwner }, ownerId)).toBe(false);
        expect(overviewResponse({ ...sandbox, ownerId: undefined }, ownerId)).toBe(false);
    });
    it("binds billing writes to the expected owner and requires the same owner in confirmation", async () => {
        const input = { address: { line1: "Musterweg 4", postalCode: "53359", city: "Rheinbach", country: "DE" as const } };
        const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, ownerId: anotherOwner, billing: sandbox.billing.details }) });
        vi.stubGlobal("fetch", fetch);
        await expect(saveBuyerAccountBilling(ownerId, input, "33333333-3333-4333-8333-333333333333")).rejects.toThrow("nicht bestätigt");
        expect(fetch).toHaveBeenCalledWith("/api/payments/account/billing", expect.objectContaining({ headers: expect.objectContaining({ "X-Workfare-Owner": ownerId }), body: JSON.stringify(input) }));
        fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, ownerId, billing: sandbox.billing.details }) });
        expect(await saveBuyerAccountBilling(ownerId, input, "33333333-3333-4333-8333-333333333333")).toEqual(sandbox.billing.details);
    });
    it("does not start owner-bound financial reads without a valid page owner", async () => {
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        await expect(readBuyerAccountOverview("unknown")).rejects.toThrow("Anmeldung");
        expect(fetch).not.toHaveBeenCalled();
    });
    it("does not flash a false empty state before the authenticated request finishes", () => {
        const html = renderToStaticMarkup(<BuyerAccountPanel />);
        expect(html).toContain("Übersicht wird geladen");
        expect(html).toContain('role="status"');
        expect(html).not.toContain("Noch keine Zahlung");
        expect(html).not.toContain("0,00");
    });

    it("keeps a failed request distinct from a genuine empty history and offers retry", () => {
        const html = render(null, false, "Die Zahlungsübersicht ist gerade nicht erreichbar.");
        expect(html).toContain('role="alert"');
        expect(html).toContain("Erneut versuchen");
        expect(html).not.toContain("Noch keine Zahlung");
        expect(html).not.toContain("Rechnungsdaten</span>");
    });

    it("keeps an empty history brief without fake balances or payment actions", () => {
        const html = render(local);
        expect(html).toContain("Noch keine Zahlung.");
        expect(html).not.toContain("Zahlungen und verfügbare Belege erscheinen hier");
        expect(html).not.toContain("0,00");
        expect(html).not.toContain("Jetzt bezahlen");
        expect(html).not.toContain("Guthaben");
        expect(html).not.toContain("<input");
    });
    it("keeps icon-only refresh inside the closed history disclosure and makes account linkage explicit", () => {
        const html = render(sandbox);
        expect(html).toContain('aria-label="Zahlungsübersicht aktualisieren"');
        const summaryEnd=html.indexOf("</summary>");
        const refresh=html.indexOf('aria-label="Zahlungsübersicht aktualisieren"');
        expect(refresh).toBeGreaterThan(summaryEnd);
        expect(refresh).toBeLessThan(html.indexOf("</details>"));
        expect(html).not.toContain(">Aktualisieren<");
        expect(html).toContain("Mit deinem Workfare-Profil verknüpft.");
        expect(html).toContain("Mit deinem Workfare-Konto verknüpft.");
        expect(html).not.toContain('name="billing-name"');
        expect(html).not.toContain('name="billing-email"');
    });

    it("keeps utilities unframed and billing collapsed with supplied help after billing", () => {
        const html = render(sandbox, false, null, <details><summary>Fragen zu Workfare Pay</summary><p>Hilfe bei Bedarf.</p></details>);
        const details = html.match(/<details[^>]*>/g) ?? [];
        expect(details).toHaveLength(3);
        expect(details.every((tag) => !/\bopen(?:=|\s|>)/.test(tag))).toBe(true);
        expect(html.match(/aria-label="Zahlungen und Rechnungsdaten"/g)).toHaveLength(1);
        expect(html.indexOf("Rechnungsdaten</span>")).toBeLessThan(html.indexOf("Fragen zu Workfare Pay"));
        expect(html).toContain("Robin Muster");
        expect(html).not.toContain("<input");
        expect(html).not.toContain("Gut zu wissen");
        expect(html).not.toContain("<aside");
    });

    it("offers one clear optional-address action instead of an empty address panel", () => {
        const html = render({ ...sandbox, billing: { ...sandbox.billing, details: { ...sandbox.billing.details!, address: null } } });
        expect(html).toContain("Rechnungsadresse</h3>");
        expect(html).toContain("Optional"); expect(html.match(/>Hinzufügen<\/button>/g)).toHaveLength(1);
        expect(html).not.toMatch(/Keine Rechnungsadresse hinterlegt|Nur ergänzen|>Ergänzen<|<input/);
    });

    it("labels an authorization as reserved money without inventing a captured amount or receipt", () => {
        const html = render(sandbox);
        expect(html).toContain("Vorgemerkt");
        expect(html).toContain("30,00");
        expect(html).not.toContain(">Bezahlt<");
        expect(html).not.toContain(">Beleg<");
        expect(html).not.toContain(">0,00");
    });

    it("distinguishes a released hold from an active authorization, payment or refund", () => {
        const html = render({ ...sandbox, history: { ...sandbox.history, payments: [{ ...sandbox.history.payments[0],
            status: "released", amountMinor: 1_000, capturedAmountMinor: 0, refundedAmountMinor: 0,
            receiptUrl: "https://pay.stripe.com/receipts/payment/releasedFixture" }] } });
        expect(html).toContain("Vormerkung aufgehoben");
        expect(html).toContain("10,00");
        expect(html).not.toContain(">Vorgemerkt<");
        expect(html).not.toContain(">Bezahlt<");
        expect(html).not.toContain(">Erstattet<");
        expect(html).not.toContain(">Beleg<");
        expect(html).not.toContain("releasedFixture");
    });

    it("shows captured and partially refunded amounts with a genuine owner-bound receipt", () => {
        const payment = { ...sandbox.history.payments[0], status: "partially_refunded" as const, amountMinor: 5000,
            capturedAmountMinor: 3000, refundedAmountMinor: 1000, receiptUrl: "https://pay.stripe.com/receipts/payment/fixture" };
        const html = render({ ...sandbox, history: { ...sandbox.history, payments: [payment] } });
        expect(html).toContain("Teilweise erstattet");
        expect(html).toContain("30,00");
        expect(html).toContain("10,00");
        expect(html).not.toContain("50,00");
        expect(html).toContain('href="https://pay.stripe.com/receipts/payment/fixture"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it("does not turn a tainted receipt value into a clickable arbitrary URL", () => {
        const payment = { ...sandbox.history.payments[0], status: "paid" as const, capturedAmountMinor: 3000,
            receiptUrl: "https://pay.stripe.com.evil.example/receipts/payment/fixture" };
        const html = render({ ...sandbox, history: { ...sandbox.history, payments: [payment] } });
        expect(html).toContain("Bezahlt");
        expect(html).not.toContain("evil.example");
        expect(html).not.toContain(">Beleg<");
    });

    it("labels the bounded history honestly instead of providing a nonfunctional show-all link", () => {
        const html = render({ ...sandbox, history: { ...sandbox.history, hasMore: { payments: true, invoices: false } } });
        expect(html).toContain("die letzten 20 Einträge je Bereich");
        expect(html).not.toContain("Alle anzeigen");
    });

    it("does not claim no older history exists when only drafts occupy the recent invoice window", () => {
        const html = render({ ...local, kind: "sandbox", history: { ...local.history, state: "empty", hasMore: { payments: false, invoices: true } } });
        expect(html).toContain("Keine Zahlungen in diesem Ausschnitt");
        expect(html).toContain("die letzten 20 Einträge je Bereich");
        expect(html).not.toContain("Noch keine Zahlung");
    });

    it("keeps invoice documents and PDF links distinct from payment receipts", () => {
        const html = render({ ...sandbox, history: { ...sandbox.history, invoices: [{ id: "in_fixture", createdAt: "2026-10-24T10:00:00.000Z",
            number: "WF-001", description: null, status: "paid", amountMinor: 3300, paidAmountMinor: 3300, remainingAmountMinor: 0, currency: "eur",
            invoiceUrl: "https://invoice.stripe.com/i/acct_fixture/fixture", pdfUrl: "https://pay.stripe.com/invoice/acct_fixture/fixture/pdf?s=ap" }] } });
        expect(html).toContain("Rechnung WF-001");
        expect(html).toContain('href="https://invoice.stripe.com/i/acct_fixture/fixture"');
        expect(html).toContain('href="https://pay.stripe.com/invoice/acct_fixture/fixture/pdf?s=ap"');
        expect(html).toContain(">PDF<");
        expect(html).not.toContain("Jetzt bezahlen");
    });

    it("escapes financial descriptions and billing names as text", () => {
        const html = render({ ...sandbox, billing: { ...sandbox.billing, details: { ...sandbox.billing.details!, name: '<img src="x" onerror="alert(1)">' } },
            history: { ...sandbox.history, payments: [{ ...sandbox.history.payments[0], description: "<script>alert(1)</script>" }] } });
        expect(html).not.toContain("<script>");
        expect(html).not.toContain('<img src="x"');
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("&lt;img");
    });
});
