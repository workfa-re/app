import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApplicationChat } from "@/components/activity/ApplicationChat";

vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));
vi.mock("@/app/app-home/applications/actions", () => ({ markApplicationMessagesRead: vi.fn() }));
vi.mock("@/components/profile/UserProfileModal", () => ({ UserProfileModal: () => null }));
vi.mock("@/components/activity/ChatAppointments", () => ({ ChatAppointments: () => null }));

type ChatProps = ComponentProps<typeof ApplicationChat>;

function renderHeader(application: Record<string, unknown> = {}, props: Partial<ChatProps> = {}) {
    const html = renderToStaticMarkup(<ApplicationChat
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
    const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
    expect(header).toBeDefined();
    return header!;
}

describe("provider next step in the chat header", () => {
    it.each(["submitted", "negotiating"])("offers scheduling beside Details for a %s reservation", status => {
        const header = renderHeader({ status });
        expect(header).toContain('aria-label="Termin vereinbaren"');
        expect(header).not.toContain('aria-label="Zusammenarbeit abschließen"');
        expect(header).toContain('data-has-primary-action="true"');
        expect(header.indexOf('aria-label="Termin vereinbaren"'))
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
        expect(header).not.toContain('aria-label="Termin vereinbaren"');
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
