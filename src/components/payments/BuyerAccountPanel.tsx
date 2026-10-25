"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronRight, FileText, Loader2, RotateCw, UserRound } from "lucide-react";
import type { BuyerAccountSnapshot, BuyerBillingDetails, BuyerBillingInput, BuyerInvoiceEntry, BuyerPaymentEntry } from "@/lib/payments/buyer-account-types";
import type { PaymentSurfaceKind } from "./PaymentEnvironment";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Payments.module.css";
import account from "./BuyerAccount.module.css";

const PAYMENT_LABELS: Record<BuyerPaymentEntry["status"], string> = {
    pending: "In Bearbeitung", authorized: "Vorgemerkt", released: "Vormerkung aufgehoben", paid: "Bezahlt", partially_refunded: "Teilweise erstattet", refunded: "Erstattet", failed: "Fehlgeschlagen",
};
const INVOICE_LABELS: Record<BuyerInvoiceEntry["status"], string> = { open: "Offen", paid: "Bezahlt", uncollectible: "Nicht beglichen", void: "Storniert" };
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function changeBuyerAccountEmail(ownerId: string, email: string) {
    if (!UUID.test(ownerId)) throw new Error("Bitte melde dich erneut an.");
    const response = await fetch("/api/payments/account/email", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workfare-Owner": ownerId }, body: JSON.stringify({ email }) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        if (object(value) && value.code === "email_change_rate_limited") throw new Error("Bitte warte kurz, bevor du eine weitere Bestätigung anforderst.");
        if (object(value) && value.code === "account_email_family_review_required") throw new Error("Deine E-Mail ist mit einer Familienfreigabe verknüpft. Schließe zuerst die Auszahlungsfreigabe ab oder kontaktiere uns für eine sichere Änderung.");
        throw new Error("Die Änderung konnte nicht angefordert werden. Bitte versuche es später erneut.");
    }
    if (!object(value) || value.ownerId !== ownerId || !["unchanged", "pending", "changed"].includes(String(value.status))) throw new Error("Die Änderung konnte nicht bestätigt werden.");
    return value.status as "unchanged" | "pending" | "changed";
}

function BillingIdentity({ details, ownerId, disabled, isOwnerCurrent }: { details: BuyerBillingDetails | null; ownerId: string; disabled: boolean; isOwnerCurrent: () => boolean }) {
    const id = useId();
    const [editing, setEditing] = useState(false), [email, setEmail] = useState(""), [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
    const locked = useRef(false), mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (locked.current || disabled || !isOwnerCurrent()) return;
        locked.current = true; setPending(true); setError(null); setFeedback(null);
        try {
            const result = await changeBuyerAccountEmail(ownerId, email);
            if (!mounted.current || !isOwnerCurrent()) return;
            if (result === "changed") { window.location.reload(); return; }
            setEditing(false); setFeedback(result === "pending" ? "Bestätige die Änderung über die E-Mails von Workfare. Bis dahin bleibt deine bisherige Adresse gültig." : "Diese E-Mail-Adresse ist bereits mit deinem Konto verknüpft.");
        } catch (failure) { if (mounted.current && isOwnerCurrent()) setError(failure instanceof Error ? failure.message : "Bitte versuche es erneut."); }
        finally { locked.current = false; if (mounted.current) setPending(false); }
    }
    return <div className={account.linkedIdentity}>
        <div className={account.linkedField}><span>Name</span><strong>{details?.name || "Dein Profilname"}</strong><small>Mit deinem Workfare-Profil verknüpft.</small></div>
        <div className={account.linkedField}><div className={account.linkedFieldHeading}><span>E-Mail</span><button type="button" className={styles.textAction} disabled={disabled || pending} onClick={() => { setEmail(details?.email ?? ""); setEditing(value => !value); setFeedback(null); setError(null); }}>Ändern</button></div><strong>{details?.email || "Deine Konto-E-Mail"}</strong><small>Mit deinem Workfare-Konto verknüpft. Nach Bestätigung wird sie auch für Zahlungen übernommen.</small></div>
        {editing && <form className={account.emailForm} onSubmit={submit}><label htmlFor={`${id}-email`}>Neue E-Mail-Adresse<input id={`${id}-email`} type="email" autoComplete="email" required maxLength={254} value={email} disabled={pending || disabled} onChange={event => setEmail(event.target.value)} /></label><div className={account.formActions}><button type="button" className={styles.textAction} disabled={pending} onClick={() => setEditing(false)}>Abbrechen</button><button type="submit" className={`app-glass-control ${styles.action}`} disabled={pending || disabled}>{pending ? <Loader2 size={16} className={account.spinner} /> : null}Bestätigung anfordern</button></div></form>}
        {feedback && <p role="status" className={account.identityFeedback}>{feedback}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
    </div>;
}

function billingResponse(value: unknown): value is BuyerBillingDetails {
    return object(value) && nullableText(value.name) && nullableText(value.email)
        && (value.address === null || (object(value.address) && ["line1", "line2", "postalCode", "city", "country"].every((key) => nullableText((value.address as Record<string, unknown>)[key]))));
}
function financialRecord(value: unknown) {
    return object(value) && typeof value.id === "string" && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
        && typeof value.currency === "string" && /^[a-z]{3}$/.test(value.currency) && Number.isSafeInteger(value.amountMinor) && nullableText(value.description);
}
export function overviewResponse(value: unknown, ownerId: string, kind?: PaymentSurfaceKind): value is BuyerAccountSnapshot {
    if (!UUID.test(ownerId) || !object(value) || (kind !== undefined && value.kind !== kind) || value.ownerId !== ownerId || typeof value.kind !== "string" || !["local", "sandbox", "live"].includes(value.kind) || typeof value.customerExists !== "boolean"
        || !object(value.billing) || typeof value.billing.available !== "boolean" || !(value.billing.details === null || billingResponse(value.billing.details))
        || !object(value.history) || !["local_simulation", "empty", "available"].includes(String(value.history.state))
        || !Array.isArray(value.history.payments) || !Array.isArray(value.history.invoices) || value.history.payments.length > 20 || value.history.invoices.length > 20
        || !object(value.history.hasMore) || typeof value.history.hasMore.payments !== "boolean" || typeof value.history.hasMore.invoices !== "boolean") return false;
    if ((value.kind === "local") !== (value.history.state === "local_simulation")) return false;
    return value.history.payments.every((entry: unknown) => financialRecord(entry) && object(entry) && Object.hasOwn(PAYMENT_LABELS, String(entry.status))
        && Number.isSafeInteger(entry.capturedAmountMinor) && Number.isSafeInteger(entry.refundedAmountMinor) && nullableText(entry.receiptUrl))
        && value.history.invoices.every((entry: unknown) => financialRecord(entry) && object(entry) && Object.hasOwn(INVOICE_LABELS, String(entry.status))
            && Number.isSafeInteger(entry.paidAmountMinor) && Number.isSafeInteger(entry.remainingAmountMinor) && nullableText(entry.number) && nullableText(entry.invoiceUrl) && nullableText(entry.pdfUrl));
}

export async function readBuyerAccountOverview(ownerId: string, signal?: AbortSignal, kind?: PaymentSurfaceKind): Promise<BuyerAccountSnapshot> {
    if (!UUID.test(ownerId)) throw new Error("Bitte öffne die Übersicht nach deiner Anmeldung erneut.");
    const response = await fetch("/api/payments/account", { credentials: "same-origin", cache: "no-store", signal, headers: { "X-Workfare-Owner": ownerId } });
    if (response.status === 401) throw new Error("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
    if (!response.ok) throw new Error("Die Zahlungsübersicht ist gerade nicht erreichbar.");
    const data: unknown = await response.json().catch(() => null);
    if (!overviewResponse(data, ownerId, kind)) throw new Error("Die Zahlungsübersicht konnte nicht vollständig geladen werden.");
    return data;
}

export async function saveBuyerAccountBilling(ownerId: string, input: BuyerBillingInput, operationId: string): Promise<BuyerBillingDetails> {
    if (!UUID.test(ownerId)) throw new Error("Bitte öffne die Übersicht nach deiner Anmeldung erneut.");
    const response = await fetch("/api/payments/account/billing", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "idempotency-key": operationId, "X-Workfare-Owner": ownerId }, body: JSON.stringify(input) });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401) throw new Error("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
        if (object(data) && data.code === "invalid_billing_details") throw new Error("Bitte prüfe deine Rechnungsdaten. Eine ergänzte Adresse muss vollständig sein.");
        if (object(data) && data.code === "billing_sync_unconfirmed") throw new Error("Workfare Pay konnte die Speicherung noch nicht bestätigen. Versuche es erneut; deine Eingaben bleiben erhalten.");
        throw new Error("Die Rechnungsdaten konnten nicht gespeichert werden. Deine Eingaben bleiben erhalten.");
    }
    if (!object(data) || data.ok !== true || data.ownerId !== ownerId || !billingResponse(data.billing)) throw new Error("Die Speicherung konnte nicht bestätigt werden. Bitte lade den aktuellen Stand erneut.");
    return data.billing;
}
function money(amountMinor: number, currency: string) {
    const formatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() });
    const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** decimals);
}
function safeDocument(value: string | null, kind: "receipt" | "invoice" | "pdf") {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return null;
        if (kind === "receipt" && url.hostname === "pay.stripe.com" && url.pathname.startsWith("/receipts/")) return url.href;
        if (kind === "invoice" && url.hostname === "invoice.stripe.com" && url.pathname.startsWith("/i/")) return url.href;
        if (kind === "pdf" && url.hostname === "pay.stripe.com" && /^\/invoice\/.+\/pdf$/.test(url.pathname)) return url.href;
    } catch { /* An unavailable link must not hide a payment. */ }
    return null;
}

function DocumentLink({ href, children, label }: { href: string | null; children: React.ReactNode; label: string }) {
    if (!href) return null;
    return <a className={`${styles.textAction} ${account.documentLink}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
        {children}<ArrowUpRight size={13} aria-hidden="true" />
    </a>;
}

function History({ snapshot }: { snapshot: BuyerAccountSnapshot }) {
    const { history } = snapshot;
    if (!history.payments.length && !history.invoices.length) return <div className={account.empty}>
        <p>{history.hasMore.payments || history.hasMore.invoices ? "Keine Zahlungen in diesem Ausschnitt." : "Noch keine Zahlung."}</p>
        {(history.hasMore.payments || history.hasMore.invoices) && <span>Angezeigt werden die letzten 20 Einträge je Bereich.</span>}
    </div>;
    return <div className={account.history}>
        {history.payments.length > 0 && <section aria-label="Zahlungsverlauf">
            {history.invoices.length > 0 && <h3 className={account.groupTitle}>Zahlungen</h3>}
            <ul className={account.entries}>{history.payments.map((entry) => {
                const receipt = ["paid", "partially_refunded", "refunded"].includes(entry.status) ? safeDocument(entry.receiptUrl, "receipt") : null;
                const amount = ["paid", "partially_refunded", "refunded"].includes(entry.status) ? entry.capturedAmountMinor : entry.amountMinor;
                return <li key={entry.id} className={account.entry}>
                    <div className={account.entryTitle}><span>{entry.description || "Zahlung"}</span><strong>{money(amount, entry.currency)}</strong></div>
                    <div className={account.entryMeta}>
                        <time dateTime={entry.createdAt}>{dateFormat.format(new Date(entry.createdAt))}</time>
                        <span>{PAYMENT_LABELS[entry.status]}</span>
                        {entry.status === "partially_refunded" && <span>{money(entry.refundedAmountMinor, entry.currency)} erstattet</span>}
                        <DocumentLink href={receipt} label={`Beleg zu ${entry.description || "deiner Zahlung"} öffnen`}>Beleg</DocumentLink>
                    </div>
                </li>;
            })}</ul>
        </section>}
        {history.invoices.length > 0 && <section aria-label="Rechnungen">
            <h3 className={account.groupTitle}>Rechnungen</h3>
            <ul className={account.entries}>{history.invoices.map((entry) => <li key={entry.id} className={account.entry}>
                <div className={account.entryTitle}><span>{entry.number ? `Rechnung ${entry.number}` : "Rechnung"}</span><strong>{money(entry.amountMinor, entry.currency)}</strong></div>
                <div className={account.entryMeta}>
                    <time dateTime={entry.createdAt}>{dateFormat.format(new Date(entry.createdAt))}</time>
                    <span>{INVOICE_LABELS[entry.status]}</span>
                    <DocumentLink href={safeDocument(entry.invoiceUrl, "invoice")} label={`Rechnung ${entry.number || "ansehen"} öffnen`}>Ansehen</DocumentLink>
                    <DocumentLink href={safeDocument(entry.pdfUrl, "pdf")} label={`Rechnung ${entry.number || ""} als PDF öffnen`}>PDF</DocumentLink>
                </div>
            </li>)}</ul>
        </section>}
        {(history.hasMore.payments || history.hasMore.invoices) && <p className={account.limited}>Angezeigt werden die letzten 20 Einträge je Bereich.</p>}
    </div>;
}

type BillingForm = { address: NonNullable<BuyerBillingInput["address"]> };
function initialBilling(details: BuyerBillingDetails | null): BillingForm {
    return { address: {
        line1: details?.address?.line1 ?? "", line2: details?.address?.line2 ?? "", postalCode: details?.address?.postalCode ?? "",
        city: details?.address?.city ?? "", country: "DE",
    } };
}
function Billing({ snapshot, onSaved, onSavingChange, onEditingChange, isOwnerCurrent }: { snapshot: BuyerAccountSnapshot; onSaved: (details: BuyerBillingDetails) => void; onSavingChange: (saving: boolean) => void; onEditingChange: (editing: boolean) => void; isOwnerCurrent: () => boolean }) {
    const fieldId = useId();
    const editRef = useRef<HTMLButtonElement>(null);
    const firstField = useRef<HTMLInputElement>(null);
    const busyRef = useRef(false);
    const mounted = useRef(false);
    const wasEditing = useRef(false);
    const saveOperation = useRef<{ input: string; id: string } | null>(null);
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState(() => initialBilling(snapshot.billing.details));
    const [addressAction, setAddressAction] = useState<"preserve" | "edit" | "remove">("preserve");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; onSavingChange(false); }; }, [onSavingChange]);
    useEffect(() => {
        onEditingChange(editing);
        return () => onEditingChange(false);
    }, [editing, onEditingChange]);
    useEffect(() => {
        if (editing) firstField.current?.focus();
        else if (wasEditing.current) editRef.current?.focus();
        wasEditing.current = editing;
    }, [editing, addressAction]);

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busyRef.current || !isOwnerCurrent()) return;
        busyRef.current = true;
        onSavingChange(true);
        setSaving(true); setError(null); setSaved(false);
        try {
            const payload: BuyerBillingInput = {
                ...(addressAction === "edit" ? { address: input.address } : addressAction === "remove" ? { address: null } : {}) };
            const serialized = JSON.stringify(payload);
            if (saveOperation.current?.input !== serialized) saveOperation.current = { input: serialized, id: crypto.randomUUID() };
            const billing = await saveBuyerAccountBilling(snapshot.ownerId, payload, saveOperation.current.id);
            if (mounted.current && isOwnerCurrent()) { saveOperation.current = null; onSaved(billing); setEditing(false); setSaved(true); }
        } catch (failure) {
            if (mounted.current) setError(failure instanceof TypeError ? "Die Verbindung ist gerade unterbrochen. Deine Eingaben bleiben erhalten."
                : failure instanceof Error ? failure.message : "Bitte versuche es erneut.");
        } finally {
            busyRef.current = false;
            if (mounted.current) { setSaving(false); onSavingChange(false); }
        }
    }

    const details = snapshot.billing.details;
    const address = details?.address;
    const hasAddress = Boolean(address && [address.line1, address.line2, address.postalCode, address.city, address.country].some(Boolean));
    return <details className={account.billing}>
        <summary className={account.billingSummary}><span className={account.billingLabel}>
            <span className={`app-glass-control ${account.billingIcon}`} aria-hidden="true"><UserRound size={19} strokeWidth={1.5} /></span>
            <span>Rechnungsdaten</span></span><ChevronRight className={account.billingChevron} size={17} aria-hidden="true" /></summary>
        <div className={account.billingBody}>
            {snapshot.billing.available && <BillingIdentity details={details} ownerId={snapshot.ownerId} disabled={saving || editing} isOwnerCurrent={isOwnerCurrent} />}
            {!snapshot.billing.available ? <p className={account.unavailable}>{snapshot.kind === "local"
                ? "Rechnungsdaten werden in der lokalen Vorschau nicht gespeichert."
                : "Hinterlege zuerst ein Zahlungsmittel. Danach kannst du deine Rechnungsdaten ergänzen."}</p>
                : editing ? <form onSubmit={save} className={account.form}>
                    <fieldset disabled={saving} aria-busy={saving}>
                        <section className={account.optionalAddress} aria-label="Optionale Rechnungsadresse">
                            <div className={account.addressHeading}><span>Rechnungsadresse <small>optional</small></span><button type="button" className={styles.textAction} aria-expanded={addressAction === "edit"} aria-controls={`${fieldId}-address`} onClick={() => {
                                if (addressAction === "edit") setAddressAction("preserve");
                                else { if (address?.country !== "DE") setInput(current => ({ ...current, address: { line1: "", line2: "", postalCode: "", city: "", country: "DE" } })); setAddressAction("edit"); }
                            }}>{addressAction === "edit" ? hasAddress ? "Beibehalten" : "Nicht ergänzen" : hasAddress ? "Bearbeiten" : "Ergänzen"}</button></div>
                            {addressAction === "edit" ? <div id={`${fieldId}-address`} className={account.addressFields}>
                        <label htmlFor={`${fieldId}-line1`}>Straße und Hausnummer<input ref={firstField} id={`${fieldId}-line1`} name="billing-address-line1" autoComplete="billing address-line1" value={input.address.line1}
                            required minLength={3} maxLength={200} onChange={(event) => setInput({ ...input, address: { ...input.address, line1: event.target.value } })} /></label>
                        <label htmlFor={`${fieldId}-line2`}>Adresszusatz <span>optional</span><input id={`${fieldId}-line2`} name="billing-address-line2" autoComplete="billing address-line2" value={input.address.line2}
                            maxLength={200} onChange={(event) => setInput({ ...input, address: { ...input.address, line2: event.target.value } })} /></label>
                        <div className={account.addressRow}>
                            <label htmlFor={`${fieldId}-postalCode`}>Postleitzahl<input id={`${fieldId}-postalCode`} name="billing-postal-code" autoComplete="billing postal-code" inputMode="numeric" value={input.address.postalCode}
                                required pattern="[0-9]{5}" maxLength={5} onChange={(event) => setInput({ ...input, address: { ...input.address, postalCode: event.target.value } })} /></label>
                            <label htmlFor={`${fieldId}-city`}>Ort<input id={`${fieldId}-city`} name="billing-city" autoComplete="billing address-level2" value={input.address.city}
                                required maxLength={100} onChange={(event) => setInput({ ...input, address: { ...input.address, city: event.target.value } })} /></label>
                        </div>
                        <p className={account.country}>Deutschland</p>
                            </div> : <p className={account.addressPreview}>{addressAction === "remove" ? "Die Adresse wird beim Speichern entfernt." : hasAddress
                                ? [address?.line1, address?.line2, [address?.postalCode, address?.city].filter(Boolean).join(" "), address?.country === "DE" ? "Deutschland" : address?.country].filter(Boolean).join(", ")
                                : "Nur ergänzen, wenn du eine Rechnungsadresse benötigst."}</p>}
                            {hasAddress && addressAction !== "edit" && <button type="button" className={styles.textAction} onClick={() => setAddressAction(addressAction === "remove" ? "preserve" : "remove")}>{addressAction === "remove" ? "Rückgängig" : "Adresse entfernen"}</button>}
                        </section>
                        <div className={account.formActions}>
                            <button type="button" className={styles.textAction} onClick={() => { setEditing(false); setError(null); }}>Abbrechen</button>
                            <button type="submit" className={`app-glass-control ${styles.action}`}>
                                {saving && <Loader2 size={16} className={account.spinner} aria-hidden="true" />}{saving ? "Wird gespeichert …" : "Speichern"}
                            </button>
                        </div>
                    </fieldset>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                </form> : <><div className={account.addressTitle}><span>Rechnungsadresse <small>optional</small></span></div><div className={account.billingRead}>
                    {hasAddress ? <address className={account.address}>
                        {address?.line1 && <span>{address.line1}</span>}{address?.line2 && <span>{address.line2}</span>}
                        {(address?.postalCode || address?.city) && <span>{[address?.postalCode, address?.city].filter(Boolean).join(" ")}</span>}
                        {address?.country && <span>{address.country === "DE" ? "Deutschland" : address.country}</span>}
                    </address> : <p className={account.unavailable}>Keine Rechnungsadresse hinterlegt.</p>}
                    <button type="button" ref={editRef} className={`app-glass-control ${styles.quietButton}`} onClick={() => {
                        setInput(initialBilling(details)); setAddressAction("preserve"); setError(null); setSaved(false); setEditing(true);
                    }}>{hasAddress ? "Bearbeiten" : "Ergänzen"}</button>
                </div></>}
            {saved && <p className={`${styles.feedback} ${account.saved}`}><Check size={15} aria-hidden="true" />Rechnungsdaten gespeichert.</p>}
        </div>
    </details>;
}

export function BuyerAccountView({ snapshot, loading, error, onRetry, onBillingSaved, isOwnerCurrent = () => true, children }: {
    snapshot: BuyerAccountSnapshot | null; loading: boolean; error: string | null; onRetry: () => void; onBillingSaved: (details: BuyerBillingDetails) => void;
    children?: React.ReactNode;
    isOwnerCurrent?: () => boolean;
}) {
    const titleId = useId();
    const [savingBilling, setSavingBilling] = useState(false);
    const [editingBilling, setEditingBilling] = useState(false);
    return <section className={`${styles.surface} ${account.utilities}`} aria-label="Rechnungsdaten und Hilfe">
        <div className={account.historySection}><details className={account.billing} open={error ? true : undefined}>
            <summary className={`${account.billingSummary} ${account.historySummary}`}><span className={account.billingLabel}><span className={`app-glass-control ${account.billingIcon}`}><FileText size={19} strokeWidth={1.5} aria-hidden="true" /></span><span>Zahlungen und Belege</span></span><ChevronRight className={account.billingChevron} size={17} aria-hidden="true" /></summary>
            <div className={account.billingBody} aria-labelledby={titleId} aria-busy={loading}>
            <h2 id={titleId} className={account.srOnly}>Zahlungen und Belege</h2>
            {loading ? <p className={`${styles.loading} ${account.notice}`} role="status"><Loader2 size={16} className={account.spinner} aria-hidden="true" />Übersicht wird geladen …</p>
                : error ? <div className={account.failure}><p className={styles.error} role="alert">{error}</p><button type="button" className={`app-glass-control ${styles.quietButton}`} onClick={onRetry}>Erneut versuchen</button></div>
                    : snapshot && <History snapshot={snapshot} />}
            </div>
        </details><div className={account.historyTools}><button type="button" className={`app-glass-control ${account.refresh}`} disabled={loading || savingBilling || editingBilling} onClick={onRetry} aria-label="Zahlungsübersicht aktualisieren" title="Zahlungen aktualisieren"><RotateCw size={17} className={loading ? account.spinner : undefined} aria-hidden="true" /></button></div></div>
        {!loading && !error && snapshot && <Billing snapshot={snapshot} onSaved={onBillingSaved} onSavingChange={setSavingBilling} onEditingChange={setEditingBilling} isOwnerCurrent={isOwnerCurrent} />}
        {children}
    </section>;
}

export default function BuyerAccountPanel({ ownerId, kind, version = 0, children }: { ownerId?: string; kind?: PaymentSurfaceKind; version?: number; children?: React.ReactNode }) {
    const router = useRouter();
    const [attempt, setAttempt] = useState(0);
    const key = `${ownerId ?? "unknown"}:${kind ?? "unknown"}:${version}:${attempt}`;
    const invalidatedOwner = useRef<string | null>(null);
    const generation = useRef(0);
    const [state, setState] = useState<{ key: string; snapshot: BuyerAccountSnapshot | null; error: string | null }>({ key: "", snapshot: null, error: null });
    const [announcement, setAnnouncement] = useState("");
    useEffect(() => {
        const lifecycleGeneration = generation;
        let active = true;
        const controller = new AbortController();
        const ticket = ++generation.current;
        const isCurrent = () => active && generation.current === ticket && invalidatedOwner.current !== ownerId;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event === "USER_UPDATED" && session?.user.id === ownerId) { setAttempt(value => value + 1); return; }
            if (event !== "SIGNED_OUT" && (!session?.user.id || session.user.id === ownerId)) return;
            invalidatedOwner.current = ownerId ?? null; ++generation.current; controller.abort(); setAnnouncement("");
            setState({ key, snapshot: null, error: "Bitte öffne die Übersicht nach deiner Anmeldung erneut." });
        });
        async function load() {
            if (!ownerId || invalidatedOwner.current === ownerId) {
                if (active) setState({ key, snapshot: null, error: "Bitte öffne die Übersicht nach deiner Anmeldung erneut." });
                return;
            }
            try {
                const data = await readBuyerAccountOverview(ownerId, controller.signal, kind);
                if (isCurrent()) { setState({ key, snapshot: data, error: null }); setAnnouncement("Zahlungsübersicht aktualisiert."); }
            } catch (failure) {
                if (isCurrent()) setState({ key, snapshot: null, error: failure instanceof TypeError ? "Die Verbindung ist gerade unterbrochen. Bitte versuche es erneut."
                    : failure instanceof Error ? failure.message : "Bitte versuche es erneut." });
            }
        }
        void load();
        return () => { active = false; ++lifecycleGeneration.current; controller.abort(); subscription.unsubscribe(); };
    }, [key, kind, ownerId]);
    const loading = state.key !== key;
    return <>
        <span className={account.srOnly} aria-live="polite" aria-atomic="true">{announcement}</span>
        <BuyerAccountView snapshot={state.snapshot?.ownerId === ownerId ? state.snapshot : null} loading={loading} error={loading ? null : state.error} onRetry={() => { if (!ownerId || invalidatedOwner.current === ownerId) { router.refresh(); return; } setAnnouncement(""); setAttempt((value) => value + 1); }} isOwnerCurrent={() => !!ownerId && invalidatedOwner.current !== ownerId}
            onBillingSaved={(details) => {
                if (!ownerId || invalidatedOwner.current === ownerId) return;
                setAnnouncement("Rechnungsdaten gespeichert.");
                setState((current) => current.key !== key || current.snapshot?.ownerId !== ownerId ? current : {
                    ...current, snapshot: { ...current.snapshot, billing: { available: true, details } },
                });
            }}>{children}</BuyerAccountView>
    </>;
}
