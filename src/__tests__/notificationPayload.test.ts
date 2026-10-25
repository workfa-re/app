import { describe, expect, it } from "vitest";
import { normalizeNotificationItem, parseNotificationPage } from "@/components/notifications/notificationPayload";
import { getNotificationPresentation } from "@/components/notifications/notificationPresentation";

const item = { id: "one", title: "Neue Nachricht", type: "message", created_at: "2026-10-23T12:00:00Z", read_at: null, body: "  Ein   langer Hinweis.  " };

describe("notification payloads and presentation", () => {
    it("normalizes optional event metadata without inventing priorities", () => {
        expect(normalizeNotificationItem({ ...item, priority: 1, event_type: "security", category: "account", user_id: "owner" }))
            .toMatchObject({ priority: 1, event_type: "security", category: "account", user_id: "owner" });
        expect(normalizeNotificationItem({ ...item, priority: 7 })?.priority).toBeUndefined();
    });

    it("rejects malformed rows and invalid page envelopes", () => {
        for (const value of [null, [], "text", {}, { ...item, id: 1 }, { ...item, title: null }]) expect(normalizeNotificationItem(value)).toBeNull();
        for (const value of [null, {}, { ok: false }, { ok: true, notifications: [], unread_count: NaN, snapshot_at: item.created_at }]) {
            expect(() => parseNotificationPage(value)).toThrow();
        }
    });

    it("uses only valid recipient rows, an integer counter and an explicit cursor flag", () => {
        expect(parseNotificationPage({ ok: true, notifications: [item, null], unread_count: 2.5, has_more: true, snapshot_at: item.created_at }))
            .toMatchObject({ notifications: [expect.objectContaining({ id: "one" })], unreadCount: 2, hasMore: true });
    });

    it("prefers compact job and person context while retaining full accessible copy", () => {
        expect(getNotificationPresentation({ ...item, data: { route: "/app-home/activities?conversation=one", job_title: "Rasen mähen", sender_name: "Anna Schneider" } }))
            .toMatchObject({ title: "Neue Nachricht", body: "Rasen mähen · Anna Schneider", fullBody: "Ein langer Hinweis.", category: "message", actionLabel: "Nachricht öffnen" });
    });

    it("does not duplicate an identical body and title", () => {
        expect(getNotificationPresentation({ ...item, body: item.title }).body).toBe("");
    });

    it("classifies machine events without parsing the opaque event key", () => {
        expect(getNotificationPresentation({ ...item, title: "Info", type: "info", event_type: "appointment_request_pending", event_key: "opaque:unrelated" }))
            .toMatchObject({ title: "Neuer Terminvorschlag", category: "appointment", priority: 1 });
        expect(getNotificationPresentation({ ...item, title: "Kontozugriff prüfen", type: "info", event_type: "security" }))
            .toMatchObject({ category: "account", priority: 1 });
    });

    it.each([
        ["membership_active", 2],
        ["membership_renewal_changed", 2],
        ["membership_payment_failed", 1],
    ] as const)("opens %s in membership management with a clear payment action", (event, priority) => {
        expect(getNotificationPresentation({ ...item, type: event, event_type: event,
            data: { route: "/app-home/settings/membership" } }))
            .toMatchObject({ category: "payment", priority, actionLabel: "Workfare Plan öffnen", route: "/app-home/settings/membership" });
    });

    it("keeps existing useful individual titles and validates destinations", () => {
        expect(getNotificationPresentation({ ...item, title: "Dein Konto ist bereit", type: "info", data: { route: "https://evil.example" } }))
            .toMatchObject({ title: "Dein Konto ist bereit", route: null, priority: 3 });
    });
});
