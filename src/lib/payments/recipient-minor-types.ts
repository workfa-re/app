import type { RecipientStatus } from "./recipient-types";

/** Private immutable binding; never returned to a browser. */
export type RecipientMinorBinding = Readonly<{
    guardianId: string;
    consentId: string;
    childBirthdate: string;
    guardianBirthdate: string;
    guardianEmail: string;
    guardianName: string;
}>;
export type GuardianEvidence = Readonly<{ personRef: string; tosAcceptedAt: string }>;
export type GuardianRecipientReason = "guardian_kyc_required" | "guardian_identity_mismatch" | "guardian_terms_required"
    | "recipient_country_model_unsupported" | "recipient_setup_required" | "recipient_guardian_binding_conflict";
export type GuardianRecipientContext = Readonly<{
    ownerId: string;
    kind: "live";
    children: readonly Readonly<{ childId: string; name: string; status: RecipientStatus; canStartPayout: boolean; reasonCode: GuardianRecipientReason | null }>[];
}>;
