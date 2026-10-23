"use client";

import { supabaseBrowser } from "@/lib/supabaseClient";
import type { NotificationCursor, NotificationPage } from "./notificationTypes";
import { parseNotificationPage } from "./notificationPayload";
export { normalizeNotificationItem } from "./notificationPayload";

const FALLBACK_RPC_ERROR = "Die Änderung konnte nicht bestätigt werden.";

function getRpcError(result: unknown, transportError?: string) {
    if (transportError) return transportError;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        return FALLBACK_RPC_ERROR;
    }

    const response = result as { ok?: boolean; error?: string };
    return response.ok === true ? null : response.error ?? FALLBACK_RPC_ERROR;
}

export async function markNotificationRead(notificationId: string) {
    try {
        const { data, error } = await supabaseBrowser.rpc("mark_notification_read", {
            p_notification_id: notificationId,
        });
        return getRpcError(data, error?.message);
    } catch {
        return FALLBACK_RPC_ERROR;
    }
}

export async function markAllNotificationsRead() {
    try {
        const { data, error } = await supabaseBrowser.rpc("mark_all_notifications_read");
        return getRpcError(data, error?.message);
    } catch {
        return FALLBACK_RPC_ERROR;
    }
}

export async function markNotificationsReadThrough(snapshotAt: string) {
    try {
        const { data, error } = await supabaseBrowser.rpc("mark_notifications_read_through", { p_snapshot_at: snapshotAt });
        return getRpcError(data, error?.message);
    } catch { return FALLBACK_RPC_ERROR; }
}

export async function markNotificationsSeen(ids: string[]) {
    if (!ids.length) return null;
    try {
        const { data, error } = await supabaseBrowser.rpc("mark_notifications_seen", { p_notification_ids: ids.slice(0, 100) });
        return getRpcError(data, error?.message);
    } catch { return FALLBACK_RPC_ERROR; }
}

export async function getNotificationPage(cursor: NotificationCursor | null, unreadOnly: boolean, limit = 25): Promise<NotificationPage> {
    const { data, error } = await supabaseBrowser.rpc("get_notification_feed", {
        p_limit: Math.max(1, Math.min(100, Math.trunc(limit))),
        p_before_created_at: cursor?.createdAt ?? undefined,
        p_before_id: cursor?.id ?? undefined,
        p_unread_only: unreadOnly,
    });
    if (error) throw new Error("Benachrichtigungen nicht verfügbar.");
    return parseNotificationPage(data);
}
