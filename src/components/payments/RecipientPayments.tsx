"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Clock3, Loader2, RefreshCw, Wallet, X } from "lucide-react";
import type { RecipientComponent, RecipientSessionResult, RecipientSettingsSnapshot } from "@/lib/payments/recipient-types";
import { sanitizeRecipientReturnPath } from "@/lib/payments/recipient-return-path";
import { paymentRequest, paymentErrorMessage } from "./payment-client";
import { usePaymentSnapshot } from "./usePaymentSnapshot";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "./usePaymentOwner";
import { RecipientNotifications } from "./RecipientNotifications";
import { PaymentEmbedBoundary } from "./PaymentEmbedBoundary";
import { RecipientHostedFallback } from "./RecipientHostedFallback";
import { isStripeSurfaceKind, validStripeSurfaceSession } from "./PaymentEnvironment";
import { RecipientOverview } from "./RecipientOverview";
import styles from "./Payments.module.css";

const EmbeddedRecipient = dynamic(() => import("./EmbeddedRecipient"), { ssr: false, loading: () => <p role="status" className={styles.loading}>Stripe wird geladen …</p> });
const componentTitles: Record<RecipientComponent, string> = { onboarding: "Auszahlung einrichten", management: "Auszahlungsdaten", balances: "Dein Guthaben", payouts_list: "Deine Auszahlungen", notification_banner: "Hinweise von Stripe" };

/** Enables read-only entry points; every Stripe read is still freshly authorized on the server. */
export function recipientFinancialActionsEnabled(snapshot: RecipientSettingsSnapshot | null, unknown = false, now = Date.now()): boolean {
    if (!snapshot || unknown || snapshot.status !== "ready") return false;
    if (snapshot.eligibility !== "minor_review_required") return (snapshot.featureEnabled || snapshot.setupEnabled === true) && snapshot.canStart;
    if (snapshot.kind !== "live" || !snapshot.checkedAt || snapshot.requirementCount !== 0 || !snapshot.hasPayoutMethod
        || !snapshot.detailsSubmitted || !snapshot.transfersActive || !snapshot.payoutsEnabled) return false;
    const checkedAt = Date.parse(snapshot.checkedAt);
    return Number.isFinite(checkedAt) && checkedAt <= now && checkedAt > now - 24 * 60 * 60_000;
}

export function RecipientPayments({ initial, returnTo, ownerId, hostedReturned = false }: { initial: RecipientSettingsSnapshot | null; returnTo: string | null; ownerId?: string; hostedReturned?: boolean }) {
    const router = useRouter();
    const initialKind = initial?.kind;
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const { snapshot, setSnapshot, unknown: unconfirmedStatus, setUnknown: setStatusUnknown, isCurrentSource } = usePaymentSnapshot(initial);
    const [session, setSession] = useState<RecipientSessionResult | null>(null);
    const [editing, setEditing] = useState(false);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const inFlight = useRef(false);
    const setupOperation = useRef<{ component: RecipientComponent; id: string } | null>(null);
    const consentRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<HTMLFormElement>(null);
    const embedRef = useRef<HTMLDivElement>(null);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const consentId = useId();
    const handledHostedReturn = useRef(false);
    const restoreFocus = useCallback(() => {
        requestAnimationFrame(() => (editButtonRef.current ?? headingRef.current)?.focus({ preventScroll: true }));
    }, []);
    useEffect(() => {
        if (!editing && !session) return;
        const frame = requestAnimationFrame(() => {
            (session ? embedRef.current : editorRef.current)?.scrollIntoView({ block: "nearest", behavior: "auto" });
        });
        return () => cancelAnimationFrame(frame);
    }, [editing, session]);
    const statusUnknown = unconfirmedStatus || (isStripeSurfaceKind(snapshot?.kind) && snapshot?.status === "pending" && snapshot.checkedAt === null);
    const ready = snapshot?.status === "ready" && !statusUnknown;
    const local = snapshot?.kind === "local";
    const pending = snapshot?.status === "pending" && !statusUnknown;
    const canStart = (snapshot?.featureEnabled || snapshot?.setupEnabled === true) && snapshot?.canStart;
    const canReadFinancials = recipientFinancialActionsEnabled(snapshot, statusUnknown);
    const needsInformation = (snapshot?.requirementCount ?? 0) > 0;
    const restrictedWithoutUserAction = snapshot?.status === "restricted" && !needsInformation;
    const statusTitle = statusUnknown ? "Aktuellen Stand prüfen"
        : ready ? local ? "Test-Auszahlung eingerichtet" : "Auszahlung eingerichtet"
        : needsInformation ? "Bitte ergänze deine Angaben"
        : restrictedWithoutUserAction ? "Auszahlung noch nicht freigegeben"
        : pending ? "Angaben werden geprüft" : "Deine Vergütung auf dein Konto";
    const statusDescription = statusUnknown ? "Die Bereitschaft wird erst nach erneuter Bestätigung angezeigt."
        : ready ? local ? "Keine echten Bankdaten hinterlegt" : "Auszahlungsdaten sicher bei Stripe verwalten"
        : needsInformation ? "Stripe benötigt noch Angaben für deine Auszahlung."
        : restrictedWithoutUserAction ? "Stripe hat die Auszahlung noch nicht freigegeben. Prüfe den aktuellen Stand."
        : pending ? "Prüfe hier den aktuellen Stand deiner Angaben." : snapshot?.featureEnabled ? "Einmal einrichten, bevor du deinen ersten Job reservierst." : "Richte deine Auszahlung für kommende Jobs ein.";

    const sync = useCallback(async (returnAfterSuccess = false) => {
        if (inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy(true); setError(null); setStatusUnknown(true);
        try {
            const result = await paymentRequest<{ ok: boolean; snapshot: RecipientSettingsSnapshot }>("/api/payments/recipient/sync", {}, undefined, ownerId ?? "");
            if (result.ok !== true || !result.snapshot || result.snapshot.kind !== initialKind) throw new Error("not_confirmed");
            if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; }
            setSnapshot(result.snapshot); setStatusUnknown(false);
            if (result.snapshot.status === "ready") {
                setupOperation.current = null;
                setSession(null); setEditing(false); setConsent(false); setFeedback(returnAfterSuccess ? "Auszahlung eingerichtet." : "Stand aktualisiert.");
                const destination = sanitizeRecipientReturnPath(returnTo);
                if (returnAfterSuccess && destination) { router.replace(destination); router.refresh(); }
                else if (returnAfterSuccess) requestAnimationFrame(() => headingRef.current?.focus({preventScroll:true}));
            } else if (returnAfterSuccess) { setupOperation.current = null; setSession(null); setEditing(false); setFeedback("Den aktuellen Einrichtungsstand siehst du hier."); }
        } catch (failure) {
            if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; }
            setSnapshot(current => current ? { ...current, status: "pending", transfersActive: false, payoutsEnabled: false } : null);
            setError(paymentErrorMessage(failure));
        }
        finally { setBusy(false); inFlight.current = false; }
    }, [returnTo, router, setSnapshot, setStatusUnknown, isCurrentSource, isCurrentOwner, ownerId, initialKind]);
    useEffect(() => {
        if (!hostedReturned || handledHostedReturn.current) return;
        const frame = requestAnimationFrame(() => { handledHostedReturn.current = true; void sync(true); });
        return () => cancelAnimationFrame(frame);
    }, [hostedReturned, sync]);
    const onStripeExit = useCallback(() => {
        if (session && session.component !== "onboarding" && session.component !== "management") {
            setSession(null); setEditing(false); setConsent(false); setError(null);
            restoreFocus();
        } else void sync(true);
    }, [sync, session, restoreFocus]);
    const onNotificationChanged = useCallback(async () => {
        await sync(false);
        requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    }, [sync]);
    const onStripeError = useCallback(() => { setError("Stripe konnte diesen Bereich gerade nicht öffnen. Bitte versuche es erneut."); }, []);
    const onStripeRetry = useCallback(() => setError(null), []);

    async function start(component: RecipientComponent) {
        if (inFlight.current || !isCurrentOwner()) return;
        if ((component === "onboarding" || component === "management") && !consent) return;
        inFlight.current = true; setBusy(true); setError(null); setFeedback(null);
        try {
            const createsAccount = component === "onboarding" || component === "management";
            if (createsAccount && setupOperation.current?.component !== component) setupOperation.current = { component, id: crypto.randomUUID() };
            const result = await paymentRequest<RecipientSessionResult>("/api/payments/recipient/session", { component, consent }, createsAccount ? setupOperation.current!.id : crypto.randomUUID(), ownerId ?? "");
            if (result.kind !== snapshot?.kind || result.component !== component
                || (result.kind !== "local" && (!isStripeSurfaceKind(result.kind) || !validStripeSurfaceSession(result, result.kind)))) throw new Error("not_confirmed");
            if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; }
            setSession(result); setEditing(false);
        } catch (failure) {
            if (isStripeSurfaceKind(snapshot?.kind) && (component === "balances" || component === "payouts_list")) setStatusUnknown(true);
            setError(paymentErrorMessage(failure));
        }
        finally { setBusy(false); inFlight.current = false; }
    }

    async function localFinish(outcome: "complete" | "cancel") {
        if (!session || session.kind !== "local" || inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy(true); setError(null);
        try {
            const result = await paymentRequest<{ ok: boolean; snapshot: RecipientSettingsSnapshot }>("/api/payments/recipient/local", { sessionId: session.sessionId, outcome }, undefined, ownerId ?? "");
            if (result.ok !== true || !result.snapshot || result.snapshot.kind !== initialKind) throw new Error("not_confirmed");
            setupOperation.current = null;
            if (!isCurrentSource() || !isCurrentOwner()) { setSession(null); setEditing(false); setConsent(false); router.refresh(); restoreFocus(); return; }
            setSnapshot(result.snapshot); setStatusUnknown(false); setSession(null); setEditing(false); setConsent(false);
            if (outcome === "complete" && result.snapshot.status === "ready") {
                setFeedback("Test-Auszahlung eingerichtet.");
                const destination = sanitizeRecipientReturnPath(returnTo);
                if (destination) { router.replace(destination); router.refresh(); }
                else requestAnimationFrame(() => headingRef.current?.focus({preventScroll:true}));
            } else restoreFocus();
        } catch (failure) { setStatusUnknown(true); setError(paymentErrorMessage(failure)); }
        finally { setBusy(false); inFlight.current = false; }
    }

    function openEditor() {
        if (inFlight.current || !isCurrentOwner()) return;
        setupOperation.current = null;
        setEditing(true); setConsent(false); setError(null); setFeedback(null);
        requestAnimationFrame(() => consentRef.current?.focus({preventScroll:true}));
    }
    async function close() {
        if (inFlight.current || !isCurrentOwner()) return;
        if (session?.kind === "local") { await localFinish("cancel"); return; }
        setupOperation.current = null;
        const needsSync = session && isStripeSurfaceKind(session.kind) && (session.component === "onboarding" || session.component === "management");
        if (needsSync) {
            await sync(false);
        }
        setSession(null); setEditing(false); setConsent(false);
        if (!needsSync) setError(null);
        restoreFocus();
    }

    if (ownerChanged) return <section className={styles.surface}><p className={styles.error} role="alert">{PAYMENT_OWNER_CHANGED}</p><a className={`app-glass-control ${styles.action}`} href="/app-home/settings/payments">Workfare Pay neu öffnen</a></section>;
    return <div className={styles.stack}>
        {!session && !editing && ownerId && snapshot && snapshot.kind !== "disabled" && <RecipientOverview key={ownerId} ownerId={ownerId} kind={snapshot.kind}
            busy={busy || statusUnknown}
            onPayouts={canReadFinancials ? () => void start("payouts_list") : undefined} onFunds={canReadFinancials ? () => void start("balances") : undefined} />}
        <section className={styles.surface} aria-labelledby="recipient-heading" aria-busy={busy}>
            <div className={styles.sectionHeading}><h2 id="recipient-heading" ref={headingRef} tabIndex={-1}>{session ? componentTitles[session.component] : "Deine Auszahlung"}</h2>{(editing || session) && <button type="button" className={styles.close} aria-label="Auszahlungsbereich schließen" onClick={() => void close()} disabled={busy}><X size={19} /></button>}</div>
            {!session && !editing && <>
                <div className={styles.methodRow}><span className={styles.cardMark} aria-hidden="true">{ready ? <Check size={24} /> : pending || statusUnknown || restrictedWithoutUserAction ? <Clock3 size={24} /> : <Wallet size={24} />}</span><div className={styles.identity}><strong>{statusTitle}</strong><span>{statusDescription}</span></div>{ready && canStart && <button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action}`} onClick={openEditor} disabled={busy}>Ändern</button>}</div>
                {statusUnknown || restrictedWithoutUserAction ? <button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action}`} onClick={() => void sync()} disabled={busy}><RefreshCw size={16} />Status prüfen</button> : !ready && canStart && <div className={styles.editorActions}><button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action}`} onClick={openEditor} disabled={busy}><ArrowRight size={17} />{needsInformation ? "Angaben ergänzen" : pending ? "Angaben ansehen" : snapshot?.status === "onboarding" ? "Einrichtung fortsetzen" : "Auszahlung einrichten"}</button>{pending && <button type="button" className={styles.quietButton} onClick={() => void sync()} disabled={busy}><RefreshCw size={15} />Status prüfen</button>}</div>}
                {!canStart && !ready && <p className={styles.smallCopy}>{snapshot?.eligibility === "minor_review_required" ? "Dein Elternteil richtet die Auszahlung im Familienbereich mit Stripe ein. Die Auszahlung bleibt bis zum Abschluss der Prüfung gesperrt." : "Die Auszahlungseinrichtung ist für dieses Konto noch nicht freigeschaltet."}</p>}
                {snapshot?.eligibility === "minor_review_required" && <Link href="/guardian/access" className={`app-glass-control ${styles.action}`}><ArrowRight size={17} aria-hidden="true" />Zur Familie</Link>}
            </>}
            {editing && !session && <form ref={editorRef} className={styles.editor} onSubmit={event => { event.preventDefault(); void start(ready ? "management" : "onboarding"); }}><p className={styles.editorIntro}>{local ? "Du prüfst den Ablauf ohne echte Bankdaten und ohne Auszahlung." : !ready ? "Beim ersten Einrichten übernehmen wir deinen Namen und deine bestätigte E-Mail. Bank- und Prüfdaten gibst du direkt bei Stripe ein." : "Stripe führt dich durch die benötigten Angaben. Bank- und Prüfdaten bleiben bei Stripe."}</p><label className={styles.consent} htmlFor={consentId}><input ref={consentRef} id={consentId} type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} /><span>{local ? "Ich möchte die Auszahlungseinrichtung mit Testdaten ausprobieren." : ready ? "Ich möchte meine Auszahlungsdaten bei Stripe verwalten." : "Ich möchte meine Auszahlung bei Stripe einrichten und dafür die erforderlichen Angaben machen."}</span></label><div className={styles.editorActions}><button type="submit" className={`app-glass-control ${styles.action}`} disabled={busy || !consent}>{busy ? <Loader2 size={17} className={styles.spinner} /> : <ArrowRight size={17} />}Weiter</button><button type="button" className={styles.quietButton} disabled={busy} onClick={() => void close()}>Abbrechen</button></div></form>}
            {session && session.kind !== "local" && isStripeSurfaceKind(session.kind) && <div ref={embedRef} className={styles.embedded}><PaymentEmbedBoundary onCancel={() => void close()}><EmbeddedRecipient key={`${ownerId}:${session.clientSecret}`} ownerId={ownerId} kind={session.kind} clientSecret={session.clientSecret} publishableKey={session.publishableKey} component={session.component} onExit={onStripeExit} onError={onStripeError} onRetry={onStripeRetry} /></PaymentEmbedBoundary>{session.component === "management" && <button type="button" className={`app-glass-control ${styles.action}`} onClick={() => void sync(true)} disabled={busy}>Fertig</button>}</div>}
            {session?.kind === "local" && <div ref={embedRef} className={styles.editor}>{session.component === "onboarding" || session.component === "management" ? <><div className={styles.localPreview}><Wallet size={27} /><div><strong>Test-Auszahlung</strong><span>Keine IBAN, kein Ausweis und kein echtes Geld.</span></div></div><div className={styles.editorActions}><button type="button" className={`app-glass-control ${styles.action}`} onClick={() => void localFinish("complete")} disabled={busy}>{busy ? <Loader2 size={17} className={styles.spinner} /> : <Check size={17} />}Test-Einrichtung abschließen</button><button type="button" className={styles.quietButton} onClick={() => void localFinish("cancel")} disabled={busy}>Abbrechen</button></div></> : <p className={styles.smallCopy}>In der lokalen Simulation gibt es keine Geldbewegungen. Echte Testdaten werden hier im Stripe-Testbetrieb angezeigt.</p>}</div>}
            {error && <p role="alert" className={styles.error}>{error}</p>}{feedback && !error && <p role="status" className={styles.feedback}><Check size={15} />{feedback}</p>}
            {snapshot && isStripeSurfaceKind(snapshot.kind) && canStart && snapshot.eligibility === "adult" && ownerId && (session?.kind === snapshot.kind || snapshot.status !== "not_started") && <RecipientHostedFallback key={ownerId} ownerId={ownerId} kind={snapshot.kind} returnTo={returnTo} />}
        </section>
        {!session && !editing && !statusUnknown && !busy && <RecipientNotifications snapshot={snapshot} ownerId={ownerId} onChanged={onNotificationChanged} />}
    </div>;
}
