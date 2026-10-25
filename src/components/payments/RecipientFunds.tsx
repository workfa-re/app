"use client";

import { useId, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, RefreshCw, Wallet } from "lucide-react";
import type { RecipientPayoutOverview } from "@/lib/payments/recipient-types";
import { validRecipientBankSummary } from "@/lib/payments/recipient-bank-summary";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import { isStripeSurfaceKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const schedules = { daily: "Täglich", weekly: "Wöchentlich", monthly: "Monatlich", manual: "Manuell", unknown: "Bei Stripe prüfen" };
export function validRecipientFunds(value: unknown): value is RecipientPayoutOverview {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<RecipientPayoutOverview>;
    return isStripeSurfaceKind(row.kind) && row.currency === "eur" && Number.isSafeInteger(row.availableCents) && Number.isSafeInteger(row.pendingCents)
        && typeof row.schedule === "string" && Object.hasOwn(schedules, row.schedule)
        && row.canRequestPayout === false && row.canRetainBalance === false && row.maxHoldingDays === 90
        && ["retention_monitor_required", "recipient_setup_required", "currency_not_supported"].includes(row.disabledReason ?? "")
        && typeof row.stripePayoutsEnabled === "boolean" && typeof row.hasPayoutMethod === "boolean"
        && (row.bank === undefined || row.bank === null || validRecipientBankSummary(row.bank))
        && (row.pendingAvailableAt === undefined || row.pendingAvailableAt === null || typeof row.pendingAvailableAt === "string" && Number.isFinite(Date.parse(row.pendingAvailableAt)))
        && typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt));
}

export function RecipientFundsView({ snapshot, loading, error, onRetry, onDetails, onHistory }: {
    snapshot: RecipientPayoutOverview | null; loading: boolean; error: string | null;
    onRetry: () => void; onDetails: () => void; onHistory: () => void;
}) {
    const hintId = useId();
    if (loading) return <p className={styles.loading} role="status">Guthaben wird bei Stripe geprüft …</p>;
    if (error) return <div className={styles.embedRecovery}><p role="alert">{error}</p><button type="button" className={styles.textAction} onClick={onRetry}>Erneut versuchen</button></div>;
    if (!snapshot) return null;
    return <div>
        <div className={styles.fundsHeading}><span>Bei Stripe</span><button type="button" className={styles.iconButton} aria-label="Guthaben aktualisieren" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /></button></div>
        <dl className={styles.fundsAmounts}>
            <div><dt>Verfügbar</dt><dd>{money.format(snapshot.availableCents / 100)}</dd></div>
            <div><dt>Vorgemerkt</dt><dd>{money.format(snapshot.pendingCents / 100)}</dd></div>
        </dl>
        <p id={hintId} className={styles.fundsHint}>Vorgemerkte Beträge sind noch nicht verfügbar. Ein Stripe-Guthaben ist noch kein Zahlungseingang auf deinem Bankkonto.</p>
        <div className={styles.fundsSchedule}><span>Auszahlungsplan</span><strong>{schedules[snapshot.schedule]}</strong></div>
        {(!snapshot.stripePayoutsEnabled || !snapshot.hasPayoutMethod) && <p className={styles.notice}>Deine Bankauszahlung ist noch nicht bereit. Bitte prüfe deine Auszahlungsdaten.</p>}
        <div className={styles.editorActions}>
            <button type="button" className={`app-glass-control ${styles.action}`} onClick={onHistory}><ArrowDownToLine size={16} aria-hidden="true" />Auszahlungen ansehen</button>
            <button type="button" className={styles.quietButton} onClick={onDetails}>Details bei Stripe<ArrowRight size={15} aria-hidden="true" /></button>
        </div>
        <p className={styles.fundsHint}>Eigene Auszahlungsbeträge und das längere Halten von Guthaben sind noch nicht verfügbar.</p>
    </div>;
}

/** Financial reads start only when the owner opens this region. */
export function RecipientFunds({ onDetails, onHistory }: { onDetails: () => void; onHistory: () => void }) {
    const [snapshot, setSnapshot] = useState<RecipientPayoutOverview | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loading = useRef(false);
    async function load() {
        if (loading.current) return;
        loading.current = true; setPending(true); setError(null);
        try {
            const value = await paymentRequest<unknown>("/api/payments/recipient/payouts");
            if (!validRecipientFunds(value)) throw new Error("funds_unconfirmed");
            setSnapshot(value);
        } catch (failure) { setSnapshot(null); setError(paymentErrorMessage(failure)); }
        finally { loading.current = false; setPending(false); }
    }
    return <details className={`${styles.surface} ${styles.funds}`} aria-label="Guthaben und Auszahlungen" onToggle={event => { if (event.currentTarget.open && !snapshot && !loading.current) void load(); }}>
        <summary className={styles.settingsRow}><span className={`app-glass-control ${styles.rowIcon}`} aria-hidden="true"><Wallet size={21} /></span><span>Guthaben &amp; Auszahlungen</span><ArrowRight size={17} className={styles.rowArrow} aria-hidden="true" /></summary>
        <div className={styles.fundsBody}><RecipientFundsView snapshot={snapshot} loading={pending} error={error} onRetry={() => void load()} onDetails={onDetails} onHistory={onHistory} /></div>
    </details>;
}
