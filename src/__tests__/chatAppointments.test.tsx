import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppointmentRequest } from "@/lib/activity/appointments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/app-home/applications/actions", () => ({ manageJobAppointment: vi.fn() }));

import { ChatAppointments } from "@/components/activity/ChatAppointments";

const proposal: AppointmentRequest = {
    id: "proposal-current", application_id: "conversation-a", appointment_id: "appointment-a",
    requested_by: "seeker-a", starts_at: "2026-10-25T13:00:00Z", ends_at: null,
    timezone: "Europe/Berlin", note: "Am Gartentor treffen.", status: "pending",
    created_at: "2026-10-23T12:00:00Z", responded_at: null,
};
const render = (props: Partial<ComponentProps<typeof ChatAppointments>> = {}) => renderToStaticMarkup(<ChatAppointments
    applicationId="conversation-a" currentUserId="provider-a" isProvider recurring={false}
    appointments={[{ id: "appointment-a", starts_at: "2026-10-25T12:00:00Z", status: "scheduled" }]}
    formatSchedule={value => value ?? null} onChanged={vi.fn()} requests={[proposal]}
    available onReload={vi.fn().mockResolvedValue(undefined)} {...props}
/>);

describe("controlled appointment proposal details", () => {
    it("shows the current pending proposal with its real confirmation actions", () => {
        const html = render();
        expect(html).toContain("Neuer Terminvorschlag");
        expect(html).toContain("Der bisherige Termin gilt bis zur Bestätigung.");
        expect(html).toContain("Annehmen");
        expect(html).toContain("Ablehnen");
    });

    it("keeps the selected proposal and appointment management together in details", () => {
        const html = render({ focusedRequest: proposal, isProvider: false, currentUserId: "seeker-a", recurring: true });
        expect(html).toContain("Dein offener Vorschlag");
        expect(html).toContain("Vorschlag zurückziehen");
        expect(html).toContain("Änderung anfragen");
        expect(html).toContain("Termin anfragen");
        expect(html).not.toContain("Neuer Termin");
        expect(html).not.toContain("<form");
    });

    it.each(["accepted", "declined", "withdrawn", "superseded"] as const)("keeps a selected %s proposal separate from the current pending request", status => {
        const html = render({ focusedRequest: { ...proposal, id: "proposal-history", note: "Bisheriger Vorschlag.", status } });
        expect(html).toContain(`data-status="${status}"`);
        expect(html).toContain("Bisheriger Vorschlag.");
        expect(html).not.toContain("Am Gartentor treffen.");
        expect(html).not.toContain("Der bisherige Termin gilt bis zur Bestätigung.");
        expect(html).not.toContain("Annehmen");
        expect(html).not.toContain("Ablehnen");
        expect(html).not.toContain("Vorschlag zurückziehen");
    });

    it("does not substitute the current request for an unassigned historical hint", () => {
        const html = render({ focusedRequest: null });
        expect(html).toContain("Dieser Hinweis gehört zum bisherigen Terminverlauf.");
        expect(html).not.toContain("Am Gartentor treffen.");
        expect(html).not.toContain("Neuer Terminvorschlag");
        expect(html).not.toContain("Annehmen");
    });

    it("prioritizes selected-request loading over the current request and unavailable fallback", () => {
        const html = render({ focusedLoading: true, available: false, onLegacySchedule: vi.fn() });
        expect(html).toContain("Terminvorschlag wird geladen");
        expect(html).not.toContain("Neuer Terminvorschlag");
        expect(html).not.toContain("Termin bearbeiten");
        expect(html).not.toContain("Am Gartentor treffen.");
    });

    it("prioritizes selected-request errors and retry over every normal appointment action", () => {
        const html = render({ focusedError: "Dieser Vorschlag konnte nicht geladen werden.", available: false, onReloadFocused: vi.fn(), onLegacySchedule: vi.fn() });
        expect(html).toContain('role="alert"');
        expect(html).toContain("Dieser Vorschlag konnte nicht geladen werden.");
        expect(html).toContain("Erneut laden");
        expect(html).not.toContain("Neuer Terminvorschlag");
        expect(html).not.toContain("Termin bearbeiten");
    });

    it("preserves a resolved selection even if pending-request retrieval is unavailable", () => {
        const html = render({ focusedRequest: { ...proposal, status: "accepted" }, available: false, canManage: false });
        expect(html).toContain("Vorschlag angenommen");
        expect(html).toContain("Am Gartentor treffen.");
        expect(html).not.toContain("nicht verfügbar");
        expect(html).not.toContain("<button");
    });

    it("keeps historical chats read-only even for providers and legacy scheduling", () => {
        for (const available of [true, false]) {
            const html = render({ canManage: false, available, focusedRequest: proposal, onLegacySchedule: vi.fn() });
            expect(html).toContain("Am Gartentor treffen.");
            expect(html).not.toContain("<button");
            expect(html).not.toContain("<form");
        }
    });

    it("preserves legacy scheduling and retry when the new API is unavailable", () => {
        const providerHtml = render({ available: false, requests: [], onLegacySchedule: vi.fn() });
        expect(providerHtml).toContain("Termin bearbeiten");
        const seekerHtml = render({ available: false, requests: [], isProvider: false, currentUserId: "seeker-a" });
        expect(seekerHtml).toContain("Erneut laden");
        expect(seekerHtml).not.toContain("Termin bearbeiten");
    });
});
