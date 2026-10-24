"use client";

import { useId, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "./usePaymentOwner";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import type { StripeSurfaceKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";

export function recipientHostedUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try { const url = new URL(value); return url.origin === "https://connect.stripe.com" && !url.username && !url.password ? url.toString() : null; }
    catch { return null; }
}

/** The link remains in this owner-only component's memory until navigation. */
export function RecipientHostedFallback({ returnTo, kind, ownerId }: { returnTo: string | null; kind: StripeSurfaceKind; ownerId: string }) {
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const [consent, setConsent] = useState(false);
    const [pending, setPending] = useState(false);
    const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const operation = useRef<string | null>(null);
    const inFlight = useRef(false);
    const fieldId = useId();
    async function open(event: React.FormEvent) {
        event.preventDefault();
        if (!consent || inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setPending(true); setError(null); setLink(null);
        operation.current ??= crypto.randomUUID();
        try {
            const result = await paymentRequest<{ kind: string; url: string; expiresAt: string; requiresExternalBrowser: boolean }>("/api/payments/recipient/hosted", { consent: true, returnTo }, operation.current, ownerId);
            if (!isCurrentOwner()) return;
            const url = recipientHostedUrl(result.url);
            if (result.kind !== kind || result.requiresExternalBrowser !== true || !url || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error("hosted_unconfirmed");
            setLink({ url, expiresAt: result.expiresAt });
        } catch (failure) { operation.current = null; setError(paymentErrorMessage(failure)); }
        finally { inFlight.current = false; setPending(false); }
    }
    if (ownerChanged) return <p className={styles.error} role="alert">{PAYMENT_OWNER_CHANGED}</p>;
    return <details className={styles.embedHelp}>
        <summary>Einrichtung direkt bei Stripe öffnen</summary>
        <p>Nutze dafür einen normalen Browser wie Safari, Chrome oder Firefox. Nach deiner Rückkehr prüfen wir den Einrichtungsstand erneut.</p>
        <form onSubmit={open}>
            <label className={styles.consent} htmlFor={fieldId}><input id={fieldId} type="checkbox" checked={consent} disabled={pending} onChange={event => { setConsent(event.target.checked); setLink(null); operation.current = null; }} /><span>Ich möchte meine Auszahlungseinrichtung direkt bei Stripe fortsetzen.</span></label>
            {link ? <a className={`app-glass-control ${styles.action}`} href={link.url} target="_blank" rel="noopener noreferrer" onClick={event => {
                if (!isCurrentOwner()) { event.preventDefault(); setLink(null); setError(PAYMENT_OWNER_CHANGED); return; }
                if (Date.parse(link.expiresAt) <= Date.now()) { event.preventDefault(); setLink(null); operation.current = null; setError("Der Link ist abgelaufen. Bitte bereite einen neuen Stripe-Link vor."); }
            }}>Stripe im Browser öffnen<ArrowUpRight size={16} aria-hidden="true" /></a>
                : <button type="submit" className={`app-glass-control ${styles.action}`} disabled={!consent || pending}>{pending && <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />}{pending ? "Wird vorbereitet …" : "Stripe-Link vorbereiten"}</button>}
        </form>
        {error && <p role="alert" className={styles.error}>{error}</p>}
    </details>;
}
