import "server-only";
import { cache } from "react";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";

export const GUARDIAN_SCHEMA_RELEASE = "workfare-guardian-purpose-v1";
export type GuardianSchemaState = "ready" | "legacy" | "unavailable";
type RpcFailure = { code?: string; message?: string; details?: string };
type Client = Awaited<ReturnType<typeof supabaseServer>>;
export function missingGuardianRpc(error: unknown, name: string) {
    if (!error || typeof error !== "object") return false;
    const value = error as RpcFailure;
    if (value.code !== "PGRST202" && value.code !== "42883") return false;
    // A missing nested helper must not reactivate old authorization logic.
    const message = typeof value.message === "string" ? value.message : "";
    if (value.code === "42883") return message.startsWith(`function public.${name}(`) && message.includes(") does not exist");
    return message.startsWith(`Could not find the function public.${name}(`)
        || message.startsWith(`Could not find the function public.${name} `);
}
const readiness = z.object({ ready: z.literal(true), release: z.literal(GUARDIAN_SCHEMA_RELEASE), revision: z.literal("20261024101749") });

export async function readGuardianSchemaState(client: Client): Promise<GuardianSchemaState> {
    try {
        const call = (name: string, args?: Record<string, unknown>) => (client.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(name, args);
        const result = await call("get_guardian_schema_readiness");
        if (!result.error) return readiness.safeParse(result.data).success ? "ready" : "unavailable";
        if (!missingGuardianRpc(result.error, "get_guardian_schema_readiness")) return "unavailable";
        // Only a wholly old schema may use the old workflow. A partial rollout,
        // denied request, malformed response or outage remains closed.
        const context = await call("get_guardian_access_context", { p_token: null });
        return missingGuardianRpc(context.error, "get_guardian_access_context") ? "legacy" : "unavailable";
    } catch { return "unavailable"; }
}
export const getGuardianSchemaState = cache(async (): Promise<GuardianSchemaState> => {
    try { return await readGuardianSchemaState(await supabaseServer()); }
    catch { return "unavailable"; }
});
