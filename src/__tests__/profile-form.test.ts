import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/types";
import { buildProfileUpdate, createProfileDraft } from "@/components/profile/profile-form";

const profile = {
    id: "own-profile", account_type: "job_seeker", full_name: "Alex Beispiel", birthdate: "2010-01-01",
    email: "alex@example.invalid", bio: " Hallo ", interests: " Sport ", skills: " Mathe ",
    availability_note: " Samstags ", city: "Rheinbach", zip: "53359", street: "Beispielstraße",
    house_number: "2", lat: 0, lng: 0,
} as Profile;

describe("profile editing contract", () => {
    it("keeps valid zero coordinates and normalizes optional copy", () => {
        expect(createProfileDraft(profile)).toMatchObject({ bio: "Hallo", skills: "Mathe", lat: 0, lng: 0 });
    });
    it("only writes the authenticated editable columns, never identity or verification", () => {
        const update = buildProfileUpdate(createProfileDraft(profile), false);
        expect(Object.keys(update).sort()).toEqual(["availability_note", "bio", "city", "house_number", "interests", "lat", "lng", "skills", "street", "zip"]);
        expect(update).not.toHaveProperty("id");
        expect(update).not.toHaveProperty("email");
        expect(update).not.toHaveProperty("provider_verification_status");
    });
    it("does not erase hidden fields or change a provider's verified address", () => {
        expect(buildProfileUpdate(createProfileDraft(profile), true)).toEqual({ bio: "Hallo", availability_note: "Samstags" });
    });
    it("stores empty optional fields as null and rejects invalid coordinates", () => {
        const draft = createProfileDraft({ ...profile, bio: " ", lat: Number.NaN, lng: Number.POSITIVE_INFINITY });
        expect(buildProfileUpdate(draft, false)).toMatchObject({ bio: null, lat: null, lng: null });
    });
});
