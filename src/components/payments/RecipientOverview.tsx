"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronRight, FileClock, FileText, RefreshCw, WalletCards } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { RecipientPaymentSummary } from "@/lib/payments/recipient-summary-types";
import type { PaymentOrderState } from "@/lib/payments/order-types";
import { validRecipientFunds } from "./RecipientFunds";
import { paymentRequest } from "./payment-client";
import { PayWordmark } from "./PayWordmark";
import { PaymentEnvironment, type PaymentSurfaceKind } from "./PaymentEnvironment";
import { followGlassPointer } from "@/lib/glass-pointer";
import styles from "./RecipientOverview.module.css";
import paymentStyles from "./Payments.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states: Record<PaymentOrderState, string> = {
    awaiting_confirmation: "Preis vorgeschlagen", ready: "Preis bestätigt", authorization_pending: "Zahlung noch offen",
    authorized: "Vorgemerkt", capture_pending: "In Bearbeitung", paid: "Bezahlt", cancel_pending: "Storno in Bearbeitung",
    canceled: "Storniert", refund_pending: "Erstattung in Bearbeitung", refunded: "Erstattet", failed: "Nicht bezahlt", review_required: "Zahlung in Klärung",
};
const payoutStates = { paid: "Ausgezahlt", pending: "In Vorbereitung", in_transit: "Unterwegs", canceled: "Storniert", failed: "Fehlgeschlagen" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Financial data is displayed only after its owner, units and completeness are confirmed. */
export function validRecipientPaymentSummary(value: unknown, ownerId: string): value is RecipientPaymentSummary {
    if (!object(value) || value.ownerId !== ownerId || !UUID.test(ownerId) || typeof value.kind !== "string" || !["sandbox", "local", "live"].includes(value.kind)
        || value.currency !== "eur" || !timestamp(value.checkedAt) || !object(value.earnings)) return false;
    const earnings = value.earnings;
    if (earnings.scope !== "confirmed_workfare_payments" || ![earnings.confirmedCents, earnings.refundedCents, earnings.underReviewCents, earnings.underReviewCount, earnings.paidJobs].every(integer)
        || ![null, "recipient_setup_required", "minor_review_required", "provider_unavailable", "local_simulation"].includes(value.fundsUnavailableReason as null | string)) return false;
    if (value.kind === "local" && (value.funds !== null || value.payouts !== null || value.fundsUnavailableReason !== "local_simulation")) return false;
    if (value.kind !== "local" && value.fundsUnavailableReason === "local_simulation") return false;
    if (value.funds !== null && (!validRecipientFunds(value.funds) || value.funds.kind !== value.kind)) return false;
    if (value.payouts !== null) {
        const payouts = value.payouts;
        if (!object(payouts) || typeof payouts.coverage !== "string" || !["complete", "recent_only"].includes(payouts.coverage) || !timestamp(payouts.checkedAt)
            || ![payouts.paidOutCents, payouts.inTransitCents].every(amount => amount === null || integer(amount))
            || (payouts.coverage === "complete" && ![payouts.paidOutCents, payouts.inTransitCents].every(integer))
            || (payouts.coverage === "recent_only" && (payouts.paidOutCents !== null || payouts.inTransitCents !== null))
            || !Array.isArray(payouts.recent) || payouts.recent.length > 10 || !payouts.recent.every(row => object(row) && typeof row.id === "string"
                && /^po_[A-Za-z0-9]+$/.test(row.id) && integer(row.amountCents) && typeof row.status === "string" && Object.hasOwn(payoutStates, row.status)
                && timestamp(row.createdAt) && timestamp(row.arrivalAt) && typeof row.automatic === "boolean")) return false;
    }
    return Array.isArray(value.recentPayments) && value.recentPayments.length <= 10 && value.recentPayments.every(row => object(row)
        && typeof row.id === "string" && UUID.test(row.id) && typeof row.applicationId === "string" && UUID.test(row.applicationId)
        && typeof row.title === "string" && row.title.length > 0 && row.title.length <= 300 && integer(row.earningsCents)
        && typeof row.state === "string" && Object.hasOwn(states, row.state) && timestamp(row.startsAt) && timestamp(row.updatedAt));
}

type Resource = { summary: RecipientPaymentSummary | null; loading: boolean; error: string | null };

function useRecipientSummary(ownerId: string, view: "full" | "home" = "full", kind?: PaymentSurfaceKind) {
    const [resource, setResource] = useState<Resource>({ summary: null, loading: true, error: null });
    const generation = useRef(0);
    const mounted = useRef(false);
    const inFlight = useRef<number | null>(null);
    const ownerValid = useRef(true);
    const invalidate = useCallback(() => { ++generation.current; inFlight.current = null; }, []);
    const refresh = useCallback(async () => {
        if (!mounted.current || inFlight.current !== null || !ownerValid.current) return;
        const ticket = ++generation.current;
        inFlight.current = ticket;
        setResource({ summary: null, loading: true, error: null });
        try {
            const value = await paymentRequest<unknown>(view === "home" ? "/api/payments/recipient/summary?view=home" : "/api/payments/recipient/summary", undefined, undefined, ownerId);
            if (!mounted.current || ticket !== generation.current) return;
            if (!validRecipientPaymentSummary(value, ownerId) || (kind !== undefined && value.kind !== kind)) throw new Error("unconfirmed_summary");
            setResource({ summary: value, loading: false, error: null });
        } catch {
            if (mounted.current && ticket === generation.current) setResource({ summary: null, loading: false, error: "Deine Zahlungsübersicht konnte gerade nicht geladen werden." });
        } finally { if (inFlight.current === ticket) inFlight.current = null; }
    }, [ownerId, view, kind]);
    useEffect(() => {
        mounted.current = true;
        ownerValid.current = true;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT" || (session?.user.id && session.user.id !== ownerId)) {
                ownerValid.current = false; invalidate();
                setResource({ summary: null, loading: false, error: "Bitte öffne die Übersicht nach deiner Anmeldung erneut." });
            }
        });
        const financialChange = (event: Event) => { if ((event as CustomEvent<{ownerId:string}>).detail?.ownerId === ownerId) void refresh(); };
        window.addEventListener("workfare-pay-updated", financialChange);
        void Promise.resolve().then(refresh);
        return () => { mounted.current = false; invalidate(); subscription.unsubscribe(); window.removeEventListener("workfare-pay-updated", financialChange); };
    }, [ownerId, refresh, invalidate]);
    return { ...resource, summary: resource.summary?.ownerId === ownerId && (kind === undefined || resource.summary.kind === kind) ? resource.summary : null, refresh };
}

type SummaryResource = Resource & { refresh: () => Promise<void> };
type SharedSummary = SummaryResource & { ownerId: string; kind?: PaymentSurfaceKind };
const RecipientSummaryContext = createContext<SharedSummary | null>(null);

/** Page-scoped sharing keeps the overview and its history on one authorized read. */
export function RecipientSummaryProvider({ ownerId, kind, children }: { ownerId: string; kind?: PaymentSurfaceKind; children: React.ReactNode }) {
    const { summary, loading, error, refresh } = useRecipientSummary(ownerId, "full", kind);
    const value = useMemo(() => ({ ownerId, kind, summary, loading, error, refresh }), [ownerId, kind, summary, loading, error, refresh]);
    return <RecipientSummaryContext value={value}>{children}</RecipientSummaryContext>;
}

function matchesSummary(resource: SharedSummary | null, ownerId: string, kind?: PaymentSurfaceKind): resource is SharedSummary {
    return !!resource && resource.ownerId === ownerId && (kind === undefined || resource.kind === kind)
        && (!resource.summary || resource.summary.ownerId === ownerId && (kind === undefined || resource.summary.kind === kind));
}

type ViewProps = Resource & { onRetry: () => void; compact?: boolean; busy?: boolean; onPayouts?: () => void };
function Amount({ value, className }: { value: number | null | undefined; className?: string }) {
    return <span className={className}>{value === null || value === undefined ? "—" : money.format(value / 100)}</span>;
}

function FirstEarnings({ summary }: { summary: RecipientPaymentSummary }) {
    if (summary.earnings.confirmedCents !== 0 || summary.earnings.refundedCents !== 0 || summary.earnings.paidJobs !== 0
        || summary.recentPayments.length || summary.payouts?.recent.length) return null;
    return <div className={styles.empty}><span>Dein erster Verdienst beginnt mit einem Job.</span><Link href="/app-home/jobs" className={`app-glass-control ${styles.action}`}>Jobs entdecken<ArrowRight size={15} aria-hidden="true" /></Link></div>;
}

export function RecipientOverviewView({ summary, loading, error, onRetry, compact = false, busy = false }: ViewProps) {
    const funds = summary?.funds;
    return <section className={`${styles.surface}${compact ? ` ${styles.compact}` : ""}`} aria-label={compact ? "Deine Vergütung mit Workfare Pay" : "Deine Zahlungsübersicht"} aria-busy={loading} onPointerMove={followGlassPointer}>
        <div className={styles.heading}>
            {compact ? <div className={styles.brand}><span className={`app-glass-control ${styles.brandIcon}`} aria-hidden="true"><WalletCards size={17} strokeWidth={1.5} /></span><div className={styles.brandText}><PayWordmark />{summary && <PaymentEnvironment kind={summary.kind} compact className={styles.environment} />}</div></div>
                : <h2 className={styles.title}>Deine Zahlungsübersicht</h2>}
            {compact ? <Link href="/app-home/settings/payments" className={`app-glass-control ${styles.open}`} aria-label="Workfare Pay öffnen"><ArrowUpRight size={19} aria-hidden="true" /></Link>
                : <button type="button" className={`app-glass-control ${styles.open}`} onClick={onRetry} disabled={loading || busy} aria-label="Zahlungsübersicht aktualisieren"><RefreshCw size={18} aria-hidden="true" /></button>}
        </div>
        {loading ? <div className={styles.pending} role="status"><span className={styles.loadingAmount}>—</span><span>Zahlungsübersicht wird geladen …</span></div>
            : error ? <div className={styles.failure}><p role="alert">{error}</p><button type="button" className={styles.textAction} onClick={onRetry} disabled={busy}>Erneut versuchen<ArrowRight size={15} aria-hidden="true" /></button></div>
            : summary ? <>
                <dl className={styles.numbers}>
                    <div className={styles.primary}><dt>Verfügbar</dt><dd><Amount value={funds?.availableCents} /></dd></div>
                    <div className={styles.primary}><dt>Gesamtverdienst</dt><dd><Amount value={summary.earnings.confirmedCents} /></dd></div>
                    {!compact && <><div><dt>In Bearbeitung</dt><dd><Amount value={funds?.pendingCents} /></dd></div>
                        <div><dt>Bereits ausgezahlt</dt><dd><Amount value={summary.payouts?.paidOutCents} /></dd></div></>}
                </dl>
                {!compact && <>
                    {!!funds && funds.pendingCents > 0 && <p className={styles.note}>{funds.pendingAvailableAt
                        ? <>Beträge in Bearbeitung: voraussichtlich auszahlbar am <time dateTime={funds.pendingAvailableAt}>{date.format(new Date(funds.pendingAvailableAt))}</time>.</>
                        : "Die Beträge in Bearbeitung werden für deine Bankauszahlung verarbeitet."}</p>}
                    {summary.payouts?.inTransitCents !== null && summary.payouts?.inTransitCents !== undefined && summary.payouts.inTransitCents > 0 && <p className={styles.caption}><Amount value={summary.payouts.inTransitCents} /> auf dem Weg zu deinem Bankkonto</p>}
                    {!funds && <p className={styles.note}>{summary.fundsUnavailableReason === "minor_review_required" ? "Bankauszahlungen für Minderjährige sind noch nicht freigegeben."
                        : summary.fundsUnavailableReason === "local_simulation" ? "Diese Vorschau enthält kein Bankguthaben."
                        : summary.fundsUnavailableReason === "provider_unavailable" ? "Dein Guthaben bei Workfare Pay konnte gerade nicht geladen werden." : "Dein Auszahlungsstand erscheint nach der Einrichtung."}</p>}
                    {funds && !summary.payouts && summary.fundsUnavailableReason === "provider_unavailable" && <p className={styles.note}>Der Auszahlungsverlauf ist gerade nicht verfügbar.</p>}
                    {summary.payouts?.coverage === "recent_only" && <p className={styles.note}>Die Gesamtsumme deiner Auszahlungen ist gerade nicht verfügbar.</p>}
                </>}
            </> : null}
    </section>;
}

function PaymentHistory({ summary }: { summary: RecipientPaymentSummary }) {
    if (!summary.recentPayments.length && !summary.payouts?.recent.length) return <><p className={styles.noMovements}>Noch keine Transaktionen.</p><FirstEarnings summary={summary} /></>;
    return <div className={styles.history}>
        {summary.recentPayments.length > 0 && <><h3>Zahlungen</h3><ul>{summary.recentPayments.map(payment => <li key={payment.id}><Link href={`/app-home/activities?conversation=${payment.applicationId}`} className={styles.entry}>
            <span className={`app-glass-control ${styles.entryIcon}`} aria-hidden="true">{payment.state === "refunded" ? <ArrowUpRight size={18} /> : payment.state === "paid" ? <ArrowDownLeft size={18} /> : <FileText size={18} />}</span>
            <div className={styles.entryCopy}><strong>{payment.title}</strong><span>{states[payment.state]}<span aria-hidden="true"> · </span>{date.format(new Date(payment.updatedAt))}</span></div><span className={styles.entryAmount}><Amount value={payment.earningsCents} /></span>
        </Link></li>)}</ul></>}
        {!!summary.payouts?.recent.length && <><h3>Bankauszahlungen</h3><ul>{summary.payouts.recent.map(payout => <li key={payout.id} className={styles.entry}>
            <span className={`app-glass-control ${styles.entryIcon}`} aria-hidden="true"><ArrowDownToLine size={18} /></span><div className={styles.entryCopy}><strong>{payout.automatic ? "Automatische Bankauszahlung" : "Bankauszahlung"}</strong><span>{payoutStates[payout.status]}<span aria-hidden="true"> · </span>{date.format(new Date(payout.createdAt))}</span></div><span className={styles.entryAmount}><Amount value={payout.amountCents} /></span>
        </li>)}</ul></>}
    </div>;
}

export function RecipientTransactionHistoryView({ summary, loading, error, onRetry, onPayouts, busy = false }: Resource & { onRetry: () => void; onPayouts?: () => void; busy?: boolean }) {
    return <details className={`${paymentStyles.utilitySection} ${styles.transactionDisclosure}`}>
        <summary className={paymentStyles.settingsRow}><span className={`app-glass-control ${paymentStyles.rowIcon}`} aria-hidden="true"><FileClock size={21} strokeWidth={1.5} /></span><span>Transaktionshistorie</span><ChevronRight size={18} className={paymentStyles.rowArrow} aria-hidden="true" /></summary>
        <div className={styles.transactionBody} aria-busy={loading}>
            <div className={styles.historyTools}><button type="button" className={`app-glass-control ${styles.open}`} onClick={onRetry} disabled={loading || busy} aria-label="Transaktionshistorie aktualisieren"><RefreshCw size={17} aria-hidden="true" /></button></div>
            {loading ? <p className={styles.note} role="status">Transaktionen werden geladen …</p>
                : error ? <p className={styles.note} role="alert">{error}</p>
                    : summary ? <><PaymentHistory summary={summary} />{onPayouts && summary.funds && <div className={styles.actions}><button type="button" className={`app-glass-control ${styles.action}`} onClick={onPayouts} disabled={busy || !summary.funds.stripePayoutsEnabled || !summary.funds.hasPayoutMethod}><ArrowDownToLine size={17} aria-hidden="true" />Alle Auszahlungen</button></div>}</> : null}
        </div>
    </details>;
}

type OverviewProps = { ownerId: string; kind?: PaymentSurfaceKind; onPayouts?: () => void; busy?: boolean };
function StandaloneOverview({ ownerId, kind, onPayouts, busy = false }: OverviewProps) {
    const resource = useRecipientSummary(ownerId, "full", kind);
    return <RecipientOverviewView {...resource} onRetry={() => void resource.refresh()} onPayouts={onPayouts} busy={busy} />;
}
export function RecipientOverview(props: OverviewProps) {
    const shared = useContext(RecipientSummaryContext);
    return matchesSummary(shared, props.ownerId, props.kind)
        ? <RecipientOverviewView {...shared} onRetry={() => void shared.refresh()} onPayouts={props.onPayouts} busy={props.busy} />
        : <StandaloneOverview {...props} />;
}

type HistoryProps = { ownerId: string; kind?: PaymentSurfaceKind; onPayouts?: () => void; busy?: boolean };
function StandaloneTransactionHistory({ ownerId, kind, onPayouts, busy }: HistoryProps) {
    const resource = useRecipientSummary(ownerId, "full", kind);
    return <RecipientTransactionHistoryView {...resource} onRetry={() => void resource.refresh()} onPayouts={onPayouts} busy={busy} />;
}
export function RecipientTransactionHistory({ ownerId, kind, onPayouts, busy }: HistoryProps) {
    const shared = useContext(RecipientSummaryContext);
    return matchesSummary(shared, ownerId, kind)
        ? <RecipientTransactionHistoryView {...shared} onRetry={() => void shared.refresh()} onPayouts={onPayouts} busy={busy} />
        : <StandaloneTransactionHistory ownerId={ownerId} kind={kind} onPayouts={onPayouts} busy={busy} />;
}

export function RecipientPayHome({ ownerId }: { ownerId: string }) {
    const resource = useRecipientSummary(ownerId, "home");
    return <div className={styles.home}><RecipientOverviewView {...resource} compact onRetry={() => void resource.refresh()} /></div>;
}
