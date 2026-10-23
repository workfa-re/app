import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupNotificationFeedRows, NotificationFeed } from "@/components/notifications/NotificationFeed";
import type { NotificationItem } from "@/components/notifications/notificationTypes";

const rows: NotificationItem[] = [
    { id: "new", type: "system", title: "Terminänderung angefragt", body: "Rasen mähen · Anna", created_at: "2026-10-23T12:00:00Z", read_at: null, category: "appointments", priority: 1, data: { route: "/app-home/activities?conversation=one" } },
    { id: "read", type: "system", title: "Termin bestätigt", body: "Sonntag, 14:00 Uhr", created_at: "2026-10-22T12:00:00Z", read_at: "2026-10-23T12:00:00Z", priority: 3 },
];
function renderFeed(overrides: Partial<ComponentProps<typeof NotificationFeed>> = {}) {
    return renderToStaticMarkup(<NotificationFeed notifications={rows} unreadCount={1} filter="all" onFilterChange={() => {}} hasMore={false} loading={false} loadingMore={false} markingAllRead={false} error={null} onRetry={() => {}} onLoadMore={() => {}} onMarkAllRead={() => {}} onActivate={() => {}} {...overrides} />);
}

describe("notification feed presentation", () => {
    it("separates new and read notifications without exposing internal priorities", () => {
        const html = renderFeed();
        expect(html).toContain('aria-label="Neu"');
        expect(html).toContain('aria-label="Gelesen"');
        expect(html).toContain('aria-label="Ungelesen: Terminänderung angefragt. Rasen mähen · Anna. Termin ansehen"');
        expect(html.match(/data-unread="true"/g)).toHaveLength(1);
        expect(html).not.toContain("priority");
        expect(html).not.toContain("P1");
        expect(html).not.toContain('aria-label="Gelesen: Termin bestätigt. Sonntag, 14:00 Uhr. Ansehen"');
    });

    it("keeps read rows out of the unread filter and provides a distinct empty state", () => {
        const filtered = renderFeed({ filter: "unread" });
        expect(filtered).toContain("Terminänderung angefragt");
        expect(filtered).not.toContain("Termin bestätigt");
        const empty = renderFeed({ filter: "unread", notifications: [], unreadCount: 0 });
        expect(empty).toContain("Alles gelesen");
        expect(empty).toContain('aria-label="Alle als gelesen markieren"');
        expect(empty).not.toContain("Hier ist noch alles ruhig");
    });

    it("shows a load failure without falsely claiming there are no notifications", () => {
        const html = renderFeed({ notifications: [], error: "Gerade nicht verfügbar." });
        expect(html).toContain('role="alert"');
        expect(html).toContain("Erneut versuchen");
        expect(html).not.toContain("Hier ist noch alles ruhig");
        expect(html).not.toContain("Alles gelesen");
    });

    it("loads older rows in place and preserves the visible list during retry", () => {
        const html = renderFeed({ hasMore: true, error: "Verbindung unterbrochen." });
        expect(html).toContain("Terminänderung angefragt");
        expect(html).toContain("Termin bestätigt");
        expect(html).toContain("Ältere Benachrichtigungen laden");
        expect(html).not.toContain('href="/app-home/notifications');
    });

    it("keeps unseen and unread separate in the DOM", () => {
        const html = renderFeed({ notifications: [{ ...rows[0], seen_at: "2026-10-23T12:01:00Z" }] });
        expect(html).toContain('data-unread="true"');
        expect(html).not.toContain("data-notification-unseen");
    });

    it("lets a long information-only account notice expand inline even after it has been read", () => {
        const notice: NotificationItem = { ...rows[1], id: "account-info", category: "account", title: "Hinweis zu deinem Konto", body: "Deine Kontoeinstellungen wurden aktualisiert. Prüfe bitte bei Gelegenheit, ob deine Kontaktangaben noch stimmen. Dafür ist keine sofortige Aktion nötig.", data: {} };
        const html = renderFeed({ notifications: [notice], unreadCount: 0 });
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-controls="notification-body-account-info"');
        expect(html).toContain('data-notification-id="account-info"');
        expect(html).toContain('id="notification-body-account-info"');
        expect(html).toContain("Dafür ist keine sofortige Aktion nötig.");
        expect(html).not.toMatch(/data-notification-unseen="account-info"[^>]*disabled/);
    });

    it("preserves an expanded notice when a read update removes it from the unread feed", () => {
        const expanded = { ...rows[0], data: {}, body: "Die vollständige Information bleibt beim Lesen sichtbar.", read_at: "2026-10-23T13:00:00Z" };
        const groups = groupNotificationFeedRows([], "unread", expanded);
        expect(groups.unread).toEqual([]);
        expect(groups.read).toEqual([]);
        expect(groups.opened).toEqual([expanded]);
        const allGroups = groupNotificationFeedRows([expanded, rows[1]], "all", expanded);
        expect(allGroups.read).toContain(expanded);
        expect(allGroups.read.filter(item => item.id === expanded.id)).toHaveLength(1);
        expect(allGroups.opened).toEqual([]);
    });

    it("keeps a failed read attempt expanded in its unread group", () => {
        const unread = { ...rows[0], data: {}, read_at: null };
        const priorExpanded = { ...unread, read_at: "2026-10-23T13:00:00Z" };
        const groups = groupNotificationFeedRows([unread], "unread", priorExpanded);
        expect(groups.unread).toEqual([unread]);
        expect(groups.opened).toEqual([]);
    });
});
