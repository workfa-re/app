export const GUARDIAN_DECLARATION_VERSION = "workfare-guardian-2026-10-24-v1";
export const GUARDIAN_DECLARATION_TEXT = "Ich bin für dieses Kind gesetzlich vertretungsberechtigt und stimme seiner Nutzung von Workfare sowie Bewerbungen und dem Kontakt zu Anbietern für altersgerechte, zulässige Tätigkeiten zu. Gesetzliche Grenzen und gegebenenfalls weitere erforderliche Einwilligungen bleiben bestehen. Diese Zustimmung umfasst weder eine Zahlungsfreigabe bei Stripe noch eine vollständige Einsicht in private Chats.";
export const FAMILY_DECLARATION_TEXT = "Ich möchte diese freiwillige Familienverknüpfung herstellen. Sie ist keine Elternfreigabe für die volljährige Person und gibt keinen vollständigen Zugriff auf private Chats oder Zahlungsdaten.";
export type GuardianRelationshipType = "mother" | "father" | "legal_guardian";
export type FamilyInvitationDirection = "child_to_guardian" | "guardian_to_child";
export type GuardianConsentInput = {
    accepted: true;
    declarationVersion: typeof GUARDIAN_DECLARATION_VERSION;
    relationshipType: GuardianRelationshipType;
};
export type GuardianInvitationPreview = {
    direction: FamilyInvitationDirection;
    inviterName: string | null;
    childName: string | null;
    minorRequired: boolean | null;
    status: "active" | "redeemed" | "expired" | "revoked";
    expiresAt: string;
};
export type GuardianConnection = {
    id: string;
    childId: string;
    guardianId: string;
    name: string | null;
    actorRole: "guardian" | "child";
    status: "active" | "pending" | "revoked";
    consentRequired: boolean;
    consented: boolean;
};
export type GuardianAccessContext = {
    authenticated: boolean;
    userId: string | null;
    email: string | null;
    viewer: "guardian" | "child" | "unconfigured";
    profile: {
        fullName: string | null;
        birthdate: string | null;
        accountType: "job_seeker" | "job_provider" | null;
        adultEligible: boolean;
    };
    invitation: GuardianInvitationPreview | null;
    relationships: GuardianConnection[];
    permission?: { required: boolean; granted: boolean };
    workspace: {
        access: "family_only" | "provider_complete" | "provider_incomplete" | "child" | "unconfigured";
        providerSetupHref: "/onboarding?purpose=provider";
        passwordConfigured: boolean | null;
    };
};
export type GuardianActionError = { ok: false; error: string; code: string };
export type GuardianApplicationAccess = {
    guardianStatus: "none" | "pending" | "linked";
    hasActiveGuardian: boolean;
    canApply: boolean;
    isVerified: boolean;
};
export type GuardianContextResult = { ok: true; context: GuardianAccessContext } | GuardianActionError;
export type FamilyInvitationResult = {
    success: true;
    token: string;
    expires_at: string;
    reused: boolean;
    direction: FamilyInvitationDirection;
} | { success?: false; error: string; code?: string };
export type GuardianRedemptionResult = {
    success: true;
    state: "linked" | "pending_guardian_confirmation";
    childId: string;
    consentRequired: boolean;
} | { success: false; message: string; code?: string };
