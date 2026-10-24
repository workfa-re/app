"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Stripe, StripeElementStyle, StripeIbanElement } from "@stripe/stripe-js";
import { ArrowRight, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import { InitialBankAttempt } from "./bank-iban-attempt";
import { paymentErrorMessage } from "./payment-client";
import { stripeKeyMatchesKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";
import bankStyles from "./MinorPayoutSetup.module.css";

function elementStyle(dark: boolean): StripeElementStyle {
    return { base: { color: dark ? "#f5f5f5" : "#202020", fontFamily: "Inter, Arial, sans-serif", fontSize: "16px", lineHeight: "24px",
        iconColor: dark ? "#d5d5d5" : "#686868", "::placeholder": { color: dark ? "#a3a3a3" : "#737373" } }, invalid: { color: dark ? "#f4aaaa" : "#a52a2a" } };
}

/** Only Stripe's iframe ever receives the IBAN. No app input or state holds it. */
export default function BankIbanForm({ publishableKey, holderName, needsRestart, accepted, onAccepted, isCurrentOwner, onSave, disabled = false }: {
    publishableKey: string; holderName: string; needsRestart: boolean; accepted: boolean; onAccepted: (accepted: boolean) => void;
    isCurrentOwner: () => boolean; onSave: (token: string) => Promise<void>; disabled?: boolean;
}) {
    const id = useId(), { resolvedTheme } = useTheme();
    const target = useRef<HTMLDivElement | null>(null), stripe = useRef<Stripe | null>(null), iban = useRef<StripeIbanElement | null>(null);
    const attempt = useRef<InitialBankAttempt | null>(null), mounted = useRef(false), dark = useRef(resolvedTheme === "dark");
    const initialDisabled = useRef(disabled);
    const [name, setName] = useState(holderName), [ready, setReady] = useState(false), [complete, setComplete] = useState(false);
    const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), [loadError, setLoadError] = useState(false);
    const [error, setError] = useState<string | null>(null), [hasToken, setHasToken] = useState(false);

    useEffect(() => {
        mounted.current = true;
        let alive = true, timedOut = false;
        const timer = setTimeout(() => {
            if (!alive || !isCurrentOwner()) return;
            timedOut = true; iban.current?.destroy(); iban.current = null; stripe.current = null;
            setLoadError(true); setError("Das sichere Bankfeld ist noch nicht erreichbar. Bitte lade es erneut.");
        }, 15_000);
        attempt.current = new InitialBankAttempt();
        const activeAttempt = attempt.current;
        async function load() {
            try {
                if (!stripeKeyMatchesKind("live", publishableKey) || !isCurrentOwner()) throw new Error("bank_unavailable");
                const { loadStripe } = await import("@stripe/stripe-js");
                if (!alive || timedOut || !isCurrentOwner()) return;
                const sdk = await loadStripe(publishableKey, { locale: "de" });
                if (!alive || timedOut || !isCurrentOwner()) return;
                if (!sdk || !target.current) throw new Error("bank_unavailable");
                stripe.current = sdk;
                const element = sdk.elements({ locale: "de" }).create("iban", { supportedCountries: ["SEPA"], placeholderCountry: "DE", style: elementStyle(dark.current), disabled: initialDisabled.current });
                iban.current = element;
                element.on("ready", () => { if (alive && !timedOut && isCurrentOwner()) { clearTimeout(timer); setReady(true); } });
                element.on("change", event => {
                    if (!alive || !isCurrentOwner()) return;
                    setComplete(event.complete); setError(event.error?.message || null);
                });
                element.mount(target.current);
            } catch {
                clearTimeout(timer);
                if (alive && isCurrentOwner()) { setLoadError(true); setError("Das sichere Bankfeld konnte nicht geladen werden."); }
            }
        }
        void load();
        return () => {
            alive = false; mounted.current = false; clearTimeout(timer); activeAttempt.dispose();
            iban.current?.destroy(); iban.current = null; stripe.current = null;
        };
    }, [publishableKey, retry, isCurrentOwner]);

    useEffect(() => { dark.current = resolvedTheme === "dark"; iban.current?.update({ style: elementStyle(dark.current) }); }, [resolvedTheme]);
    useEffect(() => { initialDisabled.current = busy || disabled || hasToken; iban.current?.update({ disabled: initialDisabled.current }); }, [busy, disabled, hasToken]);

    async function save() {
        const sdk = stripe.current, element = iban.current, active = attempt.current;
        if (!sdk || !element || !active || !accepted || !complete || busy || disabled || !isCurrentOwner()) return;
        setBusy(true); setError(null);
        try { await active.save({ stripe: sdk, iban: element, holderName: name, isCurrentOwner, onSave }); }
        catch (failure) { if (mounted.current && isCurrentOwner()) { setError(paymentErrorMessage(failure)); setHasToken(active.hasToken); } }
        finally { if (mounted.current && isCurrentOwner()) setBusy(false); }
    }

    return <form className={bankStyles.bankFields} onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className={bankStyles.field} htmlFor={`${id}-holder`}>Kontoinhaber<input id={`${id}-holder`} autoComplete="name" value={name} maxLength={200} disabled={busy || disabled || hasToken} onChange={event => setName(event.target.value)} /></label>
        <div className={bankStyles.field}><label htmlFor={`${id}-iban`}>IBAN</label><div id={`${id}-iban`} ref={target} className={bankStyles.iban} aria-label="IBAN – sicherer Bereich von Stripe" aria-describedby={`${id}-privacy`} aria-busy={!ready && !loadError} />{!ready && !loadError && <p role="status" className={bankStyles.fieldStatus}><Loader2 size={14} className={styles.spinner} />Sicheres Bankfeld wird geladen …</p>}</div>
        <p id={`${id}-privacy`} className={bankStyles.privacy}><LockKeyhole size={14} aria-hidden="true" />Deine Bankdaten werden direkt an Stripe übertragen.</p>
        <label className={styles.consent} htmlFor={`${id}-consent`}><input id={`${id}-consent`} type="checkbox" checked={accepted} required disabled={busy || disabled || hasToken} onChange={event => onAccepted(event.target.checked)} /><span>{needsRestart ? "Ich möchte die ungenutzte Einrichtung neu beginnen und diese Bankverbindung für meine Auszahlungen hinterlegen." : "Ich möchte diese Bankverbindung für meine Auszahlungen hinterlegen."}</span></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {loadError ? <button type="button" className={`app-glass-control ${styles.action}`} onClick={() => { setLoadError(false); setError(null); setReady(false); setRetry(value => value + 1); }}><RefreshCw size={17} />Bankfeld neu laden</button>
            : <button type="submit" className={`app-glass-control ${styles.action}`} disabled={!ready || !complete || !name.trim() || !accepted || busy || disabled}>{busy ? <Loader2 size={17} className={styles.spinner} /> : <ArrowRight size={17} />}{hasToken ? "Speichern erneut bestätigen" : "Bankverbindung speichern"}</button>}
    </form>;
}
