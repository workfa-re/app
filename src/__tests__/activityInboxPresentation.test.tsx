import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ search: "", refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: route.refresh }),
    useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));

import { ActivityCommandCenter, getActivityInboxPresentation } from "@/components/activity/ActivityCommandCenter";

const conversation = {
    id: "reserved-a",
    job_id: "job-a",
    status: "negotiating",
    conversation_state: "open",
    is_primary: true,
    created_at: "2026-10-20T10:00:00.000Z",
    message: "  Ich helfe\n gern.  ",
    last_message_preview: "  Passt dir\n Samstag?  ",
    last_message_at: "2026-10-21T11:00:00.000Z",
    unread_count: 2,
    pending_reopen_count: 0,
    applicant: {
        full_name: "Anna Schneider", city: "Rheinbach", avatar_url: null,
        birthdate: "2008-02-12", email: "private-seeker@example.test", address: "Private Straße 8",
    },
    job: {
        id: "job-a", title: "Rasen mähen", public_location_label: "Rheinbach",
        creator: {
            full_name: "Max Mustermann", company_name: "Garten & Nachbarschaft", city: "Rheinbach", avatar_url: null,
            email: "private-provider@example.test", address: "Verborgener Weg 12",
        },
    },
};

describe("activity inbox presentation", () => {
    it("shows the job and the correct conversation partner for each role without leaking account fields", () => {
        const provider = getActivityInboxPresentation(conversation, "provider");
        const seeker = getActivityInboxPresentation(conversation, "seeker");
        expect(provider.partner).toEqual({ name: "Anna Schneider", subtitle: "Rasen mähen", meta: "Rheinbach", avatarUrl: null });
        expect(seeker.partner).toEqual({ name: "Garten & Nachbarschaft", subtitle: "Rasen mähen", meta: "Rheinbach", avatarUrl: null });
        expect(provider.status.label).toBe("Reserviert");
        expect(provider.preview).toBe("Passt dir Samstag?");
        expect(provider.previewTimestamp).toBe(conversation.last_message_at);
        for (const privateValue of ["2008-02-12", "private-seeker@example.test", "Private Straße 8", "private-provider@example.test", "Verborgener Weg 12"]) {
            expect(JSON.stringify([provider, seeker])).not.toContain(privateValue);
        }
    });

    it("uses normalized initial text and its own date when no meaningful last message exists", () => {
        const initial = getActivityInboxPresentation({ ...conversation, last_message_preview: " \n " }, "provider");
        expect(initial.preview).toBe("Ich helfe gern.");
        expect(initial.previewTimestamp).toBe(conversation.created_at);
        expect(getActivityInboxPresentation({ ...conversation, last_message_preview: null, message: " \n " }, "seeker").preview)
            .toBe("Noch keine Nachricht im Gespräch.");
    });

    it("distinguishes a confirmed agreement, completion and historical non-primary conversations", () => {
        expect(getActivityInboxPresentation({ ...conversation, status: "accepted" }, "provider").status.label).toBe("Vereinbart");
        expect(getActivityInboxPresentation({ ...conversation, status: "completed", conversation_state: "closed" }, "provider").status.label).toBe("Abgeschlossen");
        expect(getActivityInboxPresentation({ ...conversation, status: "accepted", is_primary: false }, "provider").status)
            .toEqual({ label: "Beendet", tone: "neutral" });
        expect(getActivityInboxPresentation({ ...conversation, status: "accepted", conversation_state: "closed" }, "provider").status)
            .toEqual({ label: "Beendet", tone: "neutral" });
        const retired = getActivityInboxPresentation({ ...conversation, status: "auto_rejected", close_action: "waitlist_retired", pending_reopen_count: 1 }, "provider");
        expect(retired.status.label).toBe("Beendete Anfrage");
        expect(retired.attention).toMatchObject({ unreadCount: 2, pendingReopenCount: 0, kind: "message" });
    });
});

function renderInbox(applications = [conversation], role: "provider" | "seeker" = "provider") {
    return renderToStaticMarkup(<ActivityCommandCenter
        applications={applications} role={role} currentUserId="current-user" readOnly
        onSendMessage={async () => { throw new Error("No messages may be sent by rendering an inbox."); }}
    />);
}

function conversationButtons(html: string) {
    return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
        .map(match => match[0])
        .filter(button => button.includes("Gespräch öffnen:"));
}

describe("direct conversation inbox", () => {
    beforeEach(() => {
        route.search = "";
        vi.clearAllMocks();
    });

    it.each(["provider", "seeker"] as const)("renders one direct conversation target for %s with its job, person and real status", role => {
        const html = renderInbox([conversation], role);
        const rows = conversationButtons(html);
        expect(html).toContain("<h1>Nachrichten</h1>");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain("Rasen mähen");
        expect(rows[0]).toContain(role === "provider" ? "Anna Schneider" : "Garten &amp; Nachbarschaft");
        expect(rows[0]).toContain("Reserviert");
        expect(rows[0]).toContain("Passt dir Samstag?");
        expect(rows[0]).toContain("2 ungelesene Nachrichten");
        expect(rows[0]).not.toContain("aria-expanded");
        expect(html).not.toContain("private-seeker@example.test");
        expect(html).not.toContain("private-provider@example.test");
        expect(route.refresh).not.toHaveBeenCalled();
    });

    it("keeps separate archived conversations for the same job and labels reopening separately from unread messages", () => {
        route.search = "view=archive";
        const html = renderInbox([
            conversation,
            { ...conversation, id: "withdrawn", status: "withdrawn", conversation_state: "closed", is_primary: false, unread_count: 0, pending_reopen_count: 1 },
            { ...conversation, id: "rejected", status: "rejected", conversation_state: "closed", is_primary: false, unread_count: 1 },
        ]);
        const rows = conversationButtons(html);
        expect(rows).toHaveLength(2);
        expect(rows.filter(row => row.includes("Rasen mähen"))).toHaveLength(2);
        const reopenRow = rows.find(row => row.includes("Zurückgezogen"));
        expect(reopenRow).toContain("Öffnungsanfrage offen");
        expect(reopenRow).not.toContain("ungelesene Nachricht");
        expect(rows.find(row => row.includes("Abgelehnt"))).toContain("1 ungelesene Nachricht");
        expect(rows.every(row => !row.includes("Reserviert"))).toBe(true);
    });

    it("opens an archived deep link in Archiv without losing its selected row", () => {
        route.search = "conversation=completed";
        const html = renderInbox([
            conversation,
            { ...conversation, id: "completed", status: "completed", conversation_state: "closed", is_primary: false },
        ]);
        const rows = conversationButtons(html);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain('aria-pressed="true"');
        expect(rows[0]).toContain("Abgeschlossen");
        expect(rows[0]).not.toContain("Reserviert");
    });

    it.each([
        ["provider", "/app-home/offers", "Zu deinen Jobs"],
        ["seeker", "/app-home/jobs", "Jobs entdecken"],
    ] as const)("gives an empty %s inbox its own useful starting action", (role, href, label) => {
        const html = renderInbox([], role);
        expect(html).toContain("<h1>Nachrichten</h1>");
        expect(html).toContain('href="' + href + '"');
        expect(html).toContain(label);
        expect(conversationButtons(html)).toHaveLength(0);
    });
});
