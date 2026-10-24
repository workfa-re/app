import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sanitizeRecipientReturnPath } from "./recipient-return-path";
import { PaymentFlowError } from "./runtime.server";

export const RECIPIENT_HOSTED_COOKIE = "wf-pay-recipient-hosted";
export const RECIPIENT_HOSTED_TTL = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Consent = { version: 1; userId: string; accountHash: string; nonce: string; issuedAt: number; expiresAt: number; returnTo: string | null };
const unavailable = (): never => { throw new PaymentFlowError("recipient_hosted_consent_required", 409); };
function sign(payload: string, secret: string | undefined) {
    if (!secret || secret.length < 32 || secret.length > 4_096 || /[\r\n]/.test(secret)) throw new PaymentFlowError("recipient_hosted_not_configured", 503);
    return createHmac("sha256", secret).update(`workfare-pay:recipient-hosted:v1:${payload}`).digest("hex");
}
const hashAccount = (value: string) => createHash("sha256").update(value).digest("hex");

export function createHostedConsent(userId: string, accountRef: string, returnTo: string | null, secret: string | undefined, now = Date.now()) {
    const issuedAt = Math.floor(now / 1_000);
    const consent: Consent = { version: 1, userId, accountHash: hashAccount(accountRef), nonce: randomUUID(), issuedAt,
        expiresAt: issuedAt + RECIPIENT_HOSTED_TTL, returnTo };
    const payload = Buffer.from(JSON.stringify(consent)).toString("base64url");
    return { value: `${payload}.${sign(payload, secret)}`, consent };
}

export function readHostedConsent(value: string | null | undefined, userId: string, accountRef: string, secret: string | undefined, now = Date.now()): Consent {
    if (!value || value.length > 2_048) return unavailable();
    const parts = value.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return unavailable();
    const expected = sign(parts[0], secret);
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts[1], "hex"))) return unavailable();
    let consent: Consent;
    try { consent = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return unavailable(); }
    const epoch = Math.floor(now / 1_000);
    if (!consent || consent.version !== 1 || consent.userId !== userId || consent.accountHash !== hashAccount(accountRef)
        || typeof consent.nonce !== "string" || !UUID.test(consent.nonce)
        || !Number.isSafeInteger(consent.issuedAt) || !Number.isSafeInteger(consent.expiresAt)
        || consent.issuedAt > epoch || consent.expiresAt <= epoch || consent.expiresAt !== consent.issuedAt + RECIPIENT_HOSTED_TTL
        || (consent.returnTo !== null && sanitizeRecipientReturnPath(consent.returnTo) !== consent.returnTo)) return unavailable();
    return consent;
}

export function hostedCookieFromHeader(header: string | null): string | null {
    const values = header?.split(";").map(part => part.trim()).filter(part => part.startsWith(`${RECIPIENT_HOSTED_COOKIE}=`)) ?? [];
    return values.length === 1 ? values[0].slice(RECIPIENT_HOSTED_COOKIE.length + 1) : null;
}

export function hostedConsentCookie(value: string, maxAge: number, secure: boolean) {
    return `${RECIPIENT_HOSTED_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/payments/recipient/hosted; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
