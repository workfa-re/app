"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowLeft, CalendarDays, Clock3, MapPin, Search, ShieldCheck, X } from "lucide-react";
import { type ActivityMessage, type ActivityStage } from "@/lib/activity/chat";
import { profileInitials, toPublicProfile, type VisibleProfile } from "@/components/profile/public-profile";
import { chatSearchExcerpt, findChatMessages, formatChatCompensation, orderChatAppointments, splitChatHighlight, type ChatAppointment } from "./chat-details";
import styles from "./ChatDetails.module.css";

type DetailJob = {
    title?: string | null; description?: string | null; wage_hourly?: number | null;
    payment_type?: string | null; public_location_label?: string | null;
};
type ChatDetailsProps = {
    dialogRef: RefObject<HTMLElement | null>; compact: boolean; onClose: () => void;
    name: string; profile: VisibleProfile | null; partnerRole: string;
    job: DetailJob; jobTitle: string; jobKind: string;
    statusLabel: string; stage?: ActivityStage; closureReason?: string | null; authorizedAddress?: string | null;
    appointments: ChatAppointment[]; scheduledFor?: string | null; scheduleNote?: string | null;
    appointmentActions?: ReactNode;
    formatSchedule: (value?: string | null) => string | null;
    searchOpen: boolean; onSearchOpen: (open: boolean) => void; query: string; onQuery: (query: string) => void;
    messages: ActivityMessage[]; loading: boolean; hasOlder: boolean; loadingOlder: boolean; loadError?: string | null;
    onLoadOlder: () => void; onJump: (id: string, query: string) => void; onLatest: () => void;
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
    const headingId = useId();
    const jobHeadingId = useId();
    const personHeadingId = useId();
    const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
    const person = props.profile ? toPublicProfile(props.profile) : null;
    const personName = person?.displayName || props.name;
    const matches = useMemo(() => findChatMessages(messages, query), [messages, query]);
    const orderedAppointments = useMemo(() => orderChatAppointments(props.appointments, props.scheduledFor, props.scheduleNote), [props.appointments, props.scheduledFor, props.scheduleNote]);
    const next = orderedAppointments[0];
    const nextIsUpcoming = next?.status === "scheduled" && new Date(next.starts_at).getTime() >= Date.now();

    useEffect(() => {
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
            {!searchOpen && <button ref={searchButtonRef} className={styles.searchToggle} type="button" onClick={() => props.onSearchOpen(true)} aria-label="Im Chat suchen" title="Im Chat suchen"><Search aria-hidden="true" /></button>}
            <button className={styles.close} type="button" onClick={props.onClose} aria-label="Details schließen"><X aria-hidden="true" /></button>
        </div>
        <div className={styles.body}>
            {searchOpen ? <>
                <div className={styles.searchField}><Search aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Geladene Nachrichten durchsuchen" placeholder="Nachricht suchen" value={query} onChange={event => props.onQuery(event.target.value)} /></div>
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
            </> : <>
                <section className={styles.personCard} aria-labelledby={personHeadingId}>
                    <div className={styles.identity}>
                        <span className={styles.avatar} aria-hidden="true">{person?.avatarUrl && failedAvatar !== person.avatarUrl
                            ? <img src={person.avatarUrl} alt="" decoding="async" onError={() => setFailedAvatar(person.avatarUrl)} />
                            : profileInitials(personName)}</span>
                        <div className={styles.identityText}>
                            <h3 id={personHeadingId}>{personName}</h3>
                            {person?.personName && <p className={styles.contactName}>{person.personName}</p>}
                            <p>{props.partnerRole}{person?.ageYears != null ? ` · ${person.ageYears} Jahre` : ""}</p>
                        </div>
                    </div>
                    {(person?.location || person?.memberSince) && <div className={styles.personFacts}>
                        {person.location && <span><MapPin aria-hidden="true" />{person.location}</span>}
                        {person.memberSince && <span><CalendarDays aria-hidden="true" />Dabei seit {person.memberSince}</span>}
                    </div>}
                    {(person?.isStaff || person?.isVerifiedProvider) && <p className={styles.trust}><ShieldCheck aria-hidden="true" />{person.isStaff ? "Offizielles Workfare-Team" : "Adresse geprüft"}</p>}
                    {person?.bio && <ExpandableText text={person.bio} limit={260} label="Mehr zur Person" />}
                    {Boolean(person?.skills.length) && <ProfileTags label="Fähigkeiten" values={person!.skills} />}
                    {Boolean(person?.interests.length) && <ProfileTags label="Interessen" values={person!.interests} />}
                </section>

                <section className={styles.jobCard} aria-labelledby={jobHeadingId}>
                    <div className={styles.sectionHeading}><span>Auftrag</span><span className={styles.status}>{props.statusLabel.replace(/^Geschlossen · /, "")}</span></div>
                    <h3 id={jobHeadingId}>{jobTitle}</h3>
                    {props.stage && <div className={styles.stageSummary}>
                        {props.stage.index >= 0 && <ol className={styles.stages} aria-label="Jobverlauf">{["Offen", "Reserviert", "Vereinbart", "Abgeschlossen"].map((label, index) => <li key={label} aria-current={index === props.stage!.index ? "step" : undefined} data-reached={index <= props.stage!.index}>{label}</li>)}</ol>}
                        <p>{props.stage.hint}</p>
                    </div>}
                    <div className={styles.jobFacts}><strong>{formatChatCompensation(job.wage_hourly, job.payment_type)}</strong><span>{props.jobKind}</span></div>
                    {job.public_location_label && <p className={styles.location}><MapPin aria-hidden="true" />{job.public_location_label}</p>}
                    {job.description?.trim() && <ExpandableText text={job.description.trim()} limit={320} label="Ganze Beschreibung" />}
                    {props.authorizedAddress && <div className={styles.meetingPoint}><ShieldCheck aria-hidden="true" /><div><span>Freigegebener Treffpunkt</span><p>{props.authorizedAddress}</p></div></div>}
                    {props.closureReason && <p className={styles.closure}>{props.closureReason}</p>}
                </section>

                {(next || props.appointmentActions) && <section className={`${styles.section} ${styles.appointmentSection}`} aria-label="Termine"><h3>{nextIsUpcoming ? "Nächster Termin" : "Termine"}</h3>
                    {next && <Appointment appointment={next} formatSchedule={props.formatSchedule} />}
                    {orderedAppointments.length > 1 && <details className={styles.history}><summary>Weitere Termine ({orderedAppointments.length - 1})</summary>{orderedAppointments.slice(1).map(appointment => <Appointment key={appointment.id} appointment={appointment} formatSchedule={props.formatSchedule} />)}</details>}
                    {props.appointmentActions}
                </section>}
                {props.actions && <section className={styles.section} aria-label="Aktionen"><h3>Aktionen</h3><div className={styles.actions}>{props.actions}</div></section>}
                {props.dangerAction && <div className={`${styles.actions} ${styles.danger}`}>{props.dangerAction}</div>}
                <div className={styles.footerTools}>
                    <button type="button" className={styles.utility} onClick={props.onLatest}><ArrowDown aria-hidden="true" />Zu den neuesten Nachrichten</button>
                    <details className={styles.security}><summary><ShieldCheck aria-hidden="true" />Sicherheit im Chat</summary><p className={styles.text}>Nachrichten werden bei der Übertragung verschlüsselt. Dieser Chat ist nicht Ende-zu-Ende-verschlüsselt. Wenn du Inhalte meldest, kann Workfare sie zur Prüfung einsehen.</p></details>
                </div>
            </>}
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

function ProfileTags({ label, values }: { label: string; values: string[] }) {
    const [expanded, setExpanded] = useState(false);
    return <div className={styles.profileTags}>
        <h4>{label}</h4>
        <ul>{(expanded ? values : values.slice(0, 5)).map(value => <li key={value}>{value}</li>)}</ul>
        {values.length > 5 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Weniger anzeigen" : `${values.length - 5} weitere`}</button>}
    </div>;
}

function Appointment({ appointment, formatSchedule }: { appointment: ChatAppointment; formatSchedule: ChatDetailsProps["formatSchedule"] }) {
    return <div className={styles.appointment}><CalendarDays aria-hidden="true" /><div><strong>{formatSchedule(appointment.starts_at)}</strong><span>{appointment.status === "scheduled" ? "Geplant" : appointment.status === "completed" ? "Erledigt" : "Abgesagt"}{appointment.note ? ` · ${appointment.note}` : ""}</span></div></div>;
}
