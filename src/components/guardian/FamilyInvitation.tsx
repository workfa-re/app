"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Clock3, Link2, Loader2, Share2 } from "lucide-react";
import { createFamilyInvitation } from "@/app/actions/guardian";
import type { FamilyInvitationDirection } from "@/lib/guardian/types";
import { guardianAction, invitationLink } from "./guardian-client";
import styles from "./Guardian.module.css";

export function FamilyInvitation({ direction = "child_to_guardian", existing = false }: {
    direction?: FamilyInvitationDirection;
    existing?: boolean;
}) {
    const [invitation, setInvitation] = useState<{ url: string; expiresAt: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [shareAvailable, setShareAvailable] = useState(false);
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; if (copyTimer.current) clearTimeout(copyTimer.current); };
    }, []);

    useEffect(() => {
        if (!invitation) return;
        const check = () => {
            if (Date.parse(invitation.expiresAt) > Date.now()) return;
            setInvitation(null);
            setCopied(false);
            setError("Die Einladung ist abgelaufen. Du kannst einen neuen Link erstellen.");
        };
        const interval = setInterval(check, 30_000);
        check();
        return () => clearInterval(interval);
    }, [invitation]);

    async function prepare() {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(null);
        try {
            const result = await guardianAction(() => createFamilyInvitation(direction));
            if (!mounted.current) return;
            if (!result.success) { setError(result.error); return; }
            if (!result.token || !Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now()) {
                setError("Die Einladung konnte nicht vorbereitet werden. Bitte versuche es erneut."); return;
            }
            setInvitation({ url: invitationLink(window.location.origin, result.token), expiresAt: result.expires_at });
            setShareAvailable(typeof navigator.share === "function");
        } catch { if (mounted.current) setError("Die Einladung konnte nicht bestätigt werden. Bitte versuche es erneut."); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }

    async function copy() {
        if (!invitation) return;
        setError(null);
        try {
            await navigator.clipboard.writeText(invitation.url);
            if (!mounted.current) return;
            setCopied(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => { if (mounted.current) setCopied(false); }, 2500);
        } catch { if (mounted.current) setError("Kopieren ist hier nicht verfügbar. Du kannst den Link im Feld markieren und kopieren."); }
    }

    async function share() {
        if (!invitation || !navigator.share) return;
        try { await navigator.share({ title: "Einladung zu Workfare", url: invitation.url }); }
        catch (error) { if (mounted.current && !(error instanceof DOMException && error.name === "AbortError")) setError("Die Einladung konnte nicht geteilt werden. Kopiere stattdessen den Link."); }
    }

    return <div className={styles.invite}>
        {invitation ? <>
            <div className={styles.inviteLink}>
                <label className={styles.field}>Persönlicher Einladungslink
                    <input type="text" readOnly value={invitation.url} onFocus={event => event.currentTarget.select()} />
                </label>
                <p className={styles.expiry}><Clock3 size={14} aria-hidden="true" />Gültig bis <time dateTime={invitation.expiresAt}>{new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(invitation.expiresAt))}</time></p>
            </div>
            <div className={styles.actions}>
                <button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => void copy()}>
                    {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{copied ? "Link kopiert" : "Link kopieren"}
                </button>
                {shareAvailable ? <button type="button" className={styles.quiet} onClick={() => void share()}><Share2 size={16} aria-hidden="true" />Teilen</button> : null}
            </div>
            <p className={styles.fieldHint}>Teile diesen Link nur mit {direction === "child_to_guardian" ? "deinem Elternteil oder deiner gesetzlichen Vertretung" : "deinem Kind"}. Die Verbindung entsteht erst nach der Bestätigung.</p>
            <span className="sr-only" role="status">{copied ? "Einladungslink kopiert." : ""}</span>
        </> : <button type="button" className={`${styles.action} ${styles.primary} ${styles.glass}`} disabled={busy} onClick={() => void prepare()}>
            {busy ? <Loader2 size={17} className={styles.spinner} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}
            {busy ? "Einladung wird vorbereitet …" : existing ? "Einladungslink anzeigen" : "Einladungslink erstellen"}
        </button>}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>;
}
