import { BRAND_EMAIL, BRAND_NAME } from "@/lib/constants";

/** Rebrand stored regional labels without rewriting account or region records. */
export function currentBrandLabel(value: string | null | undefined): string {
  return value?.trim().replace(/\bjob[ _-]?bridge\b/gi, BRAND_NAME) || BRAND_NAME;
}

/** Older deployment variables must not send support requests to the old domain. */
export function currentContactEmail(value: string | null | undefined): string {
  return value?.trim().replace(/@jobbridge\.(app|team)$/i, "@workfare.team") || BRAND_EMAIL;
}

// The separate administration service has not changed domains yet.
// Keep its working destination until that service has an authenticated new host.
export const ADMIN_PORTAL_URL = "https://admin.jobbridge.team";
