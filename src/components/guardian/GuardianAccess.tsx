"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, Users } from "lucide-react";
import { approveGuardianRelationship, completeGuardianProfile, getGuardianAccessContext, redeemGuardianInvitation, requestGuardianOtp, revokeGuardianRelationship, setGuardianAccessPassword, verifyGuardianOtp } from "@/app/guardian/access/actions";
import type { GuardianAccessContext, GuardianConsentInput, GuardianRedemptionResult } from "@/lib/guardian/types";
import { ageInBerlin } from "@/lib/age";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { FamilyInvitation } from "./FamilyInvitation";
import { GuardianAccountSettings, GuardianWorkspaceOffer, type GuardianPasswordInput } from "./GuardianAccount";
import { GuardianConnections } from "./GuardianConnections";
import { GuardianPayoutsProvider } from "./GuardianPayouts";
import { GuardianConsentReview, GuardianEmailForm, GuardianPrivacy, GuardianProfileForm, GuardianSuccess } from "./GuardianForms";
import { GuardianShell } from "./GuardianShell";
import { guardianAction } from "./guardian-client";
import styles from "./Guardian.module.css";
import { GuardianGuestEntry } from "./GuardianGuestEntry";

export type GuardianAccessStep = "email" | "password" | "profile" | "review" | "family" | "wrong_account" | "child_profile" | "unavailable";

export function guardianAccessStep(context: GuardianAccessContext, hasToken: boolean): GuardianAccessStep {
    if (!context.authenticated) return "email";
    if (hasToken && (!context.invitation || context.invitation.status !== "active")) return "unavailable";
    if (hasToken && context.invitation?.direction === "guardian_to_child") {
        if (context.viewer === "unconfigured") return "child_profile";
        if (context.viewer !== "child") return "wrong_account";
        return context.invitation.minorRequired === null ? "unavailable" : "review";
    }
    if (hasToken && context.viewer === "child") return "wrong_account";
    if (hasToken && context.workspace.passwordConfigured === false) return "password";
    if (context.viewer !== "child" && (!context.profile.fullName || !context.profile.birthdate || !context.profile.adultEligible)) return "profile";
    if (hasToken) return context.invitation?.minorRequired === null ? "unavailable" : "review";
    return "family";
}

function stageTitle(step: GuardianAccessStep | "loading", context: GuardianAccessContext | null) {
    if (step === "family") return "Deine Familie";
    if (step === "review") return context?.invitation?.direction === "guardian_to_child" ? "Eine Einladung für dich" : context?.invitation?.minorRequired ? "Elternfreigabe" : "Familie verbinden";
    if (step === "unavailable") return "Einladung nicht verfügbar";
    if (step === "wrong_account") return "Das passende Konto wählen";
    if (step === "child_profile") return "Dein Workfare-Profil";
    return "Deine Familie";
}

export function GuardianLoading() {
    return <GuardianShell title="Deine Familie"><div className={styles.surface}><p className={styles.loading} role="status"><Loader2 size={18} className={styles.spinner} aria-hidden="true" />Zugang wird geladen …</p></div></GuardianShell>;
}

export function GuardianAccessRoute() {
    const params = useSearchParams();
    const token = params.get("token");
    const returnChildId = params.get("recipientHosted") === "returned" ? params.get("childId") : null;
    return <GuardianAccess key={token || "family"} token={token} returnChildId={returnChildId} />;
}

function GuardianAccess({ token, returnChildId }: { token: string | null; returnChildId: string | null }) {
    const router = useRouter();
    const [context, setContext] = useState<GuardianAccessContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [codeSent, setCodeSent] = useState(false);
    const [resendAllowed, setResendAllowed] = useState(true);
    const [success, setSuccess] = useState<Extract<GuardianRedemptionResult, { success: true }> | null>(null);
    const [showInvite, setShowInvite] = useState(false);
    const [reauthenticating, setReauthenticating] = useState(false);
    const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const loadGeneration = useRef(0);
    const ownerEpoch = useRef(0);
    const ownerId = useRef<string | null>(null);
    const resendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        const request = ++loadGeneration.current;
        try {
            const result = await guardianAction(() => getGuardianAccessContext(token || undefined));
            if (!mounted.current || request !== loadGeneration.current) return;
            if (result.ok) {
                if (ownerId.current !== result.context.userId) {
                    ++ownerEpoch.current;
                    setSuccess(null); setShowInvite(false); setCodeSent(false); setReauthenticating(false); setPasswordNotice(null);
                }
                ownerId.current = result.context.userId;
                setContext(result.context); setError(null);
            }
            else { setContext(null); setError(result.error); }
        } catch { if (mounted.current && request === loadGeneration.current) { setContext(null); setError("Der Zugang konnte nicht geladen werden. Bitte versuche es erneut."); } }
        finally { if (mounted.current && request === loadGeneration.current) setLoading(false); }
    }, [token]);

    useEffect(() => {
        const generation = loadGeneration;
        const epoch = ownerEpoch;
        mounted.current = true;
        void Promise.resolve().then(load);
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            const changedOwner = event === "SIGNED_IN" && session?.user.id !== ownerId.current;
            if (event !== "SIGNED_OUT" && !changedOwner) return;
            ++ownerEpoch.current; ++loadGeneration.current;
            ownerId.current = null;
            setContext(null); setSuccess(null); setShowInvite(false); setCodeSent(false); setReauthenticating(false); setPasswordNotice(null); setError(null); setLoading(true);
            // Avoid running another auth request while Supabase dispatches its event.
            void Promise.resolve().then(load);
        });
        return () => { mounted.current = false; ++generation.current; ++epoch.current; subscription.unsubscribe(); if (resendTimer.current) clearTimeout(resendTimer.current); };
    }, [load]);

    async function run(action: () => Promise<void>) {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(null);
        try { await action(); }
        catch { if (mounted.current) setError("Der Vorgang konnte nicht bestätigt werden. Bitte prüfe den aktuellen Stand, bevor du es erneut versuchst."); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }

    async function request(emailInput: string) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => requestGuardianOtp({ email: emailInput, ...(token ? { token } : {}), ...(reauthenticating ? { reauthenticate: true } : {}) }));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            setCodeSent(true); setResendAllowed(false);
            if (resendTimer.current) clearTimeout(resendTimer.current);
            resendTimer.current = setTimeout(() => { if (mounted.current) setResendAllowed(true); }, 60_000);
        });
    }

    async function verify(emailInput: string, code: string) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => verifyGuardianOtp({ email: emailInput, code }));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            setLoading(true); setCodeSent(false);
            if (reauthenticating) { setReauthenticating(false); setPasswordNotice("Dein Zugang ist bestätigt. Du kannst jetzt dein Passwort speichern."); }
            await load();
        });
    }

    async function savePassword(input: GuardianPasswordInput) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            setPasswordNotice(null);
            const result = await guardianAction(() => setGuardianAccessPassword(input));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            setPasswordNotice("Dein Passwort ist gespeichert. Du kannst dich auch damit anmelden.");
            await load();
        });
    }

    async function complete(data: { fullName: string; birthdate: string; adultConfirmed: true }) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => completeGuardianProfile(data));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            await load();
        });
    }

    async function confirm(input: GuardianConsentInput) {
        if (!token) return;
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => redeemGuardianInvitation(token, input));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.success) { setError(result.message); return; }
            setSuccess(result);
        });
    }

    async function approve(childId: string, input: GuardianConsentInput) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => approveGuardianRelationship(childId, input));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            await load();
        });
    }

    async function revoke(id: string) {
        await run(async () => {
            const epoch = ownerEpoch.current;
            const result = await guardianAction(() => revokeGuardianRelationship(id));
            if (!mounted.current || epoch !== ownerEpoch.current) return;
            if (!result.ok) { setError(result.error); return; }
            await load();
        });
    }

    async function switchAccount() {
        await run(async () => {
            await import("@/components/payments/recipient-connect-lifecycle")
                .then(({ logoutRecipientConnectSessions }) => logoutRecipientConnectSessions()).catch(() => undefined);
            const result = await supabaseBrowser.auth.signOut();
            if (result.error) { setError("Abmelden ist gerade nicht möglich. Bitte versuche es erneut."); return; }
            window.location.reload();
        });
    }

    const step = context ? guardianAccessStep(context, !!token) : "loading";
    const child = context?.viewer === "child";
    const age = ageInBerlin(context?.profile.birthdate);
    const minor = age !== null && age >= 14 && age < 18;
    const setupPath = token ? `/?authMode=signup&redirectTo=${encodeURIComponent(`/guardian/access?token=${token}`)}` : "/";
    return <GuardianShell title={reauthenticating ? "Deinen Zugang bestätigen" : success ? success.state === "pending_guardian_confirmation" ? "Fast verbunden" : "Alles hinterlegt" : stageTitle(step, context)}
        description={reauthenticating ? "Ein neuer E-Mail-Code schützt Änderungen an deinem Passwort." : step === "family" ? "Deine Familie und ihre Freigaben an einem Ort." : undefined}>
        <div key={context?.userId || "signed-out"} className={`${styles.surface} ${styles.stack}`} aria-busy={busy || loading}>
            {context?.authenticated ? <div className={styles.account}><div><strong>{context.profile.fullName || "Dein Zugang"}</strong><span>{context.email}</span></div><button type="button" className={styles.quiet} disabled={busy} onClick={() => void switchAccount()}>Konto wechseln</button></div> : null}
            {loading ? <p className={styles.loading} role="status"><Loader2 size={18} className={styles.spinner} aria-hidden="true" />Zugang wird geladen …</p>
                : reauthenticating && context?.authenticated ? <><GuardianEmailForm key="confirm-access" email={context.email || ""} codeSent={codeSent} busy={busy} resendAllowed={resendAllowed} fixedEmail onRequest={value => void request(value)} onVerify={(value, code) => void verify(value, code)} onChangeEmail={() => undefined} /><button type="button" className={styles.quiet} disabled={busy} onClick={() => { setReauthenticating(false); setCodeSent(false); setError(null); }}>Zurück zur Familie</button></>
                : success ? <GuardianSuccess pending={success.state === "pending_guardian_confirmation"} consentRequired={success.consentRequired} onContinue={() => { router.replace("/guardian/access"); if (!token) { setSuccess(null); void load(); } }} />
                : !context ? <><h2>Gerade nicht erreichbar</h2><button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => { setLoading(true); void load(); }}>Erneut versuchen</button></>
                : step === "email" ? <GuardianGuestEntry token={token} />
                : step === "password" ? <><h2>Dein dauerhafter Familienzugang</h2><p className={styles.intro}>Lege ein Passwort fest. Danach meldest du dich überall mit deiner E-Mail-Adresse und diesem Passwort an.</p>{context.profile.adultEligible ? <GuardianAccountSettings requiredSetup email={context.email} passwordConfigured={false} busy={busy} notice={passwordNotice} onSavePassword={input => void savePassword(input)} onReauthenticate={() => { setReauthenticating(true); setCodeSent(false); setError(null); }} /> : <Link className={`${styles.action} ${styles.glass}`} href={`/auth/forgot-password?redirectTo=${encodeURIComponent(token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access")}`} prefetch={false}>Passwort einrichten</Link>}</>
                : step === "profile" ? <GuardianProfileForm key={context.email} fullName={context.profile.fullName} birthdate={context.profile.birthdate} busy={busy} onComplete={data => void complete(data)} />
                : step === "review" && context.invitation ? <GuardianConsentReview key={`${context.email}:${context.invitation.direction}`} invitation={context.invitation} busy={busy} onConfirm={input => void confirm(input)} />
                : step === "wrong_account" ? <><h2>Dieser Link ist für {context.invitation?.direction === "guardian_to_child" ? "dein Kind" : "dein Elternteil"}</h2><p className={styles.intro}>{context.invitation?.direction === "guardian_to_child" ? "Die Einladung wird im Konto der jobsuchenden Person angenommen." : "Die Zustimmung muss über den eigenen Zugang deines Elternteils oder deiner gesetzlichen Vertretung erfolgen."}</p><button type="button" className={`${styles.action} ${styles.glass}`} disabled={busy} onClick={() => void switchAccount()}>Mit passendem Konto fortfahren</button></>
                : step === "child_profile" ? <><h2>Richte dein Profil ein</h2><p className={styles.intro}>Für diese Einladung brauchst du ein Workfare-Profil als jobsuchende Person. Danach kannst du die Familienverbindung bestätigen.</p><Link href={setupPath} prefetch={false} className={`${styles.action} ${styles.glass}`}>Profil einrichten<ChevronRight size={16} aria-hidden="true" /></Link></>
                : step === "unavailable" ? <><h2>{context.invitation?.status === "redeemed" ? "Bereits angenommen" : "Bitte prüfe deinen Link"}</h2><p className={styles.intro}>{context.invitation?.status === "redeemed" ? "Diese Einladung wurde bereits angenommen. Deine eigenen Verbindungen findest du in der Familienübersicht." : "Die Einladung ist abgelaufen, wurde zurückgezogen oder kann nicht bestätigt werden. Bitte lass dir einen neuen Link senden."}</p><Link href="/guardian/access" prefetch={false} className={`${styles.action} ${styles.glass}`}>Zum Familienbereich</Link></>
                : step === "family" ? <>
                    {child && context.permission?.required && context.permission.granted ? <div><h2>Elternfreigabe aktiv</h2><p className={styles.fieldHint}>Eine dauerhafte Familienverknüpfung ist freiwillig. Für Workfare Pay gelten weiterhin eigene Voraussetzungen.</p></div> : null}
                    <GuardianPayoutsProvider key={`${context.userId}:${context.relationships.map(value => `${value.id}:${value.consented}`).join("|")}`} ownerId={child ? null : context.userId} returnChildId={returnChildId}><GuardianConnections relationships={context.relationships} busy={busy} onApprove={(id, input) => void approve(id, input)} onRevoke={id => void revoke(id)} /></GuardianPayoutsProvider>
                    {showInvite ? <div><h2>{child ? minor ? "Elternteil einladen" : "Familie verbinden" : "Dein Kind einladen"}</h2><p className={styles.intro}>{child ? minor ? "Dein Elternteil kann nur die Erlaubnis erteilen oder eure Familie dauerhaft verknüpfen." : "Die Verbindung ist freiwillig. Deine privaten Chats und Zahlungsdaten bleiben getrennt." : "Dein Kind nimmt den Link im eigenen Konto an. Unter 18 bestätigst du anschließend hier die Zustimmung."}</p><FamilyInvitation direction={child ? "child_to_guardian" : "guardian_to_child"} /><button type="button" className={styles.quiet} onClick={() => setShowInvite(false)}>Schließen</button></div>
                        : child || context.workspace.passwordConfigured === true ? <button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => setShowInvite(true)}><Users size={17} aria-hidden="true" />{child ? context.permission?.granted ? "Familie verknüpfen" : "Elternteil einladen" : "Kind einladen"}</button> : null}
                    {child ? <Link href="/app-home/profile" prefetch={false} className={styles.quiet}>Zu deinem Profil<ChevronRight size={15} aria-hidden="true" /></Link> : null}
                    {!child ? <GuardianAccountSettings requiredSetup={context.workspace.passwordConfigured === false} email={context.email} passwordConfigured={context.workspace.passwordConfigured} busy={busy} notice={passwordNotice} onSavePassword={input => void savePassword(input)} onReauthenticate={() => { setReauthenticating(true); setCodeSent(false); setError(null); }} /> : null}
                </> : null}
            {error ? <div className={styles.error} role="alert"><AlertCircle size={17} aria-hidden="true" /><p>{error}</p></div> : null}
        </div>
        {context?.authenticated && step === "family" && !success && !reauthenticating ? <GuardianWorkspaceOffer workspace={context.workspace} /> : null}
        <GuardianPrivacy />
    </GuardianShell>;
}
