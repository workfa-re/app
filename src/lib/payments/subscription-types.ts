export const MEMBERSHIP_NAME = "Workfare Plan";
export const MEMBERSHIP_TERMS_VERSION = "workfare-plan-v1";
export const MEMBERSHIP_DEFAULT_OFFER = Object.freeze({
    name: MEMBERSHIP_NAME,
    priceCents: 590,
    currency: "eur" as const,
    interval: "month" as const,
    standardRateBps: 1200,
    memberRateBps: 600,
    fixedFeeCents: 49,
    termsVersion: MEMBERSHIP_TERMS_VERSION,
});
export type MembershipOffer = typeof MEMBERSHIP_DEFAULT_OFFER;
export type MembershipState =
    | "none"
    | "active"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "paused"
    | "trialing"
    | "unpaid";
export type MembershipSnapshot = Readonly<{
    ownerId: string;
    kind: "live" | "sandbox" | "local";
    offer: MembershipOffer;
    membership: Readonly<{
        status: MembershipState;
        entitled: boolean;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
        contractReference: string | null;
    }>;
    checkoutAvailable: boolean;
    manageAvailable: boolean;
}>;
