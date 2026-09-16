"use client";

import { AlertCircle, Bell, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getNotificationRoute } from "@/components/notifications/notificationRouting";
import { markAllNotificationsRead, markNotificationRead } from "@/components/notifications/notificationRpc";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import type { HeaderNotificationItem } from "@/lib/types/platform";
import { endPerfMark, startPerfMark } from "@/lib/perf";

type NotificationItem = HeaderNotificationItem & { data?: unknown };

type NotificationFeedback = {
    source: "refresh" | "rpc" | "realtime";
    message: string;
};

const notificationDateFormatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
});

function formatNotificationDate(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : notificationDateFormatter.format(date);
}

function scheduleIdle(task: () => void, timeout = 2200) {
    if (typeof window === "undefined") return () => undefined;

    const idleWindow = window as typeof window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
        const id = idleWindow.requestIdleCallback(task, { timeout });
        return () => idleWindow.cancelIdleCallback?.(id);
    }

    const timeoutId = window.setTimeout(task, timeout);
    return () => window.clearTimeout(timeoutId);
}

export function NotificationsPopover({
    currentUserId,
    initialUnreadCount = 0,
    initialNotifications = [],
}: {
    currentUserId: string | null;
    initialUnreadCount?: number;
    initialNotifications?: HeaderNotificationItem[];
}) {
    const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<NotificationItem[]>(
        () => initialNotifications as NotificationItem[],
    );
    const [hasLoadedFresh, setHasLoadedFresh] = useState(false);
    const [feedback, setFeedback] = useState<NotificationFeedback | null>(null);
    const [isRefreshPending, startRefreshTransition] = useTransition();
    const router = useRouter();
    const pathname = usePathname();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const refreshRequestIdRef = useRef(0);
    const mountedRef = useRef(true);
    const warmNotificationsRoute = useCallback(() => {
        router.prefetch("/app-home/notifications");
    }, [router]);

    const fetchNotifications = useCallback(async () => {
        if (!currentUserId) return null;

        const [countResult, rowsResult] = await Promise.all([
            supabaseBrowser
                .from("notifications")
                .select("id", { count: "exact", head: true })
                .eq("user_id", currentUserId)
                .is("read_at", null),
            supabaseBrowser
                .from("notifications")
                .select("id, type, title, body, data, created_at, read_at")
                .eq("user_id", currentUserId)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(10),
        ]);

        if (countResult.error) throw countResult.error;
        if (rowsResult.error) throw rowsResult.error;

        return {
            unreadCount: countResult.count ?? 0,
            notifications: (rowsResult.data ?? []) as NotificationItem[],
        };
    }, [currentUserId]);

    const refreshNotifications = useCallback(async ({
        preserveRpcFeedback = false,
    }: {
        preserveRpcFeedback?: boolean;
    } = {}) => {
        const requestId = ++refreshRequestIdRef.current;
        try {
            const next = await fetchNotifications();
            if (!next || !mountedRef.current || requestId !== refreshRequestIdRef.current) return true;
            setUnreadCount(next.unreadCount);
            setNotifications(next.notifications);
            setHasLoadedFresh(true);
            setFeedback((current) => {
                if (current?.source === "realtime") return current;
                if (preserveRpcFeedback && current?.source === "rpc") return current;
                return null;
            });
            return true;
        } catch {
            if (mountedRef.current && requestId === refreshRequestIdRef.current) {
                setFeedback({
                    source: "refresh",
                    message: "Benachrichtigungen konnten gerade nicht aktualisiert werden.",
                });
            }
            return false;
        }
    }, [fetchNotifications]);

    const retryRefresh = useCallback(() => {
        startRefreshTransition(async () => {
            await refreshNotifications();
        });
    }, [refreshNotifications]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        if (isCoarsePointer) return;
        const timeoutId = window.setTimeout(warmNotificationsRoute, 450);
        return () => window.clearTimeout(timeoutId);
    }, [warmNotificationsRoute]);

    useEffect(() => {
        if (hasLoadedFresh || !currentUserId) return;
        let cancelled = false;

        const cancelIdle = scheduleIdle(() => {
            if (!cancelled) void refreshNotifications();
        });

        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [currentUserId, hasLoadedFresh, refreshNotifications]);

    useEffect(() => {
        if (!open || hasLoadedFresh || !currentUserId) return;
        void refreshNotifications();
    }, [currentUserId, hasLoadedFresh, open, refreshNotifications]);

    useEffect(() => {
        if (!currentUserId) return;
        let active = true;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                void refreshNotifications({ preserveRpcFeedback: true });
            }, 80);
        };

        const channel = supabaseBrowser
            .channel(`personal-notifications-popover:${currentUserId}`)
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${currentUserId}`,
            }, scheduleRefresh)
            .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${currentUserId}`,
            }, scheduleRefresh)
            .subscribe((status) => {
                if (!active) return;
                if (status === "SUBSCRIBED") {
                    setFeedback((current) => current?.source === "realtime" ? null : current);
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    setFeedback({
                        source: "realtime",
                        message: "Live-Updates sind unterbrochen. Du kannst die Liste weiterhin manuell laden.",
                    });
                }
            });

        return () => {
            active = false;
            if (refreshTimer) clearTimeout(refreshTimer);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, refreshNotifications]);

    useEffect(() => {
        if (!open) return;
        const frameId = requestAnimationFrame(() => {
            endPerfMark("notifications-open");
        });
        return () => cancelAnimationFrame(frameId);
    }, [open]);

    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    useEffect(() => {
        const handleOtherPopover = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== "notifications") setOpen(false);
        };

        window.addEventListener("workfare:header-popover-open", handleOtherPopover);
        return () => window.removeEventListener("workfare:header-popover-open", handleOtherPopover);
    }, []);

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open]);

    const markAsRead = useCallback((notification: NotificationItem) => {
        if (notification.read_at) return;
        const readAt = new Date().toISOString();
        setFeedback((current) => current?.source === "realtime" ? current : null);
        setNotifications((current) => current.map((item) => (
            item.id === notification.id ? { ...item, read_at: readAt } : item
        )));
        setUnreadCount((current) => Math.max(0, current - 1));

        void markNotificationRead(notification.id).then(async (error) => {
            if (!error) return;
            setNotifications((current) => current.map((item) => (
                item.id === notification.id && item.read_at === readAt
                    ? { ...item, read_at: null }
                    : item
            )));
            setUnreadCount((current) => current + 1);
            setFeedback({ source: "rpc", message: "Der Lesestatus konnte nicht gespeichert werden." });
            await refreshNotifications({ preserveRpcFeedback: true });
        });
    }, [refreshNotifications]);

    const markAllAsRead = useCallback(() => {
        if (unreadCount === 0) return;
        const readAt = new Date().toISOString();
        const previousUnreadCount = unreadCount;
        const previouslyUnreadIds = new Set(
            notifications.filter((notification) => !notification.read_at).map((notification) => notification.id),
        );
        setFeedback((current) => current?.source === "realtime" ? current : null);
        setNotifications((current) => current.map((notification) => (
            notification.read_at ? notification : { ...notification, read_at: readAt }
        )));
        setUnreadCount(0);

        void markAllNotificationsRead().then(async (error) => {
            if (!error) return;
            setNotifications((current) => current.map((notification) => (
                previouslyUnreadIds.has(notification.id) && notification.read_at === readAt
                    ? { ...notification, read_at: null }
                    : notification
            )));
            setUnreadCount((current) => Math.max(current, previousUnreadCount));
            setFeedback({ source: "rpc", message: "Der Lesestatus konnte nicht vollständig gespeichert werden." });
            await refreshNotifications({ preserveRpcFeedback: true });
        });
    }, [notifications, refreshNotifications, unreadCount]);

    const activateNotification = useCallback((notification: NotificationItem) => {
        markAsRead(notification);
        const destination = getNotificationRoute(notification.data);
        if (!destination) return;
        setOpen(false);
        router.push(destination);
    }, [markAsRead, router]);

    const toggleOpen = () => {
        if (!open) {
            startPerfMark("notifications-open");
            window.dispatchEvent(new CustomEvent("workfare:header-popover-open", { detail: "notifications" }));
        }
        setOpen((current) => !current);
    };

    return (
        <div className="notifications-popover-root relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={toggleOpen}
                aria-label={open
                    ? "Benachrichtigungen schließen"
                    : unreadCount > 0
                        ? `Benachrichtigungen öffnen, ${unreadCount} ungelesen`
                        : "Benachrichtigungen öffnen"}
                aria-expanded={open}
                aria-controls="app-notifications-panel"
                className={cn(
                    "notifications-trigger relative flex h-[52px] w-[52px] items-center justify-center rounded-full border border-transparent text-slate-300 outline-none",
                    "transition-[box-shadow,color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none motion-reduce:active:scale-100",
                    open && "is-open",
                )}
            >
                <Bell aria-hidden="true" size={18} />
                {unreadCount > 0 ? (
                    <span aria-hidden="true" className="notification-unread-dot absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full" />
                ) : null}
            </button>

            <AnimatePresence initial={false}>
                {open ? (
                    <>
                        <motion.div
                            key="notifications-backdrop"
                            aria-hidden="true"
                            className="app-header-popover-backdrop fixed inset-x-0 bottom-0 z-40 cursor-default appearance-none border-0 bg-transparent p-0"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12, ease: "easeOut" }}
                            onClick={() => setOpen(false)}
                        />
                        <motion.div
                            key="notifications-panel"
                            id="app-notifications-panel"
                            role="dialog"
                            aria-label="Benachrichtigungen"
                            className={cn(
                                "notifications-panel fixed left-4 right-4 z-50 flex origin-top-right flex-col rounded-2xl border border-transparent p-1.5",
                                "md:absolute md:left-auto md:right-0 md:top-[calc(100%+0.5rem)] md:w-[22rem]",
                            )}
                            initial={{ opacity: 0, y: -6, scale: 0.985 }}
                            animate={{
                                opacity: 1,
                                y: 0,
                                scale: 1,
                                transition: { duration: 0.18, ease: [0.2, 0, 0, 1] },
                            }}
                            exit={{
                                opacity: 0,
                                y: -4,
                                scale: 0.99,
                                transition: { duration: 0.13, ease: "easeIn" },
                            }}
                        >
                            <div className="notifications-panel-header flex items-center justify-between border-b px-3 pb-2.5 pt-2.5">
                                <h4 className="notifications-panel-title text-balance font-semibold text-white">Benachrichtigungen</h4>
                                <span aria-live="polite" className="notifications-panel-count text-xs tabular-nums text-slate-400">
                                    {unreadCount > 0 ? `${unreadCount} ungelesen` : "Alles gelesen"}
                                </span>
                            </div>

                            {feedback ? (
                                <div role="alert" className="mx-1.5 mt-1.5 grid gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.2)]">
                                    <p className="flex items-start gap-2 text-pretty text-xs leading-4 text-red-200">
                                        <AlertCircle aria-hidden="true" className="mt-px shrink-0" size={15} />
                                        {feedback.message}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={retryRefresh}
                                        disabled={isRefreshPending}
                                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-100 shadow-[0_0_0_1px_rgba(255,255,255,0.1)] outline-none transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-white/5 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                                    >
                                        {isRefreshPending
                                            ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={14} />
                                            : <RefreshCw aria-hidden="true" size={14} />}
                                        {isRefreshPending ? "Wird geladen …" : "Neu laden"}
                                    </button>
                                </div>
                            ) : null}

                            <div aria-busy={isRefreshPending} className="notifications-list min-h-0 max-h-[320px] flex-1 overflow-y-auto py-1">
                                {notifications.length === 0 ? (
                                    <div className="notifications-empty px-4 py-8 text-center text-pretty text-sm text-slate-500">
                                        {isRefreshPending ? (
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={15} />
                                                Wird geladen …
                                            </span>
                                        ) : feedback ? "Gerade nicht erreichbar." : "Hier erscheinen deine persönlichen Updates."}
                                    </div>
                                ) : (
                                    notifications.map((notification) => {
                                        const destination = getNotificationRoute(notification.data);
                                        const canActivate = !notification.read_at || Boolean(destination);
                                        const formattedDate = formatNotificationDate(notification.created_at);
                                        return (
                                            <button
                                                key={notification.id}
                                                type="button"
                                                disabled={!canActivate}
                                                aria-label={`${notification.read_at ? "Gelesen" : "Ungelesen"}: ${notification.title || "Benachrichtigung"}. ${notification.body || ""}`}
                                                onClick={() => activateNotification(notification)}
                                                onPointerEnter={() => destination && router.prefetch(destination)}
                                                onFocus={() => destination && router.prefetch(destination)}
                                                className={cn(
                                                    "notification-card relative min-h-11 w-full rounded-[0.625rem] px-3 py-2.5 text-left outline-none transition-[background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600",
                                                    notification.read_at ? "is-read" : "is-unread",
                                                    !canActivate && "cursor-default",
                                                )}
                                            >
                                                <p className="notification-title text-pretty text-sm font-medium text-slate-100">
                                                    {notification.title || "Benachrichtigung"}
                                                </p>
                                                {notification.body ? (
                                                    <p className="notification-body mt-1 line-clamp-2 text-pretty text-xs text-slate-400">
                                                        {notification.body}
                                                    </p>
                                                ) : null}
                                                <div className="mt-1.5 flex items-center justify-between">
                                                    {formattedDate ? (
                                                        <time dateTime={notification.created_at ?? undefined} className="notification-date text-[11px] tabular-nums text-slate-500">
                                                            {formattedDate}
                                                        </time>
                                                    ) : <span />}
                                                    {!notification.read_at ? (
                                                        <span aria-hidden="true" className="notification-card-dot h-1.5 w-1.5 rounded-full bg-indigo-400" />
                                                    ) : null}
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>

                            <div className={cn(
                                "notifications-panel-footer grid border-t px-1 pt-1 text-center",
                                unreadCount > 0 ? "grid-cols-2 gap-1" : "grid-cols-1",
                            )}>
                                {unreadCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={markAllAsRead}
                                        className="notifications-view-all inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[0.625rem] px-2 text-xs font-semibold outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 motion-reduce:transition-none motion-reduce:active:scale-100"
                                    >
                                        <CheckCheck aria-hidden="true" size={14} />
                                        Alle lesen
                                    </button>
                                ) : null}
                                <Link
                                    href="/app-home/notifications"
                                    prefetch
                                    onTouchStart={warmNotificationsRoute}
                                    onPointerDown={warmNotificationsRoute}
                                    onMouseEnter={warmNotificationsRoute}
                                    onFocus={warmNotificationsRoute}
                                    className="notifications-view-all flex min-h-11 items-center justify-center rounded-[0.625rem] px-3 text-xs font-semibold outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 motion-reduce:transition-none motion-reduce:active:scale-100"
                                >
                                    Alle anzeigen
                                </Link>
                            </div>
                        </motion.div>
                    </>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
