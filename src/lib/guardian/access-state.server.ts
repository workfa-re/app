import "server-only";
import { cache } from "react";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import type { GuardianApplicationAccess } from "./types";
import { missingGuardianRpc, readGuardianSchemaState } from "./schema-readiness.server";
import { ageInBerlin } from "@/lib/age";

async function readLegacyApplicationAccess(client: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<GuardianApplicationAccess | null> {
    const { data: profile, error: profileError } = await client.from("profiles").select("id,account_type,birthdate").eq("id", userId).maybeSingle();
    if (profileError || !profile || profile.id !== userId || profile.account_type !== "job_seeker") return null;
    const age = ageInBerlin(profile.birthdate ?? "");
    if (age === null || age < 14 || age > 20) return { guardianStatus: "none", hasActiveGuardian: false, canApply: false, isVerified: false };
    const { data, error } = await client.from("guardian_relationships").select("child_id").eq("child_id", userId).eq("status", "active").limit(1);
    if (error || !Array.isArray(data)) return null;
    const linked = data.some(row => row.child_id === userId);
    // This preserves the old projection only on a proven old schema. Its
    // existing submit_job_application RPC remains the mutation authority.
    return { guardianStatus: linked ? "linked" : "none", hasActiveGuardian: linked, canApply: linked, isVerified: linked };
}

const accessSchema = z.object({
    guardianStatus: z.enum(["none", "pending", "linked"]),
    hasActiveGuardian: z.boolean(), canApply: z.boolean(), isVerified: z.boolean(),
}).refine(value => (value.guardianStatus === "linked") === value.hasActiveGuardian
    && (!value.isVerified || (value.hasActiveGuardian && value.canApply)));

/** Request-scoped and always bound to the verified session; no target-ID overload. */
export const getGuardianApplicationAccess = cache(async (): Promise<GuardianApplicationAccess | null> => {
    try {
        const client = await supabaseServer();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user?.email_confirmed_at) return null;
        const { data, error } = await (client.rpc as unknown as (name: string) => Promise<{ data: unknown; error: unknown }>)("get_guardian_application_access");
        if (error) {
            if (!missingGuardianRpc(error, "get_guardian_application_access") || await readGuardianSchemaState(client) !== "legacy") return null;
            return await readLegacyApplicationAccess(client, user.id);
        }
        const result = accessSchema.safeParse(data);
        return result.success ? result.data : null;
    } catch { return null; }
});
