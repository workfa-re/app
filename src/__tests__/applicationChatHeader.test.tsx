import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationChat } from "@/components/activity/ApplicationChat";

vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));
vi.mock("@/app/app-home/applications/actions", () => ({ markApplicationMessagesRead: vi.fn() }));
vi.mock("@/components/profile/UserProfileModal", () => ({ UserProfileModal: () => null }));
vi.mock("@/components/activity/ChatAppointments", () => ({ ChatAppointments: () => null }));
const appointmentState = vi.hoisted(() => ({ requests: [] as Record<string, unknown>[], available: true, refresh: vi.fn() }));
vi.mock("@/components/activity/useAppointmentRequests", () => ({ useAppointmentRequests: () => appointmentState }));

beforeEach(() => { appointmentState.requests = []; });

type ChatProps = ComponentProps<typeof ApplicationChat>;

function renderChat(application: Record<string, unknown> = {}, props: Partial<ChatProps> = {}) {
    return renderToStaticMarkup(<ApplicationChat
        application={{
            id: "application-a",
            status: "negotiating",
            is_primary: true,
            conversation_state: "open",
            applicant: { id: "seeker-a", full_name: "Mara Beispiel" },
            job: { id: "job-a", title: "Hilfe im Garten", posted_by: "provider-a", job_kind: "one_time" },
            ...application,
        }}
        currentUserId="provider-a"
        currentUserRole="provider"
        onSchedule={vi.fn()}
        onComplete={vi.fn()}
        onSendMessage={vi.fn()}
        {...props}
    />);
}

function renderHeader(application: Record<string, unknown> = {}, props: Partial<ChatProps> = {}) {
    const header = renderChat(application, props).match(/<header\b[\s\S]*?<\/header>/)?.[0];
    expect(header).toBeDefined();
    return header!;
}

describe("provider next step in the chat header", () => {
    it.each(["submitted", "negotiating"])("offers scheduling beside Details for a %s reservation", status => {
        const header = renderHeader({ status });
        expect(header).toContain('aria-label="Termin festlegen"');
        expect(header).not.toContain('aria-label="Zusammenarbeit abschließen"');
        expect(header).toContain('data-has-primary-action="true"');
        expect(header.indexOf('aria-label="Termin festlegen"'))
            .toBeLessThan(header.indexOf('aria-label="Jobdetails und Aktionen öffnen"'));
    });

    it.each(["one_time", "recurring"])("offers one completion shortcut for an agreed %s job", jobKind => {
        const header = renderHeader({
            status: "accepted",
            engagement: { status: "active" },
            scheduled_for: "2026-07-16T19:24:00Z",
            job: { id: "job-a", title: "Hilfe im Garten", posted_by: "provider-a", job_kind: jobKind },
        });
        expect(header.match(/class="activity-schedule-button"/g)).toHaveLength(1);
        expect(header).toContain('aria-label="Zusammenarbeit abschließen"');
        expect(header).not.toContain('aria-label="Termin festlegen"');
        expect(header.indexOf('aria-label="Zusammenarbeit abschließen"'))
            .toBeLessThan(header.indexOf('aria-label="Jobdetails und Aktionen öffnen"'));
    });

    it.each([
        { status: "completed", conversation_state: "closed", engagement: { status: "completed" } },
        { status: "cancelled", conversation_state: "closed" },
        { status: "accepted", conversation_state: "closed", engagement: { status: "active" } },
        { status: "accepted", is_primary: false, engagement: { status: "active" } },
        { status: "accepted", engagement: { status: "completed" } },
        { status: "accepted", engagement: null },
        { status: "negotiating", is_primary: false },
        { status: "waitlisted" },
    ])("keeps inactive or non-primary work out of the header: %j", application => {
        const header = renderHeader(application);
        expect(header).not.toContain('class="activity-schedule-button"');
        expect(header).toContain('data-has-primary-action="false"');
        expect(header).toContain('aria-label="Jobdetails und Aktionen öffnen"');
    });

    it.each(["negotiating", "accepted"])("does not expose provider actions to seekers or read-only %s chats", status => {
        const application = { status, engagement: { status: "active" } };
        for (const props of [{ currentUserRole: "seeker" as const }, { readOnly: true }]) {
            expect(renderHeader(application, props)).not.toContain('class="activity-schedule-button"');
        }
    });

    it("requires the matching action callback instead of exposing an inactive shortcut", () => {
        expect(renderHeader({}, { onSchedule: undefined })).not.toContain('class="activity-schedule-button"');
        expect(renderHeader({ status: "accepted", engagement: { status: "active" } }, { onComplete: undefined }))
            .not.toContain('class="activity-schedule-button"');
    });
});

describe("open appointment request shortcut", () => {
    beforeEach(() => {
        appointmentState.requests = [{ id: "request-a", status: "pending", requested_by: "seeker-a" }];
    });

    it("opens the provider's request directly beside Details while keeping completion available", () => {
        const header = renderHeader({ status: "accepted", engagement: { status: "active" } });
        expect(header).toContain('aria-label="Offene Terminanfrage prüfen"');
        expect(header).toContain('aria-label="Zusammenarbeit abschließen"');
        expect(header.indexOf('aria-label="Offene Terminanfrage prüfen"')).toBeLessThan(header.indexOf('aria-label="Jobdetails und Aktionen öffnen"'));
        expect(header).toContain('aria-haspopup="dialog"');
    });

    it("lets seekers find their own outgoing proposal without offering provider decisions", () => {
        const header = renderHeader({ status: "accepted", engagement: { status: "active" } }, { currentUserRole: "seeker" });
        expect(header).toContain('aria-label="Deinen Terminvorschlag ansehen"');
        expect(header).not.toContain('aria-label="Offene Terminanfrage prüfen"');
        expect(header).not.toContain('aria-label="Zusammenarbeit abschließen"');
    });

    it.each([
        { status: "completed", conversation_state: "closed" },
        { status: "accepted", conversation_state: "closed" },
        { status: "accepted", is_primary: false },
        { status: "negotiating" },
    ])("does not expose stale request actions after the collaboration changes: %j", application => {
        expect(renderHeader({ ...application, engagement: { status: "active" } })).not.toContain('class="activity-appointment-shortcut"');
    });

    it("does not expose an appointment action in read-only mode", () => {
        expect(renderHeader({ status: "accepted", engagement: { status: "active" } }, { readOnly: true })).not.toContain('class="activity-appointment-shortcut"');
    });
});

describe("one integrated order status below the chat header", () => {
    function statusBar(html: string) {
        const bar = html.match(/<section class="activity-chat-statebar"[\s\S]*?<\/section>/)?.[0];
        expect(bar).toBeDefined();
        return bar!;
    }

    it("separates the agreed appointment from messages without repeating a header badge", () => {
        const html = renderChat({ status: "accepted", scheduled_for: "2026-10-25T14:00:00Z", engagement: { status: "active" } });
        const bar = statusBar(html);
        expect(bar).toContain('aria-label="Auftragsstatus"');
        expect(bar).toContain("Termin vereinbart");
        expect(bar).toContain('<time dateTime="2026-10-25T14:00:00Z">');
        expect(html.indexOf(bar)).toBeGreaterThan(html.indexOf("</header>"));
        expect(html.indexOf(bar)).toBeLessThan(html.indexOf('role="log"'));
        expect(html).not.toContain('class="activity-chat-notice"');
        expect(html).not.toContain('class="activity-chat-status"');
    });

    it("shows the real reservation even when release actions are unavailable", () => {
        for (const props of [{}, { readOnly: true }, { currentUserRole: "seeker" as const }]) {
            const bar = statusBar(renderChat({}, props));
            expect(bar).toContain("Reserviert");
            expect(bar).toContain(props.currentUserRole === "seeker" ? "Termin mit dem Anbieter abstimmen" : "Nächster Schritt: Termin festlegen");
            expect(bar).not.toContain('class="activity-chat-state-action"');
        }
    });

    it("keeps rare reservation release actions out of the status bar", () => {
        expect(statusBar(renderChat({}, { onReject: vi.fn() })))
            .not.toContain('aria-label="Bewerbung ablehnen und Job freigeben"');
        expect(statusBar(renderChat({}, { currentUserRole: "seeker", onWithdraw: vi.fn() })))
            .not.toContain('aria-label="Bewerbung zurückziehen"');
        expect(statusBar(renderChat({}, { readOnly: true, onReject: vi.fn() })))
            .not.toContain('class="activity-chat-state-action"');
    });

    it("does not invent an appointment when an agreed job has no valid date", () => {
        for (const scheduled_for of [null, "not-a-date"]) {
            const bar = statusBar(renderChat({ status: "accepted", scheduled_for }));
            expect(bar).toContain("Vereinbart");
            expect(bar).not.toContain("<time");
            expect(bar).not.toContain("Termin abstimmen");
        }
    });

    it("keeps recurring collaboration and its date concise", () => {
        const bar = statusBar(renderChat({ status: "accepted", scheduled_for: "2026-10-25T14:00:00Z", job: { title: "Gartenpflege", job_kind: "recurring" } }));
        expect(bar).toContain("Zusammenarbeit aktiv");
        expect(bar.match(/<time\b/g)).toHaveLength(1);
    });

    it("does not fill ended chats with legacy closure placeholders", () => {
        for (const closed_reason of [null, "", "1161", "ok"]) {
            const bar = statusBar(renderChat({ status: "cancelled", conversation_state: "closed", closed_reason }));
            expect(bar).not.toContain("ältere Schließung");
            expect(bar).not.toContain("Grund:");
        }
    });

    it.each([
        { status: "accepted", conversation_state: "closed" },
        { status: "accepted", is_primary: false },
        { status: "completed", conversation_state: "closed" },
        { status: "waitlisted" },
    ])("does not show an active appointment for ended work: %j", application => {
        const html = renderChat({ ...application, scheduled_for: "2026-10-25T14:00:00Z", closed_reason: "Gemeinsam beendet" });
        const bar = statusBar(html);
        expect(html.match(/class="activity-chat-statebar"/g)).toHaveLength(1);
        expect(bar).toContain('data-tone="closed"');
        expect(bar).not.toContain("<time");
        expect(bar).not.toContain("Termin vereinbart");
        expect(bar).not.toContain('class="activity-chat-state-action"');
        expect(bar).toContain(application.status === "waitlisted" ? "Beendete Anfrage" : "Grund: Gemeinsam beendet");
        if (application.status === "completed") expect(bar).toContain("Abgeschlossen");
    });
});
