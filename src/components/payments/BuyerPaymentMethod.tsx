"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CreditCard, Loader2, MoreHorizontal, Trash2, X } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import type { PaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import { sanitizePaymentReturnPath } from "@/lib/payments/return-path";
import { paymentRequest, paymentErrorMessage } from "./payment-client";
import { usePaymentSnapshot } from "./usePaymentSnapshot";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "./usePaymentOwner";
import { PaymentEmbedBoundary } from "./PaymentEmbedBoundary";
import { resetBuyerSetupOperation } from "./buyer-setup-retry";
import { StripeReloadButton, type StripeEmbedControls } from "./StripeEmbedControls";
import styles from "./Payments.module.css";
import { isStripeSurfaceKind, stripeKeyMatchesKind } from "./PaymentEnvironment";

const EmbeddedBuyerSetup = dynamic(() => import("./EmbeddedBuyerSetup"), { ssr: false, loading: () => <p className={styles.loading} role="status">Stripe wird geladen …</p> });
type Setup = { kind: "local"; sessionId: string } | { kind: "embedded"; sessionId: string; clientSecret: string; publishableKey: string };
type SetupResult = Setup | { kind: "complete"; sessionId: string; returnTo: string | null };
type Props = { initial: PaymentSettingsSnapshot; returnTo: string | null; resumeSetupId?: string | null; onChanged?: () => void; ownerId?: string };
const cardBrands: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", diners: "Diners Club", discover: "Discover", jcb: "JCB", unionpay: "UnionPay" };

/** A finished Stripe frame is not proof that the owner-bound method was stored. */
export async function confirmBuyerSetupSession(sessionId: string, ownerId: string, kind: PaymentSettingsSnapshot["kind"]) {
    const result = await paymentRequest<{ status: string; returnTo: string | null }>("/api/payments/setup/sync", { sessionId }, undefined, ownerId);
    const snapshot = await paymentRequest<PaymentSettingsSnapshot>("/api/payments/status", undefined, undefined, ownerId);
    if (snapshot.kind !== kind) throw new Error("payment_mode_changed");
    if (result.status !== "complete" || !snapshot.buyerReady || !snapshot.method) throw new Error("not_ready");
    return { snapshot, returnTo: sanitizePaymentReturnPath(result.returnTo) };
}

export function BuyerPaymentMethod({ initial, returnTo, resumeSetupId, onChanged, ownerId }: Props) {
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const { snapshot, setSnapshot, unknown, setUnknown, isCurrentSource } = usePaymentSnapshot(initial);
    const [editing, setEditing] = useState(Boolean(resumeSetupId && initial.kind === "local"));
    const [menu, setMenu] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [consent, setConsent] = useState(false);
    const [setup, setSetup] = useState<Setup | null>(resumeSetupId && initial.kind === "local" ? { kind: "local", sessionId: resumeSetupId } : null);
    const [busy, setBusy] = useState<"start" | "confirm" | "remove" | "cleanup" | "cancel" | "refresh" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const operationId = useRef<string | null>(null);
    const operationTheme = useRef<"light" | "dark" | null>(null);
    const inFlight = useRef(false);
    const consentRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<HTMLFormElement>(null);
    const embedRef = useRef<HTMLDivElement>(null);
    const stripeControls = useRef<StripeEmbedControls | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const keepButtonRef = useRef<HTMLButtonElement>(null);
    const consentId = useId();
    const menuId = useId();
    const removeTitleId = useId();
    const ready = snapshot.buyerReady && snapshot.method !== null && !unknown;
    const setupAvailable = snapshot.featureEnabled || snapshot.setupEnabled === true;

    useEffect(() => {
        if (!editing) return;
        const frame = requestAnimationFrame(() => {
            const target = setup ? embedRef.current : editorRef.current;
            target?.scrollIntoView({ block: "nearest", behavior: "auto" });
        });
        return () => cancelAnimationFrame(frame);
    }, [editing, setup]);

    useEffect(() => {
        if (!menu) return;
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(false); editButtonRef.current?.focus({preventScroll:true}); } };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
    }, [menu]);

    const confirmed = useCallback(async (sessionId: string) => {
        if (inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy("confirm"); setError(null);
        try {
            const { snapshot: current, returnTo: confirmedReturn } = await confirmBuyerSetupSession(sessionId, ownerId ?? "", initial.kind);
            if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; }
            setSnapshot(current); setUnknown(false);
            setSetup(null); setEditing(false); setConsent(false); operationId.current = null; operationTheme.current = null;
            onChanged?.();
            const destination = confirmedReturn;
            if (destination) { router.replace(destination); router.refresh(); }
            else { setFeedback("Zahlungsmittel hinterlegt."); headingRef.current?.focus({preventScroll:true}); }
        } catch (failure) { if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; } setUnknown(true); setError(paymentErrorMessage(failure)); }
        finally { setBusy(null); inFlight.current = false; }
    }, [router, onChanged, setSnapshot, setUnknown, isCurrentSource, isCurrentOwner, ownerId, initial.kind]);

    const setupSessionId = setup?.sessionId;
    // Embedded Checkout's onComplete option is immutable for an open session.
    // Keep its bridge stable when a new server projection updates the handler.
    const confirmedRef = useRef(confirmed);
    useEffect(() => { confirmedRef.current = confirmed; }, [confirmed]);
    const onStripeComplete = useCallback(() => { if (setupSessionId) void confirmedRef.current(setupSessionId); }, [setupSessionId]);

    function restoreFocus() {
        requestAnimationFrame(() => (editButtonRef.current ?? headingRef.current)?.focus({preventScroll:true}));
    }

    async function start(event: React.FormEvent) {
        event.preventDefault();
        if (!consent || inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy("start"); setError(null); setFeedback(null);
        operationId.current ??= crypto.randomUUID();
        operationTheme.current ??= resolvedTheme === "dark" ? "dark" : "light";
        try {
            const response = await paymentRequest<SetupResult>("/api/payments/setup", { consent: true, uiMode: "embedded", returnTo, theme: operationTheme.current }, operationId.current, ownerId ?? "");
            if (!isCurrentSource() || !isCurrentOwner()) return;
            if (response.kind !== "local" && response.kind !== "embedded" && response.kind !== "complete") throw new Error("invalid_setup");
            if (response.kind === "local" && snapshot.kind !== "local") throw new Error("invalid_setup");
            if (response.kind === "embedded" && (!isStripeSurfaceKind(snapshot.kind) || !stripeKeyMatchesKind(snapshot.kind, response.publishableKey)
                || typeof response.clientSecret !== "string" || !response.clientSecret || response.clientSecret.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(response.clientSecret))) throw new Error("invalid_setup");
            setEditing(true);
            if (response.kind === "complete") {
                inFlight.current = false;
                await confirmed(response.sessionId);
            } else setSetup(response);
        } catch (failure) { setError(paymentErrorMessage(failure)); if (resetBuyerSetupOperation(failure)) { operationId.current = null; operationTheme.current = null; } }
        finally { setBusy(null); inFlight.current = false; }
    }

    async function finishLocal(outcome: "complete" | "cancel") {
        if (!setup || setup.kind !== "local" || inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy(outcome === "complete" ? "confirm" : "cancel"); setError(null);
        try {
            await paymentRequest("/api/payments/local/setup", { sessionId: setup.sessionId, outcome }, undefined, ownerId ?? "");
            inFlight.current = false;
            if (outcome === "complete") await confirmed(setup.sessionId);
            else closeEditor();
        } catch (failure) { setError(paymentErrorMessage(failure)); }
        finally { setBusy(null); inFlight.current = false; }
    }

    function closeEditor() {
        if (inFlight.current || !isCurrentOwner()) return;
        setSetup(null); setEditing(false); setConsent(false); setError(null); operationId.current = null; operationTheme.current = null;
        restoreFocus();
    }

    async function remove() {
        if (inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy("remove"); setError(null);
        try {
            const result = await paymentRequest<{ ok: boolean; pendingRemoval: boolean }>("/api/payments/method/remove", {}, undefined, ownerId ?? "");
            if (result.ok !== true || typeof result.pendingRemoval !== "boolean") throw new Error("unconfirmed");
            if (!isCurrentSource() || !isCurrentOwner()) { setRemoving(false); router.refresh(); restoreFocus(); return; }
            setSnapshot({ ...snapshot, buyerReady: false, method: null, pendingRemoval: result.pendingRemoval });
            onChanged?.();
            setRemoving(false); setEditing(false); setConsent(false); setFeedback("Zahlungsmittel entfernt.");
            restoreFocus();
        } catch (failure) { setUnknown(true); setRemoving(false); setError(paymentErrorMessage(failure)); restoreFocus(); }
        finally { setBusy(null); inFlight.current = false; }
    }

    async function refreshOrCleanup(cleanup: boolean) {
        if (inFlight.current || !isCurrentOwner()) return;
        inFlight.current = true; setBusy(cleanup ? "cleanup" : "refresh"); setError(null);
        try {
            if (cleanup) await paymentRequest("/api/payments/method/retry-removal", {}, undefined, ownerId ?? "");
            const current = await paymentRequest<PaymentSettingsSnapshot>("/api/payments/status", undefined, undefined, ownerId ?? "");
            if (!isCurrentSource() || !isCurrentOwner()) { router.refresh(); return; }
            if (current.kind !== initial.kind) throw new Error("payment_mode_changed");
            setSnapshot(current); setUnknown(false); setFeedback(cleanup && !current.pendingRemoval ? "Entfernung abgeschlossen." : null);
        } catch (failure) { setError(paymentErrorMessage(failure)); }
        finally { setBusy(null); inFlight.current = false; }
    }

    function openEditor() {
        if (inFlight.current || !isCurrentOwner()) return;
        setEditing(true); setMenu(false); setRemoving(false); setFeedback(null); setError(null); setConsent(false);
        operationId.current = null; operationTheme.current = null;
        requestAnimationFrame(() => consentRef.current?.focus({preventScroll:true}));
    }

    const method = snapshot.method;
    if (ownerChanged) return <section className={styles.surface}><p className={styles.error} role="alert">{PAYMENT_OWNER_CHANGED}</p><a className={`app-glass-control ${styles.action}`} href="/app-home/settings/payments">Workfare Pay neu öffnen</a></section>;
    return <section className={`${styles.surface} ${styles.methodSurface}`} data-state={editing ? "editing" : ready ? "ready" : unknown ? "unknown" : "empty"} data-embedded={setup?.kind === "embedded" && !unknown || undefined} aria-labelledby="payment-method-title" aria-busy={Boolean(busy)}>
        <div className={styles.sectionHeading}><h2 id="payment-method-title" ref={headingRef} tabIndex={-1}>Zahlungsmittel</h2>
            {editing && <div className={styles.headerTools}>{setup?.kind === "embedded" && <StripeReloadButton controls={stripeControls} disabled={Boolean(busy)} />}<button type="button" className={`app-glass-control ${styles.close}`} aria-label="Einrichtung schließen" disabled={Boolean(busy)} onClick={() => setup?.kind === "local" ? void finishLocal("cancel") : closeEditor()}><X size={19} /></button></div>}
        </div>
        {ready && method && !editing ? <div className={styles.methodRow}>
            <span className={styles.cardMark} aria-hidden="true">{method.brand === "visa" ? "VISA" : method.brand === "mastercard" ? "MC" : <CreditCard size={25} strokeWidth={1.5} />}</span>
            <div className={styles.identity}><strong>{method.brand === "simulation" ? "Test-Zahlungsmittel" : `${cardBrands[method.brand ?? ""] || "Karte"} •••• ${method.last4}`}</strong><span>{method.brand === "simulation" ? "Keine echte Karte hinterlegt" : method.expiryMonth && method.expiryYear ? `Gültig bis ${String(method.expiryMonth).padStart(2, "0")}/${String(method.expiryYear).slice(-2)}` : "Für deine nächsten Jobs hinterlegt"}</span></div>
            <div className={styles.methodControls}><button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action}`} onClick={openEditor} disabled={Boolean(busy)}>Ändern</button>
                <div className={styles.menuAnchor} ref={menuRef}><button type="button" className={`app-glass-control ${styles.iconButton}`} aria-label="Zahlungsmittel verwalten" aria-expanded={menu} aria-controls={menuId} disabled={Boolean(busy)} onClick={() => setMenu(value => !value)}><MoreHorizontal size={21} /></button>
                    {menu && <div id={menuId} className={styles.menu}><button type="button" onClick={() => { setMenu(false); setRemoving(true); requestAnimationFrame(() => keepButtonRef.current?.focus({preventScroll:true})); }}><Trash2 size={17} />Entfernen</button></div>}
                </div>
            </div>
        </div> : !editing && <div className={styles.emptyMethod}>
            <span className={`app-glass-control ${styles.cardMark}`} aria-hidden="true"><CreditCard size={25} strokeWidth={1.5} /></span>
            <div className={styles.emptyCopy}><p>{unknown ? "Aktuellen Stand prüfen" : setupAvailable ? "Noch kein Zahlungsmittel." : "Die Einrichtung ist noch nicht verfügbar."}</p>
                <span>{unknown ? "Bitte lade den Status neu, bevor du fortfährst." : snapshot.featureEnabled ? "Vor deinem ersten veröffentlichten Job. Heute wird nichts abgebucht." : setupAvailable ? "Für kommende Aufträge. Heute wird nichts abgebucht." : "Du kannst dein Konto und deine Jobentwürfe weiter vorbereiten."}</span></div>
            {setupAvailable && !unknown && <button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action} ${styles.primaryAction}`} onClick={openEditor} disabled={Boolean(busy)} aria-label="Zahlungsmittel hinzufügen">Hinzufügen<ArrowRight size={17} /></button>}
        </div>}

        {editing && !setup && <form ref={editorRef} className={styles.editor} onSubmit={start}>
            <p className={styles.editorIntro}>{ready ? "Workfare Pay nutzt Stripe. Deine bisherige Karte bleibt bis zum bestätigten Austausch hinterlegt." : "Workfare Pay nutzt Stripe. Heute wird nichts abgebucht."}</p>
            <label className={styles.consent} htmlFor={consentId}><input ref={consentRef} type="checkbox" id={consentId} checked={consent} onChange={event => setConsent(event.target.checked)} disabled={Boolean(busy)} /><span>{snapshot.kind === "local" ? "Ich möchte den Ablauf mit einem Test-Zahlungsmittel ausprobieren. Es findet keine Zahlung statt." : "Stripe darf mein Zahlungsmittel für künftige Workfare-Aufträge speichern. Jede Zahlung bestätige ich gesondert."}</span></label>
            <div className={styles.editorActions}><button type="submit" className={`app-glass-control ${styles.action}`} disabled={!consent || Boolean(busy)}>{busy === "start" ? <Loader2 size={17} className={styles.spinner} /> : <ArrowRight size={17} />}Sicher einrichten</button><button type="button" className={styles.quietButton} onClick={closeEditor} disabled={Boolean(busy)}>Abbrechen</button></div>
        </form>}

        {setup?.kind === "embedded" && !unknown && <div ref={embedRef} className={styles.embedded}><PaymentEmbedBoundary onCancel={closeEditor} headerControls><EmbeddedBuyerSetup publishableKey={setup.publishableKey} clientSecret={setup.clientSecret} onComplete={onStripeComplete} onCancel={closeEditor} controlsRef={stripeControls} /></PaymentEmbedBoundary>{busy === "confirm" && <p className={styles.loading} role="status">Zahlungsmittel wird geprüft …</p>}</div>}
        {setup?.kind === "local" && !unknown && <div ref={embedRef} className={styles.editor}><div className={styles.localPreview}><CreditCard size={26} strokeWidth={1.5} /><div><strong>Lokales Test-Zahlungsmittel</strong><span>Keine Karte und keine Bankdaten erforderlich.</span></div></div><div className={styles.editorActions}><button type="button" className={`app-glass-control ${styles.action}`} disabled={Boolean(busy)} onClick={() => void finishLocal("complete")}>{busy === "confirm" ? <Loader2 size={17} className={styles.spinner} /> : <Check size={17} />}Test-Einrichtung abschließen</button><button type="button" className={styles.quietButton} disabled={Boolean(busy)} onClick={() => void finishLocal("cancel")}>Abbrechen</button></div></div>}

        {removing && <div className={styles.confirmation} role="group" aria-labelledby={removeTitleId}><h3 id={removeTitleId}>Zahlungsmittel entfernen?</h3><p>Für einen neuen Job brauchst du anschließend wieder eines. Bestehende Aufträge bleiben erhalten.</p><div className={styles.editorActions}><button type="button" className={`app-glass-control ${styles.action}`} onClick={remove} disabled={Boolean(busy)}>{busy === "remove" && <Loader2 size={16} className={styles.spinner} />}Entfernen</button><button type="button" ref={keepButtonRef} className={styles.quietButton} onClick={() => { setRemoving(false); restoreFocus(); }} disabled={Boolean(busy)}>Behalten</button></div></div>}
        {snapshot.pendingRemoval && <div className={styles.notice}><p>Eine frühere Karte muss bei Stripe noch entfernt werden. Dein aktuelles Zahlungsmittel bleibt dabei erhalten.</p><button type="button" className={styles.textAction} disabled={Boolean(busy)} onClick={() => void refreshOrCleanup(true)}>Entfernung abschließen</button></div>}
        {unknown && <button type="button" ref={editButtonRef} className={`app-glass-control ${styles.action}`} disabled={Boolean(busy)} onClick={() => setup ? void confirmed(setup.sessionId) : void refreshOrCleanup(false)}>{setup ? "Einrichtung prüfen" : "Status neu laden"}</button>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {feedback && !error && <p className={styles.feedback} role="status"><Check size={15} />{feedback}</p>}
    </section>;
}
