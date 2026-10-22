"use client";

import {
    AlertCircle,
    Bell,
    CheckCheck,
    ChevronRight,
    Loader2,
    RefreshCw,
    Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CumulativeLoadMoreLink } from "@/components/ui/CumulativeLoadMoreLink";
import { getNotificationRoute } from "@/components/notifications/notificationRouting";
import { markAllNotificationsRead, markNotificationRead } from "@/components/notifications/notificationRpc";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { Database } from "@/lib/types/supabase";
import { cn } from "@/lib/utils";

export type PersonalNotificationItem = Pick<
    Database["public"]["Tables"]["notifications"]["Row"],
    "id" | "type" | "title" | "body" | "data" | "created_at" | "read_at"
>;

type NotificationsSearchParams = Record<string, string | string[] | undefined>;

type NotificationFeedback = {
    source: "initial" | "refresh" | "rpc" | "realtime";
    message: string;
};

type PaginationConfig = {
    pathname: string;
    searchParams: NotificationsSearchParams;
    pageParam: string;
    nextPage: number;
    canAdvance: boolean;
};

const notificationDateFormatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
});

function formatNotificationDate(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : notificationDateFormatter.format(date);
}

export function PersonalNotificationCenter({
    currentUserId,
    initialNotifications,
    initialUnreadCount,
    initialTotalCount,
    initialLoadError,
    visibleLimit,
    pagination,
}: {
    currentUserId: string;
    initialNotifications: PersonalNotificationItem[];
    initialUnreadCount: number;
    initialTotalCount: number;
    initialLoadError: boolean;
    visibleLimit: number;
    pagination: PaginationConfig;
}) {
    const [notifications, setNotifications] = useState(initialNotifications);
    const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
    const [totalCount, setTotalCount] = useState(initialTotalCount);
    const [feedback, setFeedback] = useState<NotificationFeedback | null>(() => (
        initialLoadError
            ? {
                source: "initial",
                message: "Benachrichtigungen konnten nicht vollständig geladen werden.",
            }
            : null
    ));
    const [isRefreshPending, startRefreshTransition] = useTransition();
    const router = useRouter();
    const refreshRequestIdRef = useRef(0);
    const initialRetryStartedRef = useRef(false);

    const refreshNotifications = useCallback(async ({
        preserveRpcFeedback = false,
    }: {
        preserveRpcFeedback?: boolean;
    } = {}) => {
        const requestId = ++refreshRequestIdRef.current;

        try {
            const [rowsResult, unreadResult] = await Promise.all([
                supabaseBrowser
                    .from("notifications")
                    .select("id, type, title, body, data, created_at, read_at", { count: "exact" })
                    .eq("user_id", currentUserId)
                    .order("created_at", { ascending: false })
                    .order("id", { ascending: false })
                    .range(0, Math.max(0, visibleLimit - 1)),
                supabaseBrowser
                    .from("notifications")
                    .select("id", { count: "exact", head: true })
                    .eq("user_id", currentUserId)
                    .is("read_at", null),
            ]);

            if (requestId !== refreshRequestIdRef.current) return true;
            if (rowsResult.error || unreadResult.error) {
                setFeedback({
                    source: "refresh",
                    message: "Benachrichtigungen konnten gerade nicht aktualisiert werden.",
                });
                return false;
            }

            const nextNotifications = (rowsResult.data ?? []) as PersonalNotificationItem[];
            setNotifications(nextNotifications);
            setUnreadCount(unreadResult.count ?? 0);
            setTotalCount(rowsResult.count ?? nextNotifications.length);
            setFeedback((current) => {
                if (current?.source === "realtime") return current;
                if (preserveRpcFeedback && current?.source === "rpc") return current;
                return null;
            });
            return true;
        } catch {
            if (requestId === refreshRequestIdRef.current) {
                setFeedback({
                    source: "refresh",
                    message: "Benachrichtigungen konnten gerade nicht aktualisiert werden.",
                });
            }
            return false;
        }
    }, [currentUserId, visibleLimit]);

    const retryRefresh = useCallback(() => {
        startRefreshTransition(async () => {
            await refreshNotifications();
        });
    }, [refreshNotifications]);

    useEffect(() => {
        if (!initialLoadError || initialRetryStartedRef.current) return;
        initialRetryStartedRef.current = true;
        retryRefresh();
    }, [initialLoadError, retryRefresh]);

    useEffect(() => {
        let active = true;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                void refreshNotifications({ preserveRpcFeedback: true });
            }, 80);
        };

        const channel = supabaseBrowser
            .channel(`personal-notifications-center:${currentUserId}`)
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
                        message: "Die Live-Aktualisierung ist unterbrochen. Du kannst weiterhin manuell aktualisieren.",
                    });
                }
            });

        return () => {
            active = false;
            if (refreshTimer) clearTimeout(refreshTimer);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, refreshNotifications]);

    const readNotification = useCallback((notification: PersonalNotificationItem) => {
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

    const readAllNotifications = useCallback(() => {
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

    const activateNotification = useCallback((notification: PersonalNotificationItem) => {
        readNotification(notification);
        const destination = getNotificationRoute(notification.data);
        if (destination) router.push(destination);
    }, [readNotification, router]);

    const hasMore = pagination.canAdvance && notifications.length < totalCount;
    const isEmptyLoading = notifications.length === 0 && isRefreshPending;

    return (
        <section aria-labelledby="notification-center-title" className="mx-auto w-full max-w-4xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <p className="mb-2 text-sm font-semibold text-[var(--brand)]">Persönlicher Eingang</p>
                    <h1 id="notification-center-title" className="text-balance text-2xl font-semibold tracking-[-0.02em] text-[var(--text-strong)] sm:text-3xl">
                        Benachrichtigungen
                    </h1>
                    <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--text-muted)]">
                        Updates zu deinen Bewerbungen, Nachrichten und Terminen.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {unreadCount > 0 ? (
                        <button
                            type="button"
                            onClick={readAllNotifications}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-[var(--text-default)] shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[var(--surface-muted)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100"
                        >
                            <CheckCheck aria-hidden="true" size={17} />
                            Alle als gelesen
                        </button>
                    ) : null}
                    <Link
                        href="/app-home/settings/notifications"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-[var(--text-default)] shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[var(--surface-muted)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        <Settings aria-hidden="true" size={17} />
                        Einstellungen
                    </Link>
                </div>
            </header>

            <div className="sr-only" aria-live="polite">
                {unreadCount === 0 ? "Keine ungelesenen Benachrichtigungen" : `${unreadCount} ungelesene Benachrichtigungen`}
            </div>

            {feedback ? (
                <div role="alert" className="mb-4 grid gap-3 rounded-2xl bg-red-500/10 px-4 py-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--danger)_24%,transparent)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <p className="flex min-w-0 items-start gap-2 text-pretty text-sm leading-5 text-red-700 dark:text-red-300">
                        <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
                        {feedback.message}
                    </p>
                    <button
                        type="button"
                        onClick={retryRefresh}
                        disabled={isRefreshPending}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-[var(--text-default)] shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[var(--surface-muted)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        {isRefreshPending
                            ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={16} />
                            : <RefreshCw aria-hidden="true" size={16} />}
                        {isRefreshPending ? "Wird geladen …" : "Erneut laden"}
                    </button>
                </div>
            ) : null}

            {notifications.length === 0 ? (
                <div className="rounded-2xl bg-[var(--surface-solid)] px-6 py-12 text-center shadow-[0_0_0_1px_var(--border-subtle),0_10px_30px_rgba(15,23,42,0.05)]">
                    <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--text-muted)]">
                        {isEmptyLoading
                            ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={21} />
                            : <Bell aria-hidden="true" size={21} />}
                    </span>
                    <h2 className="mt-4 text-balance text-base font-semibold text-[var(--text-strong)]">
                        {isEmptyLoading ? "Benachrichtigungen werden geladen" : feedback ? "Noch nicht vollständig geladen" : "Alles im Blick"}
                    </h2>
                    <p className="mx-auto mt-1 max-w-md text-pretty text-sm leading-6 text-[var(--text-muted)]">
                        {feedback
                            ? "Versuche es erneut. Deine vorhandenen Benachrichtigungen gehen dabei nicht verloren."
                            : "Sobald es ein persönliches Update für dich gibt, erscheint es hier."}
                    </p>
                </div>
            ) : (
                <ol className="overflow-hidden rounded-2xl bg-[var(--surface-solid)] shadow-[0_0_0_1px_var(--border-subtle),0_10px_30px_rgba(15,23,42,0.05)]">
                    {notifications.map((notification, index) => {
                        const destination = getNotificationRoute(notification.data);
                        const canActivate = !notification.read_at || Boolean(destination);
                        const formattedDate = formatNotificationDate(notification.created_at);
                        return (
                            <li key={notification.id} className={cn(index > 0 && "border-t border-[var(--border-subtle)]")}>
                                <button
                                    type="button"
                                    disabled={!canActivate}
                                    onClick={() => activateNotification(notification)}
                                    onPointerEnter={() => destination && router.prefetch(destination)}
                                    onFocus={() => destination && router.prefetch(destination)}
                                    className={cn(
                                        "group grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 text-left outline-none transition-[background-color] duration-150 ease-out focus-visible:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] sm:px-5",
                                        canActivate && "hover:bg-[var(--surface-muted)]",
                                        !canActivate && "cursor-default",
                                    )}
                                    aria-label={`${notification.read_at ? "Gelesen" : "Ungelesen"}: ${notification.title}. ${notification.body ?? ""}`}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            "mt-1.5 size-2 rounded-full",
                                            notification.read_at ? "bg-transparent" : "bg-[var(--brand)]",
                                        )}
                                    />
                                    <span className="min-w-0">
                                        <span className={cn(
                                            "block text-pretty text-sm text-[var(--text-strong)]",
                                            notification.read_at ? "font-medium" : "font-semibold",
                                        )}>
                                            {notification.title || "Benachrichtigung"}
                                        </span>
                                        {notification.body ? (
                                            <span className="mt-1 block text-pretty text-sm leading-5 text-[var(--text-muted)]">
                                                {notification.body}
                                            </span>
                                        ) : null}
                                        {formattedDate ? (
                                            <time dateTime={notification.created_at ?? undefined} className="mt-2 block text-xs tabular-nums text-[var(--text-muted)]">
                                                {formattedDate}
                                            </time>
                                        ) : null}
                                    </span>
                                    {destination ? (
                                        <ChevronRight aria-hidden="true" className="mt-1 text-[var(--text-muted)] transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none" size={18} />
                                    ) : null}
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}

            {notifications.length > 0 ? (
                <div className="pt-4 text-center">
                    <p className="text-xs tabular-nums text-[var(--text-muted)]">
                        {notifications.length} von {totalCount} Benachrichtigungen angezeigt
                    </p>
                    {hasMore ? (
                        <CumulativeLoadMoreLink
                            pathname={pagination.pathname}
                            searchParams={pagination.searchParams}
                            pageParam={pagination.pageParam}
                            nextPage={pagination.nextPage}
                            label="Weitere Benachrichtigungen laden"
                        />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
