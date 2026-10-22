import type { AccountType, ProviderVerificationStatus } from "@/lib/types";

/** Existing caller input. Preview-only fields never enter the public view model. */
export type VisibleProfile = {
    id: string;
    full_name?: string | null;
    company_name?: string | null;
    account_type?: AccountType | null;
    user_type?: string | null;
    avatar_url?: string | null;
    bio?: string | null;
    city?: string | null;
    country?: string | null;
    skills?: string | null;
    interests?: string | null;
    created_at?: string | null;
    provider_verification_status?: ProviderVerificationStatus | null;
    age_years?: number | null;
    is_staff?: boolean | null;
    /** Compatibility for the signed-in user's existing preview, reduced to years. */
    birthdate?: string | null;
    /** Accepted by the existing preview caller; not part of public RPCs or output. */
    availability_note?: string | null;
};

export type PublicProfile = {
    id: string;
    displayName: string;
    personName: string | null;
    role: AccountType | null;
    roleLabel: string;
    avatarUrl: string | null;
    bio: string | null;
    location: string | null;
    memberSince: string | null;
    ageYears: number | null;
    skills: string[];
    interests: string[];
    isStaff: boolean;
    isVerifiedProvider: boolean;
};

function clean(value: string | null | undefined) {
    return value?.trim() || null;
}

function countryName(value: string | null | undefined) {
    const country = clean(value);
    if (!country || !/^[a-z]{2}$/i.test(country)) return country;
    try {
        return new Intl.DisplayNames("de", { type: "region", fallback: "none" }).of(country.toUpperCase()) || country;
    } catch {
        return country;
    }
}

function tags(value: string | null | undefined) {
    return [...new Set((value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function ageInYears(profile: VisibleProfile, now: Date) {
    if (typeof profile.age_years === "number" && Number.isFinite(profile.age_years)
        && Number.isInteger(profile.age_years) && profile.age_years >= 0) return profile.age_years;
    const parts = profile.birthdate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return null;
    const [, rawYear, rawMonth, rawDay] = parts;
    const year = Number(rawYear), month = Number(rawMonth) - 1, day = Number(rawDay);
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    let age = now.getFullYear() - year;
    if (now.getMonth() < month || (now.getMonth() === month && now.getDate() < day)) age -= 1;
    return age >= 0 ? age : null;
}

export function profileInitials(name: string) {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => Array.from(part)[0]?.toUpperCase()).join("") || "W";
}

/** A strict whitelist: never spread a full profile into the public presentation. */
export function toPublicProfile(profile: VisibleProfile, isStaff = false, now = new Date()): PublicProfile {
    const role = profile.account_type === "job_provider" || profile.user_type === "job_provider"
        ? "job_provider" : profile.account_type === "job_seeker" || profile.user_type === "job_seeker"
            ? "job_seeker" : null;
    const isProvider = role === "job_provider";
    const fullName = clean(profile.full_name);
    const companyName = isProvider ? clean(profile.company_name) : null;
    const createdAt = profile.created_at ? new Date(profile.created_at) : null;

    return {
        id: profile.id,
        displayName: companyName || fullName || (isProvider ? "Jobanbieter" : "Workfare-Mitglied"),
        personName: companyName && fullName && companyName !== fullName ? fullName : null,
        role,
        roleLabel: isProvider ? "Jobanbieter" : role === "job_seeker" ? "Jobsuchend" : "Workfare-Profil",
        avatarUrl: clean(profile.avatar_url),
        bio: clean(profile.bio),
        location: [clean(profile.city), countryName(profile.country)].filter(Boolean).join(", ") || null,
        memberSince: createdAt && !Number.isNaN(createdAt.getTime())
            ? new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(createdAt) : null,
        ageYears: isProvider ? null : ageInYears(profile, now),
        skills: isProvider ? [] : tags(profile.skills),
        interests: isProvider ? [] : tags(profile.interests),
        isStaff: isStaff || profile.is_staff === true,
        isVerifiedProvider: isProvider && profile.provider_verification_status === "verified",
    };
}
