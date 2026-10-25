import { createElement, type ElementType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuardianAccessContext, GuardianConnection, GuardianInvitationPreview } from "@/lib/guardian/types";

const actions = vi.hoisted(() => ({ createFamilyInvitation: vi.fn(), redeemGuardianInvitation: vi.fn(), approveGuardianRelationship: vi.fn(), setGuardianAccessPassword: vi.fn(), signInGuardianAccessPassword: vi.fn() }));
vi.mock("@/app/guardian/permission/actions", () => ({ getGuardianPermission: vi.fn() }));
vi.mock("@/app/actions/guardian", () => ({ createFamilyInvitation: actions.createFamilyInvitation }));
vi.mock("@/app/guardian/access/actions", () => ({
    redeemGuardianInvitation: actions.redeemGuardianInvitation, approveGuardianRelationship: actions.approveGuardianRelationship,
    completeGuardianProfile: vi.fn(), getGuardianAccessContext: vi.fn(), requestGuardianOtp: vi.fn(), revokeGuardianRelationship: vi.fn(), verifyGuardianOtp: vi.fn(),
    setGuardianAccessPassword: actions.setGuardianAccessPassword, signInGuardianAccessPassword: actions.signInGuardianAccessPassword,
}));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: { onAuthStateChange: vi.fn() } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string; prefetch?: boolean }) => createElement("a", { ...props, prefetch: undefined, href }, children) }));
vi.mock("next/image", () => ({ default: (props: { priority?: boolean }) => createElement("img", { ...props, priority: undefined }) }));
vi.mock("@/components/providers/ThemeProvider", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@headlessui/react", () => ({
    Dialog: ({ open, children, ...props }: { open: boolean; children: ReactNode; className: string; onClose: () => void }) => open ? createElement("div", { className: props.className, role: "dialog" }, children) : null,
    DialogPanel: ({ children, className }: { children: ReactNode; className: string }) => createElement("section", { className }, children),
    DialogTitle: ({ as = "h2", children, className }: { as?: ElementType; children: ReactNode; className?: string }) => createElement(as, { className }, children),
    DialogBackdrop: () => null,
    Description: ({ children, className }: { children: ReactNode; className: string }) => createElement("p", { className }, children),
}));

import { guardianAccessStep, GuardianLoading } from "@/components/guardian/GuardianAccess";
import { GuardianConsentReview, GuardianEmailForm, GuardianProfileForm, GuardianSuccess, guardianReviewCopy } from "@/components/guardian/GuardianForms";
import { GuardianGuestEntry } from "@/components/guardian/GuardianGuestEntry";
import { GuardianAccountSettings, GuardianWorkspaceOffer } from "@/components/guardian/GuardianAccount";
import { GuardianConnections, guardianConnectionLabel } from "@/components/guardian/GuardianConnections";
import { FamilyInvitation } from "@/components/guardian/FamilyInvitation";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import { GuardianBanner } from "@/components/profile/GuardianBanner";
import { AddGuardianButton } from "@/components/profile/AddGuardianButton";
import { guardianAction, invitationLink } from "@/components/guardian/guardian-client";

const invitation: GuardianInvitationPreview = { direction: "child_to_guardian", inviterName: "Mara", childName: "Anna", minorRequired: true, status: "active", expiresAt: "2030-10-25T10:00:00Z" };
const context: GuardianAccessContext = { authenticated: true, userId: "guardian-owner", email: "parent@example.test", viewer: "guardian", profile: { fullName: "Mara Beispiel", birthdate: "1980-01-01", accountType: null, adultEligible: true }, invitation, relationships: [], workspace: { access: "family_only", providerSetupHref: "/onboarding?purpose=provider", passwordConfigured: true } };
const connection: GuardianConnection = { id: "family-connection", childId: "child", guardianId: "guardian", actorRole: "guardian", name: "Anna Beispiel", status: "pending", consentRequired: true, consented: false };
const noop = () => undefined;
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("purpose-bound guardian access and consent UI", () => {
    it("lets a guest authenticate without disclosing invitation metadata first", () => {
        expect(guardianAccessStep({ ...context, authenticated: false, userId: null, invitation: null, relationships: [], email: null }, true)).toBe("email");
    });
    it("combines minimal adult details with the invitation review", () => {
        expect(guardianAccessStep({ ...context, viewer: "unconfigured", profile: { fullName: null, birthdate: null, adultEligible: false, accountType: null } }, true)).toBe("review");
        expect(guardianAccessStep(context, true)).toBe("review");
        expect(guardianAccessStep({ ...context, workspace: { ...context.workspace, passwordConfigured: false } }, true)).toBe("password");
        expect(guardianAccessStep({ ...context, viewer:"unconfigured",profile:{...context.profile,fullName:null,birthdate:null,adultEligible:false},workspace:{...context.workspace,passwordConfigured:false} },true)).toBe("review");
        expect(context.profile.accountType).toBeNull();
    });
    it("routes a reverse invitation to the child's profile instead of claiming the child is an adult guardian", () => {
        const reverse = { ...context, invitation: { ...invitation, direction: "guardian_to_child" as const } };
        expect(guardianAccessStep({ ...reverse, viewer: "unconfigured" }, true)).toBe("child_profile");
        expect(guardianAccessStep({ ...reverse, viewer: "child", profile: { ...context.profile, adultEligible: false, accountType: "job_seeker" } }, true)).toBe("review");
        expect(guardianAccessStep(reverse, true)).toBe("wrong_account");
    });
    it("never offers a child the guardian's legal consent form or treats an unknown age as optional", () => {
        expect(guardianAccessStep({ ...context, viewer: "child" }, true)).toBe("wrong_account");
        expect(guardianAccessStep({ ...context, invitation: { ...invitation, minorRequired: null } }, true)).toBe("unavailable");
    });
    it.each(["expired", "revoked", "redeemed"] as const)("does not redeem an invitation with status %s from a return marker", status => {
        expect(guardianAccessStep({ ...context, invitation: { ...invitation, status } }, true)).toBe("unavailable");
    });
    it("keeps authenticated family access available without any invitation token", () => {
        expect(guardianAccessStep({ ...context, invitation: null }, false)).toBe("family");
        expect(guardianAccessStep({ ...context, viewer: "child", invitation: null }, false)).toBe("family");
    });
    it("offers a passwordless code form without long account or payment registration", () => {
        const html = renderToStaticMarkup(<GuardianEmailForm email="" codeSent={false} busy={false} onRequest={noop} onVerify={noop} onChangeEmail={noop} />);
        expect(html).toContain('type="email"'); expect(html).toContain('autoComplete="email"'); expect(html).toContain("Anmeldecode senden");
        expect(html).not.toMatch(/type="password"|name="street"|name="zip"|Kreditkarte|Anbieterprofil|registrieren/);
    });
    it("provides a real one-time-code field, change-email and bounded resend controls", () => {
        const html = renderToStaticMarkup(<GuardianEmailForm email="parent@example.test" codeSent busy={false} resendAllowed={false} onRequest={noop} onVerify={noop} onChangeEmail={noop} />);
        expect(html).toContain('autoComplete="one-time-code"'); expect(html).toContain('inputMode="numeric"'); expect(html).toContain('maxLength="10"'); expect(html).toContain('pattern="[0-9]{6,10}"');
        expect(html).toContain("E-Mail ändern"); expect(html).toMatch(/disabled=""[^>]*>Code versendet/);
        expect(html).not.toContain('name="password"');
    });
    it("requires a fresh adult declaration and only name and birthdate in the minimal parent profile", () => {
        const html = renderToStaticMarkup(<GuardianProfileForm fullName={null} birthdate={null} busy={false} onComplete={noop} />);
        expect(html).toContain('name="fullName"'); expect(html).toContain('name="birthdate"'); expect(html).toContain('type="checkbox"');
        expect(html).not.toContain('checked=""'); expect(html).toContain('type="submit"'); expect(html).toContain('disabled=""');
        expect(html).not.toMatch(/name="(?:street|zip|city|iban|account_type)"/); expect(html).toContain("keine Ausweisprüfung");
        expect(html).toContain("Elternkonto einrichten"); expect(html).not.toContain('type="password"');
    });
    it("starts real guardian consent with an empty relationship choice and unchecked explicit consent", () => {
        const html = renderToStaticMarkup(<GuardianConsentReview invitation={invitation} busy={false} onConfirm={noop} />);
        expect(html).toMatch(/value=""[^>]*selected=""/); expect(html).not.toContain('checked=""'); expect(html).toMatch(/type="submit"[^>]*disabled=""/);
        expect(text(html)).toContain("gesetzlich vertretungsberechtigt"); expect(text(html)).toContain("weder eine Zahlungsfreigabe bei Stripe");
        expect(actions.redeemGuardianInvitation).not.toHaveBeenCalled(); expect(actions.approveGuardianRelationship).not.toHaveBeenCalled();
    });
    it("combines missing parent details and explicit approval into one form without payout or provider fields", () => {
        const html=renderToStaticMarkup(<GuardianConsentReview invitation={invitation} profile={{fullName:null,birthdate:null,adultEligible:false}} busy={false} onConfirm={noop} />);
        expect(html.match(/<form /g)).toHaveLength(1);expect(html.match(/type="submit"/g)).toHaveLength(1);
        expect(html).toContain('name="fullName"');expect(html).toContain('name="birthdate"');expect(html).toContain("Ich bin volljährig.");expect(html).toContain("Freigabe erteilen");
        expect(html).not.toContain('checked=""');expect(html).not.toMatch(/name="(?:street|zip|iban|account_type)"|Elternkonto einrichten/);
        const existing=renderToStaticMarkup(<GuardianConsentReview invitation={invitation} profile={context.profile} busy={false} onConfirm={noop} />);
        expect(existing).not.toContain('name="birthdate"');expect(existing).not.toContain('name="fullName"');
    });
    it("names the child in concise consent and keeps the unchanged complete scope before submission", () => {
        const html = renderToStaticMarkup(<GuardianConsentReview invitation={invitation} busy={false} onConfirm={noop} />);
        expect(text(html)).toContain("erteile Anna die beschriebene Elternfreigabe");
        expect(html).toMatch(/type="checkbox"[^>]*aria-describedby="[^"]+"/);
        expect(text(html)).toContain("Keine Zahlungsfreigabe bei Stripe");
        expect(text(html)).toContain("Gesetzliche Grenzen und weitere erforderliche Einwilligungen gelten weiterhin.");
        expect(html.indexOf("Vollständige Erklärung lesen")).toBeLessThan(html.indexOf('type="submit"'));
        expect(html).not.toMatch(/<details[^>]* open/);
        expect(guardianReviewCopy(invitation).declaration).toBe("Ich bin für dieses Kind gesetzlich vertretungsberechtigt und stimme seiner Nutzung von Workfare sowie Bewerbungen und dem Kontakt zu Anbietern für altersgerechte, zulässige Tätigkeiten zu. Gesetzliche Grenzen und gegebenenfalls weitere erforderliche Einwilligungen bleiben bestehen. Diese Zustimmung umfasst weder eine Zahlungsfreigabe bei Stripe noch eine vollständige Einsicht in private Chats.");
    });
    it("uses the existing provider onboarding for a parent's optional account upgrade", () => {
        const html = renderToStaticMarkup(<GuardianWorkspaceOffer workspace={context.workspace} />);
        expect(html).toContain('href="/onboarding?purpose=provider"'); expect(html).toContain("Workfare nutzen");
        expect(html).toContain("Dein Elternkonto ist eingerichtet"); expect(html).not.toContain("verifiziert");
        expect(renderToStaticMarkup(<GuardianWorkspaceOffer workspace={{ ...context.workspace, access: "provider_incomplete" }} />)).toContain("Einrichtung fortsetzen");
    });
    it("never asks a complete provider to repeat onboarding or offers children a provider upgrade", () => {
        const complete = renderToStaticMarkup(<GuardianWorkspaceOffer workspace={{ ...context.workspace, access: "provider_complete" }} />);
        expect(complete).toContain('href="/app-home"'); expect(complete).not.toContain("onboarding");
        expect(renderToStaticMarkup(<GuardianWorkspaceOffer workspace={{ ...context.workspace, access: "child" }} />)).toBe("");
        expect(renderToStaticMarkup(<GuardianWorkspaceOffer workspace={{ ...context.workspace, access: "unconfigured" }} />)).toBe("");
    });
    it("migrates legacy passwordless accounts into the shared password login", () => {
        const html = renderToStaticMarkup(<GuardianAccountSettings email={context.email} passwordConfigured={false} busy={false} notice={null} onSavePassword={noop} onReauthenticate={noop} />);
        expect(html).toContain("Anmeldung &amp; Passwort"); expect(html).toContain("Passwort festlegen");
        expect(html).toContain("normale Workfare-Anmeldung"); expect(html).not.toContain('type="password"');
        expect(actions.setGuardianAccessPassword).not.toHaveBeenCalled();
        const configured = renderToStaticMarkup(<GuardianAccountSettings email={context.email} passwordConfigured busy={false} notice="Dein Passwort ist gespeichert." onSavePassword={noop} onReauthenticate={noop} />);
        expect(configured).toContain('href="/auth/forgot-password"'); expect(configured).not.toContain("Passwort festlegen"); expect(configured).toContain('role="status"');
    });
    it("opens one shared email-password entry instead of a three-choice wall", () => {
        const html = renderToStaticMarkup(<GuardianGuestEntry token="private-invite-token" />);
        expect(html).toContain('purpose=family'); expect(html).toContain("Mit E-Mail und Passwort fortfahren");
        expect(html.match(/<a /g)).toHaveLength(1); expect(html).not.toMatch(/Nur Erlaubnis|So möchtest du fortfahren|Passwort festlegen/);
        expect(html).not.toContain('type="password"'); expect(html).not.toContain("Anmeldecode senden");
        const returning=renderToStaticMarkup(<GuardianGuestEntry token={null} />);
        expect(returning).toContain("authMode=signin");expect(returning).not.toContain("authMode=signup");
    });
    it("fixes the parent's email during password reauthentication without a second account form", () => {
        const html = renderToStaticMarkup(<GuardianEmailForm email="parent@example.test" codeSent busy={false} fixedEmail onRequest={noop} onVerify={noop} onChangeEmail={noop} />);
        expect(html).toContain("parent@example.test"); expect(html).not.toContain("E-Mail ändern"); expect(html).not.toContain('type="password"');
        const request = renderToStaticMarkup(<GuardianEmailForm email="parent@example.test" codeSent={false} busy={false} fixedEmail onRequest={noop} onVerify={noop} onChangeEmail={noop} />);
        expect(request).toContain('readOnly=""');
    });
    it("keeps an adult family connection voluntary and distinct from a minor's parental consent", () => {
        const html = renderToStaticMarkup(<GuardianConsentReview invitation={{ ...invitation, minorRequired: false }} busy={false} onConfirm={noop} />);
        expect(text(html)).toContain("Freiwillig"); expect(text(html)).toContain("Für Bewerbungen nicht erforderlich");
        expect(text(html)).toContain("keine Elternfreigabe"); expect(html).not.toContain("gesetzlich vertretungsberechtigt");
    });
    it("describes a child's reverse acceptance as pending without impersonating parental approval", () => {
        const copy = guardianReviewCopy({ ...invitation, direction: "guardian_to_child" });
        expect(copy.button).toBe("Verbindung anfragen"); expect(copy.declaration).toContain("anschließend von meinem Elternteil");
        expect(copy.declaration).not.toContain("Ich bin für dieses Kind gesetzlich");
    });
    it.each([[true, true], [false, true], [false, false]])("does not promise global account or payment readiness on completion (%s,%s)", (pending, consentRequired) => {
        const html = renderToStaticMarkup(<GuardianSuccess pending={pending} consentRequired={consentRequired} onContinue={noop} />);
        expect(html).toContain('role="status"'); expect(html).toContain("Familienübersicht");
        expect(html).not.toMatch(/Konto.*freigeschaltet|volle Verantwortung|jetzt Jobs annehmen/);
        if (pending) expect(html).toContain("bestätigt die Freigabe im eigenen Konto");
    });
    it("distinguishes a saved consent, private receipt and an actually sent email", () => {
        const render=(props: {receiptUrl?:string;receiptSent?:boolean;receiptUnavailable?:boolean})=>text(renderToStaticMarkup(<GuardianSuccess pending={false} consentRequired onContinue={noop} {...props} />));
        expect(render({receiptUrl:"/guardian/permission#receipt=private",receiptSent:true})).toContain("wurde per E-Mail versendet");
        expect(render({receiptUrl:"/guardian/permission#receipt=private",receiptSent:false})).toContain("Zustellung per E-Mail konnte noch nicht bestätigt");
        expect(render({receiptUnavailable:true})).toContain("Deine Freigabe ist gespeichert und bleibt über dein Familienkonto widerrufbar");
    });
    it("surfaces pending approval structurally while avoiding private chat or financial data", () => {
        const html = renderToStaticMarkup(<GuardianConnections relationships={[connection]} busy={false} onApprove={noop} onRevoke={noop} />);
        expect(html).toContain("Anna Beispiel"); expect(html).toContain("Deine Zustimmung fehlt noch"); expect(html).toContain("Zustimmung prüfen");
        expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain("Vollständiger Chat");
        expect(guardianConnectionLabel({ ...connection, status: "active", consented: true })).toBe("Elternfreigabe hinterlegt");
        expect(guardianConnectionLabel({ ...connection, status: "active", consentRequired: false })).toBe("Freiwillig verbunden");
    });
    it("never offers parental approval to the child and excludes revoked family records from active UI", () => {
        const html = renderToStaticMarkup(<GuardianConnections relationships={[{ ...connection, actorRole: "child" }, { ...connection, id: "revoked", name: "Revoked Private Name", status: "revoked" }]} busy={false} onApprove={noop} onRevoke={noop} />);
        expect(html).toContain("Zustimmung deines Elternteils ausstehend"); expect(html).not.toContain("Zustimmung prüfen"); expect(html).not.toContain("Revoked Private Name");
    });
    it("keeps the approved child overview quiet and payout controls behind an explicit disclosure", () => {
        const html=renderToStaticMarkup(<GuardianConnections relationships={[{...connection,status:"active",consented:true}]} busy={false} onApprove={noop} onRevoke={noop}/>);
        expect(text(html)).not.toContain("Elternfreigabe hinterlegt");
        expect(text(html)).not.toContain("Bankverbindung und Auszahlungen verwaltet dein Kind.");
        expect(text(html)).toContain("Workfare Pay");
        expect(html).not.toMatch(/Stand prüfen|gesetzliche Vertretung konnte|Auszahlung einrichten|Stripe|<iframe|<input/);
        expect(html).not.toContain(' open=""');
    });
    it("reserves payout accompaniment for an adult with actual approval of a minor", () => {
        const render=(patch:Partial<GuardianConnection>)=>renderToStaticMarkup(<GuardianConnections relationships={[{...connection,status:"active",consented:true,...patch}]} busy={false} onApprove={noop} onRevoke={noop}/>);
        expect(render({actorRole:"child"})).not.toContain("Workfare Pay");
        expect(render({consentRequired:false})).not.toContain("Workfare Pay");
        expect(render({consented:false})).not.toContain("Workfare Pay");
    });
    it("lets the linked adult complete missing consent on an active legacy relationship without offering redundant approval", () => {
        const render = (patch: Partial<GuardianConnection>) => renderToStaticMarkup(<GuardianConnections relationships={[{ ...connection, status: "active", ...patch }]} busy={false} onApprove={noop} onRevoke={noop} />);
        const missing = render({ consented: false });
        expect(missing).toContain("Deine Zustimmung fehlt noch"); expect(missing).toContain("Zustimmung prüfen");
        expect(actions.approveGuardianRelationship).not.toHaveBeenCalled();
        expect(render({ consented: true })).not.toContain("Zustimmung prüfen");
        expect(render({ consentRequired: false, consented: false })).not.toContain("Zustimmung prüfen");
        expect(render({ actorRole: "child", consented: false })).not.toContain("Zustimmung prüfen");
        expect(render({ status: "revoked", consented: false })).not.toContain("Zustimmung prüfen");
    });
    it("keeps mandatory and optional invitation copy accurate and creates no invitation during rendering", () => {
        const required = renderToStaticMarkup(<GuardianConsentModal isOpen onClose={noop} />);
        const optional = renderToStaticMarkup(<GuardianConsentModal isOpen onClose={noop} consentRequired={false} />);
        const reverse = renderToStaticMarkup(<GuardianConsentModal isOpen onClose={noop} direction="guardian_to_child" />);
        expect(required).toContain("14 bis 17"); expect(optional).toContain("freiwillig"); expect(reverse).toContain("anschließend hier die Elternfreigabe");
        for (const html of [required, optional, reverse]) { expect(html).toContain('aria-label="Einladung schließen"'); expect(html).not.toMatch(/ACTION|30 Sekunden|volle Verantwortung|indigo/); }
        expect(actions.createFamilyInvitation).not.toHaveBeenCalled();
    });
    it("gives parent-add and dismiss controls a visible, accessible target without blanket application promises", () => {
        const add = renderToStaticMarkup(<AddGuardianButton />);
        expect(add).toContain('aria-label="Weiteren Elternteil einladen"'); expect(add).toContain("Hinzufügen");
        const active = renderToStaticMarkup(<GuardianBanner guardianStatus="linked" />);
        expect(active).toContain('aria-label="Hinweis ausblenden"'); expect(active).not.toContain("Du kannst Jobs annehmen");
        const optional = renderToStaticMarkup(<GuardianBanner guardianStatus="none" consentRequired={false} />);
        expect(optional).toContain('data-status="optional"'); expect(optional).not.toContain("brauchst du die Zustimmung");
    });
    it("explains that an existing family link still needs explicit consent rather than fabricating a pending invitation", () => {
        const pending = renderToStaticMarkup(<GuardianBanner guardianStatus="pending" />);
        expect(pending).toContain("Dein Elternteil kann sie im Familienbereich bestätigen.");
        expect(pending).toContain("Zustimmung einholen"); expect(pending).not.toContain("Dein Einladungslink wartet");
        const invitation = renderToStaticMarkup(<GuardianConsentModal isOpen onClose={noop} guardianStatus="pending" />);
        expect(invitation).toContain("Die Verbindung allein ersetzt diese Zustimmung nicht.");
        expect(actions.createFamilyInvitation).not.toHaveBeenCalled();
    });
    it("uses the same branded light/dark shell while loading without declaring an auth result", () => {
        const html = renderToStaticMarkup(<GuardianLoading />);
        expect(html).toContain("Workfare"); expect(html).toContain('aria-label="Helles Farbschema aktivieren"'); expect(html).toContain('role="status"');
        expect(html).not.toMatch(/bg-\[#07090f\]|freigeschaltet|Konto verifiziert|Für deine Familie/);
    });
    it("prepares a private invitation only after an explicit action and encodes token parameters safely", () => {
        const html = renderToStaticMarkup(<FamilyInvitation existing />);
        expect(html).toContain("Einladungslink anzeigen"); expect(html).not.toContain("https://"); expect(actions.createFamilyInvitation).not.toHaveBeenCalled();
        const url = new URL(invitationLink("https://app.example.test", "private&token"));
        expect(url.origin).toBe("https://app.example.test"); expect(url.pathname).toBe("/guardian/access"); expect(url.searchParams.get("token")).toBe("private&token"); expect([...url.searchParams]).toHaveLength(1);
    });
    it("bounds a lost server response without fabricating consent success, and releases its timer", async () => {
        vi.useFakeTimers();
        expect(await guardianAction(async () => ({ ok: true }))).toEqual({ ok: true }); expect(vi.getTimerCount()).toBe(0);
        const pending = guardianAction(() => new Promise<never>(() => undefined));
        const rejected = expect(pending).rejects.toThrow("nicht bestätigt");
        await vi.advanceTimersByTimeAsync(25_000); await rejected; expect(vi.getTimerCount()).toBe(0);
    });
});
