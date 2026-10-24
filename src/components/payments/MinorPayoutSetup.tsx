"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Check, Landmark, Loader2, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { paymentErrorMessage, paymentRequest } from "./payment-client";
import { stripeKeyMatchesKind } from "./PaymentEnvironment";
import { PAYMENT_OWNER_CHANGED, usePaymentOwner } from "./usePaymentOwner";
import styles from "./Payments.module.css";
import bankStyles from "./MinorPayoutSetup.module.css";

const BankIbanForm = dynamic(() => import("./BankIbanForm"), { ssr: false, loading: () => <p role="status" className={styles.loading}>Sicheres Bankfeld wird geladen …</p> });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reasons = ["guardian_consent_required", "recipient_setup_required", "recipient_guardian_binding_conflict"];
export type MinorBankContext = {
    ownerId: string; kind: "live"; hasPayoutMethod: boolean; ready: boolean; canStart: boolean; needsRestart: boolean;
    guardians: { guardianId: string; name: string }[];
    preferredGuardianId?: string | null;
    requiresGuardianAction?: boolean;
    publishableKey: string; holderName: string;
    reasonCode: "guardian_consent_required" | "recipient_setup_required" | "recipient_guardian_binding_conflict" | null;
};
type BankOperation = { id: string; guardianId: string; restart: boolean };

export function validMinorBankContext(value: unknown, ownerId: string): value is MinorBankContext {
    if (!UUID.test(ownerId) || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>, ids = new Set<string>();
    if (row.ownerId !== ownerId || row.kind !== "live" || ![row.hasPayoutMethod, row.ready, row.canStart, row.needsRestart].every(item => typeof item === "boolean")
        || (row.reasonCode !== null && !reasons.includes(row.reasonCode as string)) || !Array.isArray(row.guardians) || row.guardians.length > 100
        || !stripeKeyMatchesKind("live", row.publishableKey) || typeof row.holderName !== "string" || !row.holderName.trim() || row.holderName.length > 200 || /[\u0000-\u001f\u007f]/.test(row.holderName)
        || row.requiresGuardianAction !== undefined && typeof row.requiresGuardianAction !== "boolean") return false;
    if (row.ready && (!row.hasPayoutMethod || row.needsRestart || row.reasonCode !== null || row.guardians.length === 0 || row.requiresGuardianAction === true)) return false;
    if (row.needsRestart && row.hasPayoutMethod || row.canStart && row.reasonCode === "guardian_consent_required") return false;
    if (row.canStart && row.guardians.length === 0) return false;
    const guardiansValid = row.guardians.every(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const guardian = value as Record<string, unknown>;
        if (typeof guardian.guardianId !== "string" || !UUID.test(guardian.guardianId) || guardian.guardianId === ownerId || ids.has(guardian.guardianId)
            || typeof guardian.name !== "string" || !guardian.name.trim() || guardian.name.length > 200 || /[\u0000-\u001f\u007f]/.test(guardian.name)) return false;
        ids.add(guardian.guardianId); return true;
    });
    return guardiansValid && (row.preferredGuardianId === undefined || row.preferredGuardianId === null
        || typeof row.preferredGuardianId === "string" && ids.has(row.preferredGuardianId));
}

export function MinorPayoutSetup({ ownerId, onUpdated }: { ownerId: string; onUpdated?: () => void }) {
    const { isCurrentOwner, ownerChanged } = usePaymentOwner(ownerId);
    const [context, setContext] = useState<MinorBankContext | null>(null);
    const [guardianId, setGuardianId] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(false), locked = useRef(false), generation = useRef(0);
    const operation = useRef<BankOperation | null>(null);
    const updateCallback = useRef(onUpdated);
    useEffect(() => { updateCallback.current = onUpdated; }, [onUpdated]);
    const current = useCallback((ticket: number) => mounted.current && generation.current === ticket && isCurrentOwner(), [isCurrentOwner]);

    const load = useCallback(async () => {
        if (!mounted.current || locked.current || !isCurrentOwner()) return;
        const ticket = ++generation.current;
        locked.current = true; setBusy(true); setError(null); setAccepted(false); setContext(null); operation.current = null;
        try {
            const value = await paymentRequest<unknown>("/api/payments/recipient/bank", undefined, undefined, ownerId);
            if (!current(ticket)) return;
            if (!validMinorBankContext(value, ownerId)) throw new Error("unconfirmed_bank_context");
            setContext(value);
            setGuardianId(selected => value.guardians.some(guardian => guardian.guardianId === selected) ? selected
                : value.preferredGuardianId ?? (value.guardians.length === 1 ? value.guardians[0].guardianId : ""));
        } catch (failure) { if (current(ticket)) { setContext(null); setError(paymentErrorMessage(failure)); } }
        finally { if (current(ticket)) { locked.current = false; setBusy(false); } }
    }, [ownerId, current, isCurrentOwner]);

    useEffect(() => {
        const lifecycleGeneration = generation;
        mounted.current = true;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, authSession) => {
            if (event !== "SIGNED_OUT" && (!authSession?.user.id || authSession.user.id === ownerId)) return;
            ++generation.current; locked.current = false; operation.current = null;
            setContext(null); setAccepted(false); setBusy(false);
        });
        void Promise.resolve().then(load);
        return () => { mounted.current = false; ++lifecycleGeneration.current; operation.current = null; subscription.unsubscribe(); };
    }, [ownerId, load]);

    async function save(bankToken: string) {
        if (!context?.canStart || context.hasPayoutMethod || !accepted || !context.guardians.some(guardian => guardian.guardianId === guardianId) || locked.current || !isCurrentOwner()) throw new Error("bank_context_changed");
        const ticket = ++generation.current;
        locked.current = true; setBusy(true); setError(null);
        if (!operation.current || operation.current.guardianId !== guardianId || operation.current.restart !== context.needsRestart) {
            operation.current = { id: crypto.randomUUID(), guardianId, restart: context.needsRestart };
        }
        const active = operation.current;
        try {
            const value = await paymentRequest<unknown>("/api/payments/recipient/bank", { consent: true, bankToken, guardianId: active.guardianId, ...(active.restart ? { restart: true } : {}) }, active.id, ownerId);
            if (!current(ticket)) throw new Error("owner_changed");
            if (!validMinorBankContext(value, ownerId) || !value.hasPayoutMethod || value.needsRestart) throw new Error("unconfirmed_bank_context");
            setContext(value); setAccepted(false); operation.current = null;
            updateCallback.current?.();
        } finally { if (current(ticket)) { locked.current = false; setBusy(false); } }
    }

    if (!UUID.test(ownerId) || ownerChanged) return <section className={styles.surface}><p role="alert" className={styles.error}>{PAYMENT_OWNER_CHANGED}</p><Link href="/app-home/settings/payments" className={`app-glass-control ${styles.action}`}>Workfare Pay neu öffnen</Link></section>;
    const visible = context?.ownerId === ownerId ? context : null;
    const selected = visible?.guardians.some(guardian => guardian.guardianId === guardianId);
    return <section className={styles.surface} aria-labelledby="minor-bank-heading" aria-busy={busy}>
        <div className={styles.sectionHeading}><h2 id="minor-bank-heading">Deine Bankverbindung</h2><button type="button" className={`app-glass-control ${styles.iconButton}`} aria-label="Bankverbindungsstatus aktualisieren" disabled={busy} onClick={() => void load()}><RefreshCw size={17} /></button></div>
        <MinorPayoutSetupView context={visible} guardianId={guardianId} busy={busy} onGuardianChange={id => { operation.current = null; setGuardianId(id); setAccepted(false); }}>
            {visible && <BankIbanForm key={`${ownerId}:${guardianId}:${visible.needsRestart}`} publishableKey={visible.publishableKey} holderName={visible.holderName} needsRestart={visible.needsRestart} accepted={accepted} onAccepted={setAccepted} isCurrentOwner={isCurrentOwner} onSave={save} disabled={!selected || busy} />}
        </MinorPayoutSetupView>
        {error && <p className={styles.error} role="alert">{error}</p>}
    </section>;
}

export function MinorPayoutSetupView({ context, guardianId, busy, onGuardianChange, children }: {
    context: MinorBankContext | null; guardianId: string; busy: boolean; onGuardianChange: (id: string) => void; children?: ReactNode;
}) {
    const id = useId();
    if (!context) return busy ? <p role="status" className={styles.loading}><Loader2 size={17} className={styles.spinner} />Aktueller Stand wird geladen …</p> : <p className={styles.smallCopy}>Lade den aktuellen Stand erneut, um deine Bankverbindung einzurichten.</p>;
    const selected = context.guardians.find(guardian => guardian.guardianId === guardianId);
    const familyAction = context.reasonCode === "guardian_consent_required" || context.reasonCode === "recipient_guardian_binding_conflict";
    return <div className={bankStyles.body}>
        <div className={bankStyles.identity}><span className={bankStyles.icon} aria-hidden="true">{context.hasPayoutMethod ? <Check size={22} /> : <Landmark size={23} />}</span><div><strong>{context.ready ? "Auszahlung bereit" : context.hasPayoutMethod ? "Bankverbindung hinterlegt" : "Deine Vergütung auf dein Konto"}</strong><p>{context.hasPayoutMethod ? context.ready ? "Deinen Auszahlungsstand siehst du in der Übersicht." : context.requiresGuardianAction ? "Für die Auszahlung fehlen noch Angaben deines Elternteils bei Stripe." : "Die Auszahlung ist bereit, sobald alle erforderlichen Angaben bestätigt sind." : "Ergänze hier selbst deine Bankverbindung für Auszahlungen."}</p></div></div>
        {context.guardians.length > 0 && <p className={bankStyles.approval}><Check size={15} aria-hidden="true" />Elternfreigabe hinterlegt{selected ? ` · ${selected.name}` : ""}</p>}
        {context.hasPayoutMethod && !context.ready && context.requiresGuardianAction && <ParentPayoutNextStep />}
        {!context.canStart && !context.ready && !context.hasPayoutMethod && context.reasonCode !== null ? <div className={styles.editorActions}><p className={styles.smallCopy}>{context.reasonCode === "guardian_consent_required" ? "Bitte lass deine Elternfreigabe zuerst bestätigen." : context.reasonCode === "recipient_guardian_binding_conflict" ? "Die aktuelle Freigabe und die Auszahlungseinrichtung müssen zuerst zusammenpassen." : "Die Einrichtung ist gerade nicht verfügbar. Bitte prüfe den aktuellen Stand später erneut."}</p>{familyAction && <Link href="/guardian/access" className={`app-glass-control ${styles.action}`}><ArrowRight size={17} />{context.reasonCode === "guardian_consent_required" ? "Elternfreigabe anfordern" : "Familie ansehen"}</Link>}</div> : context.canStart && !context.hasPayoutMethod ? <div className={bankStyles.form}>
            {context.guardians.length > 1 && <label className={bankStyles.field} htmlFor={`${id}-guardian`}>Elternfreigabe<select id={`${id}-guardian`} value={guardianId} disabled={busy} onChange={event => onGuardianChange(event.target.value)}><option value="" disabled>Elternfreigabe wählen</option>{context.guardians.map(guardian => <option key={guardian.guardianId} value={guardian.guardianId}>{guardian.name}</option>)}</select></label>}
            {context.needsRestart && <p className={styles.smallCopy}>Die bisherige, ungenutzte Einrichtung wird neu begonnen. Deine Elternfreigabe bleibt bestehen.</p>}
            {children}
        </div> : null}
    </div>;
}

function ParentPayoutNextStep() {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
    async function copy() {
        try { await navigator.clipboard.writeText(new URL("/guardian/access", window.location.origin).href); setStatus("copied"); }
        catch { setStatus("failed"); }
    }
    return <div className={bankStyles.parentStep}><p>Bitte dein Elternteil, im Familienbereich „Auszahlung begleiten“ zu öffnen und die erforderlichen Angaben zu ergänzen.</p><button type="button" className={`app-glass-control ${styles.action}`} onClick={() => void copy()}>{status === "copied" ? "Link kopiert" : "Link für deine Eltern kopieren"}</button>{status === "copied" && <span role="status">Du kannst den Link jetzt an dein Elternteil weitergeben.</span>}{status === "failed" && <p role="status">Der Link konnte nicht kopiert werden. <Link href="/guardian/access">Familienbereich öffnen</Link></p>}</div>;
}
