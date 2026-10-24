import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: {} } }));
import { PayWordmark } from "@/components/payments/PayWordmark";
import { StripeEmbedHelp } from "@/components/payments/StripeEmbedHelp";
import { StripeReloadButton } from "@/components/payments/StripeEmbedControls";
import { RecipientHostedFallback, recipientHostedUrl } from "@/components/payments/RecipientHostedFallback";
import { RecipientFundsView, validRecipientFunds } from "@/components/payments/RecipientFunds";
import { validBuyerPaymentMethods } from "@/components/payments/BuyerPaymentOptions";
import { PaymentEnvironment, stripeKeyMatchesKind, validStripeSurfaceSession } from "@/components/payments/PaymentEnvironment";
import type { RecipientPayoutOverview } from "@/lib/payments/recipient-types";

const funds: RecipientPayoutOverview = { kind: "sandbox", currency: "eur", availableCents: 1_000, pendingCents: 1_250, schedule: "daily",
    stripePayoutsEnabled: true, hasPayoutMethod: true, canRequestPayout: false, canRetainBalance: false,
    disabledReason: "retention_monitor_required", maxHoldingDays: 90, checkedAt: "2026-10-24T10:00:00Z" };
const renderFunds = (snapshot: RecipientPayoutOverview | null, loading = false, error: string | null = null) => renderToStaticMarkup(<RecipientFundsView snapshot={snapshot} loading={loading} error={error} onRetry={vi.fn()} onDetails={vi.fn()} onHistory={vi.fn()} />);

describe("minimal trustworthy payment surfaces", () => {
    it("keeps normal Stripe frames free of recovery text and puts recovery beside the close control", () => {
        expect(renderToStaticMarkup(<StripeEmbedHelp onRetry={vi.fn()} onClose={vi.fn()} />)).toBe("");
        const failure = renderToStaticMarkup(<StripeEmbedHelp failed headerControls onRetry={vi.fn()} onClose={vi.fn()} />);
        expect(failure).toContain('role="alert"');
        expect(failure).not.toMatch(/<button|<details|Probleme beim Öffnen/);
        const reload = vi.fn();
        const control = StripeReloadButton({ controls: { current: { reload } } });
        control.props.onClick();
        expect(reload).toHaveBeenCalledExactlyOnceWith();
        expect(renderToStaticMarkup(control)).toContain('aria-label="Stripe-Bereich neu laden"');
    });
    it("keeps the Workfare name intact with a separate Pay descriptor", () => {
        const html = renderToStaticMarkup(<h1><PayWordmark /></h1>);
        expect(html).toContain(">Workfare</span>"); expect(html).toContain(">Pay</span>"); expect(html).not.toMatch(/JobBridge|Workfair/);
    });
    it("offers an explicit route out of failed or stalled Stripe authentication without claiming success", () => {
        const html = renderToStaticMarkup(<StripeEmbedHelp failed onRetry={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain('role="alert"'); expect(html).toContain("Stripe neu laden"); expect(html).toContain("Zurück zur Übersicht");
        expect(html).toContain("bisheriger Stand bleibt erhalten"); expect(html).not.toContain("erfolgreich");
        const slow = renderToStaticMarkup(<StripeEmbedHelp slow onRetry={vi.fn()} onClose={vi.fn()} />);
        expect(slow).toContain("Fenster"); expect(slow).toContain("blockiert"); expect(slow).not.toContain('role="alert"');
    });
    it("requires a new explicit consent before preparing a hosted browser link", () => {
        const html = renderToStaticMarkup(<RecipientHostedFallback ownerId="11111111-1111-4111-8111-111111111111" kind="sandbox" returnTo={null} />);
        expect(html).toContain('type="checkbox"'); expect(html).not.toContain('checked=""'); expect(html).toContain('disabled=""');
        expect(html).not.toContain("https://connect.stripe.com"); expect(html).toContain("normalen Browser");
    });
    it("accepts only genuine Stripe Connect browser links", () => {
        expect(recipientHostedUrl("https://connect.stripe.com/setup/s/fixture")).toBe("https://connect.stripe.com/setup/s/fixture");
        for (const value of ["https://connect.stripe.com.evil.test/setup", "https://secret@connect.stripe.com/setup", "http://connect.stripe.com/setup", "javascript:alert(1)", null]) expect(recipientHostedUrl(value)).toBeNull();
    });
    it("keeps available funds and pending funds separate without inventing bank receipt or manual payout", () => {
        const html = renderFunds(funds);
        expect(html).toContain("Verfügbar"); expect(html).toContain("Vorgemerkt"); expect(html).toContain("10,00"); expect(html).toContain("12,50");
        expect(html).not.toContain("22,50"); expect(html).toContain("noch kein Zahlungseingang"); expect(html).toContain("Täglich");
        expect(html).not.toContain("Jetzt auszahlen"); expect(html).not.toContain("Geld behalten</button>");
        expect(html).toContain("noch nicht verfügbar");
    });
    it("preserves a real negative balance rather than disguising it as zero", () => {
        const html = renderFunds({ ...funds, availableCents: -250 }); expect(html).toContain("-2,50"); expect(html).not.toContain("0,00");
    });
    it("never flashes a false zero or an empty financial state on loading failure", () => {
        const loading = renderFunds(null, true); expect(loading).toContain('role="status"'); expect(loading).not.toContain("0,00");
        const error = renderFunds(null, false, "Stripe ist nicht erreichbar."); expect(error).toContain('role="alert"'); expect(error).toContain("Erneut versuchen"); expect(error).not.toContain("0,00");
    });
    it("does not hide a missing bank target or restricted payout capability", () => {
        expect(renderFunds({ ...funds, hasPayoutMethod: false })).toContain("Bankauszahlung ist noch nicht bereit");
        expect(renderFunds({ ...funds, stripePayoutsEnabled: false })).toContain("Auszahlungsdaten");
    });
    it("rejects unconfirmed financial or payout capabilities", () => {
        expect(validRecipientFunds(funds)).toBe(true);
        expect(validRecipientFunds({ ...funds, kind: "live" })).toBe(true);
        for (const patch of [{ currency: "usd" }, { availableCents: "1000" }, { canRequestPayout: true }, { canRetainBalance: true }, { checkedAt: "unknown" }]) expect(validRecipientFunds({ ...funds, ...patch })).toBe(false);
    });
    it("does not turn unsupported SEPA into an enabled card-style setup", () => {
        const methods = { version: "buyer-methods-v1", kind: "sandbox", livePaymentsEnabled: false, selectedMethod: "card", methods: [
            { type: "card", setupEnabled: true, manualCaptureSupported: true, flow: "authorize_then_capture" },
            { type: "sepa_debit", setupEnabled: false, availability: "not_available", manualCaptureSupported: false, flow: "async_debit_after_service", reasonCode: "sepa_async_collection_unavailable" },
        ] };
        expect(validBuyerPaymentMethods(methods)).toBe(true);
        expect(validBuyerPaymentMethods({ ...methods, kind: "live", livePaymentsEnabled: true })).toBe(true);
        expect(validBuyerPaymentMethods({ ...methods, kind: "live", livePaymentsEnabled: false })).toBe(false);
        expect(validBuyerPaymentMethods({ ...methods, livePaymentsEnabled: true })).toBe(false);
        expect(validBuyerPaymentMethods({ ...methods, methods: [methods.methods[0], { ...methods.methods[1], setupEnabled: true }] })).toBe(false);
    });
    it("omits environment hints only for a real live projection while preserving test labels", () => {
        expect(renderToStaticMarkup(<PaymentEnvironment kind="live" />)).toBe("");
        expect(renderToStaticMarkup(<PaymentEnvironment kind="disabled" />)).toBe("");
        for (const kind of ["sandbox", "local"] as const) expect(renderToStaticMarkup(<PaymentEnvironment kind={kind} />)).toContain("Kein Echtgeld");
        expect(renderToStaticMarkup(<PaymentEnvironment kind="sandbox" compact />)).toContain("Testbetrieb");
        expect(renderToStaticMarkup(<PaymentEnvironment kind="local" compact />)).toContain("Simulation");
    });
    it("binds Stripe sessions and publishable key prefixes to the expected environment", () => {
        const live = { kind: "live", clientSecret: "acs_offlineSecretOnly", publishableKey: "pk_live_offlineFixtureOnly" };
        const sandbox = { kind: "sandbox", clientSecret: "acs_offlineSecretOnly", publishableKey: "pk_test_offlineFixtureOnly" };
        expect(validStripeSurfaceSession(live, "live")).toBe(true);
        expect(validStripeSurfaceSession(sandbox, "sandbox")).toBe(true);
        expect(validStripeSurfaceSession(live, "sandbox")).toBe(false);
        expect(validStripeSurfaceSession(sandbox, "live")).toBe(false);
        expect(validStripeSurfaceSession({ ...live, publishableKey: sandbox.publishableKey }, "live")).toBe(false);
        expect(validStripeSurfaceSession({ ...sandbox, publishableKey: live.publishableKey }, "sandbox")).toBe(false);
        expect(validStripeSurfaceSession({ ...live, clientSecret: "bad secret" }, "live")).toBe(false);
        expect(validStripeSurfaceSession({ ...live, clientSecret: "x".repeat(4_097) }, "live")).toBe(false);
        expect(stripeKeyMatchesKind("live", "sk_live_offlineFixtureOnly")).toBe(false);
    });
});
