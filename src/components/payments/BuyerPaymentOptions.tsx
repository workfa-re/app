"use client";

import { useRef, useState } from "react";
import type { BuyerPaymentMethods } from "@/lib/payments/method-capabilities";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import styles from "./Payments.module.css";

export function validBuyerPaymentMethods(value: unknown): value is BuyerPaymentMethods {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<BuyerPaymentMethods>;
    if (row.version !== "buyer-methods-v1" || typeof row.kind !== "string" || !["local", "sandbox", "live"].includes(row.kind)
        || row.livePaymentsEnabled !== (row.kind === "live") || !Array.isArray(row.methods) || row.methods.length !== 2) return false;
    const [card, sepa] = row.methods;
    return card?.type === "card" && typeof card.setupEnabled === "boolean" && card.manualCaptureSupported === true && card.flow === "authorize_then_capture"
        && sepa?.type === "sepa_debit" && sepa.setupEnabled === false && sepa.availability === "not_available" && sepa.manualCaptureSupported === false
        && sepa.flow === "async_debit_after_service" && sepa.reasonCode === "sepa_async_collection_unavailable";
}

export function BuyerPaymentOptions() {
    const [methods, setMethods] = useState<BuyerPaymentMethods | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const loading = useRef(false);
    async function load() {
        if (loading.current) return;
        loading.current = true; setPending(true); setError(null);
        try {
            const result = await paymentRequest<unknown>("/api/payments/methods");
            if (!validBuyerPaymentMethods(result)) throw new Error("methods_unconfirmed");
            setMethods(result);
        } catch (failure) { setError(paymentErrorMessage(failure)); }
        finally { loading.current = false; setPending(false); }
    }
    return <details className={styles.embedHelp} onToggle={event => { if (event.currentTarget.open && !methods && !loading.current) void load(); }}>
        <summary>Zahlungsarten ansehen</summary>
        {pending ? <p role="status">Zahlungsarten werden geprüft …</p> : error ? <><p role="alert">{error}</p><button type="button" className={styles.textAction} onClick={() => void load()}>Erneut versuchen</button></>
            : methods && <dl className={styles.methodOptions}>
                <div><dt>Karte</dt><dd>{methods.kind === "local" ? "Nur lokale Simulation" : methods.methods[0].setupEnabled ? "Verfügbar" : "Für dieses Konto noch nicht freigeschaltet"}</dd></div>
                <div aria-disabled="true"><dt>SEPA-Lastschrift</dt><dd>Noch nicht verfügbar</dd><p>Ein Bankeinzug braucht einen eigenen Zahlungsablauf. Er bestätigt keine sofortige Zahlung.</p></div>
            </dl>}
    </details>;
}
