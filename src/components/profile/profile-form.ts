import type { Profile } from "@/lib/types";

export type ProfileDraft = {
    bio: string;
    skills: string;
    interests: string;
    availabilityNote: string;
    city: string;
    zip: string;
    street: string;
    houseNumber: string;
    lat: number | null;
    lng: number | null;
};

export function createProfileDraft(profile: Profile): ProfileDraft {
    return {
        bio: profile.bio?.trim() ?? "",
        skills: profile.skills?.trim() ?? "",
        interests: profile.interests?.trim() ?? "",
        availabilityNote: profile.availability_note?.trim() ?? "",
        city: profile.city ?? "",
        zip: profile.zip ?? "",
        street: profile.street ?? "",
        houseNumber: profile.house_number ?? "",
        lat: profile.lat != null && Number.isFinite(Number(profile.lat)) ? Number(profile.lat) : null,
        lng: profile.lng != null && Number.isFinite(Number(profile.lng)) ? Number(profile.lng) : null,
    };
}

// These are the existing authenticated UPDATE columns; identity and verification stay read-only.
export function buildProfileUpdate(draft: ProfileDraft, isProvider: boolean) {
    const nullable = (value: string) => value.trim() || null;
    const publicFields = { bio: nullable(draft.bio), availability_note: nullable(draft.availabilityNote) };
    if (isProvider) return publicFields;
    return {
        ...publicFields,
        skills: nullable(draft.skills),
        interests: nullable(draft.interests),
        city: nullable(draft.city),
        zip: nullable(draft.zip),
        street: nullable(draft.street),
        house_number: nullable(draft.houseNumber),
        lat: draft.lat,
        lng: draft.lng,
    };
}
