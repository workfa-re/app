import "server-only";

import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { demoTokenHash, type DemoVisit } from "@/lib/demo/session";
import type { DemoIdentity, DemoRole } from "@/lib/demo/roles";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { isRecipientSandboxEnabled } from "./recipient-config";

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
const storedVisit = z.object({
    id: z.string().uuid(), expires_at: z.string().datetime({ offset: true }), seeded: z.literal(true),
    identities: z.object({ seeker: z.string().uuid(), "private-provider": z.string().uuid(), company: z.string().uuid(), guardian: z.string().uuid(), "peer-seeker": z.string().uuid() }),
});

/** Only an existing cookie-bound, seeded visit may open an explicitly enrolled sandbox identity. */
export async function getSandboxPreviewVisit(token: string | undefined, role: DemoRole, adultRecipient: boolean): Promise<{
    visit: DemoVisit & { identities: NonNullable<DemoVisit["identities"]> }; token: string; identity: DemoIdentity;
}> {
    if (requirePaymentRuntime().mode !== "sandbox") throw new PaymentFlowError("sandbox_required", 403);
    if (role === "seeker" && !isRecipientSandboxEnabled()) throw new PaymentFlowError("sandbox_preview_required", 403);
    if (!token || !/^[a-f0-9]{64}$/.test(token) || (adultRecipient && role !== "seeker")) throw new PaymentFlowError("sandbox_preview_required", 403);
    const client = getSupabaseAdminClient() as unknown as RpcClient;
    const result = await client.rpc("demo_get_session", { p_token_hash: demoTokenHash(token) });
    if (result.error) throw new PaymentFlowError("sandbox_preview_unavailable", 503);
    const parsed = storedVisit.safeParse(result.data);
    if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now()) throw new PaymentFlowError("sandbox_preview_required", 403);
    const identity: DemoIdentity = adultRecipient ? "peer-seeker" : role;
    const { error } = await client.rpc("pay_assert_sandbox_preview", {
        p_user_id: parsed.data.identities[identity], p_role: role === "seeker" ? "recipient" : "provider",
    });
    if (error) {
        if (error.message.includes("PAYMENT_SANDBOX_PREVIEW_REQUIRED")) throw new PaymentFlowError("sandbox_preview_required", 403);
        throw new PaymentFlowError("sandbox_preview_unavailable", 503);
    }
    return { visit: parsed.data, token, identity };
}
