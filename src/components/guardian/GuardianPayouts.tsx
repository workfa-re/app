"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { GuardianRecipientContext, GuardianRecipientReason } from "@/lib/payments/recipient-minor-types";
import { paymentRequest, PaymentRequestError } from "@/components/payments/payment-client";
import styles from "./Guardian.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Overview = GuardianRecipientContext;
type ChildPayout = Overview["children"][number];
const reasons: GuardianRecipientReason[] = ["guardian_kyc_required", "guardian_identity_mismatch", "guardian_terms_required", "recipient_country_model_unsupported", "recipient_setup_required", "recipient_guardian_binding_conflict"];
type Resource = { overview: Overview | null; pendingChild: string | null; error: string | null };
type Actions = Resource & { start: (childId: string) => Promise<void>; refresh: (childId: string) => Promise<void> };
const Payouts = createContext<Actions | null>(null);

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
            && (item.status !== "ready" || item.reasonCode === null);
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
    const [resource, setResource] = useState<Resource>({ overview: null, pendingChild: null, error: null });
    const current = useRef(false);
    const generation = useRef(0);
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
            setResource({ overview: result, pendingChild: null, error: null });
        } catch (error) {
            if (!current.current || ticket !== generation.current) return;
            const disabled = error instanceof PaymentRequestError && ["payments_disabled", "payments_live_not_ready", "guardian_payouts_disabled", "payments_live_disabled"].includes(error.code || "");
            setResource(value => ({ overview: childId ? value.overview : null, pendingChild: null, error: disabled ? null : childId ? errorMessage(error) : null }));
        } finally { if (ticket === generation.current) busy.current = false; }
    }, [ownerId]);
    useEffect(() => {
        const lifecycleGeneration = generation;
        current.current = true;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event !== "SIGNED_OUT" && (!session?.user.id || session.user.id === ownerId)) return;
            current.current = false; ++generation.current; operations.current.clear(); busy.current = false;
            setResource({ overview: null, pendingChild: null, error: null });
        });
        void Promise.resolve().then(() => load(returnChildId && UUID.test(returnChildId) ? returnChildId : undefined));
        return () => { current.current = false; ++lifecycleGeneration.current; busy.current = false; subscription.unsubscribe(); };
    }, [load, ownerId, returnChildId]);

    async function start(childId: string) {
        const child = resource.overview?.children.find(value => value.childId === childId);
        if (!ownerId || !current.current || busy.current || !child?.canStartPayout) return;
        busy.current = true; const ticket = ++generation.current;
        setResource(value => ({ ...value, pendingChild: childId, error: null }));
        let operation = operations.current.get(childId);
        if (!operation) { operation = crypto.randomUUID(); operations.current.set(childId, operation); }
        try {
            const result = await paymentRequest<unknown>("/api/payments/guardian/recipients", { childId, consent: true }, operation, ownerId);
            if (!current.current || ticket !== generation.current) return;
            const url = guardianPayoutHostedUrl(result, ownerId);
            if (!url) throw new Error("unconfirmed_hosted_link");
            window.location.assign(url);
        } catch (error) {
            if (current.current && ticket === generation.current) {
                // Retain the same operation after an uncertain response. Stripe or the server
                // may already have prepared the account before the connection failed.
                setResource(value => ({ ...value, pendingChild: null, error: errorMessage(error) }));
            }
        } finally { if (ticket === generation.current) busy.current = false; }
    }
    return <Payouts.Provider value={{ ...resource, start, refresh: childId => load(childId) }}>{children}{resource.error && <p className={styles.fieldHint} role="alert">{resource.error}</p>}</Payouts.Provider>;
}

export function guardianPayoutHint(entry: ChildPayout): string | null {
    if (entry.reasonCode === "guardian_identity_mismatch") return "Die gesetzliche Vertretung konnte bei Stripe noch nicht zugeordnet werden. Bitte prüfe die Angaben.";
    if (entry.reasonCode === "guardian_terms_required") return "Die Stripe-Bedingungen müssen noch direkt bei Stripe bestätigt werden.";
    if (entry.reasonCode === "recipient_country_model_unsupported") return "Stripe unterstützt die Auszahlung für dieses Konto derzeit nicht. Es wurde keine Auszahlung freigegeben.";
    if (entry.reasonCode === "recipient_guardian_binding_conflict") return "Die Auszahlung ist einer anderen gesetzlichen Vertretung zugeordnet. Bitte kontaktiere den Support.";
    if (entry.status === "pending") return "Stripe prüft die Angaben. Die Auszahlung ist noch nicht freigegeben.";
    if (entry.status === "restricted" || entry.status === "unavailable") return "Die Auszahlung ist noch nicht freigegeben. Bitte prüfe den aktuellen Stand.";
    return null;
}

export function GuardianPayoutAction({ childId }: { childId: string }) {
    const context = useContext(Payouts);
    const entry = context?.overview?.children.find(value => value.childId === childId);
    if (!context || !entry) return null;
    return <GuardianPayoutActionView key={childId} entry={entry} pending={context.pendingChild !== null} onStart={() => context.start(childId)} onRefresh={() => context.refresh(childId)} />;
}

export function GuardianPayoutActionView({ entry, pending, onStart, onRefresh }: { entry: ChildPayout; pending: boolean; onStart: () => void; onRefresh: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const [accepted, setAccepted] = useState(false);
    if (entry.status === "ready") return <p className={styles.fieldHint}>Auszahlung eingerichtet.</p>;
    const hint = guardianPayoutHint(entry);
    return <div className={styles.payoutSetup}>
        {hint && <p className={styles.fieldHint}>{hint}</p>}
        {expanded && entry.canStartPayout ? <GuardianPayoutConsent name={entry.name} accepted={accepted} pending={pending} onAccepted={setAccepted} onStart={onStart} onCancel={() => { setExpanded(false); setAccepted(false); }} /> : <div className={styles.actions}>{entry.canStartPayout && <button type="button" className={`${styles.action} ${styles.glass}`} disabled={pending} onClick={() => { setExpanded(true); setAccepted(false); }}>{entry.status === "not_started" ? "Auszahlung einrichten" : "Einrichtung fortsetzen"}<ArrowUpRight size={16} aria-hidden="true" /></button>}{entry.status !== "not_started" && <button type="button" className={styles.quiet} disabled={pending} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />Stand prüfen</button>}</div>}
    </div>;
}

export function GuardianPayoutConsent({ name, accepted, pending, onAccepted, onStart, onCancel }: { name: string; accepted: boolean; pending: boolean; onAccepted: (value: boolean) => void; onStart: () => void; onCancel: () => void }) {
    return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (accepted && !pending) onStart(); }}>
        <p className={styles.fieldHint}>Stripe prüft deine Angaben als gesetzliche Vertretung und die Auszahlung für {name}. Die Stripe-Bedingungen bestätigst du direkt dort.</p>
        <label className={styles.consent}><input type="checkbox" checked={accepted} onChange={event => onAccepted(event.target.checked)} required disabled={pending} /><span>Ich möchte die Stripe-Einrichtung für {name} als gesetzliche Vertretung starten.</span></label>
        <div className={styles.actions}><button type="submit" className={`${styles.action} ${styles.glass}`} disabled={!accepted || pending}>{pending ? <Loader2 size={16} className={styles.spinner} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}{pending ? "Wird vorbereitet …" : "Weiter zu Stripe"}</button><button type="button" className={styles.quiet} disabled={pending} onClick={onCancel}>Abbrechen</button></div>
    </form>;
}
