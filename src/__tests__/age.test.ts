import { describe, expect, it } from "vitest";
import { ageInBerlin, isAdultBirthdate } from "@/lib/age";

describe("German date-only age gates", () => {
    it("changes age on the German birthday, including the previous UTC day", () => {
        expect(ageInBerlin("2008-10-24", new Date("2026-10-23T21:59:59Z"))).toBe(17);
        expect(ageInBerlin("2008-10-24", new Date("2026-10-23T22:00:00Z"))).toBe(18);
        expect(isAdultBirthdate("2008-10-24", new Date("2026-10-23T22:00:00Z"))).toBe(true);
    });
    it.each([null, undefined, "", "2026-02-31", "2008-1-01", "2008-10-24T00:00:00Z", "2030-01-01"])("does not grant adulthood for %s", birthdate => {
        expect(ageInBerlin(birthdate, new Date("2026-10-24T12:00:00Z"))).toBeNull();
        expect(isAdultBirthdate(birthdate, new Date("2026-10-24T12:00:00Z"))).toBe(false);
    });
    it("keeps leap-day birthdays date-only", () => {
        expect(ageInBerlin("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe(17);
        expect(ageInBerlin("2008-02-29", new Date("2026-03-01T12:00:00Z"))).toBe(18);
    });
});
