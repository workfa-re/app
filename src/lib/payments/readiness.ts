export type IdentityCheckStatus = "not_started" | "pending" | "verified" | "blocked";
export type PaymentReadinessSnapshot = Readonly<{
    sandboxConfigured: boolean;
    buyer: Readonly<{ paymentMethodReady: boolean; paymentConsentAccepted: boolean }>;
    providerAddressApproved: boolean;
    providerIdentity: Readonly<{ requirement: "not_required" | "required"; status: IdentityCheckStatus; verifiedAt: string | null }>;
    recipient: Readonly<{
        transfersCapability: "inactive" | "pending" | "active";
        payoutsEnabled: boolean;
        bankAccountVerified: boolean;
        recipientModelApproved: boolean;
    }>;
}>;

export type PaymentReadinessBlocker = "sandbox_not_configured" | "buyer_payment_not_ready" | "provider_address_not_approved" | "provider_identity_required" | "recipient_payout_not_ready";

/** Role, address and guardian flags are not evidence of PSP payment/payout readiness. */
export function assessPaymentReadiness(snapshot: PaymentReadinessSnapshot) {
    const buyerPaymentReady = snapshot.buyer.paymentMethodReady === true && snapshot.buyer.paymentConsentAccepted === true;
    const providerIdentityVerified = snapshot.providerIdentity.status === "verified"
        && typeof snapshot.providerIdentity.verifiedAt === "string" && Number.isFinite(Date.parse(snapshot.providerIdentity.verifiedAt));
    const identityRequirementSatisfied = snapshot.providerIdentity.requirement === "not_required"
        || (snapshot.providerIdentity.requirement === "required" && providerIdentityVerified);
    const recipientPayoutReady = snapshot.recipient.transfersCapability === "active"
        && snapshot.recipient.payoutsEnabled === true && snapshot.recipient.bankAccountVerified === true
        && snapshot.recipient.recipientModelApproved === true;
    const publicationBlockers: PaymentReadinessBlocker[] = [];
    const payoutBlockers: PaymentReadinessBlocker[] = [];
    if (snapshot.sandboxConfigured !== true) {
        publicationBlockers.push("sandbox_not_configured");
        payoutBlockers.push("sandbox_not_configured");
    }
    if (!buyerPaymentReady) publicationBlockers.push("buyer_payment_not_ready");
    if (snapshot.providerAddressApproved !== true) publicationBlockers.push("provider_address_not_approved");
    if (!identityRequirementSatisfied) publicationBlockers.push("provider_identity_required");
    if (!recipientPayoutReady) payoutBlockers.push("recipient_payout_not_ready");
    const blockers = [...new Set([...publicationBlockers, ...payoutBlockers])];
    return Object.freeze({
        buyerPaymentReady,
        providerIdentityVerified,
        identityRequirementSatisfied,
        recipientPayoutReady,
        sandboxPublishReady: publicationBlockers.length === 0,
        sandboxPayoutReady: payoutBlockers.length === 0,
        publicationBlockers: Object.freeze(publicationBlockers),
        payoutBlockers: Object.freeze(payoutBlockers),
        // Full scenario readiness needs both roles. Never use this combined
        // flag as a job-publication gate before a recipient has been chosen.
        sandboxScenarioReady: blockers.length === 0,
        blockers: Object.freeze(blockers),
        // A successful offline scenario never grants permission to move real funds.
        livePaymentsEnabled: false as const,
    });
}
