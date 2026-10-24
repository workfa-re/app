const OFFER_PATH = /^\/app-home\/offers\/(?:new|edit\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const CONVERSATION_PATH = /^\/app-home\/activities\?conversation=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
export const PAYMENT_SETTINGS_PATH = "/app-home/settings/payments";

/** A deliberately small server allowlist, with no client-controlled origin. */
export function sanitizePaymentReturnPath(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 200 || value.includes("%") || value.includes("\\") || value.includes("#")) return null;
    if (CONVERSATION_PATH.test(value)) return value;
    const parts = value.split("?");
    if (parts.length > 2 || !OFFER_PATH.test(parts[0]) || (parts.length === 2 && parts[1] !== "resume=payment")) return null;
    return value;
}

export function getPaymentConversationReturnPath(applicationId: string): string | null {
    const candidate = `/app-home/activities?conversation=${applicationId}`;
    return CONVERSATION_PATH.test(candidate) ? candidate : null;
}

export function getPaymentSettingsHref(returnTo?: string | null): string {
    const safe = sanitizePaymentReturnPath(returnTo);
    return safe ? `${PAYMENT_SETTINGS_PATH}?${new URLSearchParams({ returnTo: safe })}` : PAYMENT_SETTINGS_PATH;
}
