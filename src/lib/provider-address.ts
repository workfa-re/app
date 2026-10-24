type ProviderAddress = { street?: string | null; house_number?: string | null; zip?: string | null; city?: string | null; lat?: number | null; lng?: number | null; provider_verification_status?: string | null };

/** A saved location enables the address-first pilot; it is not an identity check. */
export function hasCompleteProviderAddress(profile: ProviderAddress): boolean {
    return profile.provider_verification_status !== "rejected"
        && Boolean(profile.street?.trim() && profile.house_number?.trim() && profile.city?.trim())
        && /^\d{5}$/.test(profile.zip?.trim() ?? "")
        && typeof profile.lat === "number" && Number.isFinite(profile.lat) && Math.abs(profile.lat) <= 90
        && typeof profile.lng === "number" && Number.isFinite(profile.lng) && Math.abs(profile.lng) <= 180;
}
