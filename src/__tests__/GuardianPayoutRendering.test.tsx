import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: { onAuthStateChange: vi.fn() } } }));
import { GuardianPayoutActionView, GuardianPayoutConsent, GuardianPayoutsProvider, guardianPayoutHostedUrl, validGuardianPayoutOverview } from "@/components/guardian/GuardianPayouts";
import { paymentRequest } from "@/components/payments/payment-client";
import type { GuardianRecipientContext } from "@/lib/payments/recipient-minor-types";

const ownerId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const child: GuardianRecipientContext["children"][number] = { childId, name: "Anna Beispiel", status: "not_started", canStartPayout: true, reasonCode: "recipient_setup_required" };
const overview: GuardianRecipientContext = { ownerId, kind: "live", children: [child] };
const now = Date.parse("2026-10-24T12:00:00Z");
const hosted = { ownerId, kind: "live", url: "https://connect.stripe.com/setup/s/example", expiresAt: "2026-10-24T13:00:00Z", requiresExternalBrowser: true };
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
afterEach(() => vi.unstubAllGlobals());

describe("parent-led recipient setup", () => {
    it("requires an owner-bound live overview with unique child identities", () => {
        expect(validGuardianPayoutOverview(overview, ownerId)).toBe(true);
        expect(validGuardianPayoutOverview({ ...overview, ownerId: childId }, ownerId)).toBe(false);
        expect(validGuardianPayoutOverview({ ...overview, kind: "sandbox" }, ownerId)).toBe(false);
        expect(validGuardianPayoutOverview({ ...overview, children: [child, child] }, ownerId)).toBe(false);
        expect(validGuardianPayoutOverview({ ...overview, children: [{ ...child, childId: ownerId }] }, ownerId)).toBe(false);
    });
    it("does not accept ambiguous readiness or unrecognized verification reasons", () => {
        expect(validGuardianPayoutOverview({ ...overview, children: [{ ...child, status: "ready", reasonCode: "guardian_terms_required" }] }, ownerId)).toBe(false);
        expect(validGuardianPayoutOverview({ ...overview, children: [{ ...child, reasonCode: "all_clear" }] }, ownerId)).toBe(false);
        expect(validGuardianPayoutOverview({ ...overview, children: [{ ...child, status: "unavailable", canStartPayout: false }] }, ownerId)).toBe(true);
    });
    it("accepts only a current same-owner Stripe-hosted setup link", () => {
        expect(guardianPayoutHostedUrl(hosted, ownerId, now)).toBe(hosted.url);
        for (const patch of [{ ownerId: childId }, { kind: "sandbox" }, { requiresExternalBrowser: false }, { expiresAt: "2026-10-24T11:59:59Z" }, { expiresAt: "invalid" }, { url: "https://connect.stripe.com.evil.test/setup/a" }, { url: "https://connect.stripe.com@evil.test/setup/a" }, { url: "https://connect.stripe.com/setup/a#private" }, { url: "http://connect.stripe.com/setup/a" }, { url: "https://connect.stripe.com/other" }]) {
            expect(guardianPayoutHostedUrl({ ...hosted, ...patch }, ownerId, now)).toBeNull();
        }
    });
    it("does not create a recipient account or assert success when the family view renders", () => {
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        const html = renderToStaticMarkup(<GuardianPayoutsProvider ownerId={ownerId} returnChildId={childId}><span>Deine Familie</span></GuardianPayoutsProvider>);
        expect(text(html)).toBe("Deine Familie"); expect(fetch).not.toHaveBeenCalled();
    });
    it("offers one clear setup action without collecting bank, DOB or document data", () => {
        const onStart = vi.fn();
        const html = renderToStaticMarkup(<GuardianPayoutActionView entry={child} pending={false} onStart={onStart} onRefresh={vi.fn()} />);
        expect(text(html)).toBe("Auszahlung einrichten");
        expect(html).not.toMatch(/<input|<iframe|Einrichtung abgeschlossen/); expect(onStart).not.toHaveBeenCalled();
    });
    it("requires a separate unchecked setup choice while reserving Stripe TOS acceptance for Stripe", () => {
        const onStart = vi.fn();
        const html = renderToStaticMarkup(<GuardianPayoutConsent name={child.name} accepted={false} pending={false} onAccepted={vi.fn()} onStart={onStart} onCancel={vi.fn()} />);
        expect(html).toContain('type="checkbox"'); expect(html).not.toContain('checked=""'); expect(html).toMatch(/type="submit"[^>]*disabled=""/);
        expect(text(html)).toContain("für Anna Beispiel"); expect(text(html)).toContain("Stripe-Bedingungen bestätigst du direkt dort");
        expect(html).not.toMatch(/name="(?:iban|birthdate|document|tos)"|Auszahlung freigegeben/); expect(onStart).not.toHaveBeenCalled();
    });
    it("blocks duplicate setup actions while a request is pending", () => {
        const html = renderToStaticMarkup(<GuardianPayoutConsent name={child.name} accepted pending onAccepted={vi.fn()} onStart={vi.fn()} onCancel={vi.fn()} />);
        expect(html).toMatch(/type="submit"[^>]*disabled=""/); expect(text(html)).toContain("Wird vorbereitet …");
    });
    it.each(["guardian_identity_mismatch", "guardian_terms_required", "recipient_country_model_unsupported", "recipient_guardian_binding_conflict"] as const)("keeps %s visibly unready without offering an unapproved start", reasonCode => {
        const html = renderToStaticMarkup(<GuardianPayoutActionView entry={{ ...child, status: "restricted", canStartPayout: false, reasonCode }} pending={false} onStart={vi.fn()} onRefresh={vi.fn()} />);
        expect(text(html)).toContain("Stand prüfen"); expect(html).not.toMatch(/Auszahlung eingerichtet|>Auszahlung einrichten</);
        expect(text(html).length).toBeGreaterThan(30);
    });
    it("shows ready only from a ready backend entry with no next setup action", () => {
        const html = renderToStaticMarkup(<GuardianPayoutActionView entry={{ ...child, status: "ready", canStartPayout: false, reasonCode: null }} pending={false} onStart={vi.fn()} onRefresh={vi.fn()} />);
        expect(text(html)).toBe("Auszahlung eingerichtet."); expect(html).not.toContain("button");
    });
    it.each([[
        "recipient_identity_unconfirmed", "Vervollständige deine persönlichen Angaben bei Stripe."
    ],[
        "recipient_identity_mismatch", "Die Identitätsangaben bei Stripe müssen mit deinem Workfare-Profil übereinstimmen."
    ]])("explains %s without exposing identity data or claiming rejection",async(code,message)=>{
        vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({code,error:"private provider identity details"})}));
        await expect(paymentRequest("/api/payments/guardian/recipients/sync",{childId},undefined,ownerId)).rejects.toMatchObject({code,message});
    });
    it("binds setup requests to the displayed parent without putting parent identity in the target body", async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => hosted }); vi.stubGlobal("fetch", fetch);
        await paymentRequest("/api/payments/guardian/recipients", { childId, consent: true }, "stable-operation", ownerId);
        expect(fetch).toHaveBeenCalledWith("/api/payments/guardian/recipients", expect.objectContaining({ headers: { "Content-Type": "application/json", "idempotency-key": "stable-operation", "X-Workfare-Owner": ownerId }, body: JSON.stringify({ childId, consent: true }) }));
        await expect(paymentRequest("/api/payments/recipient/session", { consent: true }, "operation", "invalid-owner")).rejects.toMatchObject({ code: "owner_mismatch" });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
