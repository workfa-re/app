"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, CalendarDays, Check, Loader2, RefreshCw } from "lucide-react";
import type { RecipientPayoutSettings as Snapshot, AutomaticPayoutSchedule } from "@/lib/payments/recipient-payout-types";
import { validRecipientBankSummary } from "@/lib/payments/recipient-bank-summary";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "./usePaymentOwner";
import styles from "./Payments.module.css";
import own from "./RecipientPayoutSettings.module.css";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const weekdays: Record<string,string> = { monday:"Montag",tuesday:"Dienstag",wednesday:"Mittwoch",thursday:"Donnerstag",friday:"Freitag",saturday:"Samstag",sunday:"Sonntag" };
function scheduleText(schedule: Snapshot["schedule"]) {
    if(schedule.interval === "daily") return "An jedem Bankarbeitstag";
    if(schedule.interval === "weekly") return schedule.weeklyDays.map(day=>weekdays[day]).join(", ");
    if(schedule.interval === "monthly") return `Am ${schedule.monthlyDays.join(". und ")}. jedes Monats`;
    return "Manuelle Auszahlung";
}
export function validPayoutSettings(value: unknown, ownerId:string):value is Snapshot {
    if(!value||typeof value!=="object"||Array.isArray(value))return false;
    const row=value as Record<string,unknown>, plan=row.schedule as AutomaticPayoutSchedule|{interval:"manual"}|undefined;
    const op=row.operation as Snapshot["operation"];
    if(op!==null && (!op || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(op.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(op.operationId) || !["schedule","payout"].includes(op.kind) || !["pending","submitted","complete","failed","review_required"].includes(op.state)
        || op.replayed!==undefined && typeof op.replayed!=="boolean" || typeof op.finished!=="boolean" || op.kind==="payout" && (op.amountCents===null || op.monthlyDay!==null) || op.kind==="schedule" && (op.amountCents!==null || op.monthlyDay===null) || op.amountCents!==null && (!Number.isSafeInteger(op.amountCents)||op.amountCents<=0)
        || op.monthlyDay!==null && (!Number.isInteger(op.monthlyDay)||op.monthlyDay<1||op.monthlyDay>31) || op.payoutStatus!==null && !["pending","in_transit","paid","failed","canceled"].includes(op.payoutStatus) || op.arrivalAt!==null && !Number.isFinite(Date.parse(op.arrivalAt))))return false;
    return row.ownerId===ownerId && ["live","sandbox"].includes(String(row.kind)) && row.currency==="eur" && Number.isSafeInteger(row.availableCents) && Number.isSafeInteger(row.pendingCents)
        && row.ready===true && typeof row.canRequestPayout==="boolean" && typeof row.checkedAt==="string" && Number.isFinite(Date.parse(row.checkedAt))
        && !!plan && (["daily","manual"].includes(plan.interval) || plan.interval==="monthly" && Array.isArray(plan.monthlyDays) && plan.monthlyDays.length>0 && plan.monthlyDays.every(day=>Number.isInteger(day)&&day>=1&&day<=31) || plan.interval==="weekly" && Array.isArray(plan.weeklyDays) && plan.weeklyDays.length>0 && plan.weeklyDays.every(day=>day in weekdays))
        && (row.reasonCode===null||["balance_not_available","multiple_payment_sources","automatic_schedule_required","operation_pending"].includes(String(row.reasonCode)))
        && (row.bank===undefined||row.bank===null||validRecipientBankSummary(row.bank))
        && (row.operation===null || typeof row.operation==="object" && !Array.isArray(row.operation));
}
type PendingAttempt = { id: string; mode: "sandbox" | "live"; body: { action: "schedule" | "payout"; consent: true; monthlyDay?: number; amountCents?: number } };
const attemptKey = (ownerId: string) => `workfare:payout-attempt:${ownerId}`;
function storedAttempt(ownerId: string): PendingAttempt | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(attemptKey(ownerId)) ?? "null") as PendingAttempt | null;
        if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) || value.body?.consent !== true || !["sandbox","live"].includes(value.mode)) return null;
        if (value.body.action === "schedule" && Number.isInteger(value.body.monthlyDay) && value.body.monthlyDay! >= 1 && value.body.monthlyDay! <= 31 && value.body.amountCents === undefined
            || value.body.action === "payout" && Number.isSafeInteger(value.body.amountCents) && value.body.amountCents! > 0 && value.body.amountCents! <= 999999999 && value.body.monthlyDay === undefined) return value;
    } catch { /* Storage can be unavailable in private browsing. The in-memory attempt remains. */ }
    return null;
}
function saveAttempt(ownerId: string, value: PendingAttempt | null) {
    // A non-secret request nonce and its confirmed payload survive a page reload.
    // No account references, bank data, tokens or Stripe secrets are stored.
    try { if (value) sessionStorage.setItem(attemptKey(ownerId), JSON.stringify(value)); else sessionStorage.removeItem(attemptKey(ownerId)); } catch { /* The mounted component still retains its immutable request. */ }
}
export function RecipientPayoutSettings({ownerId,onUpdated,onManageBank}:{ownerId:string;onUpdated?:()=>void;onManageBank?:()=>void}) {
    const {isCurrentOwner,ownerChanged}=usePaymentOwner(ownerId);
    const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[editing,setEditing]=useState(false),[paying,setPaying]=useState(false),[accepted,setAccepted]=useState(false),[day,setDay]=useState(1),[message,setMessage]=useState<string|null>(null),[attemptLocked,setAttemptLocked]=useState(false),[attemptAmount,setAttemptAmount]=useState<number|null>(null);
    const mounted=useRef(false), locked=useRef(false),generation=useRef(0),attempt=useRef<PendingAttempt|null>(null);
    const update=useRef(onUpdated); useEffect(()=>{update.current=onUpdated;},[onUpdated]);
    const current=useCallback((ticket:number)=>mounted.current&&generation.current===ticket&&isCurrentOwner(),[isCurrentOwner]);
    const load=useCallback(async()=>{
        if(locked.current||!mounted.current||!isCurrentOwner())return;
        if(!attempt.current)attempt.current=storedAttempt(ownerId);
        locked.current=true;setBusy(true);setError(null); const ticket=++generation.current;
        try { const value=await paymentRequest<unknown>("/api/payments/recipient/payout-settings",undefined,undefined,ownerId);if(!current(ticket))return;if(!validPayoutSettings(value,ownerId))throw new Error("payout_unconfirmed");setSnapshot(value);
            if (attempt.current && attempt.current.mode !== value.kind) { attempt.current=null; saveAttempt(ownerId,null); }
            const pending = attempt.current;
            if (pending && !(value.operation?.operationId === pending.id && value.operation.finished)) {
                setAttemptLocked(true); setAccepted(true); setEditing(pending.body.action === "schedule"); setPaying(pending.body.action === "payout"); setAttemptAmount(pending.body.amountCents ?? null); setDay(pending.body.monthlyDay ?? 1);
                setMessage("Deine letzte Anfrage ist noch nicht abschließend bestätigt. Prüfe denselben Auftrag erneut.");
            } else {
                attempt.current=null; saveAttempt(ownerId,null); setAttemptLocked(false); setAttemptAmount(null); setAccepted(false); setEditing(false); setPaying(false); setMessage(null); setDay(value.operation&&!value.operation.finished&&value.operation.kind==="schedule"?value.operation.monthlyDay??1:value.schedule.interval==="monthly"?value.schedule.monthlyDays[0]:1);
            } }
        catch(failure){if(current(ticket)){setSnapshot(null);setError(paymentErrorMessage(failure));}}
        finally{if(current(ticket)){locked.current=false;setBusy(false);}}
    },[ownerId,current,isCurrentOwner]);
    useEffect(()=>{const lifecycle=generation;mounted.current=true;void Promise.resolve().then(load);return()=>{mounted.current=false;++lifecycle.current;attempt.current=null;};},[load]);
    async function submit(action:"schedule"|"payout") {
        if(locked.current||!snapshot||action==="payout"&&!accepted||!isCurrentOwner())return;
        const body: PendingAttempt["body"]={action,consent:true,...(action==="schedule"?{monthlyDay:day}:{amountCents:snapshot.operation&&!snapshot.operation.finished&&snapshot.operation.kind==="payout"?snapshot.operation.amountCents??snapshot.availableCents:snapshot.availableCents})};
        if(!attempt.current){attempt.current={id:crypto.randomUUID(),mode:snapshot.kind,body};saveAttempt(ownerId,attempt.current);setAttemptAmount(body.amountCents??null);}
        const active=attempt.current,ticket=++generation.current;locked.current=true;setBusy(true);setError(null);setMessage(null);
        try {const value=await paymentRequest<unknown>("/api/payments/recipient/payout-settings",active.body,active.id,ownerId);if(!current(ticket))return;if(!validPayoutSettings(value,ownerId))throw new Error("payout_unconfirmed");setSnapshot(value);attempt.current=null;saveAttempt(ownerId,null);setAttemptLocked(false);setAttemptAmount(null);setAccepted(false);setEditing(false);setPaying(false);window.dispatchEvent(new CustomEvent("workfare-pay-updated",{detail:{ownerId}}));setMessage(value.operation?.replayed?"Dieser Auftrag wurde bereits verarbeitet.":value.operation?.state==="failed"?"Dein Auftrag konnte nicht ausgeführt werden. Dein aktueller Stand wurde geladen.":value.operation&&!value.operation.finished?"Der Auftrag wird noch abgeglichen. Bitte lade den aktuellen Stand erneut.":action==="schedule"?"Dein Auszahlungstag wurde gespeichert.":["failed","canceled"].includes(value.operation?.payoutStatus??"")?"Die Auszahlung konnte nicht abgeschlossen werden. Dein automatischer Auszahlungstag bleibt bestehen.":"Deine Auszahlung wurde beauftragt. Bis zum Bankeingang kann es einige Bankarbeitstage dauern.");update.current?.();}
        catch(failure){if(current(ticket)){setError(paymentErrorMessage(failure));setAttemptLocked(!!attempt.current);}}
        finally{if(current(ticket)){locked.current=false;setBusy(false);}}
    }
    if(ownerChanged)return <section className={styles.surface}><p role="alert" className={styles.error}>{PAYMENT_OWNER_CHANGED}</p></section>;
    return <RecipientPayoutSettingsView snapshot={snapshot} busy={busy} error={error} editing={editing} paying={paying} accepted={accepted} day={day} locked={attemptLocked} message={message} attemptAmount={attemptAmount}
      onRefresh={()=>void load()} onEdit={()=>{setEditing(true);setPaying(false);setAccepted(false);setMessage(null);}} onPayout={()=>{setPaying(true);setEditing(false);setAccepted(false);setMessage(null);}} onCancel={()=>{setEditing(false);setPaying(false);setAccepted(false);}} onAccepted={setAccepted} onDay={setDay} onSubmit={submit} onManageBank={onManageBank}/>;
}
export function RecipientPayoutSettingsView({snapshot,busy,error,editing,paying,accepted,day,locked,message,attemptAmount=null,onRefresh,onEdit,onPayout,onCancel,onAccepted,onDay,onSubmit,onManageBank}:{snapshot:Snapshot|null;busy:boolean;error:string|null;editing:boolean;paying:boolean;accepted:boolean;day:number;locked:boolean;message:string|null;attemptAmount?:number|null;onRefresh:()=>void;onEdit:()=>void;onPayout:()=>void;onCancel:()=>void;onAccepted:(value:boolean)=>void;onDay:(day:number)=>void;onSubmit:(action:"schedule"|"payout")=>void;onManageBank?:()=>void}) {
    const consentId=useId();
    const retry=snapshot?.operation&&!snapshot.operation.finished;
    const amount=attemptAmount??(retry?snapshot.operation?.amountCents??0:snapshot?.availableCents??0);
    return <section className={styles.surface} aria-labelledby="payout-settings-heading" aria-busy={busy}>
        <div className={styles.sectionHeading}><h2 id="payout-settings-heading">Auszahlungen</h2><button type="button" className={`app-glass-control ${styles.iconButton}`} aria-label="Auszahlungsstand aktualisieren" disabled={busy} onClick={onRefresh}><RefreshCw size={17}/></button></div>
        {!snapshot&&busy?<p role="status" className={styles.loading}><Loader2 size={17} className={styles.spinner}/>Aktueller Stand wird geladen …</p>:snapshot?<>
          <div className={own.plan}><div><strong>{scheduleText(snapshot.schedule)}</strong><span>Automatische Bankauszahlung</span></div><button type="button" className={`app-glass-control ${styles.action}`} disabled={busy||locked||!!retry&&snapshot.operation?.kind!=="schedule"} onClick={onEdit}><CalendarDays size={16}/>Ändern</button></div>
          {!editing&&!paying&&<div className={own.actions}><button type="button" className={`app-glass-control ${styles.action}`} disabled={busy||!snapshot.canRequestPayout&&!retry} onClick={retry&&snapshot.operation?.kind==="schedule"?onEdit:onPayout}><ArrowDownToLine size={17}/>{retry?snapshot.operation?.kind==="schedule"?"Auszahlungstag prüfen":"Auszahlung prüfen":snapshot.canRequestPayout?`${money.format(snapshot.availableCents/100)} jetzt auszahlen`:"Jetzt auszahlen"}</button></div>}
          {editing&&<form className={own.editor} onSubmit={event=>{event.preventDefault();onSubmit("schedule");}}><label>Monatlicher Auszahlungstag<select value={day} disabled={busy||locked||!!retry} onChange={event=>onDay(Number(event.target.value))}>{Array.from({length:31},(_,i)=><option value={i+1} key={i+1}>Am {i+1}. des Monats</option>)}</select></label><p className={own.hint}>Am Wochenende oder an Feiertagen folgt die Auszahlung am nächsten Bankarbeitstag.</p><div className={own.actions}><button type="submit" className={`app-glass-control ${styles.action}`} disabled={busy}>Auszahlungstag speichern</button><button type="button" className={styles.quietButton} disabled={busy||locked} onClick={onCancel}>Abbrechen</button></div></form>}
          {paying&&<form className={own.editor} onSubmit={event=>{event.preventDefault();onSubmit("payout");}}><p className={own.hint}>Du überweist {money.format(amount/100)} auf deine hinterlegte Bankverbindung. Dein automatischer Auszahlungstag bleibt bestehen.</p><label className={styles.consent} htmlFor={consentId}><input id={consentId} type="checkbox" checked={accepted} disabled={busy||locked} onChange={event=>onAccepted(event.target.checked)}/><span>Ich möchte diese Bankauszahlung beauftragen.</span></label><div className={own.actions}><button type="submit" className={`app-glass-control ${styles.action}`} disabled={busy||!accepted}>{busy?<Loader2 size={16} className={styles.spinner}/>:<ArrowDownToLine size={16}/>} {retry||locked?"Erneut prüfen":`${money.format(amount/100)} auszahlen`}</button><button type="button" className={styles.quietButton} disabled={busy||locked} onClick={onCancel}>Abbrechen</button></div></form>}
          {retry&&<p className={own.notice}>Der Vorgang wird noch abgeglichen. Ein erneuter Versuch verwendet denselben Auftrag.</p>}
          {snapshot.reasonCode==="balance_not_available"&&<p className={own.hint}>{snapshot.pendingCents>0?"Deine Zahlung wird noch verarbeitet. Erst verfügbare Beträge können an deine Bank überwiesen werden.":"Aktuell ist kein Betrag für eine Bankauszahlung verfügbar."}</p>}
          {snapshot.reasonCode==="multiple_payment_sources"&&<p className={own.hint}>Diese Beträge werden nach deinem automatischen Auszahlungsplan überwiesen.</p>}
          {snapshot.bank&&<div className={own.bank}><div><span>Deine Bankverbindung</span><strong>{snapshot.bank.bankName??"Bankkonto"}</strong><small>{snapshot.bank.country} · •••• {snapshot.bank.last4}</small></div>{onManageBank&&<button type="button" className={`app-glass-control ${styles.action}`} disabled={busy||locked||!!retry} onClick={onManageBank}>Ändern</button>}</div>}
        </>:null}
        {error&&<div className={styles.error}><p role="alert">{error}</p><button type="button" className={styles.quietButton} disabled={busy} onClick={onRefresh}>Aktuellen Stand laden</button></div>}
        {message&&!error&&<p role="status" className={styles.feedback}><Check size={16}/>{message}</p>}
    </section>;
}
