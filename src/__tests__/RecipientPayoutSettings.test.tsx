import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/components/payments/usePaymentOwner", () => ({ usePaymentOwner: () => ({ isCurrentOwner: () => true, ownerChanged: false }), PAYMENT_OWNER_CHANGED: "changed" }));
import { RecipientPayoutSettingsView, validPayoutSettings } from "@/components/payments/RecipientPayoutSettings";
import type { RecipientPayoutSettings } from "@/lib/payments/recipient-payout-types";
const ownerId = "11111111-1111-4111-8111-111111111111";
const snapshot = (patch: Partial<RecipientPayoutSettings> = {}): RecipientPayoutSettings => ({ ownerId, kind: "live", currency: "eur", availableCents: 1700, pendingCents: 2300, schedule: { interval: "monthly", monthlyDays: [1] }, ready: true, canRequestPayout: true, reasonCode: null, operation: null, checkedAt: "2026-10-25T00:00:00Z", ...patch });
const render = (patch: Partial<Parameters<typeof RecipientPayoutSettingsView>[0]> = {}) => renderToStaticMarkup(<RecipientPayoutSettingsView snapshot={snapshot()} busy={false} error={null} editing={false} paying={false} accepted={false} day={1} locked={false} message={null} onRefresh={() => {}} onEdit={() => {}} onPayout={() => {}} onCancel={() => {}} onAccepted={() => {}} onDay={() => {}} onSubmit={() => {}} {...patch} />);
describe("recipient payout settings presentation", () => {
    it("shows the actual monthly payout day with one available-money action", () => { const html = render(); expect(html).toContain("Am 1. jedes Monats"); expect(html).toMatch(/17,00.+jetzt auszahlen/); expect(html).not.toMatch(/Wallet|Bankkonto eröffnen|Sofortauszahlung|Kontostand/); });
    it("shows existing daily automation as daily rather than silently promising monthly", () => { expect(render({ snapshot: snapshot({ schedule: { interval: "daily" } }) })).toContain("An jedem Bankarbeitstag"); });
    it("uses the named save action for the selected monthly day without an extra checkbox", () => { const html = render({ editing: true, day: 17 }); expect(html).toContain('value="17" selected=""'); expect(html).toContain("Bankarbeitstag"); expect(html).not.toContain('type="checkbox"'); expect(html).not.toMatch(/type="submit"[^>]*disabled/); expect(html.match(/<option /g)).toHaveLength(31); });
    it("requests explicit consent to transfer the displayed amount to the existing bank", () => { const html = render({ paying: true }); expect(html).toMatch(/17,00.+auf deine hinterlegte Bankverbindung/); expect(html).toContain("automatischer Auszahlungstag bleibt bestehen"); expect(html).toMatch(/type="submit"[^>]*disabled/); });
    it("does not offer a zero-balance payout", () => { const html = render({ snapshot: snapshot({ availableCents: 0, canRequestPayout: false, reasonCode: "balance_not_available" }) }); expect(html).toContain("Deine Zahlung wird noch verarbeitet"); expect(html).toMatch(/disabled="">(?:<svg[\s\S]*?<\/svg>)?Jetzt auszahlen/); });
    it("reopens an unresolved schedule operation as a date check, not as a money transfer", () => { const html = render({ snapshot: snapshot({ canRequestPayout: false, reasonCode: "operation_pending", operation: { id: "44444444-4444-4444-8444-444444444444", operationId: "33333333-3333-4333-8333-333333333333", kind: "schedule", state: "pending", amountCents: null, monthlyDay: 15, payoutStatus: null, arrivalAt: null, finished: false } }) }); expect(html).toContain("Auszahlungstag prüfen"); expect(html).not.toContain("Auszahlung prüfen"); });
    it("exposes a refresh action and accessible failure without raw provider errors", () => { const html = render({ snapshot: null, error: "Bitte lade den aktuellen Stand." }); expect(html).toContain('role="alert"'); expect(html).toContain("Aktuellen Stand laden"); expect(html).toContain('aria-label="Auszahlungsstand aktualisieren"'); });
    it("validates real funds, owner, operation and schedule before rendering actions", () => {
        expect(validPayoutSettings(snapshot(), ownerId)).toBe(true);
        for (const patch of [{ ownerId: "other" }, { kind: "local_simulation" }, { availableCents: "1700" }, { pendingCents: NaN }, { ready: false }, { schedule: { interval: "monthly", monthlyDays: [32] } }, { schedule: { interval: "weekly", weeklyDays: ["tomorrow"] } }, { operation: { id: "invalid" } }]) expect(validPayoutSettings({ ...snapshot(), ...patch }, ownerId)).toBe(false);
        expect(validPayoutSettings(snapshot({ availableCents: -100, canRequestPayout: false, reasonCode: "balance_not_available" }), ownerId)).toBe(true);
        expect(validPayoutSettings(snapshot({ operation: { id: "44444444-4444-4444-8444-444444444444", operationId: "33333333-3333-4333-8333-333333333333", kind: "payout", state: "pending", amountCents: null, monthlyDay: null, payoutStatus: null, arrivalAt: null, finished: false } }), ownerId)).toBe(false);
    });
});

describe("masked recipient bank card",()=>{
 it("shows the bank name and last digits with an owned management action",()=>{
  const html=render({snapshot:snapshot({bank:{bankName:"Testbank",last4:"6789",country:"DE",currency:"eur"}}),onManageBank:vi.fn()});expect(html).toContain("Testbank");expect(html).toContain("•••• 6789");expect(html).toContain('aria-label="Bankverbindung ändern"');expect(html).toContain('aria-label="Deine Bankverbindung"');expect(html).not.toMatch(/IBAN|acct_|ba_|<img|(?:src|href)="https?:\/\//);
 });
 it.each([{bankName:"Bank",last4:"12345678",country:"DE",currency:"eur"},{bankName:"Bank",last4:"6789",country:"DE",currency:"usd"},{bankName:"Bad\nBank",last4:"6789",country:"DE",currency:"eur"}])("does not render malformed bank summaries",bank=>{expect(validPayoutSettings({...snapshot(),bank},ownerId)).toBe(false);});
});

describe("payout utility disclosure",()=>{
 it("starts collapsed with controls outside the summary",()=>{
  const html=render({variant:"utility",snapshot:snapshot({bank:{bankName:"Testbank",last4:"6789",country:"DE",currency:"eur"}}),onManageBank:vi.fn()});
  expect(html).toMatch(/^<details\b/);expect(html).not.toMatch(/^<details\b[^>]*\bopen=/);
  const summary=html.match(/<summary\b[^>]*>[\s\S]*?<\/summary>/)?.[0];
  expect(summary).toContain("Auszahlungen &amp; Bank");expect(summary).not.toMatch(/<button|<a /);
  expect(html).toContain('aria-label="Bankverbindung ändern"');expect(html).not.toContain('>Auszahlungen</h2>');
 });
 it("opens a financial action or failed refresh so it cannot remain hidden",()=>{
  expect(render({variant:"utility",paying:true})).toMatch(/^<details\b[^>]*\bopen=""/);
  expect(render({variant:"utility",snapshot:null,error:"Bitte erneut laden."})).toMatch(/^<details\b[^>]*\bopen=""/);
 });
});
