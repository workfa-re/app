"use client";

import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, BriefcaseBusiness, CalendarDays, ChevronRight, CreditCard, MessageCircle, Settings2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NotificationFeed } from "./NotificationFeed";
import { getNotificationPresentation, type NotificationCategory } from "./notificationPresentation";
import type { NotificationItem } from "./notificationTypes";
import { useNotifications } from "./useNotifications";
import type { HeaderNotificationItem } from "@/lib/types/platform";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import { cn } from "@/lib/utils";
import styles from "./NotificationsPopover.module.css";

const CATEGORY_ICONS = { message: MessageCircle, appointment: CalendarDays, application: BriefcaseBusiness,
    job: BriefcaseBusiness, account: ShieldCheck, payment: CreditCard, system: Bell } satisfies Record<NotificationCategory, typeof Bell>;

/** One entry point for the inbox and its live, recipient-owned updates. */
export function NotificationsPopover({ currentUserId, initialUnreadCount, initialNotifications }: {
    currentUserId: string | null;
    initialUnreadCount?: number;
    initialNotifications?: HeaderNotificationItem[];
}) {
    const feed = useNotifications({ currentUserId, initialUnreadCount, initialNotifications });
    const [open, setOpen] = useState(false);
    const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const reducedMotion = useReducedMotion();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const requestedOpen = searchParams.get("notifications") === "open";
    const { dismissLive, liveNotification, markRead } = feed;
    const close = useCallback(() => setOpen(false), []);
    const openCenter = useCallback(() => {
        startPerfMark("notifications-open");
        window.dispatchEvent(new CustomEvent("workfare:header-popover-open", { detail: "notifications" }));
        setOpen(true);
    }, []);

    useEffect(() => setPortalRoot(document.body), []);
    useEffect(() => { setOpen(false); }, [pathname, currentUserId]);
    useEffect(() => {
        if (!requestedOpen) return;
        openCenter();
        const params = new URLSearchParams(searchParams.toString());
        params.delete("notifications");
        router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    }, [openCenter, pathname, requestedOpen, router, searchParams]);
    useEffect(() => {
        const onOtherPanel = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== "notifications") { close(); dismissLive(); }
        };
        window.addEventListener("workfare:header-popover-open", onOtherPanel);
        return () => window.removeEventListener("workfare:header-popover-open", onOtherPanel);
    }, [close, dismissLive]);
    useEffect(() => {
        if (!open) return;
        dismissLive();
        const frame = requestAnimationFrame(() => endPerfMark("notifications-open"));
        return () => cancelAnimationFrame(frame);
    }, [dismissLive, open]);

    const liveRoute = liveNotification ? getNotificationPresentation(liveNotification).route : null;
    const currentConversation = searchParams.get("conversation");
    const activeConversation = liveRoute && pathname === "/app-home/activities" && currentConversation
        ? new URL(liveRoute, "https://workfare.internal").searchParams.get("conversation") === currentConversation
        : false;
    useEffect(() => {
        if (!liveNotification) return;
        const suppress = () => {
            if (open || activeConversation || document.visibilityState !== "visible"
                || document.querySelector('[role="dialog"][aria-modal="true"]')) dismissLive();
        };
        suppress();
        const observer = new MutationObserver(suppress);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
        document.addEventListener("visibilitychange", suppress);
        return () => { observer.disconnect(); document.removeEventListener("visibilitychange", suppress); };
    }, [activeConversation, dismissLive, liveNotification, open]);

    const activate = useCallback((item: NotificationItem) => {
        void markRead(item.id);
        dismissLive();
        const destination = getNotificationPresentation(item).route;
        if (destination) { close(); router.push(destination); }
    }, [close, dismissLive, markRead, router]);
    const livePresentation = liveNotification ? getNotificationPresentation(liveNotification) : null;
    const showLive = liveNotification && livePresentation && livePresentation.priority < 3 && !open && !activeConversation;

    return <>
        <button ref={triggerRef} type="button" className={cn(styles.trigger, open && styles.triggerOpen)}
            aria-label={open ? "Benachrichtigungen schließen" : feed.unreadCount > 0
                ? `Benachrichtigungen öffnen, ${feed.unreadCount} ungelesen` : "Benachrichtigungen öffnen"}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "app-notifications-panel" : undefined}
            onClick={() => open ? close() : openCenter()}>
            <Bell aria-hidden="true" size={19} strokeWidth={1.6} />
            {feed.unreadCount > 0 && <span className={styles.dot} aria-hidden="true" />}
        </button>
        <AnimatePresence initial={false}>
            {open && <Dialog static open={open} onClose={close} className={cn("app-portal-surface", styles.dialog)}>
                <motion.div aria-hidden="true" className={styles.backdrop}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: reducedMotion ? 0 : .22 }} />
                <DialogPanel id="app-notifications-panel"><motion.div className={styles.panel}
                    initial={reducedMotion ? false : { opacity: 0, x: 12, clipPath: "inset(0% 0% 88% 72% round 32px)" }}
                    animate={{ opacity: 1, x: 0, clipPath: "inset(0% 0% 0% 0% round 32px)" }}
                    exit={{ opacity: 0, x: reducedMotion ? 0 : 12, transition: { duration: reducedMotion ? 0 : .16 } }}
                    transition={{ duration: reducedMotion ? 0 : .4, ease: [.2, .8, .2, 1] }}>
                    <header className={styles.heading}>
                        <DialogTitle as="h2">Benachrichtigungen</DialogTitle>
                        <Link href="/app-home/settings/notifications" className={styles.control}
                            aria-label="Benachrichtigungseinstellungen" title="Benachrichtigungseinstellungen" onClick={close}>
                            <Settings2 size={19} strokeWidth={1.6} aria-hidden="true" />
                        </Link>
                        <button type="button" className={styles.control} aria-label="Benachrichtigungen schließen" onClick={close} data-autofocus>
                            <X size={20} strokeWidth={1.6} aria-hidden="true" />
                        </button>
                    </header>
                    <NotificationFeed notifications={feed.notifications} unreadCount={feed.unreadCount} filter={feed.filter}
                        onFilterChange={feed.setFilter} hasMore={feed.hasMore} loading={feed.loading} loadingMore={feed.loadingMore}
                        markingAllRead={feed.markingAllRead} error={feed.error} onRetry={feed.refresh} onLoadMore={feed.loadMore}
                        onMarkAllRead={feed.markAllRead} onActivate={activate} onSeen={feed.markSeen} />
                </motion.div></DialogPanel>
            </Dialog>}
        </AnimatePresence>
        {portalRoot && createPortal(<div className={cn("app-portal-surface", styles.liveRegion)}>
            <span className={styles.srOnly} role="status" aria-atomic="true">{showLive ? `${livePresentation.title}. ${livePresentation.body}` : ""}</span>
            <AnimatePresence initial={false}>
                {showLive && <LiveNotification key={liveNotification.id} item={liveNotification}
                    onDismiss={dismissLive} onActivate={() => {
                        if (livePresentation.route) activate(liveNotification);
                        else { dismissLive(); openCenter(); }
                    }} />}
            </AnimatePresence>
        </div>, portalRoot)}
    </>;
}

function LiveNotification({ item, onDismiss, onActivate }: {
    item: NotificationItem; onDismiss: () => void; onActivate: () => void;
}) {
    const [paused, setPaused] = useState(false);
    const reducedMotion = useReducedMotion();
    const presentation = getNotificationPresentation(item);
    const Icon = CATEGORY_ICONS[presentation.category];
    useEffect(() => {
        if (paused) return;
        const timer = setTimeout(onDismiss, presentation.priority === 1 ? 10_000 : 6_500);
        return () => clearTimeout(timer);
    }, [onDismiss, paused, presentation.priority]);
    useEffect(() => {
        const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
        document.addEventListener("keydown", onEscape);
        return () => document.removeEventListener("keydown", onEscape);
    }, [onDismiss]);
    return <motion.div className={styles.liveCard} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -24, clipPath: "inset(0% 34% 0% 34% round 44px)" }}
        animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0% round 28px)" }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -8, transition: { duration: reducedMotion ? 0 : .16 } }}
        transition={{ duration: reducedMotion ? 0 : .42, ease: [.2, .8, .2, 1] }}
        drag={reducedMotion ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={.25}
        onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 550) onDismiss(); }}>
        <button type="button" className={styles.liveContent} onClick={onActivate}
            aria-label={`${presentation.title}. ${presentation.body}. ${presentation.actionLabel}`}>
            <span className={styles.liveIcon}><Icon aria-hidden="true" size={20} strokeWidth={1.6} /></span>
            <span className={styles.liveCopy}><span className={styles.liveMeta}>Workfare <span>Jetzt</span></span>
                <strong>{presentation.title}</strong>{presentation.body && <span className={styles.liveBody}>{presentation.body}</span>}</span>
            <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button type="button" className={styles.liveClose} aria-label="Hinweis schließen" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </motion.div>;
}
