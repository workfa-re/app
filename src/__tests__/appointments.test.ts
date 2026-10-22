import { describe, expect, it } from "vitest";
import { appointmentInputValue, appointmentMutationError, type AppointmentMutation } from "@/lib/activity/appointments";

const id = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-22T12:00:00Z").getTime();
const valid: AppointmentMutation = { applicationId: id, action: "propose", startsAt: "2026-10-24T15:00:00+02:00" };
describe("appointment mutation validation", () => {
    it("keeps new and changed date requests explicit", () => {
        expect(appointmentMutationError(valid, now)).toBeNull();
        expect(appointmentMutationError({ ...valid, action: "update" }, now)).toBe("Bitte wähle einen Termin.");
        expect(appointmentMutationError({ ...valid, action: "update", appointmentId: id }, now)).toBeNull();
        expect(appointmentMutationError({ ...valid, action: "add", appointmentId: id }, now)).toContain("überschreiben");
    });
    it("rejects invalid or expired times and validates an optional end", () => {
        expect(appointmentMutationError({ ...valid, startsAt: "invalid" }, now)).toContain("Zukunft");
        expect(appointmentMutationError({ ...valid, startsAt: "2026-10-20T12:00:00Z" }, now)).toContain("Zukunft");
        expect(appointmentMutationError({ ...valid, endsAt: "2026-10-23T12:00:00Z" }, now)).toContain("Ende");
        expect(appointmentMutationError({ ...valid, endsAt: "invalid" }, now)).toContain("Ende");
        expect(appointmentMutationError({ ...valid, endsAt: "2026-10-24T17:00:00+02:00" }, now)).toBeNull();
    });
    it("requires persisted requests for responses rather than accepting arbitrary client time", () => {
        for (const action of ["accept", "decline", "withdraw"] as const) {
            expect(appointmentMutationError({ applicationId: id, action }, now)).toContain("Terminanfrage");
            expect(appointmentMutationError({ applicationId: id, action, requestId: id }, now)).toBeNull();
        }
    });
    it("validates identifiers, action and bounded text", () => {
        expect(appointmentMutationError({ ...valid, applicationId: "wrong" }, now)).toContain("Vorgang");
        expect(appointmentMutationError({ ...valid, appointmentId: "wrong" }, now)).toContain("Termin");
        expect(appointmentMutationError({ ...valid, action: "unknown" as AppointmentMutation["action"] }, now)).toContain("Unbekannte");
        expect(appointmentMutationError({ ...valid, note: "x".repeat(1001) }, now)).toContain("1.000");
    });
    it("preserves dates through the browser's datetime-local conversion", () => {
        const iso = "2026-10-24T13:00:00.000Z";
        expect(new Date(appointmentInputValue(iso)).toISOString()).toBe(iso);
        expect(appointmentInputValue("invalid")).toBe("");
        expect(appointmentInputValue(null)).toBe("");
    });
});
