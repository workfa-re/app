"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { validGuardianChildOverview, type GuardianChildOverviewSnapshot, type GuardianChildView } from "@/lib/guardian/child-overview-types";
import styles from "./Guardian.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const appointment = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const labels = { reserved: "Reserviert", agreed: "Vereinbart", completed: "Abgeschlossen", canceled: "Abgesagt" };

type ChildAccess = "minor_jobs" | "profile_only" | "unavailable" | null;
type Props = { ownerId: string | undefined; childId: string; name: string; onAccess?: (access: ChildAccess) => void };
type Resource = { snapshot: GuardianChildOverviewSnapshot | null; loading: boolean; moreLoading: boolean; error: string | null; denied: boolean };
const empty: Resource = { snapshot: null, loading: true, moreLoading: false, error: null, denied: false };

export function GuardianChildOverview({ ownerId, childId, name, onAccess }: Props) {
    const [resource, setResource] = useState<Resource>(empty);
    const [view, setView] = useState<GuardianChildView>("active");
    const [blockedOwner, setBlockedOwner] = useState<string | null>(null);
    const invalidatedOwner = useRef<string | null>(null);
    const mounted = useRef(false), allowed = useRef(true), generation = useRef(0);
    const pending = useRef<AbortController | null>(null);
    const accessCallback = useRef(onAccess);
    useEffect(() => { accessCallback.current = onAccess; }, [onAccess]);
    const validScope = !!ownerId && UUID.test(ownerId) && UUID.test(childId) && ownerId !== childId;

    const load = useCallback(async (cursor?: string) => {
        if (!mounted.current || !allowed.current || cursor && pending.current) return;
        if (!validScope || !ownerId) {
            setResource({ snapshot: null, loading: false, moreLoading: false, error: "Bitte öffne den Familienbereich nach deiner Anmeldung erneut.", denied: true });
            return;
        }
        pending.current?.abort();
        const controller = new AbortController(), ticket = ++generation.current;
        pending.current = controller;
        setResource(current => ({ ...current, loading: !cursor, moreLoading: !!cursor, error: null, denied: false }));
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const query = new URLSearchParams({ childId, view });
            if (cursor) query.set("cursor", cursor);
            const response = await fetch(`/api/guardian/children/overview?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "X-Workfare-Owner": ownerId } });
            const value: unknown = await response.json().catch(() => null);
            if (!mounted.current || !allowed.current || ticket !== generation.current) return;
            if (response.status === 401 || response.status === 409) {
                allowed.current = false; invalidatedOwner.current = ownerId; ++generation.current;
                setResource(empty); setBlockedOwner(ownerId);
                return;
            }
            if (response.status === 403 || response.status === 404) {
                setResource({ snapshot: null, loading: false, moreLoading: false, error: "Diese Übersicht ist für deinen Zugang gerade nicht freigegeben.", denied: true });
                return;
            }
            if (!response.ok) throw new Error("unconfirmed_child_overview");
            if (!validGuardianChildOverview(value, ownerId, childId, view)) {
                setResource({ snapshot: null, loading: false, moreLoading: false, error: "Die Jobübersicht konnte gerade nicht vollständig bestätigt werden.", denied: true });
                return;
            }
            setResource(current => {
                const previous = current.snapshot;
                const jobs = cursor && previous?.ownerId === ownerId && previous.child.id === childId && previous.view === view
                    ? [...previous.jobs, ...value.jobs].filter((job, index, all) => all.findIndex(row => row.id === job.id) === index)
                    : value.jobs;
                return { snapshot: { ...value, jobs }, loading: false, moreLoading: false, error: null, denied: false };
            });
        } catch {
            if (mounted.current && allowed.current && ticket === generation.current) {
                setResource(current => ({ ...current, snapshot: cursor ? current.snapshot : null, loading: false, moreLoading: false, error: "Die Jobübersicht konnte gerade nicht geladen werden.", denied: false }));
            }
        } finally { clearTimeout(timeout); if (pending.current === controller) pending.current = null; }
    }, [childId, ownerId, validScope, view]);

    useEffect(() => {
        const lifecycle = generation;
        mounted.current = true; allowed.current = invalidatedOwner.current !== ownerId;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event !== "SIGNED_OUT" && (!session?.user.id || session.user.id === ownerId)) return;
            allowed.current = false; invalidatedOwner.current = ownerId ?? null; ++generation.current; pending.current?.abort();
            setResource(empty); setBlockedOwner(ownerId ?? null);
        });
        void Promise.resolve().then(() => load());
        return () => { mounted.current = false; ++lifecycle.current; pending.current?.abort(); subscription.unsubscribe(); };
    }, [load, ownerId]);

    const snapshot = resource.snapshot && resource.snapshot.ownerId === ownerId && resource.snapshot.child.id === childId ? resource.snapshot : null;
    const blocked = !!ownerId && blockedOwner === ownerId;
    useEffect(() => {
        accessCallback.current?.(blocked || resource.denied ? "unavailable" : snapshot?.access ?? null);
    }, [blocked, resource.denied, snapshot]);
    return <GuardianChildOverviewView name={name} snapshot={snapshot} view={view} loading={resource.loading || !!snapshot && snapshot.view !== view} moreLoading={resource.moreLoading} error={resource.error}
        blocked={blocked} denied={resource.denied} onView={setView} onReload={() => void load()} onMore={() => snapshot?.nextCursor && void load(snapshot.nextCursor)} />;
}

export function GuardianChildOverviewView({ name, snapshot, view, loading, moreLoading, error, blocked = false, denied = false, onView, onReload, onMore }: {
    name: string; snapshot: GuardianChildOverviewSnapshot | null; view: GuardianChildView; loading: boolean; moreLoading: boolean; error: string | null;
    blocked?: boolean; denied?: boolean; onView: (view: GuardianChildView) => void; onReload: () => void; onMore: () => void;
}) {
    const id = useId();
    if (blocked) return <p className={styles.fieldHint} role="alert">Bitte öffne den Familienbereich nach deiner Anmeldung erneut.</p>;
    if (denied) return <div className={styles.childFailure}><p role="alert">{error}</p><button type="button" className={styles.quiet} onClick={onReload}>Aktuellen Stand laden<RefreshCw size={15} aria-hidden="true" /></button></div>;
    const displayName = snapshot?.child.name || name;
    const readable = snapshot?.access === "minor_jobs";
    const jobs = snapshot?.view === view ? snapshot.jobs : [];
    return <>
        <header className={styles.childHeading}><ProfileAvatar url={snapshot?.child.avatarUrl ?? null} name={displayName} className={`${styles.childAvatar} ${styles.glass}`} /><h2>{displayName}</h2></header>
        {snapshot?.access === "profile_only" ? <p className={styles.childPrivacy}>Jobs und Kontakte werden hier nicht geteilt.</p> : <>
            <div className={`${styles.childViews} ${styles.glass}`} role="group" aria-label={`Jobs von ${displayName}`}>
                <button type="button" aria-pressed={view === "active"} aria-controls={`${id}-jobs`} onClick={() => onView("active")} disabled={loading || moreLoading}>
                    <strong>{readable ? snapshot.counts?.active ?? "—" : "—"}</strong><span>Aktiv</span>
                </button>
                <button type="button" aria-pressed={view === "completed"} aria-controls={`${id}-jobs`} onClick={() => onView("completed")} disabled={loading || moreLoading}>
                    <strong>{readable ? snapshot.counts?.completed ?? "—" : "—"}</strong><span>Abgeschlossen</span>
                </button>
            </div>
            <div id={`${id}-jobs`} className={styles.childJobs} aria-busy={loading || moreLoading}>
                {loading ? <p className={styles.childLoading} role="status"><Loader2 size={17} className={styles.spinner} aria-hidden="true" />Jobs werden geladen …</p>
                    : readable && !jobs.length ? <p className={styles.childEmpty}>{view === "active" ? "Zurzeit keine aktiven Jobs." : "Noch keine abgeschlossenen Jobs."}</p>
                    : readable ? <ul>{jobs.map(job => <li key={job.id} className={styles.childJob}>
                        <div className={styles.childJobHeading}><h3>{job.title}</h3><span className={styles.childJobStatus}>{job.status === "completed" ? <Check size={13} aria-hidden="true" /> : null}{labels[job.status]}</span></div>
                        <div className={styles.childPartner}><ProfileAvatar url={job.partner.avatarUrl} name={job.partner.name || "Auftraggeber"} className={styles.partnerAvatar} /><span>Mit <strong>{job.partner.name || "Auftraggeber"}</strong></span></div>
                        {job.status === "completed" && job.completedAt ? <p className={styles.childJobDate}><Check size={14} aria-hidden="true" /><time dateTime={job.completedAt}>{date.format(new Date(job.completedAt))}</time></p>
                            : job.startsAt ? <p className={styles.childJobDate}><CalendarDays size={14} aria-hidden="true" /><time dateTime={job.startsAt}>{appointment.format(new Date(job.startsAt))} Uhr</time></p> : null}
                    </li>)}</ul> : null}
                {error ? <div className={styles.childFailure}><p role="alert">{error}</p><button type="button" className={styles.quiet} onClick={onReload} disabled={loading || moreLoading}>Erneut laden<RefreshCw size={15} aria-hidden="true" /></button></div> : null}
                {readable && snapshot.nextCursor ? <button type="button" className={`${styles.quiet} ${styles.childMore}`} onClick={onMore} disabled={loading || moreLoading}>{moreLoading ? <Loader2 size={15} className={styles.spinner} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}Weitere Jobs</button> : null}
            </div>
        </>}
    </>;
}
