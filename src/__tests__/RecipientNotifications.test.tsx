import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { hasRecipientNotifications, RecipientNotifications } from "@/components/payments/RecipientNotifications";
import type { RecipientSettingsSnapshot } from "@/lib/payments/recipient-types";
const snapshot: RecipientSettingsSnapshot = { kind: "sandbox", featureEnabled: true, status: "restricted", canStart: true, eligibility: "adult", requirementCount: 2,
    hasPayoutMethod: true, detailsSubmitted: true, transfersActive: false, payoutsEnabled: false, checkedAt: "2026-10-24T00:00:00Z" };
describe("lazy owner notification banner entry", () => {
    it("shows only the useful action before loading Stripe or creating a session", () => {
        const html = renderToStaticMarkup(<RecipientNotifications snapshot={snapshot} onChanged={() => {}} />);
        expect(html).toContain("Offene Angaben bei Stripe"); expect(html).not.toContain("iframe"); expect(html).not.toContain("secret");
    });
    it("offers the same lazy notification action for eligible live recipients", () => {
        const live = { ...snapshot, kind: "live" as const };
        expect(hasRecipientNotifications(live)).toBe(true);
        const html = renderToStaticMarkup(<RecipientNotifications snapshot={live} onChanged={() => {}} />);
        expect(html).toContain("Offene Angaben bei Stripe"); expect(html).not.toMatch(/Testbetrieb|Simulation|iframe|secret/);
    });
    it.each([{ kind: "local" }, { detailsSubmitted: false }, { eligibility: "minor_review_required" }, { canStart: false }, { requirementCount: 0, status: "ready" }] as const)
    ("does not add empty notices, sandbox prompts for minors or a fake local banner (%j)", patch => {
        const value = { ...snapshot, ...patch };
        expect(hasRecipientNotifications(value)).toBe(false);
        expect(renderToStaticMarkup(<RecipientNotifications snapshot={value} onChanged={() => {}} />)).toBe("");
    });
});
