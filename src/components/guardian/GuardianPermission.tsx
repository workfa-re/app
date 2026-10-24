"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { getGuardianPermission, requestGuardianPermissionCode, revokeGuardianPermission, submitGuardianPermission } from "@/app/guardian/permission/actions";
import { GUARDIAN_DECLARATION_TEXT, GUARDIAN_DECLARATION_VERSION } from "@/lib/guardian/types";
import type { PermissionPreview } from "@/lib/guardian/permission.server";
import { guardianSignupHref } from "@/lib/guardian/navigation";
import { GuardianPrivacy } from "./GuardianForms";
import { GuardianShell } from "./GuardianShell";
import { guardianAction } from "./guardian-client";
import styles from "./Guardian.module.css";

function subscribeReceipt(listener: () => void) {
    window.addEventListener("hashchange", listener); window.addEventListener("popstate", listener);
    return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); };
}
function readReceiptFragment() {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("receipt");
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
const serverReceipt = () => null;

export function GuardianPermissionRoute() {
    const params = useSearchParams();
    const fragmentReceipt = useSyncExternalStore(subscribeReceipt, readReceiptFragment, serverReceipt);
    const token = params.get("token") || undefined;
    const receipt = params.get("receipt") || fragmentReceipt || undefined;
    return <GuardianPermission key={token || receipt || "missing"} token={token} initialReceipt={receipt} />;
}

function GuardianPermission({ token, initialReceipt }: { token?: string; initialReceipt?: string }) {
    const [preview, setPreview] = useState<PermissionPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [available, setAvailable] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState("");
    const [challenge, setChallenge] = useState<string | null>(null);
    const [receipt, setReceipt] = useState(initialReceipt || null);
    const [accepted, setAccepted] = useState(false);
    const [copied, setCopied] = useState(false);
    const [receiptSent, setReceiptSent] = useState(false);
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const pendingReceipt = useRef<string | null>(initialReceipt || null);
    const loadGeneration = useRef(0);
    const returnTo = token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access";
    useEffect(() => {
        mounted.current = true;
        const generations = loadGeneration;
        const generation = ++generations.current;
        void guardianAction(() => getGuardianPermission({ ...(token ? { token } : {}), ...(initialReceipt ? { receipt: initialReceipt } : {}) })).then(result => {
            if (!mounted.current || generation !== loadGeneration.current) return;
            if (result.ok) { setPreview(result.preview); setAvailable(result.emailAvailable); if (result.preview.status === "approved" && initialReceipt) setReceipt(initialReceipt); }
            else setError(result.error);
        }).catch(() => { if (mounted.current && generation === loadGeneration.current) setError("Der Link konnte nicht geprüft werden."); })
            .finally(() => { if (mounted.current && generation === loadGeneration.current) setLoading(false); });
        return () => { mounted.current = false; ++generations.current; };
    }, [token, initialReceipt]);
    async function run(task: () => Promise<void>) {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(null);
        try { await task(); }
        catch { if (mounted.current) setError("Der aktuelle Stand konnte nicht bestätigt werden. Bitte lade die Seite neu."); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }
    function request(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token) return;
        const value = String(new FormData(event.currentTarget).get("email") || "").trim();
        void run(async () => {
            const result = await guardianAction(() => requestGuardianPermissionCode({ token, email: value }));
            if (!mounted.current) return;
            if (!result.ok) { setError(result.error); return; }
            setEmail(value); setChallenge(result.challengeId);
        });
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token || !challenge || !accepted) return;
        const form = new FormData(event.currentTarget);
        if (!pendingReceipt.current) pendingReceipt.current = initialReceipt || Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
        const nextReceipt = pendingReceipt.current;
        // Durable before the POST: a refresh retains the receipt even when its
        // success response is lost. Fragments never reach HTTP logs/referrers.
        const pendingUrl = new URL(window.location.href);
        pendingUrl.searchParams.set("token", token); pendingUrl.searchParams.delete("receipt");
        pendingUrl.hash = new URLSearchParams({ receipt: nextReceipt }).toString();
        window.history.replaceState(null, "", `${pendingUrl.pathname}${pendingUrl.search}${pendingUrl.hash}`);
        void run(async () => {
            const result = await guardianAction(() => submitGuardianPermission({ token, challengeId: challenge,
                code: String(form.get("code") || ""), fullName: String(form.get("fullName") || ""), receipt: nextReceipt,
                relationshipType: String(form.get("relationshipType") || ""), adultConfirmed: true, accepted: true, declarationVersion: GUARDIAN_DECLARATION_VERSION }));
            if (!mounted.current) return;
            if (!result.ok) { setError(result.error); return; }
            setReceipt(result.receipt); setReceiptSent(result.receiptSent); setPreview(current => current ? { ...current, status: "approved" } : null);
            // The raw receipt is kept by this browser, never in localStorage or analytics.
            // Keep the precommitted fragment until navigation. A reload can
            // recover the same receipt without ever sending it in a URL query.
        });
    }
    async function revoke() {
        if (!receipt) return;
        await run(async () => {
            const result = await guardianAction(() => revokeGuardianPermission(receipt));
            if (!mounted.current) return;
            if (!result.ok) { setError(result.error); return; }
            setPreview(current => current ? { ...current, status: "revoked" } : null);
        });
    }
    return <GuardianShell title="Elternfreigabe" description="Deine Zustimmung einfach verwalten.">
        <div className={`${styles.surface} ${styles.stack}`} aria-busy={loading || busy}>
            {loading ? <p className={styles.loading} role="status"><Loader2 size={18} className={styles.spinner} aria-hidden="true" />Link wird geprüft …</p>
                : preview?.status === "approved" ? <>
                    <div className={styles.success} role="status"><CheckCircle2 size={27} aria-hidden="true" /><h2>Zustimmung hinterlegt</h2><p>Die Elternfreigabe für {preview.childName || "dein Kind"} wurde gespeichert. {preview.accountLinked ? "Du kannst sie hier oder in deinem Familienkonto verwalten." : "Es wurde kein Konto angelegt."}</p></div>
                    {receipt ? <><p className={styles.fieldHint}>{receiptSent ? "Dein persönlicher Widerrufslink wurde auch per E-Mail verschickt. " : ""}Bewahre diesen persönlichen Link auf. Damit kannst du deine Zustimmung jederzeit widerrufen. Teile ihn nicht.</p><button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => { void navigator.clipboard.writeText(new URL(`/guardian/permission#receipt=${receipt}`, window.location.origin).href).then(() => setCopied(true)).catch(() => setError("Bitte kopiere den Link aus der Adressleiste.")); }}>{copied ? "Link kopiert" : "Persönlichen Link kopieren"}</button><details className={styles.details}><summary><ChevronRight size={15} aria-hidden="true" />Zustimmung widerrufen</summary><p>Für neue Bewerbungen wird danach wieder eine gültige Elternfreigabe benötigt, sofern keine weitere vorliegt.</p><button type="button" className={`${styles.action} ${styles.glass}`} disabled={busy} onClick={() => void revoke()}>Zustimmung widerrufen</button></details></> : <p className={styles.fieldHint}>Für einen Widerruf benötigst du den persönlichen Link aus der ursprünglichen Bestätigung.</p>}
                </> : preview?.status === "revoked" ? <div className={styles.success} role="status"><h2>Zustimmung widerrufen</h2><p>Die Freigabe ist nicht mehr aktiv. Bestehende Familienkonten und andere gültige Zustimmungen bleiben davon getrennt.</p></div>
                    : preview && preview.direction === "child_to_guardian" && preview.minorRequired ? <>
                        <h2>Für {preview.childName || "dein Kind"}</h2>
                        {!available ? <p className={styles.intro}>Die Bestätigung ohne Konto ist gerade nicht verfügbar. Du kannst stattdessen dein Familienkonto einrichten.</p>
                            : !challenge ? <><p className={styles.intro}>Bestätige zuerst deine eigene E-Mail-Adresse. Anschließend erteilst du die Zustimmung.</p><form className={styles.form} onSubmit={request}><label className={styles.field}>Deine E-Mail-Adresse<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label><button className={`${styles.action} ${styles.primary} ${styles.glass}`} disabled={busy} type="submit">{busy ? "Wird gesendet …" : "Bestätigungscode erhalten"}</button></form></>
                                : <form className={styles.form} onSubmit={submit}>
                                    <p className={styles.fieldHint}>Den achtstelligen Code haben wir an {email} gesendet. Er gilt zehn Minuten.</p>
                                    <label className={styles.field}>Bestätigungscode<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} required disabled={busy} /></label>
                                    <label className={styles.field}>Dein vollständiger Name<input name="fullName" autoComplete="name" minLength={3} maxLength={120} required disabled={busy} /></label>
                                    <label className={styles.field}>Deine Beziehung<select name="relationshipType" defaultValue="" required disabled={busy}><option value="" disabled>Bitte auswählen</option><option value="mother">Mutter</option><option value="father">Vater</option><option value="legal_guardian">Gesetzliche Vertretung</option></select></label>
                                    <div className={styles.consentGroup}><label className={styles.consent}><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} required disabled={busy} aria-describedby="permission-scope" /><span>Ich bin volljährig, gesetzlich vertretungsberechtigt und erteile {preview.childName || "meinem Kind"} die beschriebene Elternfreigabe.</span></label><p id="permission-scope" className={styles.fieldHint}>Für altersgerechte, zulässige Tätigkeiten. Keine Zahlungsfreigabe bei Stripe und kein vollständiger Zugriff auf private Chats. Gesetzliche Grenzen und weitere erforderliche Einwilligungen gelten weiterhin.</p><details className={styles.details}><summary><ChevronRight size={15} aria-hidden="true" />Vollständige Erklärung lesen</summary><p>{GUARDIAN_DECLARATION_TEXT}</p></details></div>
                                    <button className={`${styles.action} ${styles.primary} ${styles.glass}`} disabled={busy || !accepted} type="submit">{busy ? "Wird bestätigt …" : "Zustimmung erteilen"}</button>
                                    <button type="button" className={styles.quiet} disabled={busy} onClick={() => { setChallenge(null); setError(null); }}>E-Mail ändern oder neuen Code anfordern</button>
                                </form>}
                    </> : <><h2>Dieser Link ist nicht verfügbar</h2><p className={styles.intro}>Eine reine Elternfreigabe ist für diesen Link nicht vorgesehen oder die Einladung ist abgelaufen.</p></>}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
        {!receipt ? <Link href={guardianSignupHref(returnTo)} prefetch={false} className={styles.quiet}>Familie dauerhaft verknüpfen<ChevronRight size={15} aria-hidden="true" /></Link> : null}
        {receipt && (!preview || preview.accountLinked) ? <Link href="/guardian/access" prefetch={false} className={styles.quiet}>Zum Familienkonto<ChevronRight size={15} aria-hidden="true" /></Link> : null}
        <GuardianPrivacy />
    </GuardianShell>;
}
