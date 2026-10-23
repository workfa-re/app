import type { NotificationItem, NotificationPage } from "./notificationTypes";

/** Keep malformed payloads out of navigation and the recipient's live feed. */
export function normalizeNotificationItem(value: unknown): NotificationItem | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.type !== "string") return null;
    return {
        id: row.id, title: row.title, type: row.type,
        body: typeof row.body === "string" ? row.body : null,
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        read_at: typeof row.read_at === "string" ? row.read_at : null,
        seen_at: typeof row.seen_at === "string" ? row.seen_at : null,
        event_key: typeof row.event_key === "string" ? row.event_key : null,
        ...(typeof row.event_type === "string" ? { event_type: row.event_type } : {}),
        ...(typeof row.user_id === "string" ? { user_id: row.user_id } : {}),
        ...(typeof row.category === "string" ? { category: row.category } : {}),
        ...(row.priority === 1 || row.priority === 2 || row.priority === 3 ? { priority: row.priority } : {}),
        ...(typeof row.in_app_visible === "boolean" ? { in_app_visible: row.in_app_visible } : {}),
        data: row.data,
    };
}

export function parseNotificationPage(data: unknown): NotificationPage {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Benachrichtigungen nicht verfügbar.");
    const page = data as Record<string, unknown>;
    if (page.ok !== true || !Array.isArray(page.notifications) || typeof page.unread_count !== "number"
        || !Number.isFinite(page.unread_count) || typeof page.snapshot_at !== "string" || !Number.isFinite(Date.parse(page.snapshot_at))) {
        throw new Error("Ungültige Benachrichtigungsantwort.");
    }
    return {
        notifications: page.notifications.map(normalizeNotificationItem).filter((row): row is NotificationItem => row !== null),
        unreadCount: Math.max(0, Math.trunc(page.unread_count)),
        hasMore: page.has_more === true,
        snapshotAt: page.snapshot_at,
    };
}
