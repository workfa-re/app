import { ageInBerlin } from "@/lib/age";
import type { Profile } from "@/lib/types";
import { isProfileComplete } from "@/lib/types";

export const GUARDIAN_PROVIDER_SETUP_PATH = "/onboarding?purpose=provider";

/** A purpose account has no marketplace role. This grants no provider permissions. */
export function isFamilyOnlyProfile(profile: Profile | null | undefined) {
    if (!profile || profile.account_type !== null || profile.provider_kind != null) return false;
    const name = profile.full_name?.trim();
    const age = ageInBerlin(profile.birthdate ?? "");
    return Boolean(name && name.length >= 3 && name.length <= 120 && age !== null && age >= 18 && age <= 120);
}

/** Resumes an existing private-provider identity; never changes its role. */
export function isIncompletePrivateProviderProfile(profile: Profile | null | undefined) {
    if (!profile || profile.account_type !== "job_provider" || profile.provider_kind !== "private" || isProfileComplete(profile)) return false;
    const name = profile.full_name?.trim();
    const age = ageInBerlin(profile.birthdate ?? "");
    return Boolean(name && name.length >= 3 && name.length <= 120 && age !== null && age >= 18 && age <= 120);
}
