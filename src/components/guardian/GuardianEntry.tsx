import { Suspense } from "react";
import { getAuthState } from "@/lib/auth";
import { isProfileComplete } from "@/lib/types";
import { isAdultBirthdate } from "@/lib/age";
import { getWards } from "@/app/actions/guardian";
import { getGuardianSchemaState } from "@/lib/guardian/schema-readiness.server";
import { GuardianAccessRoute, GuardianLoading } from "./GuardianAccess";
import { LegacyGuardianAccess, GuardianReleaseUnavailable } from "./LegacyGuardianAccess";

export async function GuardianEntry() {
    const schema = await getGuardianSchemaState();
    if (schema === "ready") return <Suspense fallback={<GuardianLoading />}><GuardianAccessRoute /></Suspense>;
    if (schema !== "legacy") return <GuardianReleaseUnavailable />;
    const auth = await getAuthState();
    const authenticated = auth.state !== "no-session" && auth.state !== "email-unconfirmed";
    const profile = authenticated ? auth.profile : null;
    const eligible = Boolean(profile?.account_type === "job_provider" && profile.provider_kind === "private" && isProfileComplete(profile) && isAdultBirthdate(profile.birthdate));
    const wards = eligible ? await getWards() : null;
    return <Suspense fallback={<GuardianLoading />}><LegacyGuardianAccess authenticated={authenticated} eligible={eligible} name={profile?.full_name ?? null} childrenNames={wards && "wards" in wards ? wards.wards?.map(child => child.full_name || "Dein Kind") ?? [] : []} /></Suspense>;
}
