import { requireCompleteProfile } from "@/lib/auth";
import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { getGuardians, getWards } from "@/app/actions/guardian";

export default async function ProfilePage() {
    const { profile, session, systemRoles } = await requireCompleteProfile();
    const [guardianResult, wardsResult] = await Promise.all([getGuardians(), getWards()]);

    const lastSignInAt = session.user.last_sign_in_at;

    return (
        <ProfileEditForm
            profile={profile}
            isStaff={systemRoles.length > 0}
            guardians={guardianResult.guardians ?? []}
            wards={wardsResult.wards ?? []}
            guardianLoadError={guardianResult.error ?? null}
            wardsLoadError={wardsResult.error ?? null}
            emailConfirmed={Boolean(session.user.email_confirmed_at)}
            lastLogin={lastSignInAt ? { created_at: lastSignInAt } : null}
        />
    );
}
