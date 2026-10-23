import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({
    supabaseBrowser: {},
}));

import {
    getActivityAttentionLabel,
    getActivityWorkspaceSection,
    getActivityWorkspaceSelection,
    getActivityWorkspaceUrl,
    getActivityAttentionSummary,
    getGroupedActivityAttentionSummary,
    matchesActivityCommandCenterFilter,
} from "@/components/activity/ActivityCommandCenter";

describe("ActivityCommandCenter reopen attention", () => {
    it("does not expose stale reopen attention for migrated retired requests", () => {
        expect(getActivityAttentionSummary({ status: "auto_rejected", close_action: "waitlist_retired", unread_count: 2, pending_reopen_count: 1 })).toEqual({ unreadCount: 2, pendingReopenCount: 0, totalCount: 2, kind: "message" });
    });
    it("keeps a closed conversation with a pending reopen request in the archive and attention filters", () => {
        const application = {
            status: "withdrawn",
            unread_count: 0,
            pending_reopen_count: 1,
        };

        expect(matchesActivityCommandCenterFilter(application, "active")).toBe(false);
        expect(matchesActivityCommandCenterFilter(application, "unread")).toBe(true);
        expect(matchesActivityCommandCenterFilter(application, "all")).toBe(true);
        expect(matchesActivityCommandCenterFilter(application, "closed")).toBe(true);
    });

    it("does not treat an ordinary closed conversation as active attention", () => {
        const application = {
            status: "withdrawn",
            unread_count: 0,
            pending_reopen_count: 0,
        };

        expect(matchesActivityCommandCenterFilter(application, "active")).toBe(false);
        expect(matchesActivityCommandCenterFilter(application, "unread")).toBe(false);
        expect(matchesActivityCommandCenterFilter(application, "closed")).toBe(true);
    });

    it("keeps message counts separate from reopen requests and normalizes invalid badge values", () => {
        expect(getActivityAttentionSummary({ unread_count: "2.8", pending_reopen_count: "1" })).toEqual({
            unreadCount: 2, pendingReopenCount: 1, totalCount: 3, kind: "mixed",
        });
        expect(getActivityAttentionSummary({ unread_count: Infinity, pending_reopen_count: -1 })).toEqual({
            unreadCount: 0, pendingReopenCount: 0, totalCount: 0, kind: "none",
        });
        expect(getActivityAttentionLabel(getActivityAttentionSummary({ unread_count: 0, pending_reopen_count: 1 })))
            .toBe("1 offene Öffnungsanfrage");
    });

    it("keeps unread messages from a closed conversation in the archive", () => {
        const application = {
            status: "withdrawn",
            unread_count: 1,
            pending_reopen_count: 0,
        };

        expect(matchesActivityCommandCenterFilter(application, "active")).toBe(false);
        expect(matchesActivityCommandCenterFilter(application, "unread")).toBe(true);
        expect(matchesActivityCommandCenterFilter(application, "all")).toBe(true);
        expect(matchesActivityCommandCenterFilter(application, "closed")).toBe(true);
    });

    it("combines message and reopen attention without mislabelling the accessible count", () => {
        const summary = getActivityAttentionSummary({
            unread_count: 2,
            pending_reopen_count: 1,
        });

        expect(summary).toEqual({
            unreadCount: 2,
            pendingReopenCount: 1,
            totalCount: 3,
            kind: "mixed",
        });
        expect(getActivityAttentionLabel(summary)).toBe(
            "2 ungelesene Nachrichten und 1 offene Öffnungsanfrage",
        );
    });

    it("aggregates provider job attention across conversations", () => {
        expect(getGroupedActivityAttentionSummary([
            { unread_count: 2, pending_reopen_count: 0 },
            { unread_count: 0, pending_reopen_count: 1 },
            { unread_count: -1, pending_reopen_count: "invalid" },
        ])).toEqual({
            unreadCount: 2,
            pendingReopenCount: 1,
            totalCount: 3,
            kind: "mixed",
        });
    });
});

describe("ActivityCommandCenter workspace navigation", () => {
    const rows = [
        { id: "ongoing", status: "negotiating", conversation_state: "open" },
        { id: "waiting", status: "waitlisted", conversation_state: "open" },
        { id: "completed", status: "completed", conversation_state: "closed", unread_count: 2, pending_reopen_count: 1 },
    ];

    it.each(["submitted", "negotiating", "accepted"])("keeps %s in Laufend while the conversation is open", status => {
        expect(getActivityWorkspaceSection({ status, conversation_state: "open" })).toBe("active");
    });

    it.each(["completed", "rejected", "auto_rejected", "withdrawn", "cancelled", "waitlisted"])("keeps %s in Archiv even when it needs attention", status => {
        const source = { status, unread_count: 1, pending_reopen_count: 1 };
        expect(getActivityWorkspaceSection(source)).toBe("closed");
        expect(matchesActivityCommandCenterFilter(source, "active")).toBe(false);
        expect(matchesActivityCommandCenterFilter(source, "closed")).toBe(true);
    });

    it("treats an explicitly closed conversation as archived even if its older status is active", () => {
        expect(getActivityWorkspaceSection({ status: "negotiating", conversation_state: "closed" })).toBe("closed");
    });

    it.each(["submitted", "negotiating", "accepted"])("never promotes a historical non-primary %s conversation into Laufend", status => {
        const historical = { status, conversation_state: "open", is_primary: false, pending_reopen_count: 1 };
        expect(getActivityWorkspaceSection(historical)).toBe("closed");
        expect(matchesActivityCommandCenterFilter(historical, "active")).toBe(false);
        expect(matchesActivityCommandCenterFilter(historical, "closed")).toBe(true);
        expect(matchesActivityCommandCenterFilter(historical, "unread")).toBe(true);
    });

    it("opens an archived deep link in Archiv without requiring a second tab click", () => {
        expect(getActivityWorkspaceSelection("completed", null, rows)).toEqual({ selectedAppId: "completed", filter: "closed" });
        expect(getActivityWorkspaceSelection("ongoing", "archive", rows)).toEqual({ selectedAppId: "ongoing", filter: "active" });
    });

    it("keeps selection driven by the current URL through read and realtime updates", () => {
        const readRows = rows.map(row => ({ ...row, unread_count: 0 }));
        expect(getActivityWorkspaceSelection("waiting", null, readRows)).toEqual({ selectedAppId: "waiting", filter: "closed" });
        expect(getActivityWorkspaceSelection("completed", null, readRows)).toEqual({ selectedAppId: "completed", filter: "closed" });
        expect(getActivityWorkspaceSelection(null, null, readRows)).toEqual({ selectedAppId: null, filter: "active" });
    });

    it("does not select an unavailable or unauthorized conversation", () => {
        expect(getActivityWorkspaceSelection("other-user", null, rows)).toEqual({ selectedAppId: null, filter: "active" });
        expect(getActivityWorkspaceSelection("other-user", "archive", rows)).toEqual({ selectedAppId: null, filter: "closed" });
    });

    it("moves the selected job to Archiv only after its confirmed application status changes", () => {
        expect(getActivityWorkspaceSelection("ongoing", null, rows).filter).toBe("active");
        const completedRows = rows.map(row => row.id === "ongoing" ? { ...row, status: "completed", conversation_state: "closed" } : row);
        expect(getActivityWorkspaceSelection("ongoing", null, completedRows)).toEqual({ selectedAppId: "ongoing", filter: "closed" });
    });

    it("preserves the provider job filter and hash when selecting or closing a conversation", () => {
        const href = "http://localhost:3000/app-home/activities?jobId=job-a#workspace";
        expect(getActivityWorkspaceUrl(href, "app/a", "closed"))
            .toBe("/app-home/activities?jobId=job-a&conversation=app%2Fa&view=archive#workspace");
        expect(getActivityWorkspaceUrl("http://localhost:3000" + getActivityWorkspaceUrl(href, "app/a", "closed"), null, "closed"))
            .toBe("/app-home/activities?jobId=job-a&view=archive#workspace");
        expect(getActivityWorkspaceUrl("http://localhost:3000/app-home/activities?conversation=completed&view=archive", null, "active"))
            .toBe("/app-home/activities");
    });

    it("restores the list, active job, and archived job from a browser history sequence", () => {
        const history = [
            "http://localhost:3000/app-home/activities",
            "http://localhost:3000/app-home/activities?conversation=ongoing",
            "http://localhost:3000/app-home/activities?conversation=completed&view=archive",
        ];
        const read = (href: string) => {
            const params = new URL(href).searchParams;
            return getActivityWorkspaceSelection(params.get("conversation"), params.get("view"), rows);
        };
        expect(history.map(read)).toEqual([
            { selectedAppId: null, filter: "active" },
            { selectedAppId: "ongoing", filter: "active" },
            { selectedAppId: "completed", filter: "closed" },
        ]);
        expect(read(history[1])).toEqual({ selectedAppId: "ongoing", filter: "active" });
        expect(read(history[0])).toEqual({ selectedAppId: null, filter: "active" });
    });
});
