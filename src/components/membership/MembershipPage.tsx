"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, FileText, House, LoaderCircle, MapPin, RefreshCw, Split } from "lucide-react";
import type { MembershipOffer, MembershipSnapshot } from "@/lib/payments/subscription-types";
import { MEMBERSHIP_NAME } from "@/lib/payments/subscription-types";
import { PaymentMotion } from "@/components/payments/PaymentMotion";
import { PaymentProviderBrand } from "@/components/payments/PaymentProviderBrand";
import { paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "@/components/payments/usePaymentOwner";
import { followGlassPointer } from "@/lib/glass-pointer";
import { membershipExample, trustedMembershipUrl, validMembershipSnapshot } from "./membership-display";
import styles from "./Membership.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const percent = (basisPoints: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(basisPoints / 100);
type Action = "checkout" | "sync" | "portal" | "cancel" | "resume";
type Resource = { snapshot: MembershipSnapshot | null; loading: boolean; error: string | null };

function membershipError(error: unknown) {
    if (error instanceof PaymentRequestError && error.code === "membership_already_active") return "Dein Plan ist bereits aktiv. Bitte lade den aktuellen Stand.";
    if (error instanceof PaymentRequestError && ["membership_unavailable", "membership_checkout_unavailable", "membership_not_configured"].includes(error.code ?? "")) return "Die Buchung ist gerade nicht verfügbar. Bitte versuche es später erneut.";
    if (error instanceof PaymentRequestError && ["membership_terms_changed", "membership_offer_changed"].includes(error.code ?? "")) return "Das Angebot hat sich geändert. Lade bitte den aktuellen Stand, bevor du buchst.";
    return error instanceof PaymentRequestError ? error.message : "Der aktuelle Stand konnte nicht bestätigt werden. Bitte lade ihn erneut.";
}

export function MembershipPage({ ownerId, result, sessionId }: { ownerId: string; result: "returned" | "canceled" | null; sessionId: string | null }) {
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const [resource, setResource] = useState<Resource>({ snapshot: null, loading: true, error: null });
    const [busy, setBusy] = useState<Action | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<"cancel" | "resume" | null>(null);
    const mounted = useRef(false), generation = useRef(0), locked = useRef(false);
    const checkoutOperation = useRef<{ version: string; id: string } | null>(null);

    const load = useCallback(async (sync: boolean, initial = false) => {
        if (!mounted.current || !isCurrentOwner()) return;
        const ticket = ++generation.current;
        setMessage(null);
        setResource({ snapshot: null, loading: true, error: null });
        try {
            const value = await paymentRequest<unknown>(sync ? "/api/payments/membership/sync" : "/api/payments/membership", sync ? sessionId ? { sessionId } : {} : undefined, undefined, ownerId);
            if (!mounted.current || ticket !== generation.current || !isCurrentOwner()) return;
            if (!validMembershipSnapshot(value, ownerId)) throw new Error("membership_unconfirmed");
            setResource({ snapshot: value, loading: false, error: null });
            if (sync) setMessage(value.membership.entitled ? "Dein Workfare Plan ist aktiv." : "Deine Buchung ist noch nicht bestätigt. Prüfe den Stand in einem Moment erneut.");
            else if (initial && result === "canceled") setMessage("Buchung abgebrochen. Dein bisheriger Stand bleibt erhalten.");
        } catch (error) {
            if (mounted.current && ticket === generation.current && isCurrentOwner()) setResource({ snapshot: null, loading: false, error: membershipError(error) });
        }
    }, [isCurrentOwner, ownerId, sessionId, result]);

    useEffect(() => {
        mounted.current = true;
        const frame = requestAnimationFrame(() => { void load(result === "returned", true); });
        return () => { cancelAnimationFrame(frame); mounted.current = false; generation.current += 1; };
    }, [load, result]);

    async function action(action: Action, options?: { immediateStart: true }) {
        const snapshot = resource.snapshot;
        if (locked.current || !snapshot || snapshot.ownerId !== ownerId || !isCurrentOwner()) return;
        locked.current = true; setBusy(action); setMessage(null); setResource(value => ({ ...value, error: null }));
        const ticket = generation.current;
        try {
            let operation: string | undefined;
            if (action === "checkout") {
                if (!snapshot.checkoutAvailable || snapshot.membership.entitled || options?.immediateStart !== true) return;
                if (checkoutOperation.current?.version !== snapshot.offer.termsVersion) checkoutOperation.current = { version: snapshot.offer.termsVersion, id: crypto.randomUUID() };
                operation = checkoutOperation.current.id;
            }
            const body = action === "checkout" ? { consent: true, immediateStart: true, termsVersion: snapshot.offer.termsVersion }
                : action === "cancel" || action === "resume" ? { consent: true } : {};
            const value = await paymentRequest<unknown>(`/api/payments/membership/${action}`, body, operation, ownerId);
            if (!mounted.current || generation.current !== ticket || !isCurrentOwner()) return;
            if (action === "checkout" || action === "portal") {
                const url = value && typeof value === "object" && "url" in value ? value.url : null;
                if (!trustedMembershipUrl(url)) throw new Error("membership_destination_unconfirmed");
                window.location.assign(url);
                return;
            }
            if (!validMembershipSnapshot(value, ownerId)) throw new Error("membership_unconfirmed");
            setResource({ snapshot: value, loading: false, error: null }); setConfirmation(null);
            setMessage(action === "cancel" ? value.membership.cancelAtPeriodEnd ? "Dein Plan endet zum bestätigten Laufzeitende." : "Die Kündigung ist noch nicht bestätigt. Bitte prüfe den aktuellen Stand."
                : action === "resume" ? !value.membership.cancelAtPeriodEnd && value.membership.entitled ? "Dein Plan läuft weiter." : "Die Fortsetzung ist noch nicht bestätigt. Bitte prüfe den aktuellen Stand."
                    : value.membership.entitled ? "Dein Plan ist aktiv. Der Stand ist aktuell." : "Der Stand wurde aktualisiert. Eine aktive Buchung ist noch nicht bestätigt.");
        } catch (error) {
            if (mounted.current && generation.current === ticket && isCurrentOwner()) setResource(value => ({ ...value, error: membershipError(error) }));
        } finally { locked.current = false; if (mounted.current) setBusy(null); }
    }

    const snapshot = !ownerChanged && resource.snapshot?.ownerId === ownerId ? resource.snapshot : null;
    return <MembershipView key={ownerId} snapshot={snapshot} loading={!ownerChanged && resource.loading} busy={busy}
        error={ownerChanged ? PAYMENT_OWNER_CHANGED : resource.error} message={ownerChanged ? null : message}
        confirmation={ownerChanged ? null : confirmation} blocked={ownerChanged}
        onAction={action} onReload={() => void load(false)} onConfirmation={setConfirmation} />;
}

type ViewProps = Resource & { busy: Action | null; message: string | null; confirmation: "cancel" | "resume" | null; blocked?: boolean;
    onAction: (action: Action, options?: { immediateStart: true }) => void; onReload: () => void; onConfirmation: (value: "cancel" | "resume" | null) => void };

export function MembershipView({ snapshot, loading, busy, error, message, confirmation, blocked = false, onAction, onReload, onConfirmation }: ViewProps) {
    const title = useId();
    const heading = useRef<HTMLHeadingElement>(null);
    const confirmationTrigger = useRef<HTMLButtonElement>(null), hadConfirmation = useRef(false);
    const [immediateStart, setImmediateStart] = useState(false), [copyResult, setCopyResult] = useState<string | null>(null);
    const offer = snapshot?.offer, membership = snapshot?.membership;
    const entitled = membership?.entitled === true;
    const PriceTag = entitled ? "p" : "h2";
    const contractQuery = membership?.contractReference && snapshot?.manageAvailable ? `?contract=${encodeURIComponent(membership.contractReference)}` : "";
    useEffect(() => {
        if (!confirmation && !hadConfirmation.current) return;
        hadConfirmation.current = confirmation !== null;
        const frame = requestAnimationFrame(() => (confirmation ? heading.current : confirmationTrigger.current)?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [confirmation]);

    return <div className={styles.page} onPointerMove={followGlassPointer}>
        <Link href="/app-home/settings/payments" prefetch={false} className={`app-glass-control ${styles.back}`}><ArrowLeft size={18} aria-hidden="true" />Workfare Pay</Link>
        <header className={styles.header}><h1>{offer?.name ?? MEMBERSHIP_NAME}</h1>
            <button type="button" className={`app-glass-control ${styles.round}`} disabled={loading || !!busy || blocked} aria-label="Plan aktualisieren" onClick={onReload}><RefreshCw size={18} aria-hidden="true" /></button>
        </header>

        {message && <p className={styles.feedback} role="status">{message}</p>}
        {error && <div className={`${styles.surface} ${styles.failure}`}><p role="alert">{error}</p>{blocked ? <a className={`app-glass-control ${styles.button}`} href="/app-home/settings/membership">Nach Anmeldung neu öffnen<ArrowRight size={16} aria-hidden="true" /></a> : <button type="button" className={`app-glass-control ${styles.button}`} onClick={onReload} disabled={!!busy || loading}>Erneut laden<RefreshCw size={16} aria-hidden="true" /></button>}</div>}

        <div className={styles.intro}>
            <h2>Weniger Gebühren.</h2>
            <div className={styles.motionStage}><PaymentMotion /></div>
        </div>
        <div className={styles.surface}>
            <section className={styles.offer} aria-labelledby={offer && !loading ? title : undefined} aria-label={!offer || loading ? "Workfare Plan" : undefined} aria-busy={loading || !!busy}>
                {loading ? <div className={styles.loading} role="status"><LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />Dein Plan wird geladen …</div> : offer && membership ? <>
                    {entitled && <div className={styles.planHeading}><h2 id={title}>{membership.cancelAtPeriodEnd ? "Dein Plan endet" : "Dein Plan ist aktiv"}</h2><span className={`app-glass-control ${styles.statusIcon}`} aria-hidden="true"><Check size={18} /></span></div>}
                    <PriceTag id={!entitled ? title : undefined} className={styles.price}><strong>{money.format(offer.priceCents / 100)}</strong><span>/ Monat</span></PriceTag>
                    <p className={styles.rate}>Servicegebühr je neuem Job</p>
                    <dl className={styles.comparison}><div><dt>Ohne Plan</dt><dd>{percent(offer.standardRateBps)} %<span>+ {money.format(offer.fixedFeeCents / 100)} je Job</span></dd></div><div data-member="true"><dt>Mit Plan</dt><dd>{percent(offer.memberRateBps)} %<span>+ {money.format(offer.fixedFeeCents / 100)} je Job</span></dd></div></dl>
                    {!blocked && <MembershipCalculator offer={offer} />}
                    {snapshot.kind !== "live" && <p className={styles.environment}>{snapshot.kind === "sandbox" ? "Stripe-Testbetrieb · Kein Echtgeld" : "Vorschau · Keine Buchung möglich"}</p>}
                    {entitled ? <>
                        {membership.currentPeriodEnd && <div className={styles.period}><CalendarDays size={18} aria-hidden="true" /><span>{membership.cancelAtPeriodEnd ? "Aktiv bis" : "Nächste Verlängerung am"} <strong><time dateTime={membership.currentPeriodEnd}>{date.format(new Date(membership.currentPeriodEnd))}</time></strong></span></div>}
                        <button className={`app-glass-control ${styles.button} ${styles.primary}`} type="button" disabled={!!busy || !snapshot.manageAvailable} onClick={() => onAction("portal")}>{busy === "portal" ? <LoaderCircle size={17} className={styles.spinner} /> : <FileText size={17} />}Rechnungen & Zahlungsmittel<ArrowUpRight size={16} aria-hidden="true" /></button>
                        <button type="button" ref={confirmationTrigger} className={styles.quiet} disabled={!!busy || !snapshot.manageAvailable} onClick={() => onConfirmation(membership.cancelAtPeriodEnd ? "resume" : "cancel")}>{membership.cancelAtPeriodEnd ? "Kündigung zurücknehmen" : "Abo kündigen"}</button>
                    </> : <>
                        {membership.status !== "none" && membership.status !== "canceled" && membership.status !== "incomplete_expired" && <p className={styles.pendingNotice}>Dein Plan ist noch nicht als bezahlt bestätigt. Prüfe den aktuellen Stand, bevor du eine weitere Buchung beginnst.</p>}
                        <label className={styles.startConsent} htmlFor={`${title}-start`}><input id={`${title}-start`} type="checkbox" checked={immediateStart} disabled={!!busy || !snapshot.checkoutAvailable} onChange={event => setImmediateStart(event.target.checked)} /><span>Ich möchte den Plan sofort nutzen. Mein 14-tägiges Widerrufsrecht bleibt bestehen; bei Widerruf können anteilige Kosten entstehen.</span></label>
                        <button type="button" className={`app-glass-control ${styles.button} ${styles.primary}`} onClick={() => immediateStart && onAction("checkout", { immediateStart: true })} disabled={!!busy || !snapshot.checkoutAvailable || !immediateStart}>{busy === "checkout" ? <LoaderCircle size={17} className={styles.spinner} /> : <ArrowRight size={17} aria-hidden="true" />}Zahlungspflichtig abonnieren</button>
                        {!snapshot.checkoutAvailable && <p className={styles.unavailable}>{["none", "canceled", "incomplete_expired"].includes(membership.status) ? "Die Buchung ist noch nicht freigeschaltet. Workfare kannst du weiterhin ohne Abo nutzen." : "Für dein Konto besteht bereits eine Buchung. Prüfe zuerst den aktuellen Stand."}</p>}
                        <p className={styles.terms}>Monatlich kündbar, automatische Verlängerung. <Link href="/legal/workfare-plan" prefetch={false}>Bedingungen</Link></p>
                        {snapshot.manageAvailable && <button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onAction("portal")}>Rechnungen & Zahlungsmittel<ArrowUpRight size={15} aria-hidden="true" /></button>}
                        {membership.status !== "none" && <button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onAction("sync")}>{busy === "sync" && <LoaderCircle size={15} className={styles.spinner} />}Buchungsstand prüfen</button>}
                    </>}
                    {confirmation && <section className={styles.confirmation} aria-labelledby={`${title}-confirm`} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onConfirmation(null); } }}>
                        <h3 id={`${title}-confirm`} ref={heading} tabIndex={-1}>{confirmation === "cancel" ? "Plan zum Laufzeitende kündigen?" : "Plan weiter nutzen?"}</h3>
                        <p>{confirmation === "cancel" ? <>Deine Vorteile bleiben {membership.currentPeriodEnd ? <>bis zum {date.format(new Date(membership.currentPeriodEnd))}</> : "bis zum Ende des bezahlten Zeitraums"} aktiv. Danach nutzt du Workfare weiter ohne Abo.</> : <>Die Kündigung wird zurückgenommen. Dein Plan verlängert sich wieder für {money.format(offer.priceCents / 100)} pro Monat.</>}</p>
                        <div className={styles.confirmButtons}><button type="button" className={`app-glass-control ${styles.button}`} disabled={!!busy} onClick={() => onAction(confirmation)}>{busy === confirmation && <LoaderCircle size={16} className={styles.spinner} />}{confirmation === "cancel" ? "Kündigung bestätigen" : "Kostenpflichtig fortsetzen"}</button><button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onConfirmation(null)}>Zurück</button></div>
                    </section>}
                    {membership.contractReference && snapshot.manageAvailable && <details className={styles.feeInfo}><summary>Vertrag & Bedingungen<ChevronDown size={15} aria-hidden="true" /></summary><div className={styles.contract}><span>Deine Vertragsreferenz</span><div><code>{membership.contractReference}</code><button type="button" className={`app-glass-control ${styles.round}`} aria-label="Vertragsreferenz kopieren" onClick={() => { if (!navigator.clipboard?.writeText) { setCopyResult("Bitte markiere und kopiere deine Vertragsreferenz."); return; } void navigator.clipboard.writeText(membership.contractReference!).then(() => setCopyResult("Vertragsreferenz kopiert."), () => setCopyResult("Bitte markiere und kopiere deine Vertragsreferenz.")); }}><Copy size={16} aria-hidden="true" /></button></div>{copyResult && <p role="status">{copyResult}</p>}<Link href="/legal/workfare-plan" prefetch={false}>Bedingungen und Widerruf<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href={`/membership/withdraw${contractQuery}`} prefetch={false}>Vertrag widerrufen<ArrowRight size={14} aria-hidden="true" /></Link></div></details>}
                </> : !error ? <p className={styles.unavailable}>Dein Angebot ist gerade nicht verfügbar.</p> : null}
            </section>
            <details className={styles.future}><summary className={styles.disclosure}><span>Demnächst</span><ChevronDown size={16} aria-hidden="true" /></summary><ul><li><MapPin size={18} aria-hidden="true" /><strong>Mehrere Einsatzorte</strong><span>Geplant</span></li><li><House size={18} aria-hidden="true" /><strong>Gemeinsames Haushaltsbudget</strong><span>Geplant</span></li><li><Split size={18} aria-hidden="true" /><strong>Zahlung aufteilen</strong><span>Geplant</span></li></ul><p>Geplant. Noch nicht Bestandteil deines Abos.</p></details>
        </div>
        <footer className={styles.footer}><nav className={styles.contractLinks} aria-label="Vertrag verwalten"><Link href={`/membership/cancel${contractQuery}`} prefetch={false}>Verträge hier kündigen</Link><Link href={`/membership/withdraw${contractQuery}`} prefetch={false}>Vertrag widerrufen</Link></nav><PaymentProviderBrand kind={snapshot?.kind} /></footer>
    </div>;
}

export function MembershipCalculator({ offer }: { offer: MembershipOffer }) {
    const id = useId();
    const [jobs, setJobs] = useState(4);
    const example = membershipExample(3400, jobs, offer)!;
    return <details className={styles.calculator}>
        <summary className={styles.disclosure}><span>Gebühren vergleichen</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className={styles.calculatorBody}>
            <div className={styles.exampleAssumption}><strong>34 € pro Job</strong><span>Beispiel: 2 Stunden à 17 €</span></div>
            <label className={styles.sliderLabel} htmlFor={`${id}-jobs`}><span>Jobs im Monat</span><output htmlFor={`${id}-jobs`}>{jobs}</output></label>
            <input className={styles.slider} id={`${id}-jobs`} type="range" min="0" max="12" step="1" value={jobs} onChange={event => setJobs(Number(event.target.value))} aria-valuetext={`${jobs} ${jobs === 1 ? "Job" : "Jobs"} im Monat mit jeweils 34 Euro Vergütung`} />
            <p className={styles.totalLabel}>Dein Gesamtbetrag im Monat</p>
            <dl className={styles.exampleRows}><div><dt>Ohne Plan</dt><dd>{money.format((example.totalEarnings + example.without) / 100)}</dd></div><div><dt>Mit Plan</dt><dd>{money.format((example.totalEarnings + example.withPlan) / 100)}</dd></div></dl>
            <p className={styles.saving} role="status" aria-live="polite"><strong>{money.format(Math.abs(example.netSaving) / 100)}<span> / Monat</span></strong><span>{example.netSaving > 0 ? "günstiger mit Plan" : example.netSaving < 0 ? "günstiger ohne Plan" : "Kein Preisunterschied"}</span></p>
            <p className={styles.calculationNote}>Vergütung und Gebühren sind enthalten. Mit Plan auch der Monatsbeitrag von {money.format(offer.priceCents / 100)}. Vereinbarte Preise und frühere Tarife bleiben unverändert.</p>
        </div>
    </details>;
}
