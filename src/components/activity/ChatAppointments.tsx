"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Pencil, X } from "lucide-react";
import { manageJobAppointment } from "@/app/app-home/applications/actions";
import { appointmentInputValue, type AppointmentMutation, type AppointmentRequest } from "@/lib/activity/appointments";
import styles from "./ChatAppointments.module.css";

type Appointment = { id: string; starts_at: string; ends_at?: string | null; note?: string | null; status: string };
type Props = {
    applicationId: string; currentUserId: string; isProvider: boolean; recurring: boolean;
    appointments: Appointment[]; formatSchedule: (value?: string | null) => string | null;
    onChanged: (appointment?: Appointment | null) => void;
    onLegacySchedule?: () => void;
    requests: AppointmentRequest[];
    available: boolean | null;
    onReload: () => Promise<void>;
    focusedRequest?: AppointmentRequest | null;
    focusedLoading?: boolean;
    focusedError?: string | null;
    onReloadFocused?: () => void;
    canManage?: boolean;
    onRequestChanged?: (request: AppointmentRequest) => void;
};

export function ChatAppointments(props: Props) {
    return <AppointmentTools key={props.applicationId} {...props} />;
}

function AppointmentTools(props: Props) {
    const router = useRouter();
    const formId = useId();
    const dateRef = useRef<HTMLInputElement>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    const mounted = useRef(true);
    const mutationPending = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [mode, setMode] = useState<"edit" | "add" | "cancel" | null>(null);
    const [target, setTarget] = useState("");
    const [startsAt, setStartsAt] = useState("");
    const [endsAt, setEndsAt] = useState("");
    const [note, setNote] = useState("");
    const active = props.appointments.filter(item => item.status === "scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const defaultAppointment = active.find(item => new Date(item.starts_at).getTime() >= Date.now() - 60_000) ?? active.at(-1);
    const canManage = props.canManage ?? true;
    const hasFocusedRequest = props.focusedRequest !== undefined;
    const request = hasFocusedRequest ? props.focusedRequest : props.requests[0];
    const requestIsPending = request?.status === "pending";
    const hasPendingRequest = requestIsPending || props.requests.some(item => item.status === "pending");

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => { if (mode && mode !== "cancel") dateRef.current?.focus(); }, [mode]);
    useEffect(() => {
        if (!error) return;
        const frame = requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }));
        return () => cancelAnimationFrame(frame);
    }, [error]);

    const selectAppointment = (id: string) => {
        const appointment = active.find(item => item.id === id);
        setTarget(id);
        setStartsAt(appointmentInputValue(appointment?.starts_at));
        setEndsAt(appointmentInputValue(appointment?.ends_at));
        setNote(appointment?.note ?? "");
    };

    const open = (next: "edit" | "add" | "cancel") => {
        if (!canManage) return;
        setError(null); setNotice(null); setMode(next);
        if (next === "add") { setTarget(""); setStartsAt(""); setEndsAt(""); setNote(""); }
        else selectAppointment(defaultAppointment?.id ?? "");
    };

    const perform = async (input: Omit<AppointmentMutation, "applicationId">) => {
        if (!canManage || mutationPending.current) return;
        mutationPending.current = true;
        setPending(true); setError(null); setNotice(null);
        try {
            const result = await manageJobAppointment({ ...input, applicationId: props.applicationId });
            if ("error" in result) { if (mounted.current) setError(result.error ?? "Die Änderung konnte nicht gespeichert werden."); return; }
            if (mounted.current) {
                setMode(null);
                setNotice(input.action === "propose" ? "Vorschlag gesendet. Der bisherige Termin bleibt bis zur Bestätigung bestehen." : input.action === "cancel" ? "Termin abgesagt. Die Zusammenarbeit bleibt geöffnet." : input.action === "decline" ? "Vorschlag abgelehnt. Der bisherige Termin bleibt bestehen." : input.action === "withdraw" ? "Vorschlag zurückgezogen." : "Termin gespeichert.");
                if (result.appointment && typeof result.appointment.id === "string") props.onChanged(result.appointment as Appointment);
                if (result.request && typeof result.request.id === "string") props.onRequestChanged?.(result.request as AppointmentRequest);
            }
            await props.onReload();
            if (mounted.current) router.refresh();
        } catch { if (mounted.current) setError("Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut."); }
        finally { mutationPending.current = false; if (mounted.current) setPending(false); }
    };

    if (props.focusedLoading) return <div className={styles.tools} aria-busy="true"><p className={styles.muted} role="status">Terminvorschlag wird geladen …</p></div>;
    if (props.focusedError) return <div className={styles.tools}>
        <p className={styles.error} role="alert">{props.focusedError}</p>
        {props.onReloadFocused && <button type="button" className={styles.retry} onClick={props.onReloadFocused}>Erneut laden</button>}
    </div>;

    const available = props.available;
    const showMutationTools = canManage && available === true;
    const requestLabel = requestIsPending
        ? request?.requested_by === props.currentUserId ? "Dein offener Vorschlag" : "Neuer Terminvorschlag"
        : request ? REQUEST_STATUS_LABELS[request.status] ?? "Terminvorschlag" : null;

    return <div className={styles.tools} aria-busy={pending}>
        {hasFocusedRequest && !request && <p className={styles.muted}>Dieser Hinweis gehört zum bisherigen Terminverlauf.</p>}
        {request && <div className={styles.request} data-status={request.status}>
            <span className={styles.eyebrow}>{requestLabel}</span>
            <strong>{props.formatSchedule(request.starts_at)}</strong>
            {request.ends_at && <span>Bis {props.formatSchedule(request.ends_at)}</span>}
            {request.note && <p>{request.note}</p>}
            {requestIsPending && <p className={styles.muted}>Der bisherige Termin gilt bis zur Bestätigung.</p>}
            {requestIsPending && showMutationTools && <div className={styles.buttons}>
                {props.isProvider ? <>
                    <button type="button" className={styles.action} disabled={pending} onClick={() => void perform({ action: "accept", requestId: request.id })}><Check aria-hidden="true" />Annehmen</button>
                    <button type="button" className={styles.action} disabled={pending} onClick={() => void perform({ action: "decline", requestId: request.id })}>Ablehnen</button>
                </> : request.requested_by === props.currentUserId && <button type="button" className={styles.action} disabled={pending} onClick={() => void perform({ action: "withdraw", requestId: request.id })}>Vorschlag zurückziehen</button>}
            </div>}
        </div>}
        {!hasFocusedRequest && !request && available === null && <p className={styles.muted} role="status">Terminoptionen werden geladen …</p>}
        {available === false && (canManage || !hasFocusedRequest) && (canManage && props.isProvider && props.onLegacySchedule
            ? <button type="button" className={styles.action} onClick={props.onLegacySchedule}><Pencil aria-hidden="true" />{props.recurring ? "Weiteren Termin vereinbaren" : "Termin bearbeiten"}</button>
            : <p className={styles.muted}>Neue Terminoptionen sind gerade nicht verfügbar. Du kannst dich im Chat abstimmen.<button type="button" className={styles.retry} onClick={() => void props.onReload()}>Erneut laden</button></p>)}
        {showMutationTools && (!mode ? <div className={styles.buttons}>
            {active.length > 0 && <button type="button" className={styles.action} disabled={pending || (!props.isProvider && hasPendingRequest)} onClick={() => open("edit")}><Pencil aria-hidden="true" />{props.isProvider ? "Termin bearbeiten" : "Änderung anfragen"}</button>}
            {(props.recurring || !active.length) && <button type="button" className={styles.action} disabled={pending || (!props.isProvider && hasPendingRequest)} onClick={() => open("add")}><CalendarPlus aria-hidden="true" />{props.isProvider ? "Neuer Termin" : "Termin anfragen"}</button>}
            {props.isProvider && active.length > 0 && <button type="button" className={styles.quiet} disabled={pending} onClick={() => open("cancel")}>Termin absagen</button>}
        </div> : <form className={styles.form} onSubmit={event => {
            event.preventDefault();
            if (mode === "cancel") { void perform({ action: "cancel", appointmentId: target }); return; }
            const start = new Date(startsAt);
            const end = endsAt ? new Date(endsAt) : null;
            if (!Number.isFinite(start.getTime()) || (end && !Number.isFinite(end.getTime()))) { setError("Bitte wähle ein gültiges Datum mit Uhrzeit."); return; }
            void perform({ action: props.isProvider ? mode === "add" ? "add" : "update" : "propose", appointmentId: target || null, startsAt: start.toISOString(), endsAt: end?.toISOString(), note });
        }}>
            <div className={styles.formTitle}><strong>{mode === "cancel" ? "Termin absagen?" : props.isProvider ? mode === "add" ? "Neuer Termin" : "Termin bearbeiten" : "Termin vorschlagen"}</strong><button type="button" className={styles.close} aria-label="Terminbearbeitung schließen" disabled={pending} onClick={() => { setMode(null); setError(null); }}><X aria-hidden="true" /></button></div>
            {mode !== "add" && active.length > 1 && <label htmlFor={`${formId}-target`}>Termin auswählen<select id={`${formId}-target`} value={target} disabled={pending} onChange={event => selectAppointment(event.target.value)}>{active.map(item => <option key={item.id} value={item.id}>{props.formatSchedule(item.starts_at)}</option>)}</select></label>}
            {mode === "cancel" ? <p>Dieser Termin entfällt. Der Chat und eure Zusammenarbeit bleiben geöffnet.</p> : <>
                <label htmlFor={`${formId}-start`}>Beginn<input ref={dateRef} id={`${formId}-start`} type="datetime-local" value={startsAt} required disabled={pending} onChange={event => setStartsAt(event.target.value)} /></label>
                <label htmlFor={`${formId}-end`}>Ende <span className={styles.optional}>optional</span><input id={`${formId}-end`} type="datetime-local" value={endsAt} disabled={pending} onChange={event => setEndsAt(event.target.value)} /></label>
                <label htmlFor={`${formId}-note`}>Hinweis <span className={styles.optional}>optional</span><textarea id={`${formId}-note`} value={note} rows={2} maxLength={1000} disabled={pending} onChange={event => setNote(event.target.value)} /></label>
                {!props.isProvider && <p className={styles.muted}>Der Anbieter bestätigt deinen Vorschlag. Bis dahin gilt der vereinbarte Termin.</p>}
            </>}
            <div className={styles.buttons}><button type="submit" className={styles.action} disabled={pending}>{pending ? "Wird gespeichert …" : mode === "cancel" ? "Termin absagen" : props.isProvider ? "Termin speichern" : "Vorschlag senden"}</button><button type="button" className={styles.quiet} disabled={pending} onClick={() => { setMode(null); setError(null); }}>Abbrechen</button></div>
        </form>)}
        {!canManage && available === true && !request && !hasFocusedRequest && <p className={styles.muted}>Keine offenen Terminvorschläge.</p>}
        {error && <p ref={errorRef} role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status" className={styles.muted}>{notice}</p>}
    </div>;
}

const REQUEST_STATUS_LABELS: Record<AppointmentRequest["status"], string> = {
    pending: "Offener Terminvorschlag",
    accepted: "Vorschlag angenommen",
    declined: "Vorschlag abgelehnt",
    withdrawn: "Vorschlag zurückgezogen",
    superseded: "Vorschlag ersetzt",
};
