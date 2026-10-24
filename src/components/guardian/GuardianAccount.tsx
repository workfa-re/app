"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronRight, KeyRound, Loader2 } from "lucide-react";
import type { GuardianAccessContext } from "@/lib/guardian/types";
import styles from "./Guardian.module.css";

type Workspace = GuardianAccessContext["workspace"];
export type GuardianPasswordInput = { password: string; passwordConfirmation: string };

export function GuardianWorkspaceOffer({ workspace }: { workspace: Workspace }) {
    if (workspace.access === "child" || workspace.access === "unconfigured") return null;
    if (workspace.access === "provider_complete") return <Link href="/app-home" prefetch={false} className={styles.workspaceLink}>Zur Plattform<ArrowUpRight size={16} aria-hidden="true" /></Link>;
    return <section className={`${styles.workspaceOffer} ${styles.glass}`} aria-labelledby="guardian-provider-heading">
        <div>
            <h2 id="guardian-provider-heading">Auch eigene Jobs anbieten?</h2>
            <p>Dein Elternkonto ist eingerichtet. Ergänze dein Anbieterprofil, um Workfare selbst zu nutzen.</p>
        </div>
        <Link href={workspace.providerSetupHref} prefetch={false} className={`${styles.action} ${styles.glass}`}>{workspace.access === "provider_incomplete" ? "Einrichtung fortsetzen" : "Workfare nutzen"}<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </section>;
}

export function GuardianAccountSettings({ email, passwordConfigured, busy, notice, onSavePassword, onReauthenticate }: {
    email: string | null;
    passwordConfigured: boolean | null;
    busy: boolean;
    notice: string | null;
    onSavePassword: (input: GuardianPasswordInput) => void;
    onReauthenticate: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [mismatch, setMismatch] = useState(false);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") || "");
        const passwordConfirmation = String(form.get("passwordConfirmation") || "");
        if (password !== passwordConfirmation) { setMismatch(true); return; }
        if (password.length < 10 || password.length > 128) return;
        setMismatch(false);
        onSavePassword({ password, passwordConfirmation });
        event.currentTarget.reset();
    }

    return <details className={`${styles.accountSettings} ${styles.details}`}>
        <summary><KeyRound size={17} strokeWidth={1.6} aria-hidden="true" /><span>Anmeldung &amp; Passwort</span><ChevronRight size={16} aria-hidden="true" /></summary>
        <div className={styles.accountSettingsBody}>
            <p className={styles.fieldHint}>Dein Elternkonto gehört zu <strong>{email}</strong>. Du kannst dich jederzeit wieder mit einem E-Mail-Code anmelden.</p>
            {editing && passwordConfigured === false ? <form className={styles.form} onSubmit={submit} aria-busy={busy}>
                <label className={styles.field}>Neues Passwort<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} placeholder="Mindestens 10 Zeichen" /></label>
                <label className={styles.field}>Passwort wiederholen<input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} aria-invalid={mismatch || undefined} onInput={() => setMismatch(false)} /></label>
                {mismatch ? <p className={styles.fieldHint} role="alert">Die Passwörter stimmen noch nicht überein.</p> : null}
                <p className={styles.fieldHint}>Freiwillig. Dein Passwort ergänzt den Zugang per E-Mail-Code.</p>
                <div className={styles.actions}>
                    <button type="submit" className={`${styles.action} ${styles.glass}`} disabled={busy}>{busy ? <Loader2 size={16} className={styles.spinner} aria-hidden="true" /> : null}{busy ? "Wird gespeichert …" : "Passwort speichern"}</button>
                    <button type="button" className={styles.quiet} disabled={busy} onClick={() => { setEditing(false); setMismatch(false); }}>Abbrechen</button>
                </div>
                <button type="button" className={styles.quiet} disabled={busy} onClick={onReauthenticate}>Zugang mit neuem E-Mail-Code bestätigen</button>
            </form> : passwordConfigured === false ? <button type="button" className={styles.quiet} disabled={busy} onClick={() => setEditing(true)}>Passwort festlegen<ChevronRight size={15} aria-hidden="true" /></button> : <Link href="/auth/forgot-password" prefetch={false} className={styles.quiet}>Passwort zurücksetzen<ChevronRight size={15} aria-hidden="true" /></Link>}
            {notice ? <p className={styles.fieldHint} role="status">{notice}</p> : null}
        </div>
    </details>;
}
