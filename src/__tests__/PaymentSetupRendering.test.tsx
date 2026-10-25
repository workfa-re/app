import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import type { RecipientSettingsSnapshot } from "@/lib/payments/recipient-types";
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()})}));
vi.mock("next/dynamic",()=>({default:()=>()=>null}));
vi.mock("@/components/providers/ThemeProvider",()=>({useTheme:()=>({resolvedTheme:"light"})}));
vi.mock("@/lib/supabaseClient",()=>({supabaseBrowser:{auth:{}}}));
import { BuyerPaymentMethod } from "@/components/payments/BuyerPaymentMethod";
import { RecipientPayments, recipientFinancialActionsEnabled } from "@/components/payments/RecipientPayments";
import { PaymentQuestions, PaymentSettings } from "@/components/payments/PaymentSettings";

const buyer:PaymentSettingsSnapshot={kind:"local",featureEnabled:true,buyerReady:false,method:null,recipientStatus:"not_started",pendingRemoval:false};
const recipient:RecipientSettingsSnapshot={kind:"sandbox",featureEnabled:true,status:"not_started",canStart:true,eligibility:"adult",requirementCount:0,hasPayoutMethod:false,detailsSubmitted:false,transfersActive:false,payoutsEnabled:false,checkedAt:null};
describe("truthful payment setup states",()=>{
    it.each([
        {status:"not_started" as const,checkedAt:null},
        {status:"onboarding" as const,checkedAt:null},
        {status:"pending" as const,checkedAt:null},
        {status:"pending" as const,checkedAt:"2026-10-24T04:00:00Z"},
        {status:"restricted" as const,checkedAt:"2026-10-24T04:00:00Z"},
    ])("places setup before the single overview in DOM/read order while status is $status ($checkedAt)",patch=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,...patch}} returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        const setupPosition=html.indexOf('id="recipient-heading"');
        const overviewPosition=html.indexOf('aria-label="Deine Zahlungsübersicht"');
        expect(setupPosition).toBeGreaterThan(-1);expect(overviewPosition).toBeGreaterThan(setupPosition);
        expect(html.match(/aria-label="Deine Zahlungsübersicht"/g)).toHaveLength(1);
    });
    it.each(["adult","minor_review_required"] as const)("places the single overview before payout controls without a duplicate ready setup card (%s)",eligibility=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"live",status:"ready",eligibility,canStart:eligibility==="adult",
            checkedAt:new Date().toISOString(),hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true}}
            returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        expect(html.indexOf('aria-label="Deine Zahlungsübersicht"')).toBeLessThan(html.indexOf('id="payout-settings-heading"'));
        expect(html.match(/aria-label="Deine Zahlungsübersicht"/g)).toHaveLength(1);
        expect(html).toContain('id="payout-settings-heading"');expect(html).not.toContain('id="recipient-heading"');expect(html).not.toContain('id="minor-bank-heading"');
    });
    it("renders live payment settings without a test banner and keeps payment identity honest",()=>{
        const html=renderToStaticMarkup(<PaymentSettings snapshot={{...buyer,kind:"live"}} role="job_provider" returnTo={null} result={null}/>);
        expect(html).toContain('aria-label="Workfare Pay mit Stripe"');expect(html).not.toContain("Über Stripe");expect(html).not.toMatch(/Stripe-Testbetrieb|Kein Echtgeld|Lokale Simulation/);
        const faq=renderToStaticMarkup(<PaymentQuestions recipient kind="live"/>);
        expect(faq).toContain("Erst verfügbare Beträge werden nach deinem Auszahlungstag");expect(faq).not.toMatch(/Testbetrieb|Simulation/);
        expect(renderToStaticMarkup(<PaymentQuestions recipient kind="sandbox"/>)).toContain("Im Testbetrieb wird kein echtes Geld bewegt");
    });
    it("groups utilities once, leaves future account details collapsed and keeps questions last",()=>{
        const html=renderToStaticMarkup(<PaymentSettings snapshot={{...buyer,kind:"live"}} role="job_provider" returnTo={null} result={null}/>);
        expect(html.match(/aria-label="Workfare Pay verwalten"/g)).toHaveLength(1);
        const group=html.slice(html.indexOf('aria-label="Workfare Pay verwalten"'), html.indexOf("<footer"));
        expect(group.indexOf("Gebühren &amp; Abo")).toBeLessThan(group.indexOf("Konto &amp; Karte"));
        expect(group.indexOf("Konto &amp; Karte")).toBeLessThan(group.indexOf("Fragen zu Workfare Pay"));
        expect(group).not.toMatch(/In Planung|Januar|2027|Der passende Plan/);
        expect(group).toContain("Wir arbeiten an einem eigenen Zahlungskonto mit Workfare Pay Karte.");
        expect(group).not.toContain("Dein nächster Schritt");
        expect(group.match(/<details[^>]*>/g)?.every(tag=>!tag.includes("open="))).toBe(true);
        expect(html).not.toContain('href="https://stripe.com/de"');
    });
    it.each(["job_seeker","guardian"]as const)("keeps account and help in the same ordered group for %s",role=>{
        const html=renderToStaticMarkup(<PaymentSettings snapshot={{...buyer,kind:"live"}} recipientSnapshot={{...recipient,kind:"live"}} role={role} returnTo={null} result={null}/>);
        expect(html.match(/aria-label="Workfare Pay verwalten"/g)).toHaveLength(1);
        expect(html.indexOf("Konto &amp; Karte")).toBeLessThan(html.indexOf("Fragen zu Workfare Pay"));
        expect(html).not.toContain("Gebühren &amp; Abo");
    });
    it("does not render a local setup session on a live buyer projection",()=>{
        const html=renderToStaticMarkup(<BuyerPaymentMethod initial={{...buyer,kind:"live"}} returnTo={null} resumeSetupId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).not.toMatch(/Lokales Test-Zahlungsmittel|Test-Einrichtung abschließen/);
    });
    it("offers explicitly enabled live setup without claiming publication is already mandatory",()=>{
        const html=renderToStaticMarkup(<BuyerPaymentMethod initial={{...buyer,kind:"live",featureEnabled:false,setupEnabled:true}} returnTo={null}/>);
        expect(html).toContain('aria-label="Zahlungsmittel hinzufügen"');expect(html).toContain("Für kommende Aufträge");
        expect(html).not.toContain("vor dem Veröffentlichen");expect(html).not.toContain("Test-Zahlungsmittel");
        const off=renderToStaticMarkup(<BuyerPaymentMethod initial={{...buyer,kind:"live",featureEnabled:false,setupEnabled:false}} returnTo={null}/>);
        expect(off).not.toContain('aria-label="Zahlungsmittel hinzufügen"');
    });
    it("preserves a separately enabled recipient setup while respecting recipient canStart",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"live",featureEnabled:false,setupEnabled:true}} returnTo={null}/>);
        expect(html).toContain("Auszahlung einrichten");expect(html).toContain("für kommende Jobs");expect(html).not.toContain("bevor du deinen ersten Job reservierst");
        const blocked=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"live",featureEnabled:false,setupEnabled:true,canStart:false,eligibility:"minor_review_required"}} returnTo={null}/>);
        expect(blocked).not.toContain(">Auszahlung einrichten</button>");
    });
    it("keeps local setup in the same payment surface without accepting real card fields",()=>{
        const html=renderToStaticMarkup(<BuyerPaymentMethod initial={buyer} returnTo={null} resumeSetupId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).toContain("Lokales Test-Zahlungsmittel");expect(html).toContain("Test-Einrichtung abschließen");
        expect(html).not.toContain('href="/app-home/settings/payments/setup');expect(html).not.toMatch(/name="(?:card|iban|cvc)/);
    });
    it("displays only the confirmed minimal card summary",()=>{
        const html=renderToStaticMarkup(<BuyerPaymentMethod initial={{...buyer,kind:"sandbox",buyerReady:true,method:{brand:"visa",last4:"4242",expiryMonth:12,expiryYear:2030}}} returnTo={null}/>);
        expect(html).toContain("•••• 4242");expect(html).toContain("12/30");expect(html).not.toContain("Auszahlung eingerichtet");
    });
    it("does not offer financial views when recipient verification is pending",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,status:"pending",detailsSubmitted:true,checkedAt:"2026-10-24T04:00:00Z"}} returnTo={null}/>);
        expect(html).toContain("Angaben werden geprüft");expect(html).toContain("Status prüfen");
        expect(html).not.toContain('aria-label="Guthaben und Auszahlungen"');expect(html).not.toContain("Auszahlung eingerichtet");
    });
    it("keeps an interrupted verification unknown after reload instead of claiming Stripe is reviewing it",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,status:"pending",detailsSubmitted:true,checkedAt:null}} returnTo={null}/>);
        expect(html).toContain("Aktuellen Stand prüfen");expect(html).toContain("Status prüfen");
        expect(html).not.toContain("Angaben werden geprüft");expect(html).not.toContain("Sobald sich etwas ändert");
        expect(html).not.toContain('aria-label="Guthaben und Auszahlungen"');
    });
    it("keeps an unconfirmed live verification unknown instead of showing completed setup",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"live",status:"pending",detailsSubmitted:true,checkedAt:null}} returnTo={null}/>);
        expect(html).toContain("Aktuellen Stand prüfen");expect(html).not.toContain("Angaben werden geprüft");expect(html).not.toMatch(/Testbetrieb|Simulation/);
    });
    it("does not ask users to repeat onboarding when Stripe restricts an account without user requirements",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,status:"restricted",detailsSubmitted:true,requirementCount:0,checkedAt:"2026-10-24T04:33:00Z"}} returnTo={null}/>);
        expect(html).toContain("Auszahlung noch nicht freigegeben");expect(html).toContain("Status prüfen");
        expect(html).not.toContain("Bitte ergänze deine Angaben");expect(html).not.toContain("Angaben ergänzen");
        expect(html).not.toContain('aria-label="Guthaben und Auszahlungen"');
    });
    it.each(["restricted","pending"] as const)("requests additional information only when Stripe reports user requirements in %s",status=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,status,detailsSubmitted:true,requirementCount:2,checkedAt:"2026-10-24T04:33:00Z"}} returnTo={null}/>);
        expect(html).toContain("Bitte ergänze deine Angaben");expect(html).toContain("Angaben ergänzen");
        expect(html).not.toContain("Auszahlung noch nicht freigegeben");
    });
    it("routes a minor to the parent-led Stripe setup without a direct recipient account start",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,canStart:false,eligibility:"minor_review_required"}} returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).toContain("Dein Elternteil richtet die Auszahlung");expect(html).toContain("bis zum Abschluss der Prüfung gesperrt");expect(html).toContain('href="/guardian/access"');expect(html).not.toContain(">Auszahlung einrichten</button>");
        expect(html).not.toContain('aria-label="Guthaben und Auszahlungen"');
        expect(html).toContain('aria-label="Deine Zahlungsübersicht"');
    });
    it("opens only read-only financial entry points for a currently verified live minor",()=>{
        const now=Date.parse("2026-10-24T12:00:00Z");
        const minorReady:RecipientSettingsSnapshot={...recipient,kind:"live",canStart:false,eligibility:"minor_review_required",status:"ready",hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true,checkedAt:"2026-10-24T11:55:00Z"};
        expect(recipientFinancialActionsEnabled(minorReady,false,now)).toBe(true);
        expect(minorReady.canStart).toBe(false);
        const html=renderToStaticMarkup(<RecipientPayments initial={minorReady} returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).not.toMatch(/>Ändern<|>Auszahlung einrichten<|Einrichtung direkt bei Stripe öffnen/);
        for(const patch of [{kind:"sandbox" as const},{status:"pending" as const},{checkedAt:null},{checkedAt:"2026-10-23T11:59:00Z"},{checkedAt:"2026-10-24T12:01:00Z"},{hasPayoutMethod:false},{detailsSubmitted:false},{transfersActive:false},{payoutsEnabled:false},{requirementCount:1}]) {
            expect(recipientFinancialActionsEnabled({...minorReady,...patch},false,now)).toBe(false);
        }
        expect(recipientFinancialActionsEnabled(minorReady,true,now)).toBe(false);
    });
    it("offers the live minor a distinct bank-only setup surface instead of parent-led full onboarding",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"live",canStart:false,eligibility:"minor_review_required"}} returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).toContain("Deine Bankverbindung");expect(html).toContain("Aktueller Stand wird geladen");
        expect(html).not.toContain("Dein Elternteil richtet die Auszahlung");expect(html).not.toContain('href="/guardian/access"');
        expect(html).not.toMatch(/Auszahlung bereit|>Auszahlung einrichten</);
    });
    it("labels simulated recipient readiness without inventing a balance or bank payout",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={{...recipient,kind:"local",eligibility:"local_demo",status:"ready",hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true}} returnTo={null} ownerId="11111111-1111-4111-8111-111111111111"/>);
        expect(html).toContain("Test-Auszahlung eingerichtet");expect(html).toContain("Keine echten Bankdaten");
        expect(html).toContain('aria-label="Deine Zahlungsübersicht"');expect(html).not.toMatch(/\d+[,.]\d{2}\s*€|Bankauszahlung abgeschlossen/);
        expect(html).not.toContain('id="payout-settings-heading"');
        expect(recipientFinancialActionsEnabled({...recipient,kind:"local",eligibility:"local_demo",status:"ready",hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true})).toBe(false);
    });
    it("keeps unavailable owner status from being shown as verified",()=>{
        const html=renderToStaticMarkup(<RecipientPayments initial={null} returnTo={null}/>);
        expect(html).not.toContain("Auszahlung eingerichtet");expect(html).not.toContain('aria-label="Guthaben und Auszahlungen"');
    });
});
