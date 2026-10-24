"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Loader2, RefreshCw, X } from "lucide-react";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { GuardianRecipientContext, GuardianRecipientReason } from "@/lib/payments/recipient-minor-types";
import { paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import styles from "./Guardian.module.css";
import payStyles from "@/components/payments/Payments.module.css";
import { stripeKeyMatchesKind } from "@/components/payments/PaymentEnvironment";
import { PayWordmark } from "@/components/payments/PayWordmark";
import { PaymentEmbedBoundary } from "@/components/payments/PaymentEmbedBoundary";
import { StripeReloadButton, type StripeEmbedControls } from "@/components/payments/StripeEmbedControls";
import { logoutRecipientConnectSessions } from "@/components/payments/recipient-connect-lifecycle";

const EmbeddedRecipient=dynamic(()=>import("@/components/payments/EmbeddedRecipient"),{ssr:false,loading:()=><p className={styles.fieldHint}>Auszahlungseinrichtung wird geladen …</p>});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Overview = GuardianRecipientContext;
type ChildPayout = Overview["children"][number];
const reasons: GuardianRecipientReason[] = ["guardian_kyc_required", "guardian_identity_mismatch", "guardian_terms_required", "recipient_country_model_unsupported", "recipient_setup_required", "recipient_guardian_binding_conflict"];
type Resource = { overview: Overview | null; pendingChild: string | null; error: string | null; loaded: boolean };
type EmbeddedSetup={ownerId:string;childId:string;kind:"live";component:"onboarding";clientSecret:string;publishableKey:string};
type Actions = Resource & { start: (childId: string, options?: { restart?: true }) => Promise<void>; refresh: (childId: string) => Promise<void>; reload: () => Promise<void>; session:EmbeddedSetup|null; closeSession:()=>Promise<void>; renewSession:(childId:string)=>Promise<string>; failSession:()=>void };
const Payouts = createContext<Actions | null>(null);

export function guardianPayoutEmbeddedSession(value:unknown,ownerId:string,childId:string):EmbeddedSetup|null {
    if(!UUID.test(ownerId)||!UUID.test(childId)||ownerId===childId||!value||typeof value!=="object"||Array.isArray(value))return null;
    const row=value as Record<string,unknown>;
    return row.ownerId===ownerId&&row.childId===childId&&row.kind==="live"&&row.component==="onboarding"
        && typeof row.publishableKey==="string"&&stripeKeyMatchesKind("live",row.publishableKey)
        && typeof row.clientSecret==="string"&&row.clientSecret.length>0&&row.clientSecret.length<=4096&&!/[\s\u0000-\u001f\u007f]/.test(row.clientSecret)
        ? row as EmbeddedSetup : null;
}

export function validGuardianPayoutOverview(value: unknown, ownerId: string): value is Overview {
    if (!value || typeof value !== "object" || Array.isArray(value) || !UUID.test(ownerId)) return false;
    const row = value as Record<string, unknown>;
    const ids = new Set<string>();
    return row.ownerId === ownerId && row.kind === "live" && Array.isArray(row.children) && row.children.length <= 100 && row.children.every(child => {
        if (!child || typeof child !== "object" || Array.isArray(child)) return false;
        const item = child as Record<string, unknown>;
        if (typeof item.childId !== "string" || !UUID.test(item.childId) || ids.has(item.childId) || item.childId === ownerId) return false;
        ids.add(item.childId);
        return typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 200
            && typeof item.status === "string" && ["not_started", "onboarding", "pending", "ready", "restricted", "unavailable"].includes(item.status)
            && typeof item.canStartPayout === "boolean" && (item.reasonCode === null || reasons.includes(item.reasonCode as GuardianRecipientReason))
            && (item.canRestartPayout === undefined || typeof item.canRestartPayout === "boolean")
            && !(item.canStartPayout === true && item.canRestartPayout === true)
            && (item.status !== "ready" || (item.reasonCode === null && item.canRestartPayout !== true));
    });
}

export function guardianPayoutHostedUrl(value: unknown, ownerId: string, now = Date.now()): string | null {
    if (!UUID.test(ownerId) || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.ownerId !== ownerId || row.kind !== "live" || row.requiresExternalBrowser !== true || typeof row.url !== "string"
        || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now) return null;
    try {
        const url = new URL(row.url);
        return url.origin === "https://connect.stripe.com" && !url.username && !url.password && !url.hash && url.pathname.startsWith("/setup/") ? url.href : null;
    } catch { return null; }
}

function errorMessage(error: unknown) {
    if (error instanceof PaymentRequestError) {
        if (["recipient_identity_unconfirmed", "recipient_identity_mismatch"].includes(error.code || "")) return error.message;
        if (error.code === "owner_mismatch" || error.code === "authentication_required") return "Bitte öffne den Familienbereich nach deiner Anmeldung erneut.";
        if (["guardian_consent_required", "guardian_binding_required"].includes(error.code || "")) return "Bitte prüfe zuerst die Elternfreigabe für dieses Kind.";
        if (["recipient_minor_not_supported", "recipient_country_not_supported", "invalid_dob_age_under_18", "guardian_model_unsupported"].includes(error.code || "")) return "Stripe unterstützt die Einrichtung für dieses Konto derzeit nicht. Es wurde keine Auszahlung freigegeben.";
    }
    return "Die Einrichtung konnte gerade nicht bestätigt werden. Bitte prüfe den aktuellen Stand und versuche es erneut.";
}

export function GuardianPayoutsProvider({ ownerId, returnChildId, children }: { ownerId: string | null; returnChildId?: string | null; children: ReactNode }) {
    const [resource, setResource] = useState<Resource>({ overview: null, pendingChild: null, error: null, loaded: false });
    const [session,setSession]=useState<EmbeddedSetup|null>(null);
    const sessionScope=useRef<string|null>(null);
    const current = useRef(false);
    const generation = useRef(0);
    const previousOwner = useRef(ownerId);
    const operations = useRef(new Map<string, string>());
    const busy = useRef(false);
    const load = useCallback(async (childId?: string) => {
        if (!ownerId || !current.current || busy.current) return;
        const ticket = ++generation.current;
        busy.current = true;
        if (childId) setResource(value => ({ ...value, pendingChild: childId, error: null }));
        try {
            if (childId) {
                const synced = await paymentRequest<{ ok: boolean; ownerId: string }>("/api/payments/guardian/recipients/sync", { childId }, undefined, ownerId);
                if (synced.ok !== true || synced.ownerId !== ownerId) throw new Error("unconfirmed_sync");
            }
            const result = await paymentRequest<unknown>("/api/payments/guardian/recipients", undefined, undefined, ownerId);
            if (!current.current || ticket !== generation.current) return;
            if (!validGuardianPayoutOverview(result, ownerId)) throw new Error("unconfirmed_overview");
            setResource({ overview: result, pendingChild: null, error: null, loaded: true });
        } catch (error) {
            if (!current.current || ticket !== generation.current) return;
            const disabled = error instanceof PaymentRequestError && ["payments_disabled", "payments_live_not_ready", "guardian_payouts_disabled", "payments_live_disabled"].includes(error.code || "");
            setResource(value => ({ overview: childId ? value.overview : null, pendingChild: null, error: disabled ? null : errorMessage(error), loaded: true }));
        } finally { if (ticket === generation.current) busy.current = false; }
    }, [ownerId]);
    useEffect(() => {
        const lifecycleGeneration = generation;
        if(previousOwner.current!==ownerId){
            previousOwner.current=ownerId;
            operations.current.clear();
            void logoutRecipientConnectSessions();
        }
        current.current = true;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event !== "SIGNED_OUT" && (!session?.user.id || session.user.id === ownerId)) return;
            void logoutRecipientConnectSessions();
            current.current = false; ++generation.current; operations.current.clear(); busy.current = false;
            sessionScope.current=null;setSession(null);
            setResource({ overview: null, pendingChild: null, error: null, loaded: false });
        });
        void Promise.resolve().then(() => load(returnChildId && UUID.test(returnChildId) ? returnChildId : undefined));
        return () => { current.current = false; ++lifecycleGeneration.current; sessionScope.current=null;busy.current = false; subscription.unsubscribe(); };
    }, [load, ownerId, returnChildId]);

    async function start(childId: string, options?: { restart?: true }) {
        const child = resource.overview?.children.find(value => value.childId === childId);
        const restart = options?.restart === true;
        if (!ownerId || !current.current || busy.current || !child || (restart ? !child.canRestartPayout : !child.canStartPayout)) return;
        busy.current = true; const ticket = ++generation.current;
        setResource(value => ({ ...value, pendingChild: childId, error: null }));
        const operationScope = restart ? `${childId}:restart` : childId;
        let operation = operations.current.get(operationScope);
        if (!operation) { operation = crypto.randomUUID(); operations.current.set(operationScope, operation); }
        try {
            const result = await paymentRequest<unknown>("/api/payments/guardian/recipients", { childId, consent: true, uiMode:"embedded", ...(restart ? { restart: true } : {}) }, operation, ownerId);
            if (!current.current || ticket !== generation.current) return;
            const setup=guardianPayoutEmbeddedSession(result,ownerId,childId);
            if(!setup)throw new Error("unconfirmed_embedded_session");
            operations.current.set(childId, operation);
            sessionScope.current=childId;setSession(setup);
            setResource(value=>({...value,pendingChild:null,error:null}));
        } catch (error) {
            if (current.current && ticket === generation.current) {
                // Retain the same operation after an uncertain response. Stripe or the server
                // may already have prepared the account before the connection failed.
                setResource(value => ({ ...value, pendingChild: null, error: errorMessage(error) }));
            }
        } finally { if (ticket === generation.current) busy.current = false; }
    }
    async function renewSession(childId:string){
        if(!ownerId||!current.current||sessionScope.current!==childId)throw new Error("owner_changed");
        const ticket=generation.current;
        let operation=operations.current.get(childId);
        if(!operation){operation=crypto.randomUUID();operations.current.set(childId,operation);}
        const result=await paymentRequest<unknown>("/api/payments/guardian/recipients",{childId,consent:true,uiMode:"embedded"},operation,ownerId);
        if(!current.current||sessionScope.current!==childId||generation.current!==ticket)throw new Error("owner_changed");
        const setup=guardianPayoutEmbeddedSession(result,ownerId,childId);
        if(!setup)throw new Error("unconfirmed_embedded_session");
        return setup.clientSecret;
    }
    async function closeSession(){
        const childId=sessionScope.current;
        sessionScope.current=null;setSession(null);
        if(childId)await load(childId);
    }
    const visibleOverview=resource.overview?.ownerId===ownerId ? resource.overview : null;
    const visibleSession=session?.ownerId===ownerId ? session : null;
    return <Payouts.Provider value={{ ...resource, overview:visibleOverview, start, refresh: childId => load(childId),reload:()=>load(),session:visibleSession,closeSession,renewSession,
        failSession:()=>setResource(value=>({...value,error:"Die Auszahlungseinrichtung konnte gerade nicht geladen werden. Bitte lade den Bereich erneut."})) }}>{children}<GuardianEmbeddedSetup /></Payouts.Provider>;
}

export function guardianPayoutHint(entry: ChildPayout): string | null {
    if (entry.reasonCode === "guardian_identity_mismatch") return entry.canStartPayout ? "Bitte prüfe deine Angaben als gesetzliche Vertretung bei Stripe." : "Die frühere Auszahlungseinrichtung ist einer anderen gesetzlichen Vertretung zugeordnet. Deine Elternfreigabe bleibt gültig.";
    if (entry.reasonCode === "guardian_terms_required") return "Die Stripe-Bedingungen müssen noch direkt bei Stripe bestätigt werden.";
    if (entry.reasonCode === "recipient_country_model_unsupported") return "Stripe unterstützt die Auszahlung für dieses Konto derzeit nicht. Es wurde keine Auszahlung freigegeben.";
    if (entry.reasonCode === "recipient_guardian_binding_conflict") return "Die frühere Auszahlungseinrichtung ist einer anderen gesetzlichen Vertretung zugeordnet. Deine Elternfreigabe bleibt gültig.";
    if (entry.status === "pending") return "Stripe prüft die Angaben. Die Auszahlung ist noch nicht freigegeben.";
    if (entry.status === "restricted" || entry.status === "unavailable") return "Die Auszahlung ist noch nicht freigegeben. Bitte prüfe den aktuellen Stand.";
    return null;
}

export function GuardianPayoutAction({ childId }: { childId: string }) {
    const context = useContext(Payouts);
    const entry = context?.overview?.children.find(value => value.childId === childId);
    if (!context) return null;
    if (!entry) return context.error ? <div role="alert"><p>{context.error}</p><button type="button" className={styles.quiet} onClick={()=>void context.reload()}>Erneut laden</button></div>
        : <p>{context.loaded ? "Die Auszahlungseinrichtung ist gerade nicht verfügbar. Deine Elternfreigabe bleibt gespeichert." : "Auszahlungsangaben werden geladen …"}</p>;
    if(context.session?.childId===childId) return null;
    return <>{context.error && <p role="alert">{context.error}</p>}<GuardianPayoutActionView key={childId} entry={entry} pending={context.pendingChild !== null} onStart={() => context.start(childId)} onRestart={() => context.start(childId,{restart:true})} onRefresh={() => context.refresh(childId)} /></>;
}

function GuardianEmbeddedSetup() {
    const context=useContext(Payouts);
    const controls=useRef<StripeEmbedControls|null>(null);
    const section=useRef<HTMLElement|null>(null);
    const session=context?.session;
    const entry=context?.overview?.children.find(child=>child.childId===session?.childId);
    const childId=session?.childId;
    useEffect(()=>{
        if(!childId)return;
        section.current?.focus({preventScroll:true});
        section.current?.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
    },[childId]);
    if(!context||!session||!entry)return null;
    return <section ref={section} tabIndex={-1} className={styles.payoutEmbed} data-guardian-payout-embedded aria-label={`Auszahlung für ${entry.name}`}>
        <div className={payStyles.sectionHeading}><div><h2><PayWordmark /></h2><p className={styles.fieldHint}>Auszahlung für {entry.name}</p></div><div className={payStyles.headerTools}><StripeReloadButton controls={controls}/><button type="button" className={`${styles.iconButton} ${styles.glass}`} aria-label="Auszahlungseinrichtung schließen" onClick={()=>void context.closeSession()}><X size={18}/></button></div></div>
        <div className={payStyles.embedded}><PaymentEmbedBoundary onCancel={()=>void context.closeSession()} headerControls><EmbeddedRecipient key={`${session.ownerId}:${childId}:${session.clientSecret}`} ownerId={session.ownerId} kind="live" publishableKey={session.publishableKey} clientSecret={session.clientSecret} component="onboarding" onExit={()=>void context.closeSession()} onError={context.failSession} controlsRef={controls} getClientSecret={()=>context.renewSession(session.childId)} /></PaymentEmbedBoundary></div>
    </section>;
}

export function GuardianPayoutActionView({ entry, pending, onStart, onRestart, onRefresh }: { entry: ChildPayout; pending: boolean; onStart: () => void; onRestart?: () => void; onRefresh: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const [accepted, setAccepted] = useState(false);
    if (entry.status === "ready") return <p className={styles.fieldHint}>Auszahlung eingerichtet.</p>;
    const hint = guardianPayoutHint(entry);
    const restart = !entry.canStartPayout && entry.canRestartPayout === true && Boolean(onRestart);
    const canOpen = entry.canStartPayout || restart;
    return <div className={styles.payoutSetup}>
        {hint && <p className={styles.fieldHint}>{hint}</p>}
        {expanded && canOpen ? <GuardianPayoutConsent name={entry.name} accepted={accepted} pending={pending} restart={restart} onAccepted={setAccepted} onStart={restart ? onRestart! : onStart} onCancel={() => { setExpanded(false); setAccepted(false); }} /> : canOpen && <div className={styles.actions}><button type="button" className={`${styles.action} ${styles.glass}`} disabled={pending} onClick={() => { setExpanded(true); setAccepted(false); }}>{restart ? "Einrichtung neu beginnen" : entry.status === "not_started" ? "Auszahlung einrichten" : "Einrichtung fortsetzen"}<ArrowUpRight size={16} aria-hidden="true" /></button>{entry.canStartPayout && entry.status !== "not_started" && <button type="button" className={styles.quiet} disabled={pending} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />Stand prüfen</button>}</div>}
    </div>;
}

export function GuardianPayoutConsent({ name, accepted, pending, restart = false, onAccepted, onStart, onCancel }: { name: string; accepted: boolean; pending: boolean; restart?: boolean; onAccepted: (value: boolean) => void; onStart: () => void; onCancel: () => void }) {
    return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (accepted && !pending) onStart(); }}>
        <p className={styles.fieldHint}>{restart ? `Die frühere Einrichtung für ${name} wird getrennt aufbewahrt. Du beginnst die notwendige Prüfung als gesetzliche Vertretung neu.` : `Stripe prüft deine Angaben als gesetzliche Vertretung und die Auszahlung für ${name}.`} Die Stripe-Bedingungen bestätigst du direkt dort.</p>
        <label className={styles.consent}><input type="checkbox" checked={accepted} onChange={event => onAccepted(event.target.checked)} required disabled={pending} /><span>{restart ? `Ich möchte eine neue Stripe-Einrichtung für ${name} als gesetzliche Vertretung beginnen.` : `Ich möchte die Stripe-Einrichtung für ${name} als gesetzliche Vertretung starten.`}</span></label>
        <div className={styles.actions}><button type="submit" className={`${styles.action} ${styles.glass}`} disabled={!accepted || pending}>{pending ? <Loader2 size={16} className={styles.spinner} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}{pending ? "Wird vorbereitet …" : restart ? "Neu beginnen" : "Auszahlung einrichten"}</button><button type="button" className={styles.quiet} disabled={pending} onClick={onCancel}>Abbrechen</button></div>
    </form>;
}
