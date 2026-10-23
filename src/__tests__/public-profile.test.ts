import { describe, expect, it } from "vitest";
import { profileInitials, toPublicProfile, type VisibleProfile } from "@/components/profile/public-profile";

const now = new Date(2026, 9, 22, 12);

describe("public profile presentation boundary", () => {
    it("whitelists presentation fields and drops private data from the own-profile preview", () => {
        const input = {
            id: "person", account_type: "job_seeker", full_name: "Alex Beispiel", birthdate: "2010-10-23",
            email: "private@example.invalid", company_contact_email: "company-private@example.invalid",
            street: "Private Straße", house_number: "12", zip: "53359", lat: 50.6, lng: 6.9,
            guardian_id: "private-guardian", availability_note: "Private preview-only note", stats: { rating: 5 },
        } as VisibleProfile;
        const output = toPublicProfile(input, false, now);
        expect(output.ageYears).toBe(15);
        expect(Object.keys(output).sort()).toEqual([
            "ageYears", "avatarUrl", "bio", "displayName", "id", "interests", "isStaff", "isVerifiedProvider",
            "location", "memberSince", "personName", "role", "roleLabel", "skills",
        ]);
        for (const value of ["private@example.invalid", "company-private@example.invalid", "Private Straße", "private-guardian", "2010-10-23", "Private preview-only note"])
            expect(JSON.stringify(output)).not.toContain(value);
    });

    it("uses authorized coarse age without exposing a date of birth", () => {
        expect(toPublicProfile({ id: "person", age_years: 17, birthdate: "2000-01-01" }, false, now).ageYears).toBe(17);
        expect(toPublicProfile({ id: "person", birthdate: "2010-10-22" }, false, now).ageYears).toBe(16);
        expect(toPublicProfile({ id: "person", birthdate: "2030-01-01" }, false, now).ageYears).toBeNull();
        expect(toPublicProfile({ id: "person", birthdate: "2010-02-31" }, false, now).ageYears).toBeNull();
        expect(toPublicProfile({ id: "person", age_years: Number.POSITIVE_INFINITY }, false, now).ageYears).toBeNull();
    });

    it("keeps provider identity and verified address distinct from an identity claim", () => {
        expect(toPublicProfile({
            id: "company", account_type: "job_provider", company_name: " Werkstatt ", full_name: " Alex Beispiel ",
            provider_verification_status: "verified", age_years: 44, skills: "Mathe", interests: "Musik",
        }, false, now)).toMatchObject({
            displayName: "Werkstatt", personName: "Alex Beispiel", roleLabel: "Jobanbieter",
            isVerifiedProvider: true, ageYears: null, skills: [], interests: [],
        });
        expect(toPublicProfile({ id: "person", account_type: "job_seeker", provider_verification_status: "verified" }).isVerifiedProvider).toBe(false);
    });

    it("does not invent missing role, verification, biography or social statistics", () => {
        const output = toPublicProfile({ id: "sparse" });
        expect(output).toMatchObject({ displayName: "Workfare-Mitglied", role: null, roleLabel: "Workfare-Profil",
            bio: null, location: null, memberSince: null, ageYears: null, isStaff: false, isVerifiedProvider: false });
        expect(output).not.toHaveProperty("stats");
        expect(output).not.toHaveProperty("rating");
        expect(output).not.toHaveProperty("jobsCompleted");
    });

    it("normalizes real optional tags and tolerates invalid member dates", () => {
        const output = toPublicProfile({ id: "person", account_type: "job_seeker", skills: " Mathe, , Garten, Mathe ",
            interests: " Musik, Sport ", created_at: "invalid", bio: " Hallo\nWelt ", city: " Rheinbach ", country: " DE " });
        expect(output).toMatchObject({ skills: ["Mathe", "Garten"], interests: ["Musik", "Sport"],
            memberSince: null, bio: "Hallo\nWelt", location: "Rheinbach, Deutschland" });
        expect(toPublicProfile({ id: "person", country: "at" }).location).toBe("Österreich");
        expect(toPublicProfile({ id: "person", country: "Deutschland" }).location).toBe("Deutschland");
        expect(toPublicProfile({ id: "person", country: "XY" }).location).toBe("XY");
    });

    it("formats genuine membership dates and preserves trusted team flags", () => {
        expect(toPublicProfile({ id: "team", created_at: "2026-03-15T12:00:00Z", is_staff: true })).toMatchObject({
            memberSince: "März 2026", isStaff: true,
        });
        expect(toPublicProfile({ id: "own" }, true).isStaff).toBe(true);
        expect(profileInitials("  Alex  Beispiel  ")).toBe("AB");
        expect(profileInitials("")).toBe("W");
    });

    it("uses readable initials for company names and optional decorative symbols", () => {
        expect(profileInitials("Garten & Nachbarschaft Rheinbach")).toBe("GN");
        expect(profileInitials("🌿 Anna Schneider")).toBe("AS");
        expect(profileInitials("Özlem Yılmaz")).toBe("ÖY");
        expect(profileInitials("— & 🌿")).toBe("W");
    });
});
