import { describe, expect, it } from "vitest";
import { isPendingAppointmentMessage, type AppointmentRequest } from "@/lib/activity/appointments";

const request: AppointmentRequest = {
    id: "33333333-3333-4333-8333-333333333301",
    application_id: "11111111-1111-4111-8111-111111111111",
    appointment_id: "22222222-2222-4222-8222-222222222222",
    requested_by: "seeker-a",
    starts_at: "2026-10-26T13:00:00Z",
    ends_at: null,
    timezone: "Europe/Berlin",
    note: null,
    status: "pending",
    created_at: "2026-10-24T10:15:30.123456+00:00",
    responded_at: null,
};
const message = {
    kind: "system",
    content: "Eine Terminänderung wurde angefragt. Der bisherige Termin bleibt bis zur Bestätigung bestehen.",
    application_id: request.application_id,
    sender_id: request.requested_by,
    created_at: "2026-10-24T10:15:30.123456Z",
};

describe("actionable pending appointment messages", () => {
    it("links an exact pending transaction without fetching message history", () => {
        expect(isPendingAppointmentMessage(message, [request])).toBe(true);
        expect(isPendingAppointmentMessage({ ...message, content: "Ein weiterer Termin wurde angefragt." }, [request])).toBe(true);
        expect(isPendingAppointmentMessage(message, [])).toBe(false);
    });

    it.each([
        ["2026-10-24T10:15:30.123456Z", "2026-10-24T10:15:30.123456+00:00"],
        ["2026-10-24T10:15:30.123456+00", "2026-10-24T10:15:30.123456Z"],
        ["2026-10-24T10:15:30.123Z", "2026-10-24T10:15:30.123000+00:00"],
        ["2026-10-24T10:15:30Z", "2026-10-24T10:15:30.000000+00:00"],
        ["2026-10-24T12:15:30.123456+02:00", "2026-10-24T10:15:30.123456Z"],
        ["2026-10-24T05:15:30.123456-05:00", "2026-10-24T10:15:30.123456Z"],
        ["2026-10-25T00:15:30.123456+02:00", "2026-10-24T22:15:30.123456Z"],
    ])("recognizes the same source instant in %s and %s", (messageTime, requestTime) => {
        expect(isPendingAppointmentMessage({ ...message, created_at: messageTime }, [{ ...request, created_at: requestTime }])).toBe(true);
    });

    it("preserves differences smaller than a millisecond", () => {
        expect(isPendingAppointmentMessage(message, [{ ...request, created_at: "2026-10-24T10:15:30.123457+00:00" }])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, created_at: "2026-10-24T10:15:30.123+00:00" }])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, created_at: "2026-10-24T10:15:31.123456+00:00" }])).toBe(false);
    });

    it.each(["accepted", "declined", "withdrawn", "superseded"] as const)("keeps an original request notice passive after it becomes %s", status => {
        expect(isPendingAppointmentMessage(message, [{ ...request, status }])).toBe(false);
    });

    it("does not substitute a newer request, another sender or another conversation", () => {
        expect(isPendingAppointmentMessage(message, [{ ...request, created_at: "2026-10-24T10:16:30.123456Z" }])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, requested_by: "seeker-b" }])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, application_id: "another-application" }])).toBe(false);
    });

    it("rejects ambiguous and inconsistent pending data", () => {
        expect(isPendingAppointmentMessage(message, [request, { ...request, id: "another-request" }])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, responded_at: "2026-10-24T11:00:00Z" }])).toBe(false);
    });

    it.each([
        "Der Terminvorschlag wurde zurückgezogen.",
        "Der Terminvorschlag wurde abgelehnt. Der bisherige Termin bleibt bestehen.",
        "Der Termin wurde aktualisiert.",
        "Der Termin wurde verbindlich vereinbart.",
    ])("leaves the status hint %s passive", content => {
        expect(isPendingAppointmentMessage({ ...message, content }, [request])).toBe(false);
    });

    it("does not treat copied chat text, temporary or deleted messages as persisted requests", () => {
        expect(isPendingAppointmentMessage({ ...message, kind: "chat" }, [request])).toBe(false);
        expect(isPendingAppointmentMessage({ ...message, is_temp: true }, [request])).toBe(false);
        expect(isPendingAppointmentMessage({ ...message, failed: true }, [request])).toBe(false);
        expect(isPendingAppointmentMessage({ ...message, deleted_at: "2026-10-24T12:00:00Z" }, [request])).toBe(false);
        expect(isPendingAppointmentMessage({ ...message, sender_id: null }, [request])).toBe(false);
        expect(isPendingAppointmentMessage({ ...message, application_id: null }, [request])).toBe(false);
    });

    it.each([
        null,
        "24.10.2026 10:15:30",
        "2026-10-24T10:15:30",
        "2026-10-24T10:15:30.1234567Z",
        "2026-02-30T10:15:30.123456Z",
        "2026-10-24T24:15:30.123456Z",
        "2026-10-24T10:15:30.123456+99:00",
        "2026-10-24T10:15:30.123456+02:99",
    ])("keeps an uncertain timestamp %s passive", createdAt => {
        expect(isPendingAppointmentMessage({ ...message, created_at: createdAt }, [request])).toBe(false);
        expect(isPendingAppointmentMessage(message, [{ ...request, created_at: createdAt as string }])).toBe(false);
    });
});
