import type { RecipientRecord } from "./recipient-types";
type IdentityRecord = Omit<RecipientRecord, "guardianReason"> & { guardianReason?: string | null };

/** Sync generations order observations; they are not an account/consent identity. */
export function recipientIdentityUnchanged(before: IdentityRecord, after: IdentityRecord | null): boolean {
    if (!after) return false;
    const identity = (record: IdentityRecord) => [record.id, record.userId, record.mode, record.accountRef,
        record.birthdate ?? null, record.displayName ?? null,
        record.minorBinding ? [record.minorBinding.guardianId, record.minorBinding.consentId,
            record.minorBinding.childBirthdate, record.minorBinding.guardianBirthdate,
            record.minorBinding.guardianEmail, record.minorBinding.guardianName] : null];
    return JSON.stringify(identity(before)) === JSON.stringify(identity(after));
}
