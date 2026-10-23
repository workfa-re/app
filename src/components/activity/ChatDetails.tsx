"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CalendarDays, Check, ChevronRight, Clock3, Coins, MapPin, Search, X } from "lucide-react";
import { type ActivityMessage, type ActivityStage } from "@/lib/activity/chat";
import { toPublicProfile, type VisibleProfile } from "@/components/profile/public-profile";
import { chatSearchExcerpt, findChatMessages, formatChatCompensation, orderChatAppointments, splitChatHighlight, type ChatAppointment } from "./chat-details";
import styles from "./ChatDetails.module.css";

type DetailJob = {
    title?: string | null; description?: string | null; wage_hourly?: number | null;
    payment_type?: string | null; public_location_label?: string | null;
};
type ChatDetailsProps = {
    dialogRef: RefObject<HTMLElement | null>; compact: boolean; onClose: () => void;
    name: string; profile: VisibleProfile | null; partnerRole: string; onOpenProfile: () => void;
    job: DetailJob; jobTitle: string; jobKind: string;
    statusLabel: string; stage?: ActivityStage; closureReason?: string | null; authorizedAddress?: string | null;
    appointments: ChatAppointment[]; scheduledFor?: string | null; scheduleNote?: string | null;
    appointmentActions?: ReactNode;
    formatSchedule: (value?: string | null) => string | null;
    searchOpen: boolean; onSearchOpen: (open: boolean) => void; query: string; onQuery: (query: string) => void;
    messages: ActivityMessage[]; loading: boolean; hasOlder: boolean; loadingOlder: boolean; loadError?: string | null;
    onLoadOlder: () => void; onJump: (id: string, query: string) => void;
    actions: ReactNode; dangerAction: ReactNode;
};

export function HighlightedChatText({ text, query }: { text: string; query: string }) {
    return splitChatHighlight(text, query).map((part, index) => part.match
        ? <mark key={index} className={styles.match}>{part.text}</mark> : part.text);
}

export function ChatDetails(props: ChatDetailsProps) {
    const { searchOpen, query, messages, job, jobTitle } = props;
    const searchRef = useRef<HTMLInputElement>(null);
    const searchButtonRef = useRef<HTMLButtonElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const headingId = useId();
    const jobHeadingId = useId();
    const person = props.profile ? toPublicProfile(props.profile) : null;
    const personName = person?.displayName || props.name;
    const matches = useMemo(() => findChatMessages(messages, query), [messages, query]);
    const orderedAppointments = useMemo(() => orderChatAppointments(props.appointments, props.scheduledFor, props.scheduleNote), [props.appointments, props.scheduledFor, props.scheduleNote]);
    const next = orderedAppointments[0];
    const nextIsUpcoming = next?.status === "scheduled" && new Date(next.starts_at).getTime() >= Date.now();

    useEffect(() => {
        bodyRef.current?.scrollTo({ top: 0, behavior: "instant" });
        if (!searchOpen) return;
        let focusFrame = 0;
        const frame = requestAnimationFrame(() => { focusFrame = requestAnimationFrame(() => searchRef.current?.focus()); });
        return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); };
    }, [searchOpen]);

    return <motion.aside ref={props.dialogRef} className={styles.rail} role="dialog" aria-modal={props.compact} aria-labelledby={headingId} tabIndex={-1}
        initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
        transition={{ type: "spring", duration: .3, bounce: 0 }}>
        <div className={styles.heading}>
            {searchOpen && <button className={styles.back} type="button" aria-label="Zurück zu den Details" onClick={() => { props.onSearchOpen(false); requestAnimationFrame(() => searchButtonRef.current?.focus()); }}><ArrowLeft aria-hidden="true" /></button>}
            <h2 id={headingId}>{searchOpen ? "Im Chat suchen" : "Details"}</h2>
            {!searchOpen && <button ref={searchButtonRef} className={styles.searchToggle} type="button" onClick={() => props.onSearchOpen(true)} aria-label="Im Chat suchen" title="Im Chat suchen">
                <motion.span className={styles.searchLens} layoutId={`${headingId}-search-lens`} aria-hidden="true" transition={{ type: "spring", duration: reducedMotion ? 0 : .35, bounce: 0 }} />
                <Search aria-hidden="true" />
            </button>}
            <button className={styles.close} type="button" onClick={props.onClose} aria-label="Details schließen"><X aria-hidden="true" /></button>
        </div>
        <div ref={bodyRef} className={styles.body}>
            {searchOpen ? <div key="search" className={styles.searchPane}>
                <div className={styles.searchField}>
                    <motion.span className={styles.searchLens} layoutId={`${headingId}-search-lens`} aria-hidden="true" transition={{ type: "spring", duration: reducedMotion ? 0 : .35, bounce: 0 }} />
                    <Search aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Geladene Nachrichten durchsuchen" placeholder="Nachricht suchen" value={query} onChange={event => props.onQuery(event.target.value)} />
                </div>
                <motion.div initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: reducedMotion ? 0 : .3, bounce: 0 }}>
                    <p className={styles.scope}>Die Suche umfasst {messages.filter(message => !message.is_temp).length} geladene Nachrichten dieses Gesprächs.{props.hasOlder ? " Ältere Nachrichten kannst du nachladen." : ""}</p>
                    <p className={styles.text} role="status" aria-live="polite">{props.loading ? "Verlauf wird geladen …" : query.trim() ? `${matches.length} Treffer` : "Gib ein Wort oder einen Satz ein."}</p>
                    {query.trim() && !matches.length && !props.loading && <p className={styles.scope}>Keine passende Nachricht im geladenen Verlauf.</p>}
                    <ol className={styles.results}>{matches.map(message => <li key={message.id}>
                        <button className={styles.result} type="button" onClick={() => props.onJump(message.id, query)}>
                            <time dateTime={message.created_at ?? undefined}>{props.formatSchedule(message.created_at) ?? "Datum nicht verfügbar"}</time>
                            <span><HighlightedChatText text={chatSearchExcerpt(message.content, query)} query={query} /></span>
                        </button>
                    </li>)}</ol>
                    {props.hasOlder && <button type="button" className={styles.utility} onClick={props.onLoadOlder} disabled={props.loadingOlder}><Clock3 aria-hidden="true" />{props.loadingOlder ? "Ältere Nachrichten werden geladen …" : "Ältere Nachrichten laden"}</button>}
                    {props.loadError && <p className={styles.text} role="alert">{props.loadError}</p>}
                </motion.div>
            </div> : <div key="details">
                <button type="button" className={styles.personCard} onClick={props.onOpenProfile}
                    disabled={!props.profile} aria-label={`Profil von ${personName} öffnen`} aria-haspopup="dialog">
                    <span className={styles.identityText}><strong>{personName}</strong><span>{props.partnerRole}</span></span>
                    {props.profile && <ChevronRight size={18} aria-hidden="true" />}
                </button>

                <section className={styles.jobCard} aria-labelledby={jobHeadingId}>
                    <h3 id={jobHeadingId}>{jobTitle}</h3>
                    {(!props.stage || props.stage.index < 0) && <span className={styles.status}>{props.stage?.label ?? props.statusLabel}</span>}
                    {props.stage && props.stage.index >= 0 && <ol className={styles.stages} aria-label="Jobverlauf" aria-live="polite">{["Offen", "Reserviert", "Vereinbart", "Abgeschlossen"].map((label, index) => <li key={label}
                        aria-current={index === props.stage!.index ? "step" : undefined}
                        data-state={index < props.stage!.index ? "complete" : index === props.stage!.index ? "current" : "upcoming"}>
                        {index === props.stage!.index && <motion.span className={styles.stageSelection} layoutId={`${jobHeadingId}-stage`} aria-hidden="true" transition={{ type: "spring", duration: reducedMotion ? 0 : .35, bounce: 0 }} />}
                        <span className={styles.stageNode} aria-hidden="true">{index < props.stage!.index || (index === 3 && props.stage!.index === 3) ? <Check size={12} /> : <span />}</span>
                        <span>{label}</span>
                    </li>)}</ol>}
                    <div className={styles.jobFacts}>
                        <div className={styles.fact}><Coins aria-hidden="true" /><div><strong>{formatChatCompensation(job.wage_hourly, job.payment_type)}</strong><span>{props.jobKind}</span></div></div>
                        {(props.authorizedAddress || job.public_location_label) && <div className={styles.fact}><MapPin aria-hidden="true" /><div>{props.authorizedAddress && <span>Treffpunkt</span>}<p>{props.authorizedAddress || job.public_location_label}</p></div></div>}
                    </div>
                    {job.description?.trim() && <ExpandableText text={job.description.trim()} limit={240} label="Ganze Beschreibung" />}
                    {props.closureReason && <p className={styles.closure}>{props.closureReason}</p>}
                    {props.stage && props.stage.index < 0 && !props.closureReason && <p className={styles.closure}>{props.stage.hint}</p>}
                </section>

                {(next || props.appointmentActions) && <section className={`${styles.section} ${styles.appointmentSection}`} aria-label="Termine"><h3>{nextIsUpcoming ? "Nächster Termin" : "Termine"}</h3>
                    {next && <Appointment appointment={next} formatSchedule={props.formatSchedule} />}
                    {orderedAppointments.length > 1 && <details className={styles.history}><summary>Weitere Termine ({orderedAppointments.length - 1})</summary>{orderedAppointments.slice(1).map(appointment => <Appointment key={appointment.id} appointment={appointment} formatSchedule={props.formatSchedule} />)}</details>}
                    {props.appointmentActions && <div className={styles.appointmentActions}>{props.appointmentActions}</div>}
                </section>}
                {props.actions && <section className={styles.section} aria-label="Aktionen"><h3>Aktionen</h3><div className={styles.actions}>{props.actions}</div></section>}
                {props.dangerAction && <div className={`${styles.actions} ${styles.danger}`}>{props.dangerAction}</div>}
            </div>}
        </div>
    </motion.aside>;
}

function ExpandableText({ text, limit, label }: { text: string; limit: number; label: string }) {
    const [expanded, setExpanded] = useState(false);
    const textId = useId();
    const long = text.length > limit;
    const cut = text.lastIndexOf(" ", limit);
    const preview = text.slice(0, cut > limit * .65 ? cut : limit).trimEnd();
    return <div className={styles.prose}>
        <p id={textId}>{long && !expanded ? `${preview}…` : text}</p>
        {long && <button type="button" aria-controls={textId} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Weniger anzeigen" : label}</button>}
    </div>;
}

function Appointment({ appointment, formatSchedule }: { appointment: ChatAppointment; formatSchedule: ChatDetailsProps["formatSchedule"] }) {
    return <div className={styles.appointment}><CalendarDays aria-hidden="true" /><div><strong>{formatSchedule(appointment.starts_at)}</strong><span>{appointment.status === "scheduled" ? "Geplant" : appointment.status === "completed" ? "Erledigt" : "Abgesagt"}{appointment.note ? ` · ${appointment.note}` : ""}</span></div></div>;
}
