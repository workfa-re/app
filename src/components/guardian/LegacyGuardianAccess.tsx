"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { redeemLegacyGuardianInvitation } from "@/app/guardian/access/actions";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { GuardianShell } from "./GuardianShell";
import styles from "./Guardian.module.css";

/** Temporary compatibility surface for the original, complete-provider model. */
export function LegacyGuardianAccess({ authenticated, eligible, name, childrenNames }: {
    authenticated: boolean; eligible: boolean; name: string | null; childrenNames: string[];
}) {
    const search = useSearchParams(); const router = useRouter();
    const token = search.get("token");
    const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const destination = token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access";
    const login = `/onboarding?authMode=signin&redirectTo=${encodeURIComponent(destination)}`;
    const onboarding = `/onboarding?redirectTo=${encodeURIComponent(destination)}`;
    async function confirm() {
        if (!token || !accepted || busy) return;
        setBusy(true); setError(null);
        try {
            const result = await redeemLegacyGuardianInvitation(token, true);
            if (result.ok) { setDone(true); router.refresh(); }
            else setError(result.error);
        } catch { setError("Die Zustimmung konnte nicht bestätigt werden. Bitte versuche es erneut."); }
        finally { setBusy(false); }
    }
    async function switchAccount() {
        if (busy) return; setBusy(true); setError(null);
        try {
            await import("@/components/payments/recipient-connect-lifecycle").then(({ logoutRecipientConnectSessions }) => logoutRecipientConnectSessions()).catch(() => undefined);
            const result = await supabaseBrowser.auth.signOut();
            if (result.error) throw new Error("sign_out_failed");
            router.push(login); router.refresh();
        } catch { setError("Dein Konto konnte nicht abgemeldet werden. Bitte versuche es erneut."); setBusy(false); }
    }
    return <GuardianShell title="Für deine Familie" description="Begleite dein Kind auf Workfare.">
        <section className={`${styles.surface} ${styles.stack}`}>
            {done ? <><CheckCircle2 size={28} aria-hidden="true" /><h2>Elternfreigabe bestätigt</h2><p className={styles.intro}>Die Verbindung wurde gespeichert. Dein Kind kann in seinem Konto weitermachen.</p><Link href="/app-home" className={`${styles.action} ${styles.glass}`}>Zur Plattform</Link></>
                : !authenticated ? <><h2>Mit deinem Konto anmelden</h2><p className={styles.intro}>Melde dich mit deinem persönlichen Konto an, um die Elternfreigabe zu bestätigen.</p><Link href={login} className={`${styles.action} ${styles.primary} ${styles.glass}`}>Anmelden</Link><Link href={`/?authMode=signup&redirectTo=${encodeURIComponent(destination)}`} className={styles.quiet}>Konto erstellen</Link></>
                : !eligible ? <><h2>Persönliches Profil vervollständigen</h2><p className={styles.intro}>Für die Bestätigung brauchst du ein vollständiges persönliches Anbieterprofil ab 18 Jahren.</p><Link href={onboarding} className={`${styles.action} ${styles.glass}`}>Profil einrichten</Link><button type="button" className={styles.quiet} disabled={busy} onClick={() => void switchAccount()}>Anderes Konto verwenden</button></>
                : token ? <><h2>Deine Zustimmung</h2>{name ? <p className={styles.intro}>Du bestätigst als {name}.</p> : null}<p className={styles.intro}>Du erlaubst deinem Kind, Workfare für altersgerechte und zulässige Tätigkeiten zu nutzen. Diese Freigabe umfasst keine Zahlungsfreigabe und keinen vollständigen Zugriff auf private Chats.</p><label className={styles.consent}><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>Ich bin für dieses Kind gesetzlich vertretungsberechtigt und stimme der beschriebenen Nutzung zu.</span></label><button type="button" className={`${styles.action} ${styles.primary} ${styles.glass}`} disabled={busy || !accepted} onClick={() => void confirm()}>{busy ? <Loader2 className={styles.spinner} size={17} aria-hidden="true" /> : null}Zustimmung bestätigen</button><button type="button" className={styles.quiet} disabled={busy} onClick={() => void switchAccount()}>Anderes Konto verwenden</button></>
                : <><h2>Deine Familie</h2>{childrenNames.length ? <ul>{childrenNames.map((child, index) => <li key={`${child}:${index}`}>{child}</li>)}</ul> : <p className={styles.intro}>Eine Einladung deines Kindes kannst du hier bestätigen.</p>}<Link href="/app-home" className={`${styles.action} ${styles.glass}`}>Zur Plattform</Link></>}
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </section>
    </GuardianShell>;
}

export function GuardianReleaseUnavailable() {
    return <GuardianShell title="Für deine Familie"><section className={`${styles.surface} ${styles.stack}`}><h2>Gerade nicht erreichbar</h2><p className={styles.intro}>Der Familienbereich konnte nicht geladen werden. Deine bestehenden Verbindungen bleiben erhalten.</p><button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => window.location.reload()}>Erneut laden</button><Link href="/app-home" className={styles.quiet}>Zur Plattform</Link></section></GuardianShell>;
}
