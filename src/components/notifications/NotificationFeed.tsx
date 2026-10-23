"use client";

import {
    Bell,
    BriefcaseBusiness,
    CalendarDays,
    CheckCheck,
    ChevronRight,
    Loader2,
    MessageCircle,
    RefreshCw,
    ShieldCheck,
    UsersRound,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getNotificationPresentation, type NotificationCategory } from "./notificationPresentation";
import type { NotificationItem } from "./notificationTypes";
import styles from "./NotificationFeed.module.css";

export type NotificationFeedProps = {
    notifications: readonly NotificationItem[];
    unreadCount: number;
    filter: "all" | "unread";
    onFilterChange: (filter: "all" | "unread") => void;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    markingAllRead: boolean;
    error: string | null;
    onRetry: () => void;
    onLoadMore: () => void;
    onMarkAllRead: () => void;
    onActivate: (notification: NotificationItem) => void;
    onSeen?: (ids: string[]) => void;
};

const ICONS = {
    message: MessageCircle,
    appointment: CalendarDays,
    application: UsersRound,
    job: BriefcaseBusiness,
    account: ShieldCheck,
    system: Bell,
} satisfies Record<NotificationCategory, typeof Bell>;

const fullDate = new Intl.DateTimeFormat("de-DE", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

function notificationTime(value: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
    const label = minutes < 1 ? "Jetzt"
        : minutes < 60 ? `vor ${minutes} Min.`
            : minutes < 1_440 ? `vor ${Math.floor(minutes / 60)} Std.`
                : shortDate.format(date);
    return { label, full: fullDate.format(date), value };
}

export function NotificationFeed(props: NotificationFeedProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const unreadFilterRef = useRef<HTMLButtonElement>(null);
    const allFilterRef = useRef<HTMLButtonElement>(null);
    const requestedFocusRef = useRef<string | null>(null);
    const reportedSeenRef = useRef(new Set<string>());
    const [expandedNotification, setExpandedNotification] = useState<NotificationItem | null>(null);
    const { unread, read, opened } = groupNotificationFeedRows(props.notifications, props.filter, expandedNotification);
    const hasRows = unread.length > 0 || read.length > 0 || opened.length > 0;

    const activateNotification = (notification: NotificationItem) => {
        const presentation = getNotificationPresentation(notification);
        if (!presentation.route) requestedFocusRef.current = notification.id;
        setExpandedNotification(current => !presentation.route && current?.id !== notification.id
            ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
            : null);
        props.onActivate(notification);
    };
    const changeFilter = (filter: "all" | "unread") => {
        requestedFocusRef.current = null;
        setExpandedNotification(null);
        props.onFilterChange(filter);
    };

    useLayoutEffect(() => {
        const id = requestedFocusRef.current;
        if (!id) return;
        // Only this activation can request focus. Live updates never move keyboard focus.
        requestedFocusRef.current = null;
        const row = Array.from(scrollRef.current?.querySelectorAll<HTMLButtonElement>("[data-notification-id]") ?? [])
            .find(element => element.dataset.notificationId === id);
        const target = row ?? (props.filter === "unread" ? unreadFilterRef.current : allFilterRef.current);
        target?.focus({ preventScroll: true });
    }, [expandedNotification, props.notifications, props.filter]);

    useEffect(() => {
        const root = scrollRef.current;
        if (!root || !props.onSeen || typeof IntersectionObserver === "undefined") return;
        const report = props.onSeen;
        const pending = new Set<string>();
        let frame: number | null = null;
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const id = (entry.target as HTMLElement).dataset.notificationUnseen;
                if (entry.isIntersecting && entry.intersectionRatio >= .5 && id && !reportedSeenRef.current.has(id)) {
                    pending.add(id);
                }
            }
            if (!pending.size || frame !== null) return;
            frame = requestAnimationFrame(() => {
                const ids = Array.from(pending);
                ids.forEach(id => reportedSeenRef.current.add(id));
                pending.clear();
                frame = null;
                report(ids);
            });
        }, { root, threshold: .5 });
        root.querySelectorAll<HTMLElement>("[data-notification-unseen]").forEach(row => observer.observe(row));
        return () => {
            observer.disconnect();
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [props.notifications, props.filter, props.onSeen]);

    return (
        <div className={styles.feed} aria-busy={props.loading || props.loadingMore}>
            <div className={styles.toolbar}>
                <div className={styles.filters} role="group" aria-label="Benachrichtigungen filtern">
                    <button ref={allFilterRef} type="button" aria-pressed={props.filter === "all"} onClick={() => changeFilter("all")} className={styles.filter}>
                        Alle
                    </button>
                    <button ref={unreadFilterRef} type="button" aria-pressed={props.filter === "unread"} onClick={() => changeFilter("unread")} className={styles.filter}>
                        Ungelesen
                        {props.unreadCount > 0 ? <span className={styles.count}>{props.unreadCount > 99 ? "99+" : props.unreadCount}</span> : null}
                    </button>
                </div>
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Alle als gelesen markieren"
                    title="Alle als gelesen markieren"
                    disabled={props.unreadCount === 0 || props.markingAllRead}
                    onClick={props.onMarkAllRead}
                >
                    {props.markingAllRead ? <Loader2 className={styles.spinner} aria-hidden="true" size={19} /> : <CheckCheck aria-hidden="true" size={19} />}
                </button>
            </div>

            <div className={styles.scroll} ref={scrollRef}>
                {props.error ? (
                    <div className={styles.error} role="alert">
                        <p>{props.error}</p>
                        <button type="button" onClick={props.onRetry} disabled={props.loading} className={styles.retry}>
                            <RefreshCw size={15} aria-hidden="true" className={props.loading ? styles.spinner : undefined} />
                            Erneut versuchen
                        </button>
                    </div>
                ) : null}

                {!hasRows && (!props.error || props.loading) ? (
                    <div className={styles.empty} role="status">
                        <span className={styles.emptyIcon}>
                            {props.loading ? <Loader2 className={styles.spinner} size={24} aria-hidden="true" /> : <Bell size={24} aria-hidden="true" />}
                        </span>
                        <h3>{props.loading ? "Wird geladen …" : props.filter === "unread" ? "Alles gelesen" : "Hier ist noch alles ruhig"}</h3>
                        <p>{props.loading ? "Deine Benachrichtigungen werden aktualisiert." : props.filter === "unread" ? "Neue Hinweise erscheinen hier, sobald etwas passiert." : "Neue Nachrichten und Änderungen an deinen Jobs findest du hier."}</p>
                    </div>
                ) : hasRows ? (
                    <>
                        {unread.length > 0 ? <NotificationGroup title="Neu" notifications={unread} onActivate={activateNotification} expandedId={expandedNotification?.id} /> : null}
                        {read.length > 0 ? <NotificationGroup title="Gelesen" notifications={read} onActivate={activateNotification} expandedId={expandedNotification?.id} /> : null}
                        {opened.length > 0 ? <NotificationGroup title="Geöffnet" notifications={opened} onActivate={activateNotification} expandedId={expandedNotification?.id} /> : null}
                    </>
                ) : null}

                {props.hasMore ? (
                    <div className={styles.more}>
                        <button type="button" disabled={props.loading || props.loadingMore} onClick={props.onLoadMore} className={styles.moreButton}>
                            {props.loadingMore ? <Loader2 className={styles.spinner} size={16} aria-hidden="true" /> : null}
                            {props.loadingMore ? "Wird geladen …" : "Ältere Benachrichtigungen laden"}
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** An opened information-only notice stays readable when marking it read removes it from the unread feed. */
export function groupNotificationFeedRows(notifications: readonly NotificationItem[], filter: "all" | "unread", expanded: NotificationItem | null) {
    const unread = notifications.filter(notification => !notification.read_at);
    const read = filter === "all" ? notifications.filter(notification => Boolean(notification.read_at)) : [];
    const currentExpanded = expanded ? notifications.find(notification => notification.id === expanded.id) ?? expanded : null;
    const opened = filter === "unread" && currentExpanded?.read_at ? [currentExpanded] : [];
    if (filter === "all" && currentExpanded && !notifications.some(notification => notification.id === currentExpanded.id)) {
        (currentExpanded.read_at ? read : unread).push(currentExpanded);
    }
    return { unread, read, opened };
}

function NotificationGroup({ title, notifications, onActivate, expandedId }: {
    title: string;
    notifications: readonly NotificationItem[];
    onActivate: NotificationFeedProps["onActivate"];
    expandedId?: string;
}) {
    return (
        <section className={styles.group} aria-label={title}>
            <h3 className={styles.groupTitle}>{title}</h3>
            <ul className={styles.list}>
                {notifications.map(notification => {
                    const presentation = getNotificationPresentation(notification);
                    const Icon = ICONS[presentation.category];
                    const unread = !notification.read_at;
                    const expandable = !presentation.route;
                    const expanded = expandable && notification.id === expandedId;
                    const fullBody = presentation.fullBody || presentation.body;
                    const bodyId = `notification-body-${notification.id}`;
                    const time = notificationTime(notification.created_at);
                    return (
                        <li key={notification.id}>
                            <button
                                type="button"
                                className={styles.row}
                                data-notification-id={notification.id}
                                data-unread={unread || undefined}
                                data-notification-unseen={notification.seen_at ? undefined : notification.id}
                                aria-expanded={expandable ? expanded : undefined}
                                aria-controls={expandable ? bodyId : undefined}
                                onClick={() => onActivate(notification)}
                                aria-label={`${unread ? "Ungelesen" : "Gelesen"}: ${presentation.title}${presentation.body ? `. ${presentation.body}` : ""}${presentation.route ? `. ${presentation.actionLabel}` : ""}`}
                            >
                                <span className={styles.rowIcon}>
                                    <Icon size={18} aria-hidden="true" />
                                    {unread ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
                                </span>
                                <span className={styles.copy}>
                                    <span className={styles.titleLine}>
                                        <span className={styles.title}>{presentation.title}</span>
                                        {time ? <time className={styles.time} dateTime={time.value} title={time.full} suppressHydrationWarning>{time.label}</time> : null}
                                    </span>
                                    {expandable ? (
                                        <span id={bodyId} className={expanded ? styles.expandedBody : styles.body}>
                                            {expanded ? fullBody || "Keine weiteren Angaben." : presentation.body}
                                        </span>
                                    ) : presentation.body ? <span className={styles.body}>{presentation.body}</span> : null}
                                </span>
                                <ChevronRight aria-hidden="true" size={15} className={styles.chevron} data-expanded={expanded || undefined} />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
