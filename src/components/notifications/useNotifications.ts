"use client";

import { useMemo, useSyncExternalStore } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { createNotificationFeed } from "./notificationStore";
import { getNotificationPage, markNotificationRead, markNotificationsReadThrough, markNotificationsSeen, normalizeNotificationItem } from "./notificationRpc";
import type { NotificationSeed } from "./notificationTypes";

type Feed = ReturnType<typeof createNotificationFeed>;
const feeds = new Map<string, Feed>();

function makeFeed(userId: string, seed: NotificationSeed): Feed {
    const feed = createNotificationFeed(userId, {
        loadPage: getNotificationPage,
        markRead: markNotificationRead,
        markReadThrough: markNotificationsReadThrough,
        markSeen: markNotificationsSeen,
        isVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
        connect(receive, reconcile) {
            const onChange = (eventType: "INSERT" | "UPDATE", value: unknown) => {
                const notification = normalizeNotificationItem(value);
                if (notification) receive({ type: eventType, notification });
                else reconcile();
            };
            const channel = supabaseBrowser.channel(`personal-notification-feed:${userId}`)
                .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, payload => onChange("INSERT", payload.new))
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, payload => onChange("UPDATE", payload.new))
                .subscribe(status => {
                    if (status === "SUBSCRIBED") receive({ type: "status", connected: true });
                    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") receive({ type: "status", connected: false });
                });
            const visible = () => { if (document.visibilityState === "visible") reconcile(); };
            document.addEventListener("visibilitychange", visible);
            window.addEventListener("online", reconcile);
            return () => {
                document.removeEventListener("visibilitychange", visible);
                window.removeEventListener("online", reconcile);
                void supabaseBrowser.removeChannel(channel);
            };
        },
        onIdle() { if (feeds.get(userId) === feed) feeds.delete(userId); },
    }, seed);
    return feed;
}

/** Header, live banners and the full center all observe the same recipient-owned feed. */
export function useNotifications({ currentUserId, ...seed }: NotificationSeed & { currentUserId: string | null }) {
    const feed = useMemo(() => {
        const userId = currentUserId ?? "";
        if (typeof window === "undefined" || !userId) return makeFeed(userId, seed);
        const cached = feeds.get(userId);
        if (cached) return cached;
        const next = makeFeed(userId, seed);
        feeds.set(userId, next);
        return next;
        // Server seeds initialize a recipient once; subsequent route refreshes must not overwrite live state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUserId]);
    const state = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getServerSnapshot);
    return { ...state, refresh: feed.refresh, loadMore: feed.loadMore, setFilter: feed.setFilter,
        markRead: feed.markRead, markAllRead: feed.markAllRead, markSeen: feed.markSeen, dismissLive: feed.dismissLive };
}
