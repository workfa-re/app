"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, CreditCard, LoaderCircle, RefreshCw, WalletCards, X } from "lucide-react";
import type { PaymentOrder, PaymentOrderAction } from "@/lib/payments/order-types";
import { LIVE_SERVICE_FEE_POLICY, quoteLiveServiceFee, quoteTestServiceFee, TEST_SERVICE_FEE_POLICY, validPaymentOrderFee, type PaymentFeePolicy } from "@/lib/payments/tariff";
import { getPaymentConversationReturnPath, getPaymentSettingsHref } from "@/lib/payments/return-path";
import type { ChatAppointment } from "@/components/activity/chat-details";
import styles from "./AppointmentPayment.module.css";
import { PayWordmark } from "./PayWordmark";
import { PaymentEnvironment, stripeKeyMatchesKind } from "./PaymentEnvironment";
import { useActivityDialogFocus } from "@/components/activity/useActivityDialogFocus";
import { followGlassPointer } from "@/lib/glass-pointer";

export type AppointmentPaymentContext = Readonly<{ applicationId: string; currentUserId: string; isProvider: boolean }>;
type Resource = { orders: readonly PaymentOrder[]; quoteFeePolicy: PaymentFeePolicy | null; loading: boolean; available: boolean; error: string | null };
type Shared = AppointmentPaymentContext & Resource & { refresh: () => Promise<void>; publish: (order: PaymentOrder) => void };
const Payments = createContext<Shared | null>(null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const APPOINTMENT_TIME = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const STATES = new Set(["awaiting_confirmation", "ready", "authorization_pending", "authorized", "capture_pending", "paid", "cancel_pending", "canceled", "refund_pending", "refunded", "failed", "review_required"]);
const stateLabels: Record<PaymentOrder["state"], string> = {
    awaiting_confirmation: "Preis vorgeschlagen", ready: "Preis bestätigt", authorization_pending: "Bestätigung ausstehend", authorized: "Zahlung freigegeben",
    capture_pending: "Zahlung wird verarbeitet", paid: "Bezahlt", cancel_pending: "Storno wird geprüft", canceled: "Storniert", refund_pending: "Erstattung läuft",
    refunded: "Erstattet", failed: "Zahlung nicht bestätigt", review_required: "Prüfung erforderlich",
};
export function formatAppointmentMoney(cents: number) { return MONEY.format(cents / 100); }

/** Display estimates never determine what Stripe charges; the server owns it. */
export function estimateAppointmentPrice(rate: number | null | undefined, paymentType: string | null | undefined, minutes: number): number | null {
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || !["fixed", "hourly"].includes(paymentType ?? "")) return null;
    const rateCents = Math.round(rate * 100);
    if (!Number.isSafeInteger(rateCents) || rateCents > 99_999_999 || (paymentType === "hourly" && (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 480))) return null;
    const result = paymentType === "hourly" ? Math.round(rateCents * minutes / 60) : rateCents;
    return result >= 50 && result <= 99_999_999 ? result : null;
}

export function nextAppointmentPaymentAction(order: PaymentOrder, provider: boolean, now: number): PaymentOrderAction | "confirm" | null {
    if (!provider) return order.state === "awaiting_confirmation" && order.termsCurrent ? "confirm" : null;
    // These resume the existing server-owned operation. They never allocate a
    // replacement intent, capture or refund from an uncertain previous result.
    if (order.state === "cancel_pending") return "cancel";
    if (order.state === "refund_pending") return "refund";
    if (order.state === "capture_pending") return "capture";
    if (!order.termsCurrent && !["paid", "refunded"].includes(order.state)) return null;
    if (order.state === "ready" || order.state === "authorization_pending") return "authorize";
    if (order.state === "authorized" && Date.parse(order.startsAt) <= now && order.captureBefore && Date.parse(order.captureBefore) > now) return "capture";
    return null;
}
export function canCancelAppointmentPayment(order: PaymentOrder, provider: boolean): boolean {
    return provider && ["awaiting_confirmation", "ready", "authorization_pending", "authorized", "failed"].includes(order.state);
}
/** Only settled failures/stale holds may be renewed; uncertain bank operations stay resumable. */
export function canRenewAppointmentPayment(order: PaymentOrder, provider: boolean, now: number): boolean {
    return order.state !== "authorization_pending" && canCancelAppointmentPayment(order, provider) && (order.state === "failed" || !order.termsCurrent
        || (order.state === "authorized" && (!order.captureBefore || !Number.isFinite(Date.parse(order.captureBefore)) || Date.parse(order.captureBefore) <= now)));
}
export function latestAppointmentPaymentOrder(orders: readonly PaymentOrder[], appointmentId: string): PaymentOrder | undefined {
    return orders.filter(order => order.appointmentId === appointmentId).reduce<PaymentOrder | undefined>((latest, order) => !latest || order.quoteVersion > latest.quoteVersion ? order : latest, undefined);
}

/** Every agreed, non-cancelled appointment needs its latest actual paid order. */
export function appointmentsArePaid(appointments: readonly ChatAppointment[], orders: readonly PaymentOrder[]): boolean {
    const agreed = appointments.filter(appointment => appointment.status !== "cancelled");
    return agreed.length > 0 && agreed.every(appointment => {
        const order = latestAppointmentPaymentOrder(orders, appointment.id);
        return order?.state === "paid" && order.refundedCents === 0 && Boolean(order.recipientConfirmedAt)
            && !orders.some(other => other.appointmentId === appointment.id && other.id !== order.id
                && ["paid", "refund_pending", "refunded", "review_required"].includes(other.state) && other.refundedCents < other.totalCents);
    });
}

export function paymentConversationShortcut(orders: readonly PaymentOrder[], provider: boolean, now: number): { appointmentId: string; label: string } | null {
    const candidates: { appointmentId: string; label: string; priority: number; time: number }[] = [];
    const seen = new Set<string>();
    for (const order of orders) {
        if (seen.has(order.appointmentId)) continue;
        if (latestAppointmentPaymentOrder(orders, order.appointmentId)?.id !== order.id) continue;
        seen.add(order.appointmentId);
        const terminal = ["paid", "canceled", "refunded"].includes(order.state);
        const needsReview = order.state === "review_required" || order.state === "failed" || (!order.termsCurrent && !terminal)
            || (order.state === "authorized" && !!order.captureBefore && Date.parse(order.captureBefore) <= now);
        const action = nextAppointmentPaymentAction(order, provider, now);
        if (needsReview) candidates.push({ appointmentId: order.appointmentId, label: "Zahlung prüfen", priority: 0, time: Date.parse(order.startsAt) });
        else if (action === "confirm") candidates.push({ appointmentId: order.appointmentId, label: "Preis bestätigen", priority: 1, time: Date.parse(order.startsAt) });
        else if (action === "capture") candidates.push({ appointmentId: order.appointmentId, label: order.state === "capture_pending" ? "Zahlung prüfen" : "Vergütung bezahlen", priority: 2, time: Date.parse(order.captureBefore ?? order.startsAt) });
        else if (action === "cancel" || action === "refund") candidates.push({ appointmentId: order.appointmentId, label: "Zahlung prüfen", priority: 0, time: Date.parse(order.startsAt) });
        else if (action === "authorize" && (order.state === "authorization_pending" || Math.abs(Date.parse(order.startsAt) - now) <= 86_400_000)) candidates.push({ appointmentId: order.appointmentId, label: "Zahlung freigeben", priority: 3, time: Date.parse(order.startsAt) });
    }
    candidates.sort((a, b) => a.priority - b.priority || a.time - b.time);
    return candidates.length ? { appointmentId: candidates[0].appointmentId, label: candidates[0].label } : null;
}

/** Opens the existing details rail; it never starts a financial operation. */
export function PaymentConversationShortcut({ onOpen }: { onOpen: (appointmentId: string) => void }) {
    const shared = useContext(Payments);
    const [now, setNow] = useState(0);
    const enabled = !!shared && shared.available;
    useEffect(() => {
        if (!enabled) return;
        const update = () => setNow(Date.now());
        const frame = requestAnimationFrame(update);
        const timer = setInterval(update, 60_000);
        return () => { cancelAnimationFrame(frame); clearInterval(timer); };
    }, [enabled]);
    if (!shared || !shared.available || shared.loading || shared.error || !now) return null;
    const shortcut = paymentConversationShortcut(shared.orders, shared.isProvider, now);
    return shortcut ? <button type="button" className="activity-schedule-button activity-payment-shortcut" aria-label={shortcut.label} title={shortcut.label} onClick={() => onOpen(shortcut.appointmentId)}><WalletCards size={16} aria-hidden="true" /><span>{shortcut.label}</span></button> : null;
}

function validOrder(value: unknown, scope: AppointmentPaymentContext): value is PaymentOrder {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return typeof row.id === "string" && UUID.test(row.id) && row.applicationId === scope.applicationId
        && [row.providerId, row.recipientId].includes(scope.currentUserId) && row.currency === "eur" && typeof row.state === "string" && STATES.has(row.state)
        && typeof row.appointmentId === "string" && UUID.test(row.appointmentId)
        && typeof row.quoteVersion === "number" && Number.isSafeInteger(row.quoteVersion) && row.quoteVersion > 0
        && typeof row.earningsCents === "number" && Number.isSafeInteger(row.earningsCents) && row.earningsCents >= 50 && row.earningsCents <= 99_999_999
        && typeof row.mode === "string" && ["sandbox", "local_simulation", "live"].includes(row.mode)
        && validPaymentOrderFee(row)
        && (row.feePolicy === LIVE_SERVICE_FEE_POLICY) === (row.mode === "live")
        && row.livePaymentsEnabled === (row.mode === "live") && row.bankPayoutConfirmed === false;
}
class PaymentRequestError extends Error { constructor(readonly code: string) { super("Zahlungsstand nicht bestätigt"); } }
async function paymentRequest(path: string, body?: Record<string, unknown>, operationId?: string, signal?: AbortSignal) {
    const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
        headers: body ? { "Content-Type": "application/json", ...(operationId ? { "Idempotency-Key": operationId } : {}) } : {}, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new PaymentRequestError(typeof value?.code === "string" ? value.code : "payment_unavailable");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentRequestError("payment_unavailable");
    return value as Record<string, unknown>;
}
export async function refreshAppointmentPaymentStatus(order: PaymentOrder, scope: AppointmentPaymentContext): Promise<PaymentOrder> {
    const result = await paymentRequest(`/api/payments/orders/${order.id}/sync`, {});
    if (!validOrder(result.order, scope) || result.order.id !== order.id) throw new PaymentRequestError("payment_unavailable");
    return result.order;
}

/** Continue only an actual, current own authorization after explicit completion consent. */
export async function captureCompletionPayment(order: PaymentOrder, scope: AppointmentPaymentContext, operationId: string, now = Date.now()): Promise<PaymentOrder> {
    if (!scope.isProvider || order.providerId !== scope.currentUserId || !validOrder(order, scope) || !UUID.test(operationId)
        || order.state !== "authorized" || !order.termsCurrent || !Number.isFinite(now) || !Number.isFinite(Date.parse(order.startsAt)) || Date.parse(order.startsAt) > now
        || !order.captureBefore || !Number.isFinite(Date.parse(order.captureBefore)) || Date.parse(order.captureBefore) <= now) {
        throw new PaymentRequestError("PAYMENT_ORDER_CAPTURE_NOT_ALLOWED");
    }
    const result = await paymentRequest(`/api/payments/orders/${order.id}/action`, { action: "capture", consent: true }, operationId);
    if (!validOrder(result.order, scope) || result.order.id !== order.id) throw new PaymentRequestError("payment_unavailable");
    return result.order;
}
function friendlyError(error: unknown) {
    const code = error instanceof PaymentRequestError ? error.code : "";
    if (["PAYMENT_ORDER_BUYER_REQUIRED", "payment_order_buyer_required"].includes(code)) return "Bitte hinterlege zuerst ein Zahlungsmittel in Workfare Pay.";
    if (["PAYMENT_ORDER_RECIPIENT_REQUIRED", "payment_order_recipient_not_ready"].includes(code)) return "Die Auszahlungseinrichtung deines Gegenübers ist noch nicht bereit.";
    if (code === "PAYMENT_ORDER_AUTHORIZATION_WINDOW") return "Die Zahlung kannst du ab 24 Stunden vor dem Termin freigeben.";
    if (["PAYMENT_ORDER_TERMS_CHANGED", "PAYMENT_ORDER_ACTIVE_EXISTS"].includes(code)) return "Der Termin oder Preisstand hat sich geändert. Bitte lade den aktuellen Stand.";
    if (code === "PAYMENT_ORDER_CAPTURE_NOT_ALLOWED") return "Die Zahlung ist noch nicht zum Einzug freigegeben. Prüfe Termin und aktuellen Stand.";
    if (code === "authentication_required") return "Bitte melde dich erneut an, um fortzufahren.";
    if (code === "PAYMENT_ORDER_RECONCILIATION_REQUIRED") return "Dieser Vorgang muss geprüft werden. Bitte wende dich an den Support.";
    if (code === "PAYMENT_ORDER_TARIFF_CHANGED") return "Die Servicegebühr hat sich geändert. Bitte prüfe den aktualisierten Gesamtbetrag und bestätige ihn erneut.";
    return "Der Vorgang ist noch nicht bestätigt. Bitte lade den aktuellen Stand, bevor du es erneut versuchst.";
}

/** One owner-bound read for all visible appointment cards; no financial Realtime. */
export function AppointmentPaymentsProvider({ context, children }: { context: AppointmentPaymentContext | null; children: ReactNode }) {
    const [resource, setResource] = useState<Resource>({ orders: [], quoteFeePolicy: null, loading: true, available: true, error: null });
    const generation = useRef(0);
    const applicationId = context?.applicationId;
    const currentUserId = context?.currentUserId;
    const isProvider = context?.isProvider;
    const scope = useMemo(() => applicationId && currentUserId ? { applicationId, currentUserId, isProvider: isProvider === true } : null, [applicationId, currentUserId, isProvider]);
    const refresh = useCallback(async () => {
        if (!scope) return;
        const ticket = ++generation.current;
        try {
            const result = await paymentRequest(`/api/payments/orders?${new URLSearchParams({ applicationId: scope.applicationId })}`);
            if (ticket !== generation.current) return;
            if (!Array.isArray(result.orders) || !result.orders.every(order => validOrder(order, scope))
                || typeof result.quoteFeePolicy !== "string"
                || !["local-zero-fee-v1", TEST_SERVICE_FEE_POLICY, LIVE_SERVICE_FEE_POLICY].includes(result.quoteFeePolicy)) throw new PaymentRequestError("payment_unavailable");
            setResource({ orders: result.orders, quoteFeePolicy: result.quoteFeePolicy as PaymentFeePolicy, loading: false, available: true, error: null });
        } catch (error) {
            if (ticket !== generation.current) return;
            const off = error instanceof PaymentRequestError && ["payment_orders_disabled", "PAYMENT_ORDERS_DISABLED", "payment_order_sandbox_disabled"].includes(error.code);
            setResource(current => ({ ...current, loading: false, available: !off, error: off ? null : "Der Zahlungsstand ist gerade nicht verfügbar." }));
        }
    }, [scope]);
    useEffect(() => {
        if (!scope) return;
        const initial = requestAnimationFrame(() => { void refresh(); });
        const visible = () => { if (document.visibilityState === "visible") void refresh(); };
        const timer = window.setInterval(visible, 20_000);
        window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
        return () => { generation.current += 1; cancelAnimationFrame(initial); clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
    }, [scope, refresh]);
    const publish = useCallback((order: PaymentOrder) => {
        generation.current += 1;
        setResource(current => ({ ...current, orders: [order, ...current.orders.filter(item => item.id !== order.id)], loading: false, error: null }));
    }, []);
    const shared = useMemo<Shared | null>(() => scope ? { ...scope, ...resource, refresh, publish } : null, [scope, resource, refresh, publish]);
    return <Payments.Provider value={shared}>{children}</Payments.Provider>;
}

export function AppointmentPayment(props: { appointment: ChatAppointment; job: { wage_hourly?: number | null; payment_type?: string | null } }) {
    const shared = useContext(Payments);
    if (!shared || !shared.available || !UUID.test(props.appointment.id)) return null;
    return <PaymentTerm key={props.appointment.id} {...props} shared={shared} />;
}

/** Completion stays in the conversation and never equates a browser return with payment. */
export function AppointmentCompletionReview({ appointments, job, pending, error, onComplete, onClose }: {
    appointments: readonly ChatAppointment[];
    job: { title?: string | null; wage_hourly?: number | null; payment_type?: string | null };
    pending: boolean; error: string | null; onComplete: () => void; onClose: () => void;
}) {
    const shared = useContext(Payments);
    const titleId = useId();
    const dialog = useActivityDialogFocus<HTMLDivElement>();
    const completionAttempted = useRef(false);
    const [busyAppointments, setBusyAppointments] = useState<ReadonlySet<string>>(() => new Set());
    const onBusyChange = useCallback((id: string, busy: boolean) => setBusyAppointments(current => {
        if (current.has(id) === busy) return current;
        const next = new Set(current); if (busy) next.add(id); else next.delete(id); return next;
    }), []);
    const currentAppointments = appointments.filter(appointment => appointment.status !== "cancelled")
        .slice().sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
    const allPaid = Boolean(shared?.isProvider && appointmentsArePaid(currentAppointments, shared.orders));
    const busy = pending || busyAppointments.size > 0;
    useEffect(() => {
        if (!allPaid || busy || shared?.loading || shared?.error || completionAttempted.current) return;
        completionAttempted.current = true;
        onComplete();
    }, [allPaid, busy, shared?.loading, shared?.error, onComplete]);
    return <div className="activity-dialog-layer" onPointerMove={followGlassPointer} onKeyDown={event => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
    }}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={busy} className={`activity-action-dialog ${styles.completionDialog}`}>
        <div className={styles.completionHeading}><div><PayWordmark /><h2 id={titleId}>Auftrag abschließen</h2></div>
            <button type="button" className={`app-glass-control ${styles.completionClose}`} aria-label="Abschluss schließen" onClick={onClose} disabled={busy}><X size={18} aria-hidden="true" /></button></div>
        {job.title && <p className={styles.completionTitle}>{job.title}</p>}
        {allPaid ? <p className={styles.hint} role="status">Die Zahlung ist bestätigt.{pending ? " Der Auftrag wird abgeschlossen …" : ""}</p>
            : <p className={styles.hint}>Prüfe die Vergütung und bestätige die Zahlung. Danach wird der Auftrag abgeschlossen und der Chat geschlossen.</p>}
        {!shared || !shared.available ? <p className={styles.hint} role="alert">Workfare Pay ist gerade nicht verfügbar. Bitte öffne den Abschluss später erneut.</p>
            : !currentAppointments.length ? <p className={styles.hint}>Vereinbare zuerst einen Termin für diesen Auftrag.</p>
                : <div className={styles.completionTerms}>{currentAppointments.map(appointment => <PaymentTerm key={appointment.id}
                    appointment={appointment} job={job} shared={shared} completion onBusyChange={onBusyChange} />)}</div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {allPaid && error && <button type="button" className={`app-glass-control ${styles.primary}`} onClick={onComplete} disabled={busy}>Abschluss erneut prüfen</button>}
        <p className={styles.completionFooter}>Zahlungsabwicklung durch Stripe</p>
    </div></div>;
}

export function AppointmentPaymentAmounts({ earnings, fee = 0, provider, feePolicy = TEST_SERVICE_FEE_POLICY }: { earnings: number; fee?: number; provider: boolean; feePolicy?: PaymentFeePolicy }) {
    return <dl className={styles.amounts}><div><dt>Vergütung</dt><dd>{formatAppointmentMoney(earnings)}</dd></div>{provider && <><div><dt>Servicegebühr{feePolicy !== LIVE_SERVICE_FEE_POLICY && <span> (Testtarif)</span>}</dt><dd>{formatAppointmentMoney(fee)}</dd></div><div className={styles.total}><dt>Gesamt</dt><dd>{formatAppointmentMoney(earnings + fee)}</dd></div></>}</dl>;
}

function estimatedFee(earnings: number | null, policy: PaymentFeePolicy | null) {
    if (earnings === null || policy === null) return null;
    try { return policy === "local-zero-fee-v1" ? 0 : policy === LIVE_SERVICE_FEE_POLICY ? quoteLiveServiceFee(earnings).grossCents : quoteTestServiceFee(earnings).grossCents; } catch { return null; }
}

function PaymentTerm({ appointment, job, shared, completion = false, onBusyChange }: { appointment: ChatAppointment; job: { wage_hourly?: number | null; payment_type?: string | null }; shared: Shared;
    completion?: boolean; onBusyChange?: (appointmentId: string, busy: boolean) => void }) {
    const order = latestAppointmentPaymentOrder(shared.orders, appointment.id);
    const live = order ? order.mode === "live" : shared.quoteFeePolicy === LIVE_SERVICE_FEE_POLICY;
    const refundLabel = live ? "Erstattung" : "Test-Erstattung";
    const [editor, setEditor] = useState(false);
    const [intent, setIntent] = useState<PaymentOrderAction | "confirm" | null>(null);
    const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
    const [minutes, setMinutes] = useState(() => {
        const duration = appointment.ends_at ? Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000) : 60;
        return duration >= 1 && duration <= 480 ? String(duration) : "60";
    });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(0);
    const locked = useRef(false);
    const operationIds = useRef(new Map<string, string>());
    const headingRef = useRef<HTMLHeadingElement>(null);
    const consentId = useId();
    useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 60_000); return () => clearInterval(timer); }, []);
    const estimated = estimateAppointmentPrice(job.wage_hourly, job.payment_type, Number(minutes));
    const proposalFee = estimatedFee(estimated, shared.quoteFeePolicy);
    const primary = order ? nextAppointmentPaymentAction(order, shared.isProvider, now) : null;
    const completionCanPay = completion && Boolean(order && Date.parse(order.startsAt) <= now);
    const displayedIntent = intent ?? (completionCanPay && (primary === "authorize" || primary === "capture") ? primary : null);
    const consentScope = `${order?.id ?? appointment.id}:${order?.totalCents ?? estimated}:${displayedIntent ?? "propose"}:${minutes}:${order?.feePolicy ?? shared.quoteFeePolicy}:${completionCanPay}`;
    const consent = acceptedScope === consentScope;
    function setConsent(value: boolean) { setAcceptedScope(value ? consentScope : null); }
    const canPropose = shared.isProvider && appointment.status === "scheduled" && !!appointment.updated_at && estimated !== null && proposalFee !== null && (!order || order.state === "canceled" || order.state === "refunded");
    const nextLabel = primary === "cancel" ? "Storno fortsetzen" : primary === "refund" ? `${refundLabel} fortsetzen`
        : primary === "capture" ? order?.state === "capture_pending" ? "Einzug fortsetzen" : "Vergütung bezahlen"
        : primary === "confirm" ? "Preis bestätigen" : order?.state === "authorization_pending" ? "Zahlung bestätigen" : "Zahlung freigeben";
    const canCancel = order && canCancelAppointmentPayment(order, shared.isProvider);
    const canRenew = order && canRenewAppointmentPayment(order, shared.isProvider, now);
    const settingsHref = getPaymentSettingsHref(getPaymentConversationReturnPath(shared.applicationId));
    useEffect(() => { onBusyChange?.(appointment.id, pending); return () => onBusyChange?.(appointment.id, false); }, [appointment.id, pending, onBusyChange]);
    function open(action: PaymentOrderAction | "confirm") { setIntent(action); setConsent(false); setError(null); }
    async function refreshStatus() {
        if (locked.current) return;
        locked.current = true; setPending(true); setError(null);
        try {
            if (order) shared.publish(await refreshAppointmentPaymentStatus(order, shared));
            else await shared.refresh();
        } catch (failure) { setError(friendlyError(failure)); }
        finally { locked.current = false; setPending(false); }
    }
    async function execute(action: PaymentOrderAction | "confirm" | "propose") {
        if (locked.current || !consent) return;
        locked.current = true; setPending(true); setError(null);
        const key = `${order?.id ?? appointment.id}:${action}${action === "propose" ? `:${shared.quoteFeePolicy}:${appointment.updated_at}:${minutes}` : ""}`;
        let operation = operationIds.current.get(key);
        if (!operation) { operation = crypto.randomUUID(); operationIds.current.set(key, operation); }
        try {
            let result: Record<string, unknown>;
            if (action === "propose") result = await paymentRequest("/api/payments/orders", { appointmentId: appointment.id, appointmentVersion: appointment.updated_at,
                ...(job.payment_type === "hourly" ? { plannedMinutes: Number(minutes) } : {}), quoteFeePolicy: shared.quoteFeePolicy, consent: true }, operation);
            else if (action === "confirm") result = await paymentRequest(`/api/payments/orders/${order!.id}/confirm`, { termsVersion: order!.termsVersion, consent: true });
            else result = await paymentRequest(`/api/payments/orders/${order!.id}/action`, { action, consent: true }, operation);
            if (!validOrder(result.order, shared) || (action !== "propose" && result.order.id !== order?.id)) throw new PaymentRequestError("payment_unavailable");
            let currentOrder = result.order;
            shared.publish(currentOrder);
            if (result.kind === "confirmation") {
                if (!stripeKeyMatchesKind(result.order.mode === "live" ? "live" : "sandbox", result.publishableKey)
                    || typeof result.clientSecret !== "string" || !/^pi_[a-zA-Z0-9]+_secret_.+/.test(result.clientSecret)
                    || result.clientSecret.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(result.clientSecret)) throw new PaymentRequestError("payment_unavailable");
                const { loadStripe } = await import("@stripe/stripe-js");
                const stripe = await loadStripe(result.publishableKey);
                if (!stripe) throw new PaymentRequestError("payment_unavailable");
                // The intent already contains the exact own saved card. Stripe
                // performs required authentication; its callback proves nothing.
                const confirmation = await stripe.confirmCardPayment(result.clientSecret);
                const synced = await refreshAppointmentPaymentStatus(result.order, shared);
                shared.publish(synced);
                currentOrder = synced;
                if (confirmation.error && synced.state === "authorization_pending") throw new PaymentRequestError("bank_confirmation_pending");
            }
            // A completion consent explicitly covers paying this exact total.
            // Normal pre-work authorization still never captures by itself.
            if (completionCanPay && action === "authorize" && currentOrder.state === "authorized") {
                const captureKey = `${currentOrder.id}:capture`;
                let captureOperation = operationIds.current.get(captureKey);
                if (!captureOperation) { captureOperation = crypto.randomUUID(); operationIds.current.set(captureKey, captureOperation); }
                shared.publish(await captureCompletionPayment(currentOrder, shared, captureOperation));
            }
            setIntent(null); setEditor(false); setConsent(false);
            requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
        } catch (failure) { setIntent(null); setEditor(false); setConsent(false); setError(friendlyError(failure)); await shared.refresh(); }
        finally { locked.current = false; setPending(false); }
    }
    if (!order && appointment.status !== "scheduled") return null;
    return <section className={styles.payment} data-payment-appointment={appointment.id} aria-label="Workfare Pay für diesen Termin" aria-busy={pending}>
        <div className={styles.heading}><WalletCards size={17} aria-hidden="true" /><h4 ref={headingRef} tabIndex={-1}>{completion ? <time dateTime={appointment.starts_at}>{Number.isFinite(Date.parse(appointment.starts_at)) ? APPOINTMENT_TIME.format(new Date(appointment.starts_at)) : "Vereinbarter Termin"}</time> : <PayWordmark />}</h4><button type="button" className={styles.refresh} aria-label="Zahlungsstand aktualisieren" onClick={() => void refreshStatus()} disabled={pending || shared.loading}><RefreshCw size={15} aria-hidden="true" /></button></div>
        {shared.loading ? <p className={styles.hint} role="status">Zahlungsstand wird geladen …</p> : shared.error ? <p className={styles.hint} role="alert">{shared.error}<button type="button" className={styles.textButton} onClick={() => void shared.refresh()}>Erneut laden</button></p> : <>
            {order ? <>
                {(!completion || !displayedIntent) && <div className={styles.summary}><strong>{formatAppointmentMoney(shared.isProvider ? order.totalCents : order.earningsCents)}</strong><span>{stateLabels[order.state]}</span></div>}
                {(!completion || !displayedIntent) && shared.isProvider && order.serviceFeeCents > 0 && <p className={styles.hint}>{formatAppointmentMoney(order.earningsCents)} Vergütung + {formatAppointmentMoney(order.serviceFeeCents)} Servicegebühr</p>}
                {order.paymentType === "hourly" && <p className={styles.hint}>{order.plannedMinutes} vereinbarte Minuten · fester Terminpreis</p>}
                {order.state === "awaiting_confirmation" && shared.isProvider && <p className={styles.hint}>Die Bestätigung deines Gegenübers steht noch aus.</p>}
                {order.state === "ready" && !shared.isProvider && <p className={styles.hint}>Dein Auftraggeber übernimmt die Zahlungsfreigabe.</p>}
                {order.state === "authorized" && <p className={styles.hint}>Noch nicht abgebucht.{shared.isProvider ? " Nach erledigter Arbeit bestätigst du die Zahlung." : " Dein Auftraggeber bestätigt die Zahlung nach der Arbeit."}</p>}
                {order.state === "paid" && <p className={styles.hint}>{shared.isProvider ? "Die vereinbarte Vergütung wurde bezahlt." : "Der Bankauszahlungsstand steht in Workfare Pay."}</p>}
                {completion && shared.isProvider && order.state === "awaiting_confirmation" && <p className={styles.hint}>Dein Gegenüber bestätigt zuerst den vereinbarten Terminpreis.</p>}
                {!order.termsCurrent && !["paid", "refunded", "canceled"].includes(order.state) && <p className={styles.hint}>Der Termin hat sich geändert. Dieser Preisstand muss zuerst storniert werden.</p>}
                {order.state === "review_required" && <p className={styles.hint}>Bitte wende dich an den Support, bevor du weitere Zahlungsaktionen ausführst.</p>}
                {!displayedIntent && !editor && <div className={styles.controls}>{primary && <button type="button" className={`app-glass-control ${styles.primary}`} onClick={() => open(primary)}>{nextLabel}<ArrowRight size={15} aria-hidden="true" /></button>}{canCancel && (!completion || canRenew) && <button type="button" className={styles.textButton} onClick={() => open("cancel")}>{completion ? "Zahlungsversuch erneuern" : "Stornieren"}</button>}{!completion && shared.isProvider && order.state === "paid" && <button type="button" className={styles.textButton} onClick={() => open("refund")}>{refundLabel}</button>}</div>}
            </> : !editor && <p className={styles.hint}>{shared.isProvider ? "Vereinbare einen klaren Preis für diesen Termin." : "Dein Auftraggeber legt den Terminpreis fest."}</p>}
            {canPropose && !displayedIntent && !editor && <button type="button" className={`app-glass-control ${styles.primary}`} onClick={() => { setEditor(true); setConsent(false); setError(null); }}>Terminpreis festlegen<ArrowRight size={15} aria-hidden="true" /></button>}
            {editor && <div className={styles.editor}><div className={styles.editorHeading}><h5>Terminpreis vorschlagen</h5><button type="button" className={styles.refresh} aria-label="Preisvorschlag schließen" disabled={pending} onClick={() => setEditor(false)}><X size={16} /></button></div>
                {job.payment_type === "hourly" && <label className={styles.minutes}>Vereinbarte Arbeitszeit<span><input type="number" inputMode="numeric" min={1} max={480} step={1} value={minutes} disabled={pending} onChange={event => { setMinutes(event.target.value); setConsent(false); }} />Minuten</span></label>}
                {estimated !== null && proposalFee !== null && <AppointmentPaymentAmounts earnings={estimated} fee={proposalFee} provider feePolicy={shared.quoteFeePolicy ?? undefined} />}
                {job.payment_type === "hourly" && <p className={styles.hint}>Aus {formatAppointmentMoney(Math.round((job.wage_hourly ?? 0) * 100))} pro Stunde wird ein fester Preis für diesen Termin. Änderungen brauchen einen neuen, beidseitig bestätigten Preisstand.</p>}
                <label className={styles.consent} htmlFor={`${consentId}-proposal`}><input id={`${consentId}-proposal`} type="checkbox" checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)} />Diesen Terminpreis möchte ich vorschlagen.</label>
                <button type="button" className={`app-glass-control ${styles.primary}`} disabled={pending || !consent || estimated === null || proposalFee === null} onClick={() => void execute("propose")}>{pending ? <LoaderCircle size={16} className={styles.spinner} /> : <ArrowRight size={16} />}Preis vorschlagen</button>
            </div>}
            {displayedIntent && order && <div className={styles.editor}><div className={styles.editorHeading}><h5>{displayedIntent === "confirm" ? "Vereinbarten Preis bestätigen" : displayedIntent === "authorize" ? completionCanPay ? "Erledigte Arbeit bezahlen" : "Zahlung freigeben" : displayedIntent === "capture" ? "Erledigte Arbeit bezahlen" : displayedIntent === "cancel" ? completion ? "Zahlungsversuch erneuern" : "Zahlungsauftrag stornieren" : `Vollständige ${refundLabel}`}</h5>{!completion && <button type="button" className={styles.refresh} aria-label="Zahlungsaktion schließen" disabled={pending} onClick={() => setIntent(null)}><X size={16} /></button>}</div>
                <AppointmentPaymentAmounts earnings={order.earningsCents} fee={order.serviceFeeCents} provider={shared.isProvider} feePolicy={order.feePolicy} />
                {!shared.isProvider && order.serviceFeeCents > 0 && <p className={styles.hint}>Die Servicegebühr übernimmt dein Auftraggeber zusätzlich. Du erhältst die vereinbarte Vergütung vollständig.</p>}
                <p className={styles.hint}>{displayedIntent === "authorize" && !completionCanPay ? "Der Betrag wird auf deiner Karte vorgemerkt. Es wird noch nichts abgebucht." : displayedIntent === "capture" || (displayedIntent === "authorize" && completionCanPay) ? "Du bezahlst mit deinem hinterlegten Zahlungsmittel. Falls erforderlich, fragt Stripe deine Bankfreigabe ab." : displayedIntent === "cancel" ? completion ? "Der bisherige Zahlungsversuch wird beendet. Danach lässt du den Terminpreis erneut bestätigen. Termin und Chat bleiben erhalten." : "Die Zahlungsfreigabe wird aufgehoben. Der Termin und der Chat bleiben erhalten." : displayedIntent === "refund" ? `${live ? "Der" : "Im Test wird der"} gesamte Betrag ${live ? "wird " : ""}an das ursprüngliche Zahlungsmittel erstattet und die Vergütung zurückgebucht.` : "Dieser Betrag gilt für genau diesen Termin."}</p>
                <label className={styles.consent} htmlFor={`${consentId}-action`}><input id={`${consentId}-action`} type="checkbox" checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)} />{displayedIntent === "capture" || (displayedIntent === "authorize" && completionCanPay) ? "Die Arbeit ist erledigt. Ich möchte jetzt bezahlen." : displayedIntent === "authorize" ? "Ich gebe diesen Gesamtbetrag für den Termin frei." : displayedIntent === "cancel" ? completion ? "Diesen Zahlungsversuch möchte ich beenden." : "Diesen Zahlungsauftrag möchte ich stornieren." : displayedIntent === "refund" ? `Diese vollständige ${refundLabel} möchte ich auslösen.` : "Diese Vergütung ist für den Termin vereinbart."}</label>
                <button type="button" className={`app-glass-control ${styles.primary}`} disabled={pending || !consent} onClick={() => void execute(displayedIntent)}>{pending ? <LoaderCircle size={16} className={styles.spinner} /> : displayedIntent === "confirm" ? <Check size={16} /> : <CreditCard size={16} />}{displayedIntent === "cancel" ? completion ? "Zahlungsversuch beenden" : "Storno bestätigen" : displayedIntent === "refund" ? `${refundLabel} bestätigen` : displayedIntent === "capture" || (displayedIntent === "authorize" && completionCanPay) ? `${formatAppointmentMoney(order.totalCents)} bezahlen und abschließen` : displayedIntent === "confirm" ? "Preis bestätigen" : "Freigabe bestätigen"}</button>
            </div>}
            {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className={styles.textButton} onClick={() => void refreshStatus()} disabled={pending}>Stand aktualisieren</button>{shared.isProvider && <Link href={settingsHref} className={styles.textButton}>Zahlungsmittel verwalten</Link>}</div>}
            <PaymentEnvironment kind={live ? "live" : order?.mode === "local_simulation" ? "local" : "sandbox"} className={styles.test} />
        </>}
    </section>;
}
