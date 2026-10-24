import { z } from "zod";
import { ageInBerlin } from "@/lib/age";
import { GUARDIAN_DECLARATION_VERSION, type GuardianConsentInput } from "./types";

export const guardianToken = z.string().trim().min(16).max(512).regex(/^[a-zA-Z0-9_-]+$/);
export const guardianEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const consentSchema = z.object({ accepted: z.literal(true), declarationVersion: z.literal(GUARDIAN_DECLARATION_VERSION), relationshipType: z.enum(["mother", "father", "legal_guardian"]) });
export function validConsent(value: unknown): GuardianConsentInput | null {
    const parsed = consentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
export const minimalGuardianProfile = z.object({
    fullName: z.string().trim().min(3).max(120).regex(/\p{L}/u).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
    birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const age = ageInBerlin(value); return age !== null && age >= 18 && age <= 120; }),
    adultConfirmed: z.literal(true),
});
const connection = z.object({ id: z.uuid(), childId: z.uuid(), guardianId: z.uuid(), name: z.string().nullable(), actorRole: z.enum(["guardian", "child"]), status: z.enum(["active", "pending", "revoked"]), consentRequired: z.boolean(), consented: z.boolean() });
export const guardianContextSchema = z.object({
    authenticated: z.literal(true), userId: z.uuid(), email: z.string().nullable(), viewer: z.enum(["guardian", "child", "unconfigured"]),
    profile: z.object({ fullName: z.string().nullable(), birthdate: z.string().nullable(), accountType: z.enum(["job_seeker", "job_provider"]).nullable(), adultEligible: z.boolean() }),
    invitation: z.object({ direction: z.enum(["child_to_guardian", "guardian_to_child"]), inviterName: z.string().nullable(), childName: z.string().nullable(), minorRequired: z.boolean().nullable(), status: z.enum(["active", "redeemed", "expired", "revoked"]), expiresAt: z.string() }).nullable(),
    relationships: z.array(connection),
    workspace: z.object({
        access: z.enum(["family_only", "provider_complete", "provider_incomplete", "child", "unconfigured"]),
        providerSetupHref: z.literal("/onboarding?purpose=provider"),
        passwordConfigured: z.boolean().nullable(),
    }),
});
