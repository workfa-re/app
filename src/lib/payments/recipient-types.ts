import type { RecipientMinorBinding, GuardianEvidence, GuardianRecipientReason } from "./recipient-minor-types";
import type { PaymentMode } from "./types";
import type { RecipientBankSummary } from "./recipient-bank-summary";

export type RecipientStatus = "not_started" | "onboarding" | "pending" | "ready" | "restricted" | "unavailable";
export type RecipientComponent = "onboarding" | "management" | "bank_management" | "balances" | "payouts_list" | "notification_banner";
export type RecipientApplicationGate = Readonly<{ required: boolean; ready: boolean }>;
export type RecipientEligibility = "local_demo" | "adult" | "minor_review_required" | "ineligible";
export type RecipientAccountPrefill = Readonly<{ contactEmail: string; displayName?: string }>;
export type RecipientPayoutOverview = Readonly<{
    kind: "sandbox" | "live";
    currency: "eur";
    availableCents: number;
    pendingCents: number;
    schedule: "daily" | "weekly" | "monthly" | "manual" | "unknown";
    stripePayoutsEnabled: boolean;
    hasPayoutMethod: boolean;
    canRequestPayout: false;
    canRetainBalance: false;
    disabledReason: "retention_monitor_required" | "recipient_setup_required" | "currency_not_supported";
    maxHoldingDays: 90;
    checkedAt: string;
    bank?: RecipientBankSummary | null;
    pendingAvailableAt?: string | null;
}>;

/** Deliberately excludes account references, identity documents and bank data. */
export type RecipientSettingsSnapshot = Readonly<{
    kind: "disabled" | "local" | "sandbox" | "live";
    featureEnabled: boolean;
    setupEnabled?: boolean;
    status: RecipientStatus;
    canStart: boolean;
    eligibility: RecipientEligibility;
    requirementCount: number;
    hasPayoutMethod: boolean;
    detailsSubmitted: boolean;
    transfersActive: boolean;
    payoutsEnabled: boolean;
    checkedAt: string | null;
}>;

export type RecipientRecord = Readonly<{
    id: string;
    userId: string;
    mode: PaymentMode;
    accountRef: string | null;
    generation: number;
    birthdate?: string | null;
    displayName?: string | null;
    minorBinding?: RecipientMinorBinding | null;
    guardianReason?: GuardianRecipientReason | null;
}>;

export type RecipientSession = Readonly<{
    id: string;
    userId: string;
    mode: PaymentMode;
    component: RecipientComponent;
    status: "pending" | "complete" | "canceled" | "expired";
    expiresAt: string;
}>;

export type VerifiedRecipientState = Readonly<{
    guardianEvidence?: GuardianEvidence | null;
    guardianReason?: GuardianRecipientReason | null;
    status: "onboarding" | "pending" | "ready" | "restricted";
    requirementCount: number;
    hasPayoutMethod: boolean;
    detailsSubmitted: boolean;
    transfersActive: boolean;
    payoutsEnabled: boolean;
}>;

export type RecipientSessionResult = Readonly<
    { kind: "local"; sessionId: string; component: RecipientComponent }
    | { kind: "sandbox" | "live"; clientSecret: string; publishableKey: string; component: RecipientComponent }
>;
