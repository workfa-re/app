import { getSafeInternalRedirect } from "@/lib/safe-redirect";

/** Family accounts can return to their invitation, never enter marketplace via a redirect. */
export function guardianReturnPath(value: unknown): string | null {
    const safe = getSafeInternalRedirect(value);
    if (!safe) return null;
    const url = new URL(safe, "https://workfare.internal");
    return url.pathname === "/guardian/access" || url.pathname === "/guardian/accept" ? safe : null;
}

export function guardianLoginHref(returnTo = "/guardian/access") {
    return `/?authMode=signin&redirectTo=${encodeURIComponent(guardianReturnPath(returnTo) ?? "/guardian/access")}`;
}

export function guardianSignupHref(returnTo = "/guardian/access") {
    return `/onboarding?purpose=family&authMode=signup&redirectTo=${encodeURIComponent(guardianReturnPath(returnTo) ?? "/guardian/access")}`;
}
