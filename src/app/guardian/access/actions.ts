"use server";

import { acceptFamilyInvitation, acceptLegacyGuardianInvitation, approveFamilyChild, loadGuardianContext, requestGuardianEmailOtp, revokeFamilyConnection, saveMinimalGuardianProfile, verifyGuardianEmailOtp, signInGuardianPassword, setGuardianPassword } from "@/lib/guardian/service.server";
import type { GuardianConsentInput } from "@/lib/guardian/types";

export async function getGuardianAccessContext(token?: string) { return loadGuardianContext(token); }
export async function requestGuardianOtp(input: { email: unknown; token?: unknown; reauthenticate?: boolean }) { return requestGuardianEmailOtp(input); }
export async function signInGuardianAccessPassword(input: { email: unknown; password: unknown }) { return signInGuardianPassword(input); }
export async function setGuardianAccessPassword(input: { password: string; passwordConfirmation: string }) { return setGuardianPassword(input); }
export async function verifyGuardianOtp(input: { email: unknown; code: unknown }) { return verifyGuardianEmailOtp(input); }
export async function completeGuardianProfile(input: { fullName: string; birthdate: string; adultConfirmed: true }) { return saveMinimalGuardianProfile(input); }
export async function redeemGuardianInvitation(token: string, consent?: GuardianConsentInput) { return acceptFamilyInvitation(token, consent); }
export async function redeemLegacyGuardianInvitation(token: string, accepted: boolean) { return acceptLegacyGuardianInvitation(token, accepted); }
export async function approveGuardianRelationship(childId: string, consent: GuardianConsentInput) {
    const result = await approveFamilyChild(childId, consent);
    return result.success ? { ok: true as const } : { ok: false as const, error: result.message, code: result.code ?? "unavailable" };
}
export async function revokeGuardianRelationship(relationshipId: string) { return revokeFamilyConnection(relationshipId); }
