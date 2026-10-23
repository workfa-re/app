import { describe, expect, it } from "vitest";
import { getAppointmentSystemMessageKind } from "@/lib/activity/appointments";

describe("appointment system message classification", () => {
    it.each([
        ["Ein weiterer Termin wurde angefragt.", "request"],
        ["Eine Terminänderung wurde angefragt. Der bisherige Termin bleibt bis zur Bestätigung bestehen.", "request"],
        ["Der Termin wurde verbindlich vereinbart.", "appointment"],
        ["Ein weiterer Termin wurde verbindlich vereinbart.", "appointment"],
        ["Der Termin wurde aktualisiert.", "appointment"],
        ["Der Termin wurde abgesagt. Die Zusammenarbeit bleibt geöffnet.", "appointment"],
        ["Der Terminvorschlag wurde abgelehnt. Der bisherige Termin bleibt bestehen.", "appointment"],
        ["Der Terminvorschlag wurde zurückgezogen.", "appointment"],
    ])("recognizes the persisted scheduling event: %s", (content, expected) => {
        expect(getAppointmentSystemMessageKind({ kind: "system", content })).toBe(expected);
    });

    it("does not turn copied user text or a partial mention into a scheduling action", () => {
        expect(getAppointmentSystemMessageKind({ kind: "chat", content: "Ein weiterer Termin wurde angefragt." })).toBeNull();
        expect(getAppointmentSystemMessageKind({ kind: "system", content: "Bitte Termin ändern" })).toBeNull();
        expect(getAppointmentSystemMessageKind({ kind: "system", content: "Ein weiterer Termin wurde angefragt. Stimmt das?" })).toBeNull();
        expect(getAppointmentSystemMessageKind({ kind: "system", content: null })).toBeNull();
    });

    it("tolerates display whitespace without relying on partial text matching", () => {
        expect(getAppointmentSystemMessageKind({ kind: "system", content: "  Der Termin wurde\naktualisiert.  " })).toBe("appointment");
    });
});
