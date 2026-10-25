"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, Loader2, RefreshCw } from "lucide-react";
import type { GuardianFinanceSnapshot } from "@/lib/payments/guardian-finance-types";
import { validRecipientBankSummary } from "@/lib/payments/recipient-bank-summary";
import { paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "@/components/payments/usePaymentOwner";
import { PayWordmark } from "@/components/payments/PayWordmark";
import styles from "./Guardian.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = { pending: "In Vorbereitung", in_transit: "Unterwegs", paid: "Ausgezahlt", failed: "Fehlgeschlagen", canceled: "Storniert" };
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function validGuardianFinanceSnapshot(value: unknown, ownerId: string, childId: string): value is GuardianFinanceSnapshot {
    if (!uuid.test(ownerId) || !uuid.test(childId) || ownerId === childId || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.ownerId === ownerId && row.childId === childId && row.kind === "live" && row.currency === "eur"
        && Number.isSafeInteger(row.confirmedCents) && Number(row.confirmedCents) >= 0
        && [row.availableCents, row.pendingCents].every(amount => amount === null || Number.isSafeInteger(amount))
        && (row.paidOutCents === null || Number.isSafeInteger(row.paidOutCents) && Number(row.paidOutCents) >= 0)
        && (row.bank === null || validRecipientBankSummary(row.bank)) && typeof row.partial === "boolean" && timestamp(row.checkedAt)
        && Array.isArray(row.recentPayouts) && row.recentPayouts.length <= 5 && row.recentPayouts.every(value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const payout = value as Record<string, unknown>;
            return Number.isSafeInteger(payout.amountCents) && Number(payout.amountCents) >= 0
                && typeof payout.status === "string" && Object.hasOwn(states, payout.status) && timestamp(payout.createdAt) && timestamp(payout.arrivalAt);
        });
}

function failureMessage(failure: unknown) {
    if (failure instanceof PaymentRequestError && failure.code === "recipient_bank_setup_required") return "Dein Kind hinterlegt zuerst seine Bankverbindung im eigenen Workfare Pay.";
    if (failure instanceof PaymentRequestError && ["guardian_consent_required", "RECIPIENT_GUARDIAN_BINDING_MISMATCH"].includes(failure.code ?? "")) return "Prüfe bitte die aktuelle Elternfreigabe und die Zuordnung der Auszahlungseinrichtung.";
    return "Die Zahlungsübersicht konnte gerade nicht geladen werden.";
}

export function GuardianFinanceOverview({ ownerId, childId }: { ownerId: string; childId: string }) {
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const [snapshot, setSnapshot] = useState<GuardianFinanceSnapshot | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState<string | null>(null);
    const mounted = useRef(false), locked = useRef(false), generation = useRef(0);
    const load = useCallback(async () => {
        if (!mounted.current || locked.current || !isCurrentOwner()) return;
        locked.current = true; setBusy(true); setError(null); setSnapshot(null);
        const ticket = ++generation.current;
        try {
            const result = await paymentRequest<unknown>(`/api/payments/guardian/finances?childId=${encodeURIComponent(childId)}`, undefined, undefined, ownerId);
            if (!mounted.current || ticket !== generation.current || !isCurrentOwner()) return;
            if (!validGuardianFinanceSnapshot(result, ownerId, childId)) throw new Error("guardian_finance_unconfirmed");
            setSnapshot(result);
        } catch (failure) { if (mounted.current && ticket === generation.current && isCurrentOwner()) setError(failureMessage(failure)); }
        finally { if (mounted.current && ticket === generation.current) { locked.current = false; setBusy(false); } }
    }, [ownerId, childId, isCurrentOwner]);
    useEffect(() => { const lifecycle = generation; mounted.current = true; void Promise.resolve().then(load); return () => { mounted.current = false; ++lifecycle.current; }; }, [load]);
    if (ownerChanged) return <p role="alert" className={styles.error}>{PAYMENT_OWNER_CHANGED}</p>;
    return <GuardianFinanceView snapshot={snapshot?.ownerId === ownerId && snapshot.childId === childId ? snapshot : null} busy={busy} error={error} onRefresh={() => void load()} />;
}

export function GuardianFinanceView({ snapshot, busy, error, onRefresh }: { snapshot: GuardianFinanceSnapshot | null; busy: boolean; error: string | null; onRefresh: () => void }) {
    const amount = (cents: number | null | undefined) => cents === null || cents === undefined ? "—" : money.format(cents / 100);
    return <section className={`${styles.finance} ${styles.glass}`} aria-label="Zahlungsübersicht deines Kindes" aria-busy={busy}>
        <div className={styles.financeHeading}><h3><PayWordmark /></h3><button type="button" className={`${styles.iconButton} ${styles.glass}`} aria-label="Zahlungsübersicht aktualisieren" disabled={busy} onClick={onRefresh}><RefreshCw size={16} /></button></div>
        {busy ? <p role="status" className={styles.fieldHint}><Loader2 size={16} className={styles.spinner} /> Zahlungsübersicht wird geladen …</p> : error ? <p role="alert" className={styles.fieldHint}>{error}</p> : snapshot ? <>
            <dl className={styles.financeAmounts}><div className={styles.financePrimary}><dt>Insgesamt verdient</dt><dd>{amount(snapshot.confirmedCents)}</dd></div><div><dt>Bereits ausgezahlt</dt><dd>{amount(snapshot.paidOutCents)}</dd></div><div><dt>In Bearbeitung</dt><dd>{amount(snapshot.pendingCents)}</dd></div><div><dt>Für Auszahlung verfügbar</dt><dd>{amount(snapshot.availableCents)}</dd></div></dl>
            {snapshot.bank && <div className={styles.financeBank}><Landmark size={20} aria-hidden="true" /><div><strong>{snapshot.bank.bankName ?? "Bankkonto"}</strong><span>•••• {snapshot.bank.last4}</span></div></div>}
            {snapshot.partial && <p className={styles.fieldHint}>Einzelne Auszahlungsdaten sind noch nicht verfügbar. Prüfe die Einrichtung oder lade den Stand später erneut.</p>}
            {snapshot.recentPayouts.length > 0 && <div><h4 className={styles.financeHistoryTitle}>Letzte Auszahlungen</h4><ul className={styles.financeHistory}>{snapshot.recentPayouts.map((payout, index) => <li key={`${payout.createdAt}:${index}`}><span>{states[payout.status]}<small>{day.format(new Date(payout.createdAt))}</small></span><strong>{amount(payout.amountCents)}</strong></li>)}</ul></div>}
            <p className={styles.fieldHint}>Du kannst die Übersicht ansehen. Bankverbindung und Auszahlung verwaltet dein Kind.</p>
        </> : null}
    </section>;
}
