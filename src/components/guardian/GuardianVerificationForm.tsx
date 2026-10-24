"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { paymentErrorMessage, paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "@/components/payments/usePaymentOwner";
import styles from "./Guardian.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const string = (value: unknown, max = 200): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export type VerificationAddress = { line1: string; postalCode: string; city: string; country: "DE" };
export type GuardianVerificationContext = {
    ownerId: string; childId: string; kind: "live"; childName: string; guardianName: string; guardianBirthdate: string; childBirthdate: string;
    guardianGivenName: string | null; guardianSurname: string | null; childGivenName: string | null; childSurname: string | null;
    guardianAddress: VerificationAddress | null; childAddress: VerificationAddress | null; childSameAddress: boolean;
    guardianAddressRequired: boolean; childAddressRequired: boolean;
    canSubmit: boolean; needsAdditionalVerification: boolean; requirements: string[]; ready: boolean;
};
export type GuardianVerificationInput = {
    guardian: { givenName: string; surname: string; address?: VerificationAddress };
    child: { givenName: string; surname: string; address?: VerificationAddress };
};
const blankAddress = (): VerificationAddress => ({ line1: "", postalCode: "", city: "", country: "DE" });
function validDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validAddress(value: unknown): value is VerificationAddress {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const address = value as Record<string, unknown>;
    return address.country === "DE" && string(address.line1) && string(address.postalCode, 20) && string(address.city);
}
export function validGuardianVerificationContext(value: unknown, ownerId: string, childId: string): value is GuardianVerificationContext {
    if (!UUID.test(ownerId) || !UUID.test(childId) || ownerId === childId || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.ownerId === ownerId && row.childId === childId && row.kind === "live" && string(row.childName) && !!row.childName.trim()
        && string(row.guardianName) && !!row.guardianName.trim()
        && [row.guardianBirthdate, row.childBirthdate].every(validDate)
        && [row.guardianGivenName, row.guardianSurname, row.childGivenName, row.childSurname].every(name => name === null || string(name))
        && (row.guardianAddress === null || validAddress(row.guardianAddress)) && (row.childAddress === null || validAddress(row.childAddress))
        && [row.childSameAddress, row.guardianAddressRequired, row.childAddressRequired, row.canSubmit, row.needsAdditionalVerification, row.ready].every(flag => typeof flag === "boolean")
        && !(row.ready && (row.canSubmit || row.needsAdditionalVerification))
        && Array.isArray(row.requirements) && row.requirements.length <= 100 && row.requirements.every(requirement => string(requirement, 500));
}
function contextError(error: unknown) {
    if (error instanceof PaymentRequestError) {
        if (error.code === "recipient_bank_setup_required") return "Dein Kind hinterlegt zuerst seine Bankverbindung im eigenen Workfare Pay. Danach kannst du die Auszahlung hier freigeben.";
        if (error.code === "guardian_profile_correction_required") return "Für die Auszahlung benötigen wir eure vollständigen Namen. Bitte kontaktiere den Support, damit die Angaben sicher korrigiert werden.";
        if (error.code === "invalid_guardian_details") return "Bitte prüfe die Namen und Anschriften. Die Namen müssen mit euren Workfare-Profilen übereinstimmen.";
        if (error.code === "explicit_consent_required") return "Bitte bestätige die Zahlungsbedingungen für dein Kind, bevor du fortfährst.";
        if (error.code === "recipient_address_required") return "Bitte ergänze die erforderliche Wohnanschrift und bestätige die Angaben erneut.";
        if (["recipient_additional_verification_required", "guardian_native_remediation_required"].includes(error.code ?? "")) return "Für die Auszahlung fehlen weitere Angaben. Bitte prüfe den aktuellen Stand.";
    }
    return paymentErrorMessage(error);
}

export function GuardianVerificationForm({ ownerId, childId, onClose, onUpdated, onAdditionalVerification }: {
    ownerId: string; childId: string; onClose: () => void; onUpdated: () => Promise<void> | void; onAdditionalVerification: () => void;
}) {
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const [context, setContext] = useState<GuardianVerificationContext | null>(null), [busy, setBusy] = useState(true);
    const [error, setError] = useState<string | null>(null), [submitted, setSubmitted] = useState(false), [revision, setRevision] = useState(0), [retryLocked, setRetryLocked] = useState(false), [canReloadError, setCanReloadError] = useState(true);
    const mounted = useRef(false), locked = useRef(false), generation = useRef(0);
    const attempt = useRef<{ id: string; input: GuardianVerificationInput } | null>(null);
    const current = useCallback((ticket: number) => mounted.current && generation.current === ticket && isCurrentOwner(), [isCurrentOwner]);
    const load = useCallback(async () => {
        if (locked.current || !mounted.current || !isCurrentOwner()) return;
        locked.current = true; const ticket = ++generation.current; setBusy(true); setError(null); setCanReloadError(true);
        try {
            const result = await paymentRequest<unknown>(`/api/payments/guardian/verification?childId=${encodeURIComponent(childId)}`, undefined, undefined, ownerId);
            if (!current(ticket)) return;
            if (!validGuardianVerificationContext(result, ownerId, childId)) throw new Error("unconfirmed_verification_context");
            setContext(result); attempt.current = null; setRetryLocked(false); setRevision(value => value + 1);
        } catch (failure) { if (current(ticket)) { setContext(null); setCanReloadError(!(failure instanceof PaymentRequestError && failure.code === "guardian_profile_correction_required")); setError(contextError(failure)); } }
        finally { if (current(ticket)) { locked.current = false; setBusy(false); } }
    }, [childId, ownerId, current, isCurrentOwner]);
    useEffect(() => {
        const lifecycleGeneration = generation;
        mounted.current = true; void Promise.resolve().then(load);
        return () => { mounted.current = false; ++lifecycleGeneration.current; attempt.current = null; };
    }, [load]);
    async function save(input: GuardianVerificationInput) {
        if (!context?.canSubmit || !isCurrentOwner() || locked.current) return;
        locked.current = true; const ticket = ++generation.current; setBusy(true); setError(null); setCanReloadError(true);
        // Keep the exact operation and payload after a lost response. No identity
        // information is placed in browser storage or passed through a URL.
        if (!attempt.current) attempt.current = { id: crypto.randomUUID(), input };
        setRetryLocked(true);
        const operation = attempt.current;
        try {
            const result = await paymentRequest<unknown>("/api/payments/guardian/verification", { childId, consent: true, ...operation.input }, operation.id, ownerId);
            if (!current(ticket)) return;
            if (!validGuardianVerificationContext(result, ownerId, childId)) throw new Error("unconfirmed_verification_context");
            attempt.current = null; setRetryLocked(false); setContext(result); setSubmitted(true); setRevision(value => value + 1);
            await onUpdated();
        } catch (failure) { if (current(ticket)) {
            if (failure instanceof PaymentRequestError && ["invalid_request", "invalid_guardian_details", "explicit_consent_required", "recipient_address_required", "recipient_identity_mismatch", "guardian_identity_mismatch"].includes(failure.code ?? "")) { attempt.current = null; setRetryLocked(false); }
            if (failure instanceof PaymentRequestError && failure.code === "guardian_profile_correction_required") { setContext(null); attempt.current = null; setRetryLocked(false); }
            setCanReloadError(!(failure instanceof PaymentRequestError && failure.code === "guardian_profile_correction_required"));
            setError(contextError(failure));
        } }
        finally { if (current(ticket)) { locked.current = false; setBusy(false); } }
    }
    if (ownerChanged) return <p role="alert" className={styles.error}>{PAYMENT_OWNER_CHANGED}</p>;
    const visibleContext = context?.ownerId === ownerId && context.childId === childId ? context : null;
    return <section className={styles.nativeVerification} aria-labelledby="guardian-verification-heading" aria-busy={busy}>
        <div className={styles.verificationHeading}><div><span className={styles.verificationEyebrow}>Workfare Pay</span><h3 id="guardian-verification-heading">Auszahlung freigeben</h3></div><button type="button" className={`${styles.iconButton} ${styles.glass}`} aria-label="Freigabe schließen" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        {!visibleContext && busy && <p role="status" className={styles.fieldHint}><Loader2 size={16} className={styles.spinner} /> Angaben werden geladen …</p>}
        {visibleContext && <GuardianVerificationView key={`${ownerId}:${childId}:${revision}`} context={visibleContext} busy={busy} submitted={submitted} retryLocked={retryLocked} onSave={input => void save(input)} onAdditionalVerification={onAdditionalVerification} />}
        {error && <GuardianVerificationError message={error} busy={busy} canReload={canReloadError} onReload={() => void load()} />}
        {!visibleContext && !busy && !error && <button type="button" className={styles.quiet} onClick={() => void load()}><RefreshCw size={16} />Stand erneut laden</button>}
    </section>;
}

/** A failed submission can already have changed Stripe requirements. Read the
 * authoritative state before offering a new operation or targeted remediation. */
export function GuardianVerificationError({ message, busy, canReload = true, onReload }: { message: string; busy: boolean; canReload?: boolean; onReload: () => void }) {
    return <div className={styles.stack}><p role="alert" className={styles.error}>{message}</p>{canReload && <button type="button" className={styles.quiet} disabled={busy} onClick={onReload}><RefreshCw size={16} />Aktuellen Stand laden</button>}</div>;
}

export function GuardianVerificationView({ context, busy, submitted, retryLocked = false, onSave, onAdditionalVerification }: {
    context: GuardianVerificationContext; busy: boolean; submitted: boolean; retryLocked?: boolean;
    onSave: (input: GuardianVerificationInput) => void; onAdditionalVerification: () => void;
}) {
    const id = useId();
    const [guardianGivenName, setGuardianGivenName] = useState(context.guardianGivenName ?? nameParts(context.guardianName)[0]), [guardianSurname, setGuardianSurname] = useState(context.guardianSurname ?? nameParts(context.guardianName)[1]);
    const [childGivenName, setChildGivenName] = useState(context.childGivenName ?? nameParts(context.childName)[0]), [childSurname, setChildSurname] = useState(context.childSurname ?? nameParts(context.childName)[1]);
    const [guardianAddress, setGuardianAddress] = useState(context.guardianAddress ?? blankAddress()), [childAddress, setChildAddress] = useState(context.childAddress ?? blankAddress());
    const sharedAddressAvailable = context.guardianAddressRequired && context.childAddressRequired;
    const [sameAddress, setSameAddress] = useState(sharedAddressAvailable && context.childSameAddress), [accepted, setAccepted] = useState(false);
    const disabled = busy || retryLocked;
    const complete = [guardianGivenName, guardianSurname, childGivenName, childSurname].every(value => value.trim().length > 0)
        && [context.guardianAddressRequired ? guardianAddress : null, context.childAddressRequired ? sameAddress ? guardianAddress : childAddress : null].every(address => !address || address.line1.trim() && /^\d{5}$/.test(address.postalCode) && address.city.trim());
    if (context.ready) return <div className={styles.success}><Check size={24} aria-hidden="true" /><p>Die Auszahlung für {context.childName} ist eingerichtet.</p></div>;
    if (context.needsAdditionalVerification && !context.canSubmit) return <div className={styles.stack}><p className={styles.fieldHint}>Für {context.childName} wird noch eine zusätzliche Prüfung benötigt. Deine Elternfreigabe bleibt gespeichert.</p><button type="button" className={`${styles.action} ${styles.glass}`} disabled={busy} onClick={onAdditionalVerification}>Zusätzliche Prüfung<ArrowRight size={17} /></button></div>;
    if (submitted && !context.canSubmit) return <div className={styles.success}><ShieldCheck size={24} aria-hidden="true" /><p>Deine Angaben wurden übermittelt. Die Auszahlung wird freigegeben, sobald alle erforderlichen Prüfungen abgeschlossen sind.</p>{context.needsAdditionalVerification && <button type="button" className={`${styles.action} ${styles.glass}`} disabled={busy} onClick={onAdditionalVerification}>Zusätzliche Prüfung<ArrowRight size={17} /></button>}</div>;
    if (!context.canSubmit) return <p className={styles.fieldHint}>Die Angaben werden geprüft. Die Elternfreigabe bleibt gespeichert.</p>;
    return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (accepted && complete && !busy) onSave({ guardian: { givenName: guardianGivenName.trim(), surname: guardianSurname.trim(), ...(context.guardianAddressRequired ? { address: guardianAddress } : {}) }, child: { givenName: childGivenName.trim(), surname: childSurname.trim(), ...(context.childAddressRequired ? { address: sameAddress ? guardianAddress : childAddress } : {}) } }); }}>
        {submitted && <p role="status" className={styles.fieldHint}>Deine Angaben wurden gespeichert. Bitte ergänze noch die folgenden erforderlichen Angaben.</p>}
        <p className={styles.fieldHint}>Bestätige deine Angaben als gesetzliche Vertretung von {context.childName}. Ein eigener Stripe-Zugang ist nicht nötig.</p>
        <details className={styles.verificationPerson} open={!guardianGivenName || !guardianSurname}><summary><span><strong>{context.guardianName}</strong><span>Gesetzliche Vertretung · {formatDate(context.guardianBirthdate)}</span></span><ChevronRight size={17} aria-hidden="true" /></summary><div className={styles.verificationGrid}><NameField id={`${id}-guardian-first`} label="Dein Vorname" value={guardianGivenName} disabled={disabled} onChange={setGuardianGivenName} /><NameField id={`${id}-guardian-last`} label="Dein Nachname" value={guardianSurname} disabled={disabled} onChange={setGuardianSurname} /></div></details>
        {context.guardianAddressRequired && <AddressFields id={`${id}-guardian`} title="Deine Wohnanschrift" address={guardianAddress} disabled={disabled} onChange={setGuardianAddress} />}
        <details className={styles.verificationPerson} open={!childGivenName || !childSurname}><summary><span><strong>{context.childName}</strong><span>Dein Kind · {formatDate(context.childBirthdate)}</span></span><ChevronRight size={17} aria-hidden="true" /></summary><div className={styles.verificationGrid}><NameField id={`${id}-child-first`} label="Vorname deines Kindes" value={childGivenName} disabled={disabled} onChange={setChildGivenName} /><NameField id={`${id}-child-last`} label="Nachname deines Kindes" value={childSurname} disabled={disabled} onChange={setChildSurname} /></div></details>
        {sharedAddressAvailable && <label className={styles.consent}><input type="checkbox" checked={sameAddress} disabled={disabled} onChange={event => { setSameAddress(event.target.checked); setAccepted(false); }} /><span>Mein Kind wohnt an derselben Adresse.</span></label>}
        {context.childAddressRequired && !sameAddress && <AddressFields id={`${id}-child`} title="Wohnanschrift deines Kindes" address={childAddress} disabled={disabled} onChange={setChildAddress} />}
        <p className={styles.fieldHint}>Stripe verarbeitet die erforderlichen Angaben für Prüfung und Auszahlung. Die Bankverbindung ergänzt dein Kind selbst.</p>
        <label className={styles.consent}><input type="checkbox" checked={accepted} required disabled={disabled} onChange={event => setAccepted(event.target.checked)} /><span>Ich bestätige die Angaben und stimme als gesetzliche Vertretung für {context.childName} der <a href="https://stripe.com/connect-account/legal/full" target="_blank" rel="noreferrer">Stripe-Vereinbarung</a> zu. Ich habe die <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">Datenschutzhinweise</a> gelesen.</span></label>
        <div className={styles.actions}><button type="submit" className={`${styles.action} ${styles.glass}`} disabled={!accepted || !complete || busy}>{busy ? <Loader2 size={17} className={styles.spinner} /> : <ShieldCheck size={17} />}{busy ? "Wird übermittelt …" : retryLocked ? "Übermittlung erneut bestätigen" : "Angaben bestätigen"}</button></div>
    </form>;
}
function nameParts(name: string): [string, string] { const [first, ...rest] = name.trim().split(/\s+/); return [first ?? "", rest.join(" ")]; }
function formatDate(date: string) { return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function NameField({ id, label, value, disabled, onChange }: { id: string; label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
    return <label htmlFor={id} className={styles.field}>{label}<input id={id} value={value} maxLength={200} required disabled={disabled} autoComplete="off" onChange={event => onChange(event.target.value)} /></label>;
}
function AddressFields({ id, title, address, disabled, onChange }: { id: string; title: string; address: VerificationAddress; disabled: boolean; onChange: (value: VerificationAddress) => void }) {
    return <fieldset className={styles.verificationAddress} disabled={disabled}><legend>{title}</legend><label className={styles.field} htmlFor={`${id}-street`}>Straße und Hausnummer<input id={`${id}-street`} autoComplete="off" required maxLength={200} value={address.line1} onChange={event => onChange({ ...address, line1: event.target.value })} /></label><div className={styles.verificationGrid}><label className={styles.field} htmlFor={`${id}-postal`}>Postleitzahl<input id={`${id}-postal`} inputMode="numeric" autoComplete="off" required pattern="[0-9]{5}" maxLength={5} value={address.postalCode} onChange={event => onChange({ ...address, postalCode: event.target.value })} /></label><label className={styles.field} htmlFor={`${id}-city`}>Ort<input id={`${id}-city`} autoComplete="off" required maxLength={200} value={address.city} onChange={event => onChange({ ...address, city: event.target.value })} /></label></div><p className={styles.fieldHint}>Deutschland</p></fieldset>;
}
