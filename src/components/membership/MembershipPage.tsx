"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, FileText, Layers3, LoaderCircle, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import type { MembershipOffer, MembershipSnapshot } from "@/lib/payments/subscription-types";
import { MEMBERSHIP_NAME } from "@/lib/payments/subscription-types";
import { PaymentMotion } from "@/components/payments/PaymentMotion";
import { paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "@/components/payments/usePaymentOwner";
import { followGlassPointer } from "@/lib/glass-pointer";
import { membershipExample, parseMembershipAmount, trustedMembershipUrl, validMembershipSnapshot } from "./membership-display";
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
    const unavailable = !snapshot || blocked;
    const contractQuery = membership?.contractReference && snapshot?.manageAvailable ? `?contract=${encodeURIComponent(membership.contractReference)}` : "";
    useEffect(() => {
        if (!confirmation && !hadConfirmation.current) return;
        hadConfirmation.current = confirmation !== null;
        const frame = requestAnimationFrame(() => (confirmation ? heading.current : confirmationTrigger.current)?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [confirmation]);

    return <div className={styles.page} onPointerMove={followGlassPointer}>
        <Link href="/app-home/settings/payments" prefetch={false} className={`app-glass-control ${styles.back}`}><ArrowLeft size={18} aria-hidden="true" />Workfare Pay</Link>
        <header className={styles.header}><div><span className={styles.eyebrow}>Für Jobanbieter</span><h1>{offer?.name ?? MEMBERSHIP_NAME}</h1></div>
            <button type="button" className={`app-glass-control ${styles.round}`} disabled={loading || !!busy || blocked} aria-label="Plan aktualisieren" onClick={onReload}><RefreshCw size={18} aria-hidden="true" /></button>
        </header>

        {message && <p className={styles.feedback} role="status">{message}</p>}
        {error && <div className={`${styles.surface} ${styles.failure}`}><p role="alert">{error}</p>{blocked ? <a className={`app-glass-control ${styles.button}`} href="/app-home/settings/membership">Nach Anmeldung neu öffnen<ArrowRight size={16} aria-hidden="true" /></a> : <button type="button" className={`app-glass-control ${styles.button}`} onClick={onReload} disabled={!!busy || loading}>Erneut laden<RefreshCw size={16} aria-hidden="true" /></button>}</div>}

        <div className={styles.hero}>
            <div className={styles.intro}><h2>Weniger Gebühren.<br /><span>Ein fester Beitrag.</span></h2>
                <p>Ein fester Monatsbeitrag ersetzt unseren Anteil an der Servicegebühr. Alle Jobs und Funktionen bleiben auch ohne Abo verfügbar.</p>
                <div className={styles.motionStage}><PaymentMotion /></div>
            </div>
            <section className={`${styles.surface} ${styles.offer}`} aria-labelledby={title} aria-busy={loading || !!busy}>
                {loading ? <div className={styles.loading} role="status"><LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />Dein Plan wird geladen …</div> : offer && membership ? <>
                    <div className={styles.planHeading}><h2 id={title}>{entitled ? membership.cancelAtPeriodEnd ? "Dein Plan endet" : "Dein Plan ist aktiv" : "Ein Beitrag. Jeden Monat."}</h2>{entitled && <span className={`app-glass-control ${styles.statusIcon}`} aria-hidden="true"><Check size={18} /></span>}</div>
                    <p className={styles.price}><strong>{money.format(offer.priceCents / 100)}</strong><span>/ Monat</span></p>
                    <p className={styles.priceNote}>Endpreis · Monatlich kündbar</p>
                    <div className={styles.rate}><strong>{percent(offer.standardRateBps - offer.memberRateBps)} <span>Prozentpunkte weniger</span></strong><p>Der Workfare-Anteil entfällt bei neuen Jobs im freigegebenen Tarif während deines aktiven Plans.</p></div>
                    <dl className={styles.comparison}><div><dt>Ohne Abo</dt><dd>{percent(offer.standardRateBps)} % + {money.format(offer.fixedFeeCents / 100)}<span>je Job</span></dd></div><div data-member="true"><dt>Mit {offer.name}</dt><dd>{percent(offer.memberRateBps)} % + {money.format(offer.fixedFeeCents / 100)}<span>je Job</span></dd></div></dl>
                    {snapshot.kind !== "live" && <p className={styles.environment}>{snapshot.kind === "sandbox" ? "Stripe-Testbetrieb · Kein Echtgeld" : "Vorschau · Keine Buchung möglich"}</p>}
                    {entitled ? <>
                        {membership.currentPeriodEnd && <div className={styles.period}><CalendarDays size={18} aria-hidden="true" /><span>{membership.cancelAtPeriodEnd ? "Aktiv bis" : "Nächste Verlängerung am"} <strong><time dateTime={membership.currentPeriodEnd}>{date.format(new Date(membership.currentPeriodEnd))}</time></strong></span></div>}
                        <button className={`app-glass-control ${styles.button} ${styles.primary}`} type="button" disabled={!!busy || !snapshot.manageAvailable} onClick={() => onAction("portal")}>{busy === "portal" ? <LoaderCircle size={17} className={styles.spinner} /> : <FileText size={17} />}Rechnungen & Zahlungsmittel<ArrowUpRight size={16} aria-hidden="true" /></button>
                        <button type="button" ref={confirmationTrigger} className={styles.quiet} disabled={!!busy || !snapshot.manageAvailable} onClick={() => onConfirmation(membership.cancelAtPeriodEnd ? "resume" : "cancel")}>{membership.cancelAtPeriodEnd ? "Kündigung zurücknehmen" : "Abo kündigen"}</button>
                    </> : <>
                        {membership.status !== "none" && membership.status !== "canceled" && membership.status !== "incomplete_expired" && <p className={styles.pendingNotice}>Dein Plan ist noch nicht als bezahlt bestätigt. Prüfe den aktuellen Stand, bevor du eine weitere Buchung beginnst.</p>}
                        <label className={styles.startConsent} htmlFor={`${title}-start`}><input id={`${title}-start`} type="checkbox" checked={immediateStart} disabled={!!busy || !snapshot.checkoutAvailable} onChange={event => setImmediateStart(event.target.checked)} /><span>Ich möchte Workfare Plan sofort nutzen. Mein 14-tägiges Widerrufsrecht bleibt bestehen. Für bereits erbrachte Leistungen kann nach den gesetzlichen Regeln anteiliger Wertersatz anfallen.</span></label>
                        <button type="button" className={`app-glass-control ${styles.button} ${styles.primary}`} onClick={() => immediateStart && onAction("checkout", { immediateStart: true })} disabled={!!busy || !snapshot.checkoutAvailable || !immediateStart}>{busy === "checkout" ? <LoaderCircle size={17} className={styles.spinner} /> : <ArrowRight size={17} aria-hidden="true" />}Zahlungspflichtig abonnieren<span>{money.format(offer.priceCents / 100)} / Monat</span></button>
                        {!snapshot.checkoutAvailable && <p className={styles.unavailable}>{["none", "canceled", "incomplete_expired"].includes(membership.status) ? "Die Buchung ist noch nicht freigeschaltet. Workfare kannst du weiterhin ohne Abo nutzen." : "Für dein Konto besteht bereits eine Buchung. Prüfe zuerst den aktuellen Stand."}</p>}
                        <p className={styles.terms}>Du bestätigst deine Buchung anschließend bei Stripe. Es gelten die <Link href="/legal/workfare-plan" prefetch={false}>Plan-Bedingungen</Link>. Dein Abo verlängert sich monatlich, bis du es kündigst.</p>
                        {snapshot.manageAvailable && <button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onAction("portal")}>Rechnungen & Zahlungsmittel<ArrowUpRight size={15} aria-hidden="true" /></button>}
                        {membership.status !== "none" && <button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onAction("sync")}>{busy === "sync" && <LoaderCircle size={15} className={styles.spinner} />}Buchungsstand prüfen</button>}
                    </>}
                    {confirmation && <section className={styles.confirmation} aria-labelledby={`${title}-confirm`} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onConfirmation(null); } }}>
                        <h3 id={`${title}-confirm`} ref={heading} tabIndex={-1}>{confirmation === "cancel" ? "Plan zum Laufzeitende kündigen?" : "Plan weiter nutzen?"}</h3>
                        <p>{confirmation === "cancel" ? <>Deine Vorteile bleiben {membership.currentPeriodEnd ? <>bis zum {date.format(new Date(membership.currentPeriodEnd))}</> : "bis zum Ende des bezahlten Zeitraums"} aktiv. Danach nutzt du Workfare weiter ohne Abo.</> : <>Die Kündigung wird zurückgenommen. Dein Plan verlängert sich wieder für {money.format(offer.priceCents / 100)} pro Monat.</>}</p>
                        <div className={styles.confirmButtons}><button type="button" className={`app-glass-control ${styles.button}`} disabled={!!busy} onClick={() => onAction(confirmation)}>{busy === confirmation && <LoaderCircle size={16} className={styles.spinner} />}{confirmation === "cancel" ? "Kündigung bestätigen" : "Kostenpflichtig fortsetzen"}</button><button type="button" className={styles.quiet} disabled={!!busy} onClick={() => onConfirmation(null)}>Zurück</button></div>
                    </section>}
                    <details className={styles.feeInfo}><summary>Was bleibt in der Servicegebühr?<ChevronDown size={15} aria-hidden="true" /></summary><p>Der allgemeine Grundanteil von {percent(offer.memberRateBps)} % und {money.format(offer.fixedFeeCents / 100)} pro Job bleibt für die Abwicklung bestehen. Er gilt unabhängig von der gewählten Zahlungsart. Bestehende Jobs und bereits vorgeschlagene Preise ändern sich durch das Abo nicht.</p></details>
                    {membership.contractReference && snapshot.manageAvailable && <details className={styles.feeInfo}><summary>Vertrag & Bedingungen<ChevronDown size={15} aria-hidden="true" /></summary><div className={styles.contract}><span>Deine Vertragsreferenz</span><div><code>{membership.contractReference}</code><button type="button" className={`app-glass-control ${styles.round}`} aria-label="Vertragsreferenz kopieren" onClick={() => { if (!navigator.clipboard?.writeText) { setCopyResult("Bitte markiere und kopiere deine Vertragsreferenz."); return; } void navigator.clipboard.writeText(membership.contractReference!).then(() => setCopyResult("Vertragsreferenz kopiert."), () => setCopyResult("Bitte markiere und kopiere deine Vertragsreferenz.")); }}><Copy size={16} aria-hidden="true" /></button></div>{copyResult && <p role="status">{copyResult}</p>}<Link href="/legal/workfare-plan" prefetch={false}>Bedingungen und Widerruf<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href={`/membership/withdraw${contractQuery}`} prefetch={false}>Vertrag widerrufen<ArrowRight size={14} aria-hidden="true" /></Link></div></details>}
                </> : !error ? <p className={styles.unavailable}>Dein Angebot ist gerade nicht verfügbar.</p> : null}
            </section>
        </div>

        {offer && !unavailable && <MembershipCalculator offer={offer} />}
        <section className={styles.future} aria-labelledby={`${title}-future`}><div className={styles.futureHeading}><h2 id={`${title}-future`}>Als Nächstes geplant</h2><span>In Planung</span></div><p>Diese Funktionen sind noch nicht verfügbar und nicht Bestandteil deines Abos.</p><ul><li><Layers3 size={21} aria-hidden="true" /><strong>Jobvorlagen</strong></li><li><FileText size={21} aria-hidden="true" /><strong>Sammelübersichten</strong></li><li><UsersRound size={21} aria-hidden="true" /><strong>Gemeinsam organisieren</strong></li></ul></section>
        <footer className={styles.footer}><ShieldCheck size={16} aria-hidden="true" /><span>Sichere Abwicklung über Stripe</span><div><Link href={`/membership/cancel${contractQuery}`} prefetch={false}>Verträge hier kündigen</Link><Link href={`/membership/withdraw${contractQuery}`} prefetch={false}>Vertrag widerrufen</Link></div></footer>
    </div>;
}

export function MembershipCalculator({ offer }: { offer: MembershipOffer }) {
    const id = useId();
    const [amount, setAmount] = useState("50"), [jobs, setJobs] = useState("4");
    const earnings = parseMembershipAmount(amount), count = /^\d{1,3}$/.test(jobs) ? Number(jobs) : 0;
    const example = earnings === null ? null : membershipExample(earnings, count, offer);
    return <details className={`${styles.surface} ${styles.calculator}`} aria-labelledby={`${id}-title`}><summary className={styles.calculatorSummary}><span><span className={styles.eyebrow}>Dein Rechenbeispiel</span><strong id={`${id}-title`}>Passt der Plan zu dir?</strong></span><span className={`app-glass-control ${styles.round}`} aria-hidden="true"><ChevronDown size={19} /></span></summary><div className={styles.calculatorBody}><div className={styles.calculatorIntro}><p>Vergleiche die Servicegebühren inklusive Monatsbeitrag. Die vereinbarte Vergütung erhalten die Jobsuchenden vollständig.</p></div>
        <div className={styles.calculation}><div className={styles.inputs}><label htmlFor={`${id}-amount`}>Vergütung je Job<div className={styles.inputWrap}><input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={earnings === null} maxLength={9} /><span aria-hidden="true">€</span></div></label><label htmlFor={`${id}-jobs`}>Jobs im Monat<div className={styles.inputWrap}><input id={`${id}-jobs`} inputMode="numeric" value={jobs} onChange={event => setJobs(event.target.value)} aria-invalid={count < 1 || count > 100} maxLength={3} /><span aria-hidden="true">Jobs</span></div></label></div>
            {example ? <><dl className={styles.exampleRows}><div><dt>Ohne Abo</dt><dd>{money.format(example.without / 100)}</dd></div><div><dt>Mit {offer.name}<span>inkl. {money.format(offer.priceCents / 100)} Monatsbeitrag</span></dt><dd>{money.format(example.withPlan / 100)}</dd></div></dl><p className={styles.saving} role="status" aria-live="polite"><strong>{money.format(Math.abs(example.netSaving) / 100)}</strong><span>{example.netSaving > 0 ? "weniger im Monat mit dem Plan" : example.netSaving < 0 ? "weniger im Monat ohne Abo" : "Unterschied bei diesem Beispiel"}</span></p></> : <p className={styles.calculationError} role="status">Gib eine Vergütung ab 1 € und zwischen 1 und 100 Jobs ein.</p>}
            <p className={styles.calculationNote}>Du sparst {percent(offer.standardRateBps - offer.memberRateBps)} Prozentpunkte je Job. Bei wenig Nutzung ist die Einzelzahlung günstiger. Dieses Beispiel berechnet jeden Job einzeln und rundet auf Cent.</p>
        </div></div>
    </details>;
}
