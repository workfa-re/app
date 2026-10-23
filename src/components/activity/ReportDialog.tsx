"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Flag, Loader2, MessageCircle, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { REPORT_REASONS, type ActivityReportInput, type ReportableContent, type ReportReason, type ReportScope } from "@/lib/activity/reporting";
import { useActivityDialogFocus } from "./useActivityDialogFocus";
import styles from "./ReportDialog.module.css";

export type ReportDialogProps = {
    applicationId: string;
    personId: string;
    personName: string;
    jobTitle: string;
    items: ReportableContent[];
    loading: boolean;
    hasOlder: boolean;
    loadingOlder: boolean;
    loadError: string | null;
    onLoadOlder: () => void;
    onReload: () => void;
    onClose: () => void;
    onSubmit: (input: ActivityReportInput) => Promise<unknown>;
};

const timestamp = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
function contentDate(value: string | null) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? timestamp.format(date) : "Datum nicht verfügbar";
}
const scopes = [
    { value: "person", label: "Person", icon: UserRound },
    { value: "conversation", label: "Gesamter Chat", icon: MessageCircle },
    { value: "message", label: "Nachricht", icon: Flag },
] as const;

export function ReportDialog(props: ReportDialogProps) {
    const id = useId();
    const reducedMotion = useReducedMotion();
    const [scope, setScope] = useState<ReportScope>("person");
    const [reason, setReason] = useState<ReportReason | "">("");
    const [description, setDescription] = useState("");
    const [query, setQuery] = useState("");
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const dialogRef = useActivityDialogFocus<HTMLDivElement>();
    const successRef = useRef<HTMLButtonElement>(null);
    const selectedRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const selected = props.items.find(item => item.key === selectedKey);
    const matches = useMemo(() => {
        const term = query.trim().toLocaleLowerCase("de-DE");
        return term ? props.items.filter(item => item.content.toLocaleLowerCase("de-DE").includes(term)) : props.items;
    }, [props.items, query]);
    const valid = Boolean(reason && (scope !== "message" || selected));

    useEffect(() => {
        if (success) successRef.current?.focus();
    }, [success]);

    function close() { if (!pendingRef.current) props.onClose(); }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!valid || !reason || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setError(null);
        try {
            const result = await props.onSubmit({
                applicationId: props.applicationId,
                reportedUserId: props.personId,
                scope,
                reasonCode: reason,
                details: description.trim() || undefined,
                messageId: scope === "message" && selected?.kind === "message" ? selected.id : null,
                reopenRequestId: scope === "message" && selected?.kind === "reopen_request" ? selected.id : null,
            });
            const response = result && typeof result === "object" ? result as Record<string, unknown> : null;
            if (typeof response?.error === "string") throw new Error(response.error);
            if (response?.ok !== true || typeof response.report_id !== "string" || !response.report_id.trim()) throw new Error("Die Meldung wurde nicht bestätigt. Bitte versuche es erneut.");
            setSuccess(true);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Die Meldung konnte nicht gesendet werden. Bitte versuche es erneut.");
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    }

    return <div className={styles.layer} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
        <div className={styles.backdrop} aria-hidden="true" />
        <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} aria-busy={pending} tabIndex={-1} className={styles.dialog}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }} transition={{ duration: reducedMotion ? 0 : .2 }}>
            {success ? <div className={styles.success}>
                <span className={styles.successIcon}><CheckCircle2 aria-hidden="true" /></span>
                <h2 id={`${id}-title`}>Meldung eingegangen</h2>
                <p id={`${id}-intro`}>Danke für deinen Hinweis. Unser Team kann deine Meldung jetzt prüfen.</p>
                <button ref={successRef} type="button" className={cn(styles.button, styles.primary)} onClick={close}>Zurück zu den Details</button>
            </div> : <form onSubmit={event => void submit(event)} className={styles.form}>
                <header className={styles.header}>
                    <button type="button" className={styles.back} onClick={close} disabled={pending} aria-label="Zurück zu den Details"><ArrowLeft aria-hidden="true" /></button>
                    <div><h2 id={`${id}-title`}>Melden</h2><p id={`${id}-intro`}>{props.personName} · {props.jobTitle}</p></div>
                </header>
                <div className={styles.body}>
                    <fieldset disabled={pending} className={styles.fields}>
                        <fieldset className={styles.scopeGroup}>
                            <legend>Was möchtest du melden?</legend>
                            <div className={styles.scopes}>{scopes.map(option => <label key={option.value} className={styles.scope} data-selected={scope === option.value}>
                                <input type="radio" name={`${id}-scope`} value={option.value} checked={scope === option.value} onChange={() => { setScope(option.value); setError(null); }} />
                                <option.icon aria-hidden="true" /><span>{option.label}</span>
                            </label>)}</div>
                        </fieldset>
                        {scope === "message" ? <section className={styles.messageSection} aria-label="Nachricht auswählen">
                            {selectedKey && !selected && <p className={styles.error} role="alert">Der ausgewählte Inhalt ist nicht mehr verfügbar. Bitte wähle erneut.</p>}
                            <div className={styles.selectionHeading}><h3>Nachricht auswählen</h3>{selected && <button type="button" className={styles.textButton} onClick={() => { setSelectedKey(null); requestAnimationFrame(() => searchRef.current?.focus()); }}>Ändern</button>}</div>
                            {selected ? <div ref={selectedRef} className={styles.selectedContent} tabIndex={-1} role="group" aria-label="Ausgewählter Inhalt"><span className={styles.contentMeta}><Check aria-hidden="true" />{selected.label}<time dateTime={selected.createdAt ?? undefined}>{contentDate(selected.createdAt)}</time></span><blockquote>{selected.content}</blockquote></div> : <>
                                <label className={styles.search}><Search aria-hidden="true" /><input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nachricht suchen" aria-label="Geladene Nachrichten durchsuchen" /></label>
                                <p className={styles.hint}>Nachrichten und Öffnungsanfragen von {props.personName}. {props.hasOlder ? "Du kannst ältere Inhalte nachladen." : ""}</p>
                                {props.loading ? <p className={styles.hint} role="status">Nachrichten werden geladen …</p> : <>
                                    <ul className={styles.messages}>{matches.map(item => <li key={item.key}><button type="button" className={styles.message} onClick={() => { setSelectedKey(item.key); setError(null); requestAnimationFrame(() => selectedRef.current?.focus()); }}>
                                        <span className={styles.contentMeta}>{item.label}<time dateTime={item.createdAt ?? undefined}>{contentDate(item.createdAt)}</time></span><span className={styles.excerpt}>{item.content}</span>
                                    </button></li>)}</ul>
                                    {!matches.length && <p className={styles.hint} role="status">{query.trim() ? "Kein Treffer in den geladenen Nachrichten." : "Keine meldbaren Inhalte im geladenen Verlauf."}</p>}
                                </>}
                                {props.loadError && <p className={styles.error} role="alert">{props.loadError}</p>}
                                {props.hasOlder && <button type="button" className={styles.loadOlder} disabled={props.loadingOlder} onClick={props.onLoadOlder}>{props.loadingOlder ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{props.loadingOlder ? "Wird geladen …" : "Ältere Nachrichten laden"}</button>}
                                {props.loadError && !props.hasOlder && <button type="button" className={styles.loadOlder} onClick={props.onReload}>Verlauf erneut laden</button>}
                            </>}
                        </section> : <div className={styles.context}>
                            {scope === "person" ? <UserRound aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}<div><strong>{scope === "person" ? props.personName : props.jobTitle}</strong><p>{scope === "person" ? "Du meldest das Verhalten dieser Person." : "Du meldest dieses Gespräch als Ganzes."}</p></div>
                        </div>}
                        <div className={styles.field}><label htmlFor={`${id}-reason`}>Grund</label><div className={styles.selectWrap}><select id={`${id}-reason`} value={reason} onChange={event => { setReason(event.target.value as ReportReason | ""); setError(null); }} required>
                            <option value="" disabled>Bitte auswählen</option>{REPORT_REASONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select><ChevronDown aria-hidden="true" /></div></div>
                        <div className={styles.field}><label htmlFor={`${id}-description`}>Was ist passiert? <span>Optional</span></label><textarea id={`${id}-description`} value={description} onChange={event => { setDescription(event.target.value); setError(null); }} maxLength={1500} rows={3} placeholder="Beschreibe kurz, was wir wissen sollten." aria-describedby={`${id}-length`} /><span id={`${id}-length`} className={styles.counter}>{description.length.toLocaleString("de-DE")} / 1.500</span></div>
                    </fieldset>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                </div>
                <footer className={styles.footer}>
                    <p>Die gemeldete Person wird nicht benachrichtigt.</p>
                    <button type="submit" className={cn(styles.button, styles.primary)} disabled={!valid || pending}>{pending ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <Flag aria-hidden="true" />}{pending ? "Wird gesendet …" : "Meldung senden"}</button>
                </footer>
            </form>}
        </motion.div>
    </div>;
}
