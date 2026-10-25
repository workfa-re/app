"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, CreditCard, LoaderCircle, RefreshCw, WalletCards, X } from "lucide-react";
import type { PaymentOrder, PaymentOrderAction } from "@/lib/payments/order-types";
import { LIVE_SERVICE_FEE_POLICY, quoteServiceFee, isPaymentFeePolicy, isPublishedFeePolicy, validFeePolicyForMode, REGULAR_SERVICE_FEE_POLICY, MEMBER_SERVICE_FEE_POLICY, TEST_SERVICE_FEE_POLICY, validPaymentOrderFee, type PaymentFeePolicy } from "@/lib/payments/tariff";
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
type PaymentUiAction = PaymentOrderAction | "pay" | "confirm";
const Payments = createContext<Shared | null>(null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const APPOINTMENT_TIME = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const STATES = new Set(["awaiting_confirmation", "ready", "authorization_pending", "authorized", "capture_pending", "paid", "cancel_pending", "canceled", "refund_pending", "refunded", "failed", "review_required"]);
const stateLabels: Record<PaymentOrder["state"], string> = {
    awaiting_confirmation: "Preis vorgeschlagen", ready: "Preis bestätigt", authorization_pending: "Zahlung noch offen", authorized: "Zahlung noch offen",
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

export function nextAppointmentPaymentAction(order: PaymentOrder, provider: boolean, now: number): PaymentUiAction | null {
    if (!provider) return order.state === "awaiting_confirmation" && order.termsCurrent ? "confirm" : null;
    // These resume the existing server-owned operation. They never allocate a
    // replacement intent, capture or refund from an uncertain previous result.
    if (order.state === "cancel_pending") return "cancel";
    if (order.state === "refund_pending") return "refund";
    if (order.state === "capture_pending") return "pay";
    if (!order.termsCurrent && !["paid", "refunded"].includes(order.state)) return null;
    if (order.state === "ready" || order.state === "authorization_pending") return "pay";
    if (order.state === "authorized" && order.captureBefore && Date.parse(order.captureBefore) > now) return "pay";
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
        else if (action === "capture" || action === "pay") candidates.push({ appointmentId: order.appointmentId, label: order.state === "capture_pending" ? "Zahlung prüfen" : "Jetzt bezahlen", priority: 2, time: Date.parse(order.captureBefore ?? order.startsAt) });
        else if (action === "cancel" || action === "refund") candidates.push({ appointmentId: order.appointmentId, label: "Zahlung prüfen", priority: 0, time: Date.parse(order.startsAt) });
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
        && (scope.isProvider ? row.providerId === scope.currentUserId : row.recipientId === scope.currentUserId) && row.currency === "eur" && typeof row.state === "string" && STATES.has(row.state)
        && typeof row.appointmentId === "string" && UUID.test(row.appointmentId)
        && typeof row.quoteVersion === "number" && Number.isSafeInteger(row.quoteVersion) && row.quoteVersion > 0
        && typeof row.earningsCents === "number" && Number.isSafeInteger(row.earningsCents) && row.earningsCents >= 50 && row.earningsCents <= 99_999_999
        && typeof row.mode === "string" && ["sandbox", "local_simulation", "live"].includes(row.mode)
        && validPaymentOrderFee(row)
        && validFeePolicyForMode(row.feePolicy, row.mode)
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

/** The named payment button declares completed work for the exact saved quote. */
export async function payCompletedAppointment(order: PaymentOrder, scope: AppointmentPaymentContext, operationId: string): Promise<Record<string, unknown> & { order: PaymentOrder }> {
    if (!scope.isProvider || order.providerId !== scope.currentUserId || !validOrder(order, scope) || !UUID.test(operationId)
        || !order.termsCurrent || !order.recipientConfirmedAt || !["ready", "authorization_pending", "authorized", "capture_pending"].includes(order.state)) {
        throw new PaymentRequestError("PAYMENT_ORDER_PAY_NOT_ALLOWED");
    }
    const result = await paymentRequest(`/api/payments/orders/${order.id}/action`, { action: "pay", consent: true }, operationId);
    if (!validOrder(result.order, scope) || result.order.id !== order.id) throw new PaymentRequestError("payment_unavailable");
    return { ...result, order: result.order };
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
    if (["PAYMENT_ORDER_CAPTURE_NOT_ALLOWED", "PAYMENT_ORDER_PAY_NOT_ALLOWED"].includes(code)) return "Die Zahlung ist noch nicht möglich. Prüfe den bestätigten Preis und den aktuellen Stand.";
    if (code === "authentication_required") return "Bitte melde dich erneut an, um fortzufahren.";
    if (code === "PAYMENT_ORDER_RECONCILIATION_REQUIRED") return "Dieser Vorgang muss geprüft werden. Bitte wende dich an den Support.";
    if (code === "PAYMENT_ORDER_TARIFF_CHANGED") return "Die Servicegebühr hat sich geändert. Bitte prüfe den aktualisierten Gesamtbetrag und bestätige ihn erneut.";
    return "Der Vorgang ist noch nicht bestätigt. Bitte lade den aktuellen Stand, bevor du es erneut versuchst.";
}

/** One owner-bound read for all visible appointment cards; no financial Realtime. */
export function AppointmentPaymentsProvider({ context, children }: { context: AppointmentPaymentContext | null; children: ReactNode }) {
    // A changed participant gets a fresh resource and new child lifetimes. An
    // old request or bank popup cannot publish into another person's view.
    const owner = context ? `${context.applicationId}:${context.currentUserId}:${context.isProvider}` : "none";
    return <ScopedAppointmentPaymentsProvider key={owner} context={context}>{children}</ScopedAppointmentPaymentsProvider>;
}

function ScopedAppointmentPaymentsProvider({ context, children }: { context: AppointmentPaymentContext | null; children: ReactNode }) {
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
                || !isPaymentFeePolicy(result.quoteFeePolicy)) throw new PaymentRequestError("payment_unavailable");
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

export function AppointmentPayment(props: { appointment: ChatAppointment; job: { wage_hourly?: number | null; payment_type?: string | null }; focusedOrderId?: string }) {
    const shared = useContext(Payments);
    if (!shared || !shared.available || !UUID.test(props.appointment.id)) return null;
    return <PaymentTerm key={`${props.appointment.id}:${props.focusedOrderId ?? "latest"}`} {...props} shared={shared} />;
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
        {allPaid && <p className={styles.hint} role="status">Die Zahlung ist bestätigt.{pending ? " Der Auftrag wird abgeschlossen …" : ""}</p>}
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
    const bundle = feePolicy === REGULAR_SERVICE_FEE_POLICY || feePolicy === MEMBER_SERVICE_FEE_POLICY ? quoteServiceFee(earnings, feePolicy) : null;
    return <div className={styles.amounts}>
        <dl className={styles.amountLine}><dt>Vergütung</dt><dd>{formatAppointmentMoney(earnings)}</dd></dl>
        {provider && <>
            <details className={styles.feeDetails}>
                <summary><span>Gebühren</span><span>{formatAppointmentMoney(fee)}<ChevronDown size={14} aria-hidden="true" /></span></summary>
                <div className={styles.feeBreakdown}>
                    {bundle && "baseCents" in bundle ? <>
                        <dl className={styles.amountLine}><dt>Abwicklung & Betrieb<span> · 6 % + 0,49 €</span></dt><dd>{formatAppointmentMoney(bundle.baseCents)}</dd></dl>
                        <dl className={styles.amountLine}><dt>Workfare-Anteil<span>{feePolicy === MEMBER_SERVICE_FEE_POLICY ? " · entfällt mit Workfare Plan" : " · 6 %"}</span></dt><dd>{formatAppointmentMoney(bundle.workfareCents)}</dd></dl>
                        <p>Allgemeine Servicegebühr, unabhängig vom gewählten Zahlungsmittel.</p>
                    </> : <><dl className={styles.amountLine}><dt>Workfare-Servicegebühr{feePolicy === LIVE_SERVICE_FEE_POLICY ? <span> · 5 %</span> : <span> (Testtarif)</span>}</dt><dd>{formatAppointmentMoney(fee)}</dd></dl><p>Die Zahlungsabwicklung ist in dieser Gebühr enthalten.</p></>}
                </div>
            </details>
            <dl className={`${styles.amountLine} ${styles.total}`}><dt>Gesamt</dt><dd>{formatAppointmentMoney(earnings + fee)}</dd></dl>
        </>}
    </div>;
}

function estimatedFee(earnings: number | null, policy: PaymentFeePolicy | null) {
    if (earnings === null || policy === null) return null;
    try { return policy === "local-zero-fee-v1" ? 0 : quoteServiceFee(earnings, policy).grossCents; } catch { return null; }
}

function PaymentTerm({ appointment, job, shared, completion = false, onBusyChange, focusedOrderId }: { appointment: ChatAppointment; job: { wage_hourly?: number | null; payment_type?: string | null }; shared: Shared;
    completion?: boolean; onBusyChange?: (appointmentId: string, busy: boolean) => void; focusedOrderId?: string }) {
    const latest = latestAppointmentPaymentOrder(shared.orders, appointment.id);
    const order = focusedOrderId ? shared.orders.find(item => item.id === focusedOrderId && item.appointmentId === appointment.id) : latest;
    const historical = Boolean(focusedOrderId && focusedOrderId !== latest?.id);
    const live = order ? order.mode === "live" : isPublishedFeePolicy(shared.quoteFeePolicy);
    const refundLabel = live ? "Erstattung" : "Test-Erstattung";
    const [editor, setEditor] = useState(false);
    const [intent, setIntent] = useState<PaymentUiAction | null>(null);
    const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
    const [minutes, setMinutes] = useState(() => {
        const duration = appointment.ends_at ? Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000) : 60;
        return duration >= 1 && duration <= 480 ? String(duration) : "60";
    });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(0);
    const locked = useRef(false);
    const mounted = useRef(false);
    const operationIds = useRef(new Map<string, string>());
    const headingRef = useRef<HTMLHeadingElement>(null);
    const consentId = useId();
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 60_000); return () => clearInterval(timer); }, []);
    const estimated = estimateAppointmentPrice(job.wage_hourly, job.payment_type, Number(minutes));
    const proposalFee = estimatedFee(estimated, shared.quoteFeePolicy);
    const primary = order && !historical ? nextAppointmentPaymentAction(order, shared.isProvider, now) : null;
    const displayedIntent = historical ? null : intent ?? (primary === "pay" || primary === "confirm" || completion && primary === "capture" ? primary : null);
    const consentScope = `${order?.id ?? appointment.id}:${order?.totalCents ?? estimated}:${displayedIntent ?? "propose"}:${minutes}:${order?.feePolicy ?? shared.quoteFeePolicy}:${completion}`;
    const consent = acceptedScope === consentScope;
    function setConsent(value: boolean) { setAcceptedScope(value ? consentScope : null); }
    const canPropose = !historical && shared.isProvider && appointment.status === "scheduled" && !!appointment.updated_at
        && estimateAppointmentPrice(job.wage_hourly, job.payment_type, 60) !== null && shared.quoteFeePolicy !== null
        && (!order || order.state === "canceled" || order.state === "refunded");
    const proposalOpen = canPropose && (editor || completion);
    const nextLabel = primary === "cancel" ? "Storno fortsetzen" : primary === "refund" ? `${refundLabel} fortsetzen`
        : primary === "capture" ? order?.state === "capture_pending" ? "Zahlung prüfen" : "Jetzt bezahlen"
        : primary === "confirm" ? "Preis bestätigen" : "Jetzt bezahlen";
    const needsExtraConsent = (action: PaymentUiAction | "propose") => ["authorize", "cancel", "refund"].includes(action);
    const canCancel = !historical && order && canCancelAppointmentPayment(order, shared.isProvider);
    const canRenew = order && canRenewAppointmentPayment(order, shared.isProvider, now);
    const settingsHref = getPaymentSettingsHref(getPaymentConversationReturnPath(shared.applicationId));
    useEffect(() => { onBusyChange?.(appointment.id, pending); return () => onBusyChange?.(appointment.id, false); }, [appointment.id, pending, onBusyChange]);
    function open(action: PaymentUiAction) { setIntent(action); setConsent(false); setError(null); }
    async function refreshStatus() {
        if (locked.current) return;
        locked.current = true; setPending(true); setError(null);
        try {
            if (order) { const refreshed = await refreshAppointmentPaymentStatus(order, shared); if (mounted.current) shared.publish(refreshed); }
            else await shared.refresh();
        } catch (failure) { if (mounted.current) setError(friendlyError(failure)); }
        finally { locked.current = false; if (mounted.current) setPending(false); }
    }
    async function execute(action: PaymentUiAction | "propose") {
        if (historical || locked.current || needsExtraConsent(action) && !consent) return;
        locked.current = true; setPending(true); setError(null);
        const key = `${order?.id ?? appointment.id}:${action}${action === "propose" ? `:${shared.quoteFeePolicy}:${appointment.updated_at}:${minutes}` : ""}`;
        let operation = operationIds.current.get(key);
        if (!operation) { operation = crypto.randomUUID(); operationIds.current.set(key, operation); }
        try {
            let result: Record<string, unknown>;
            if (action === "propose") result = await paymentRequest("/api/payments/orders", { appointmentId: appointment.id, appointmentVersion: appointment.updated_at,
                ...(job.payment_type === "hourly" ? { plannedMinutes: Number(minutes) } : {}), quoteFeePolicy: shared.quoteFeePolicy, consent: true }, operation);
            else if (action === "confirm") result = await paymentRequest(`/api/payments/orders/${order!.id}/confirm`, { termsVersion: order!.termsVersion, consent: true });
            else if (action === "pay") result = await payCompletedAppointment(order!, shared, operation);
            else result = await paymentRequest(`/api/payments/orders/${order!.id}/action`, { action, consent: true }, operation);
            if (!mounted.current) return;
            if (!validOrder(result.order, shared) || (action !== "propose" && result.order.id !== order?.id)) throw new PaymentRequestError("payment_unavailable");
            shared.publish(result.order);
            if (result.kind === "confirmation") {
                if (!stripeKeyMatchesKind(result.order.mode === "live" ? "live" : "sandbox", result.publishableKey)
                    || typeof result.clientSecret !== "string" || !/^pi_[a-zA-Z0-9]+_secret_.+/.test(result.clientSecret)
                    || result.clientSecret.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(result.clientSecret)) throw new PaymentRequestError("payment_unavailable");
                const { loadStripe } = await import("@stripe/stripe-js");
                if (!mounted.current) return;
                const stripe = await loadStripe(result.publishableKey);
                if (!mounted.current) return;
                if (!stripe) throw new PaymentRequestError("payment_unavailable");
                // The intent already contains the exact own saved card. Stripe
                // performs required authentication; its callback proves nothing.
                const confirmation = await stripe.confirmCardPayment(result.clientSecret);
                if (!mounted.current) return;
                const synced = await refreshAppointmentPaymentStatus(result.order, shared);
                if (!mounted.current) return;
                shared.publish(synced);
                if (confirmation.error && synced.state === "authorization_pending") throw new PaymentRequestError("bank_confirmation_pending");
            }
            setIntent(null); setEditor(false); setConsent(false);
            requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
        } catch (failure) { if (mounted.current) { setIntent(null); setEditor(false); setConsent(false); setError(friendlyError(failure)); await shared.refresh(); } }
        finally { locked.current = false; if (mounted.current) setPending(false); }
    }
    if (!order && appointment.status !== "scheduled" && !focusedOrderId) return null;
    return <section className={styles.payment} data-payment-appointment={appointment.id} aria-label="Workfare Pay für diesen Termin" aria-busy={pending}>
        <div className={styles.heading}><WalletCards size={17} aria-hidden="true" /><h4 ref={headingRef} tabIndex={-1}>{completion ? <time dateTime={appointment.starts_at}>{Number.isFinite(Date.parse(appointment.starts_at)) ? APPOINTMENT_TIME.format(new Date(appointment.starts_at)) : "Vereinbarter Termin"}</time> : <PayWordmark />}</h4><button type="button" className={styles.refresh} aria-label="Zahlungsstand aktualisieren" onClick={() => void refreshStatus()} disabled={pending || shared.loading}><RefreshCw size={15} aria-hidden="true" /></button></div>
        {shared.loading ? <p className={styles.hint} role="status">Zahlungsstand wird geladen …</p> : shared.error ? <p className={styles.hint} role="alert">{shared.error}<button type="button" className={styles.textButton} onClick={() => void shared.refresh()}>Erneut laden</button></p> : <>
            {focusedOrderId && !order ? <p className={styles.hint}>Dieser Zahlungsstand ist nicht mehr verfügbar.</p> : order ? <>
                {historical && <p className={styles.hint}>Früherer Preisstand · nur zur Ansicht</p>}
                {!displayedIntent && <div className={styles.summary}><strong>{formatAppointmentMoney(shared.isProvider ? order.totalCents : order.earningsCents)}</strong><span>{stateLabels[order.state]}</span></div>}
                {!displayedIntent && shared.isProvider && order.serviceFeeCents > 0 && <p className={styles.hint}>{formatAppointmentMoney(order.earningsCents)} Vergütung + {formatAppointmentMoney(order.serviceFeeCents)} Servicegebühr</p>}
                {!displayedIntent && order.paymentType === "hourly" && <p className={styles.hint}>{order.plannedMinutes} Minuten · {formatAppointmentMoney(order.earningsCents)} Vergütung</p>}
                {order.state === "awaiting_confirmation" && shared.isProvider && <p className={styles.hint}>Dein Gegenüber bestätigt den Preis im Chat. Danach kannst du bezahlen.</p>}
                {order.state === "ready" && !shared.isProvider && <p className={styles.hint}>Der Preis ist bestätigt. Dein Auftraggeber kann jetzt bezahlen.</p>}
                {order.state === "authorized" && !displayedIntent && <p className={styles.hint}>{shared.isProvider ? "Du kannst die erledigte Arbeit jetzt bezahlen." : "Dein Auftraggeber kann die Zahlung jetzt abschließen."}</p>}
                {order.state === "paid" && <p className={styles.hint}>{shared.isProvider ? "Die vereinbarte Vergütung wurde bezahlt." : "Der Bankauszahlungsstand steht in Workfare Pay."}</p>}
                {!order.termsCurrent && !["paid", "refunded", "canceled"].includes(order.state) && <p className={styles.hint}>Der Termin hat sich geändert. Dieser Preisstand muss zuerst storniert werden.</p>}
                {order.state === "review_required" && <p className={styles.hint}>Bitte wende dich an den Support, bevor du weitere Zahlungsaktionen ausführst.</p>}
                {!displayedIntent && !proposalOpen && primary && <div className={styles.controls}><button type="button" className={`app-glass-control ${styles.primary}`} onClick={() => open(primary)}>{nextLabel}<ArrowRight size={15} aria-hidden="true" /></button></div>}
            </> : !proposalOpen && <p className={styles.hint}>{shared.isProvider ? "Lege die Vergütung für die erledigte Arbeit fest." : "Dein Auftraggeber schlägt die Vergütung vor."}</p>}
            {canPropose && !displayedIntent && !proposalOpen && <button type="button" className={`app-glass-control ${styles.primary}`} onClick={() => { setEditor(true); setConsent(false); setError(null); }}>Vergütung festlegen<ArrowRight size={15} aria-hidden="true" /></button>}
            {proposalOpen && <div className={styles.editor}><div className={styles.editorHeading}><h5>Vergütung vorschlagen</h5>{!completion && <button type="button" className={styles.refresh} aria-label="Preisvorschlag schließen" disabled={pending} onClick={() => setEditor(false)}><X size={16} /></button>}</div>
                {job.payment_type === "hourly" && <label className={styles.minutes}>Gearbeitete Zeit<span><input type="number" inputMode="numeric" min={1} max={480} step={1} value={minutes} disabled={pending} onChange={event => { setMinutes(event.target.value); setConsent(false); }} />Minuten</span></label>}
                {estimated !== null && proposalFee !== null && <AppointmentPaymentAmounts earnings={estimated} fee={proposalFee} provider feePolicy={shared.quoteFeePolicy ?? undefined} />}
                {job.payment_type === "hourly" && <p className={styles.hint}>{formatAppointmentMoney(Math.round((job.wage_hourly ?? 0) * 100))} pro Stunde. Dein Gegenüber bestätigt die daraus berechnete Vergütung.</p>}
                <button type="button" className={`app-glass-control ${styles.primary}`} disabled={pending || estimated === null || proposalFee === null} onClick={() => void execute("propose")}>{pending ? <LoaderCircle size={16} className={styles.spinner} /> : <ArrowRight size={16} />}Preis vorschlagen</button>
            </div>}
            {displayedIntent && order && <div className={styles.editor}>
                <div className={styles.editorHeading}><h5>{displayedIntent === "confirm" ? "Deine Vergütung" : order.state === "capture_pending" ? "Zahlung wird verarbeitet" : displayedIntent === "pay" || displayedIntent === "capture" ? "Erledigte Arbeit bezahlen" : displayedIntent === "authorize" ? "Zahlungsstand prüfen" : displayedIntent === "cancel" ? completion ? "Zahlungsversuch erneuern" : "Zahlungsauftrag stornieren" : `Vollständige ${refundLabel}`}</h5>{!completion && !["pay", "confirm"].includes(displayedIntent) && <button type="button" className={styles.refresh} aria-label="Zahlungsaktion schließen" disabled={pending} onClick={() => setIntent(null)}><X size={16} /></button>}</div>
                <AppointmentPaymentAmounts earnings={order.earningsCents} fee={order.serviceFeeCents} provider={shared.isProvider} feePolicy={order.feePolicy} />
                {order.state === "capture_pending" ? <p className={styles.hint}>Sobald die Zahlung bestätigt ist, wird der Auftrag abgeschlossen.</p> : displayedIntent === "pay" || displayedIntent === "capture" ? <p className={styles.hint}>Die Arbeit ist erledigt. Du bezahlst jetzt mit deinem hinterlegten Zahlungsmittel.</p>
                    : displayedIntent === "confirm" ? <p className={styles.hint}>Ist das die vereinbarte Vergütung? Die Servicegebühr übernimmt dein Auftraggeber.</p>
                        : <p className={styles.hint}>{displayedIntent === "cancel" ? completion ? "Der Zahlungsversuch wird beendet. Termin und Chat bleiben erhalten." : "Der Zahlungsauftrag wird storniert. Termin und Chat bleiben erhalten." : displayedIntent === "refund" ? "Der gesamte Betrag wird an das ursprüngliche Zahlungsmittel erstattet und die Vergütung zurückgebucht." : "Prüfe den aktuellen Zahlungsstand, bevor du fortfährst."}</p>}
                {needsExtraConsent(displayedIntent) && <label className={styles.consent} htmlFor={`${consentId}-action`}><input id={`${consentId}-action`} type="checkbox" checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)} />{displayedIntent === "cancel" ? "Diesen Zahlungsversuch möchte ich beenden." : displayedIntent === "refund" ? `Diese vollständige ${refundLabel} möchte ich auslösen.` : "Ich möchte diesen Zahlungsvorgang fortsetzen."}</label>}
                <button type="button" className={`app-glass-control ${styles.primary}`} disabled={pending || needsExtraConsent(displayedIntent) && !consent} onClick={() => void (order.state === "capture_pending" && displayedIntent === "pay" ? refreshStatus() : execute(displayedIntent))}>{pending ? <LoaderCircle size={16} className={styles.spinner} /> : displayedIntent === "confirm" ? <Check size={16} /> : <CreditCard size={16} />}{displayedIntent === "cancel" ? completion ? "Zahlungsversuch beenden" : "Storno bestätigen" : displayedIntent === "refund" ? `${refundLabel} bestätigen` : order.state === "capture_pending" ? "Zahlungsstand prüfen" : order.state === "authorization_pending" && displayedIntent === "pay" ? "Zahlung fortsetzen" : displayedIntent === "pay" || displayedIntent === "capture" ? `${formatAppointmentMoney(order.totalCents)} bezahlen` : displayedIntent === "confirm" ? "Preis bestätigen" : "Zahlung fortsetzen"}</button>
            </div>}
            {!historical && order && !pending && !["cancel", "refund"].includes(displayedIntent ?? "") && (canCancel || !completion && shared.isProvider && order.state === "paid") && <details className={styles.secondaryActions}>
                <summary>Weitere Aktionen</summary>
                {canCancel && <button type="button" className={styles.textButton} onClick={() => open("cancel")}>{canRenew ? "Zahlungsversuch neu beginnen" : "Preisvorschlag zurückziehen"}</button>}
                {!completion && shared.isProvider && order.state === "paid" && <button type="button" className={styles.textButton} onClick={() => open("refund")}>{refundLabel}</button>}
            </details>}
            {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className={styles.textButton} onClick={() => void refreshStatus()} disabled={pending}>Stand aktualisieren</button>{shared.isProvider && <Link href={settingsHref} className={styles.textButton}>Zahlungsmittel verwalten</Link>}</div>}
            <PaymentEnvironment kind={live ? "live" : order?.mode === "local_simulation" ? "local" : "sandbox"} className={styles.test} />
        </>}
    </section>;
}
