import { describe, expect, it } from "vitest";
import { assessPaymentReadiness, type PaymentReadinessSnapshot } from "@/lib/payments/readiness";

function snapshot(): PaymentReadinessSnapshot {
    return {
        sandboxConfigured: true,
        buyer: { paymentMethodReady: true, paymentConsentAccepted: true },
        providerAddressApproved: true,
        providerIdentity: { requirement: "not_required", status: "not_started", verifiedAt: null },
        recipient: { transfersCapability: "active", payoutsEnabled: true, bankAccountVerified: true, recipientModelApproved: true },
    };
}

describe("distinct Workfare Pay readiness states", () => {
    it("does not impose identity verification when the PSP does not require it", () => {
        expect(assessPaymentReadiness(snapshot())).toMatchObject({ buyerPaymentReady: true, providerIdentityVerified: false,
            identityRequirementSatisfied: true, recipientPayoutReady: true, sandboxScenarioReady: true, livePaymentsEnabled: false, blockers: [] });
    });

    it("keeps buyer readiness independent of recipient banking and identity status", () => {
        const input = snapshot();
        const result = assessPaymentReadiness({ ...input,
            providerIdentity: { requirement: "required", status: "pending", verifiedAt: null },
            recipient: { transfersCapability: "pending", payoutsEnabled: false, bankAccountVerified: false, recipientModelApproved: false } });
        expect(result).toMatchObject({ buyerPaymentReady: true, providerIdentityVerified: false, recipientPayoutReady: false,
            sandboxScenarioReady: false, blockers: ["provider_identity_required", "recipient_payout_not_ready"] });
    });

    it("does not infer payment or payout readiness from the existing address approval", () => {
        const input = snapshot();
        const result = assessPaymentReadiness({ ...input, buyer: { paymentMethodReady: false, paymentConsentAccepted: false },
            recipient: { ...input.recipient, recipientModelApproved: false } });
        expect(result).toMatchObject({ buyerPaymentReady: false, recipientPayoutReady: false, sandboxScenarioReady: false,
            blockers: ["buyer_payment_not_ready", "recipient_payout_not_ready"] });
    });

    it("does not require a future recipient's bank setup to publish a sandbox job", () => {
        const input = snapshot();
        expect(assessPaymentReadiness({ ...input, recipient: { ...input.recipient, payoutsEnabled: false } })).toMatchObject({
            sandboxPublishReady: true, sandboxPayoutReady: false, sandboxScenarioReady: false,
            publicationBlockers: [], payoutBlockers: ["recipient_payout_not_ready"],
        });
    });

    it("does not require buyer setup for the recipient's separate sandbox payout readiness", () => {
        expect(assessPaymentReadiness({ ...snapshot(), buyer: { paymentMethodReady: false, paymentConsentAccepted: false },
            providerAddressApproved: false })).toMatchObject({
            sandboxPublishReady: false, sandboxPayoutReady: true, sandboxScenarioReady: false,
            publicationBlockers: ["buyer_payment_not_ready", "provider_address_not_approved"], payoutBlockers: [],
        });
    });

    it.each(["not_started", "pending", "blocked"] as const)("blocks required identity in state %s even with a stale timestamp", (status) => {
        const result = assessPaymentReadiness({ ...snapshot(), providerIdentity: {
            requirement: "required", status, verifiedAt: "2026-10-23T12:00:00.000Z",
        } });
        expect(result.providerIdentityVerified).toBe(false);
        expect(result.blockers).toEqual(["provider_identity_required"]);
    });

    it.each([null, "", "invalid"])("does not trust verified status without a valid timestamp %j", (verifiedAt) => {
        const result = assessPaymentReadiness({ ...snapshot(), providerIdentity: { requirement: "required", status: "verified", verifiedAt } });
        expect(result.providerIdentityVerified).toBe(false);
        expect(result.identityRequirementSatisfied).toBe(false);
    });

    it("accepts a required verification only when status and timestamp agree", () => {
        expect(assessPaymentReadiness({ ...snapshot(), providerIdentity: {
            requirement: "required", status: "verified", verifiedAt: "2026-10-23T12:00:00.000Z",
        } })).toMatchObject({ providerIdentityVerified: true, identityRequirementSatisfied: true, sandboxScenarioReady: true, livePaymentsEnabled: false });
    });

    it("requires all recipient payout conditions, including approval of the recipient model", () => {
        const input = snapshot();
        const missingConditions = [
            { transfersCapability: "inactive" as const }, { transfersCapability: "pending" as const },
            { payoutsEnabled: false }, { bankAccountVerified: false }, { recipientModelApproved: false },
        ];
        for (const patch of missingConditions) {
            const result = assessPaymentReadiness({ ...input, recipient: { ...input.recipient, ...patch } });
            expect(result.recipientPayoutReady).toBe(false);
            expect(result.blockers).toEqual(["recipient_payout_not_ready"]);
        }
    });

    it("requires both buyer method readiness and explicit payment consent", () => {
        const input = snapshot();
        for (const buyer of [{ paymentMethodReady: true, paymentConsentAccepted: false }, { paymentMethodReady: false, paymentConsentAccepted: true }]) {
            expect(assessPaymentReadiness({ ...input, buyer })).toMatchObject({ buyerPaymentReady: false, blockers: ["buyer_payment_not_ready"] });
        }
    });

    it("keeps sandbox configuration and the existing address check as separate blockers", () => {
        const result = assessPaymentReadiness({ ...snapshot(), sandboxConfigured: false, providerAddressApproved: false });
        expect(result).toMatchObject({ buyerPaymentReady: true, recipientPayoutReady: true, sandboxScenarioReady: false,
            blockers: ["sandbox_not_configured", "provider_address_not_approved"], livePaymentsEnabled: false });
        expect(Object.isFrozen(result.blockers)).toBe(true);
    });
});
