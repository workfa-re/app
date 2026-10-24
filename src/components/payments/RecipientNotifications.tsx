"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, LoaderCircle, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { RecipientSessionResult, RecipientSettingsSnapshot } from "@/lib/payments/recipient-types";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import { PaymentEmbedBoundary } from "./PaymentEmbedBoundary";
import { isStripeSurfaceKind, validStripeSurfaceSession, type StripeSurfaceKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";

const EmbeddedRecipient = dynamic(() => import("./EmbeddedRecipient"), { ssr: false, loading: () => <p className={styles.loading} role="status">Stripe-Hinweise werden geladen …</p> });

export function hasRecipientNotifications(snapshot: RecipientSettingsSnapshot | null | undefined): boolean {
    return isStripeSurfaceKind(snapshot?.kind) && !!snapshot && snapshot.canStart && snapshot.eligibility === "adult" && snapshot.detailsSubmitted
        && (snapshot.requirementCount > 0 || snapshot.status === "restricted" || snapshot.status === "pending");
}

/** Opening this optional region, not loading a page, creates its AccountSession. */
export function RecipientNotifications({ snapshot, onChanged, ownerId }: { snapshot: RecipientSettingsSnapshot | null; ownerId?: string; onChanged: () => Promise<void> | void }) {
    if (!hasRecipientNotifications(snapshot) || !snapshot || !isStripeSurfaceKind(snapshot.kind)) return null;
    return <NotificationRegion key={snapshot.kind} kind={snapshot.kind} onChanged={onChanged} ownerId={ownerId} />;
}

function NotificationRegion({ kind, onChanged, ownerId }: { kind: StripeSurfaceKind; onChanged: () => Promise<void> | void; ownerId?: string }) {
    const [session, setSession] = useState<Extract<RecipientSessionResult, { kind: StripeSurfaceKind }> | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => {
        setSession(null); setError(null); void onChanged();
        requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    }, [onChanged]);
    const failed = useCallback(() => setError("Stripe konnte die Hinweise gerade nicht laden. Bitte öffne sie erneut."), []);
    async function open() {
        if (inFlight.current) return;
        inFlight.current = true; setPending(true); setError(null);
        try {
            const result = await paymentRequest<RecipientSessionResult>("/api/payments/recipient/session", { component: "notification_banner" }, crypto.randomUUID(), ownerId ?? "");
            if (result.component !== "notification_banner" || !validStripeSurfaceSession(result, kind)) throw new Error("unconfirmed_banner_session");
            setSession(result);
        } catch (failure) { setError(paymentErrorMessage(failure)); }
        finally { inFlight.current = false; setPending(false); }
    }
    return <section className={`${styles.surface} ${styles.compactSurface}`} aria-label="Offene Hinweise von Stripe" aria-busy={pending}>
        {session ? <><div className={styles.sectionHeading}><h2>Hinweise von Stripe</h2><button type="button" className={styles.close} onClick={close} aria-label="Stripe-Hinweise schließen"><X size={18} /></button></div>
            <div className={styles.embedded}><PaymentEmbedBoundary onCancel={close}><EmbeddedRecipient key={`${ownerId}:${session.clientSecret}`} ownerId={ownerId} kind={session.kind} publishableKey={session.publishableKey} clientSecret={session.clientSecret} component="notification_banner" onExit={close} onError={failed} onRetry={() => setError(null)} /></PaymentEmbedBoundary></div>
            <button type="button" className={styles.quietButton} onClick={close}><RefreshCw size={15} />Stand aktualisieren</button></>
            : <button type="button" ref={trigger} className={styles.settingsRow} disabled={pending} onClick={() => void open()}>
                <span className={`app-glass-control ${styles.rowIcon}`} aria-hidden="true">{pending ? <LoaderCircle size={20} className={styles.spinner} /> : <ShieldAlert size={21} />}</span>
                <span>Offene Angaben bei Stripe</span><ArrowRight size={17} className={styles.rowArrow} aria-hidden="true" />
            </button>}
        {error && <p className={styles.error} role="alert">{error}</p>}
    </section>;
}
