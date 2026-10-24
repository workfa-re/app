"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { RecipientPaymentSummary } from "@/lib/payments/recipient-summary-types";
import type { PaymentOrderState } from "@/lib/payments/order-types";
import { validRecipientFunds } from "./RecipientFunds";
import { paymentRequest } from "./payment-client";
import { PayWordmark } from "./PayWordmark";
import { PaymentEnvironment, type PaymentSurfaceKind } from "./PaymentEnvironment";
import styles from "./RecipientOverview.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const checkedTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states: Record<PaymentOrderState, string> = {
    awaiting_confirmation: "Preis vorgeschlagen", ready: "Preis bestätigt", authorization_pending: "Bestätigung ausstehend",
    authorized: "Vorgemerkt", capture_pending: "In Bearbeitung", paid: "Bezahlt", cancel_pending: "Storno in Bearbeitung",
    canceled: "Storniert", refund_pending: "Erstattung in Bearbeitung", refunded: "Erstattet", failed: "Nicht bezahlt", review_required: "Wird geprüft",
};
const payoutStates = { paid: "Ausgezahlt", pending: "In Vorbereitung", in_transit: "Unterwegs", canceled: "Storniert", failed: "Fehlgeschlagen" };
const schedules = { daily: "Täglich", weekly: "Wöchentlich", monthly: "Monatlich", manual: "Manuell", unknown: "Bei Stripe prüfen" };
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
            if (mounted.current && ticket === generation.current) setResource({ summary: null, loading: false, error: "Deine Zahlungsübersicht konnte gerade nicht bestätigt werden." });
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
        void Promise.resolve().then(refresh);
        return () => { mounted.current = false; invalidate(); subscription.unsubscribe(); };
    }, [ownerId, refresh, invalidate]);
    return { ...resource, summary: resource.summary?.ownerId === ownerId ? resource.summary : null, refresh };
}

type ViewProps = Resource & { onRetry: () => void; compact?: boolean; busy?: boolean; onPayouts?: () => void; onFunds?: () => void };
function Amount({ value, className }: { value: number | null | undefined; className?: string }) {
    return <span className={className}>{value === null || value === undefined ? "—" : money.format(value / 100)}</span>;
}

export function RecipientOverviewView({ summary, loading, error, onRetry, compact = false, busy = false, onPayouts, onFunds }: ViewProps) {
    const funds = summary?.funds;
    return <section className={`${styles.surface}${compact ? ` ${styles.compact}` : ""}`} aria-label={compact ? "Deine Vergütung mit Workfare Pay" : "Deine Zahlungsübersicht"} aria-busy={loading}>
        <div className={styles.heading}>
            <div className={styles.brand}><PayWordmark />{compact && summary && <PaymentEnvironment kind={summary.kind} compact className={styles.environment} />}</div>
            {compact ? <Link href="/app-home/settings/payments" className={`app-glass-control ${styles.open}`} aria-label="Workfare Pay öffnen"><ArrowUpRight size={19} aria-hidden="true" /></Link>
                : <button type="button" className={`app-glass-control ${styles.open}`} onClick={onRetry} disabled={loading || busy} aria-label="Zahlungsübersicht aktualisieren"><RefreshCw size={18} aria-hidden="true" /></button>}
        </div>
        {loading ? <div className={styles.pending} role="status"><span className={styles.loadingAmount}>—</span><span>Zahlungsübersicht wird geladen …</span></div>
            : error ? <div className={styles.failure}><p role="alert">{error}</p><button type="button" className={styles.textAction} onClick={onRetry} disabled={busy}>Erneut versuchen<ArrowRight size={15} aria-hidden="true" /></button></div>
            : summary ? <>
                <dl className={styles.numbers}>
                    <div className={styles.primary}><dt>{compact ? "Bestätigt verdient" : "Verfügbar"}</dt><dd><Amount value={compact ? summary.earnings.confirmedCents : funds?.availableCents} /></dd></div>
                    <div><dt>{compact ? "Verfügbar" : "In Bearbeitung"}</dt><dd><Amount value={compact ? funds?.availableCents : funds?.pendingCents} /></dd></div>
                    <div><dt>{compact ? "In Bearbeitung" : "Bestätigt verdient"}</dt><dd><Amount value={compact ? funds?.pendingCents : summary.earnings.confirmedCents} /></dd></div>
                    {!compact && <div><dt>Bereits ausgezahlt</dt><dd><Amount value={summary.payouts?.paidOutCents} /></dd></div>}
                </dl>
                <div className={styles.caption}>
                    <span>{summary.earnings.paidJobs === 1 ? "1 bezahlter Termin" : `${summary.earnings.paidJobs} bezahlte Termine`}</span>
                    <time dateTime={summary.checkedAt} title={`Stand: ${date.format(new Date(summary.checkedAt))}`}>Stand {checkedTime.format(new Date(summary.checkedAt))}</time>
                </div>
                {summary.earnings.underReviewCount > 0 && <p className={styles.notice}>{summary.earnings.underReviewCount === 1 ? "Ein Zahlungsvorgang wird" : `${summary.earnings.underReviewCount} Zahlungsvorgänge werden`} geprüft und {summary.earnings.underReviewCount === 1 ? "ist" : "sind"} im bestätigten Verdienst noch nicht enthalten.</p>}
                {!funds && <p className={styles.note}>{summary.fundsUnavailableReason === "minor_review_required" ? "Bankauszahlungen für Minderjährige sind noch nicht freigegeben."
                    : summary.fundsUnavailableReason === "local_simulation" ? "Diese Vorschau enthält kein Bankguthaben."
                    : summary.fundsUnavailableReason === "provider_unavailable" ? "Der aktuelle Stripe-Guthabenstand konnte nicht bestätigt werden." : "Dein Auszahlungsstand erscheint nach der Einrichtung."}</p>}
                {!compact && funds && !summary.payouts && summary.fundsUnavailableReason === "provider_unavailable" && <p className={styles.note}>Der Auszahlungsverlauf ist gerade nicht verfügbar.</p>}
                {!compact && <>
                    <div className={styles.actions}>
                        {onPayouts && funds && <button type="button" className={`app-glass-control ${styles.action}`} onClick={onPayouts} disabled={busy || !funds.stripePayoutsEnabled || !funds.hasPayoutMethod}><ArrowDownToLine size={17} aria-hidden="true" />Auszahlungen ansehen</button>}
                        {onFunds && funds && <button type="button" className={styles.textAction} onClick={onFunds} disabled={busy || !funds.stripePayoutsEnabled || !funds.hasPayoutMethod}>Guthaben bei Stripe<ArrowUpRight size={15} aria-hidden="true" /></button>}
                        {funds && <span className={styles.schedule}>Auszahlungsplan: {schedules[funds.schedule]}</span>}
                    </div>
                    <details className={styles.details}><summary>So setzt sich deine Übersicht zusammen<ChevronRight size={15} aria-hidden="true" /></summary><p>Der bestätigte Verdienst umfasst bezahlte Workfare-Aufträge. Erstattete und noch ungeklärte Vorgänge zählen nicht dazu. Verfügbar und in Bearbeitung sind Guthabenstände bei Stripe. Eine Bankauszahlung ist ein eigener Schritt.</p>{summary.payouts?.coverage === "recent_only" && <p>Die Auszahlungen zeigen die letzten Vorgänge. Den vollständigen Verlauf findest du bei Stripe.</p>}</details>
                    <PaymentHistory summary={summary} />
                </>}
            </> : null}
    </section>;
}

function PaymentHistory({ summary }: { summary: RecipientPaymentSummary }) {
    if (!summary.recentPayments.length && !summary.payouts?.recent.length) return <div className={styles.empty}><span>Dein erster Verdienst beginnt mit einem Job.</span><Link href="/app-home/jobs" className={styles.textAction}>Jobs entdecken<ArrowRight size={15} aria-hidden="true" /></Link></div>;
    return <div className={styles.history}>
        {summary.recentPayments.length > 0 && <><h3>Letzte Vorgänge</h3><ul>{summary.recentPayments.map(payment => <li key={payment.id}><Link href={`/app-home/activities?conversation=${payment.applicationId}`} className={styles.entry}>
            <span className={`app-glass-control ${styles.entryIcon}`} aria-hidden="true">{payment.state === "refunded" ? <ArrowUpRight size={18} /> : payment.state === "paid" ? <ArrowDownLeft size={18} /> : <FileText size={18} />}</span>
            <div className={styles.entryCopy}><strong>{payment.title}</strong><span>{states[payment.state]}<span aria-hidden="true"> · </span>{date.format(new Date(payment.updatedAt))}</span></div><span className={styles.entryAmount}><Amount value={payment.earningsCents} /></span>
        </Link></li>)}</ul></>}
        {!!summary.payouts?.recent.length && <><h3>Letzte Auszahlungen</h3><ul>{summary.payouts.recent.map(payout => <li key={payout.id} className={styles.entry}>
            <span className={`app-glass-control ${styles.entryIcon}`} aria-hidden="true"><ArrowDownToLine size={18} /></span><div className={styles.entryCopy}><strong>{payout.automatic ? "Automatische Bankauszahlung" : "Bankauszahlung"}</strong><span>{payoutStates[payout.status]}<span aria-hidden="true"> · </span>{date.format(new Date(payout.createdAt))}</span></div><span className={styles.entryAmount}><Amount value={payout.amountCents} /></span>
        </li>)}</ul></>}
    </div>;
}

export function RecipientOverview({ ownerId, kind, onPayouts, onFunds, busy = false }: { ownerId: string; kind?: PaymentSurfaceKind; onPayouts?: () => void; onFunds?: () => void; busy?: boolean }) {
    const resource = useRecipientSummary(ownerId, "full", kind);
    return <RecipientOverviewView {...resource} onRetry={() => void resource.refresh()} onPayouts={onPayouts} onFunds={onFunds} busy={busy} />;
}

export function RecipientPayHome({ ownerId }: { ownerId: string }) {
    const resource = useRecipientSummary(ownerId, "home");
    return <div className={styles.home}><RecipientOverviewView {...resource} compact onRetry={() => void resource.refresh()} /></div>;
}
