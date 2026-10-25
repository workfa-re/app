import type { MembershipOffer, MembershipSnapshot } from "@/lib/payments/subscription-types";
import { grossFeeForRate } from "@/lib/payments/quote";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["none", "active", "canceled", "incomplete", "incomplete_expired", "past_due", "paused", "trialing", "unpaid"]);

/** The UI never derives paid membership from a return URL or a Stripe status alone. */
export function validMembershipSnapshot(value: unknown, ownerId: string): value is MembershipSnapshot {
    if (!object(value) || !UUID.test(ownerId) || value.ownerId !== ownerId || !["live", "sandbox", "local"].includes(String(value.kind))
        || typeof value.checkoutAvailable !== "boolean" || typeof value.manageAvailable !== "boolean" || !object(value.offer) || !object(value.membership)) return false;
    const offer = value.offer, membership = value.membership;
    return typeof offer.name === "string" && offer.name.length > 0 && offer.name.length <= 80
        && cents(offer.priceCents) && offer.priceCents > 0 && offer.currency === "eur" && offer.interval === "month"
        && cents(offer.standardRateBps) && offer.standardRateBps <= 10_000 && cents(offer.memberRateBps) && offer.memberRateBps < offer.standardRateBps
        && cents(offer.fixedFeeCents) && typeof offer.termsVersion === "string" && /^[a-z0-9-]{1,80}$/.test(offer.termsVersion)
        && typeof membership.status === "string" && states.has(membership.status) && typeof membership.entitled === "boolean"
        && typeof membership.cancelAtPeriodEnd === "boolean"
        && (membership.currentPeriodEnd === null || typeof membership.currentPeriodEnd === "string" && Number.isFinite(Date.parse(membership.currentPeriodEnd)))
        && (membership.contractReference === null || typeof membership.contractReference === "string" && UUID.test(membership.contractReference))
        && (!membership.entitled || membership.status === "active" || membership.status === "past_due")
        && (!membership.entitled || membership.currentPeriodEnd !== null);
}

export function parseMembershipAmount(value: string): number | null {
    const cleaned = value.trim().replace(",", ".");
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(cleaned)) return null;
    const [whole, fraction = ""] = cleaned.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return amount >= 100 && amount <= 99_999_999 ? amount : null;
}

/** Matches the tariff's independently rounded components for each example job. */
export function membershipExample(earningsCents: number, jobs: number, offer: MembershipOffer) {
    if (!cents(earningsCents) || earningsCents < 100 || !Number.isInteger(jobs) || jobs < 1 || jobs > 100
        || offer.memberRateBps >= offer.standardRateBps) return null;
    const base = grossFeeForRate(earningsCents, offer.memberRateBps) + offer.fixedFeeCents;
    const workfare = grossFeeForRate(earningsCents, offer.standardRateBps - offer.memberRateBps);
    const without = (base + workfare) * jobs;
    const withPlan = base * jobs + offer.priceCents;
    return { without, withPlan, savedFees: workfare * jobs, netSaving: without - withPlan, totalEarnings: earningsCents * jobs };
}

export function trustedMembershipUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 4_096) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port
            && ["checkout.stripe.com", "billing.stripe.com", "pay.workfa.re"].includes(url.hostname);
    } catch { return false; }
}
