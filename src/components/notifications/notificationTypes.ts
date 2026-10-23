import type { HeaderNotificationItem } from "@/lib/types/platform";

/** Internal delivery importance; never presented as a user-facing status. */
export type NotificationPriority = 1 | 2 | 3;

export type NotificationItem = HeaderNotificationItem & {
    user_id?: string;
    category?: string;
    priority?: NotificationPriority;
    event_key?: string | null;
    event_type?: string;
    seen_at?: string | null;
    in_app_visible?: boolean;
    data?: unknown;
};

export type NotificationCursor = { createdAt: string; id: string };
export type NotificationPage = {
    notifications: NotificationItem[];
    unreadCount: number;
    hasMore: boolean;
    snapshotAt: string;
};

export type NotificationFeedSnapshot = {
    filter: "all" | "unread";
    notifications: NotificationItem[];
    unreadCount: number;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    markingAllRead: boolean;
    error: string | null;
    liveNotification: NotificationItem | null;
};

export type NotificationSeed = {
    initialNotifications?: readonly HeaderNotificationItem[];
    initialUnreadCount?: number;
};
