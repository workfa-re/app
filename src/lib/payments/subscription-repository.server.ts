import "server-only";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import type { PaymentMode } from "./types";
const ref = (pattern: RegExp) => z.string().regex(pattern);
const timestamp = z.string().datetime({ offset: true }).nullable();
const recordSchema = z.object({
    userId: z.string().uuid(),
    mode: z.enum(["live", "sandbox"]),
    enabled: z.boolean(),
    productRef: ref(/^prod_[A-Za-z0-9_]+$/).nullable(),
    priceRef: ref(/^price_[A-Za-z0-9]+$/).nullable(),
    portalRef: ref(/^bpc_[A-Za-z0-9]+$/).nullable(),
    monthlyCents: z.literal(590),
    taxTreatment: z.enum(["pending", "small_business", "vat19"]),
    taxRateRef: ref(/^txr_[A-Za-z0-9]+$/).nullable(),
    termsVersion: z.literal("workfare-plan-v1"),
    customerRef: ref(/^cus_[A-Za-z0-9]+$/).nullable(),
    subscriptionRef: ref(/^sub_[A-Za-z0-9]+$/).nullable(),
    status: z.enum([
        "none",
        "active",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "past_due",
        "paused",
        "trialing",
        "unpaid",
    ]),
    paidUntil: timestamp,
    periodEnd: timestamp,
    cancelAtPeriodEnd: z.boolean(),
    reviewRequired: z.boolean(),
    generation: z.number().int().nonnegative(),
    checkedAt: timestamp,
    entitled: z.boolean(),
    contractReference: z.string().uuid().nullable(),
    checkout: z
        .object({
            id: z.string().uuid(),
            operationId: z.string().uuid(),
            sessionRef: ref(/^cs_(?:live|test)_[A-Za-z0-9]+$/).nullable(),
            state: z.enum(["pending", "complete", "expired"]),
            expiresAt: z.string().datetime({ offset: true }),
            priceRef: z.string(),
            termsVersion: z.string(),
        })
        .nullable(),
});
export type MembershipRecord = z.infer<typeof recordSchema>;
export async function membershipRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    requirePaymentRuntime();
    const client = getSupabaseAdminClient() as unknown as {
        rpc(
            name: string,
            args: Record<string, unknown>,
        ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
    };
    const { data, error } = await client.rpc(name, args);
    if (error) {
        const code = error.message?.match(/\bMEMBERSHIP_[A-Z_]+\b/)?.[0] ?? "membership_unavailable";
        throw new PaymentFlowError(code, code === "MEMBERSHIP_RATE_LIMITED" ? 429 : 409);
    }
    return data as T;
}
export function parseMembershipRecord(value: unknown, userId: string, mode: PaymentMode) {
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success || parsed.data.userId !== userId || parsed.data.mode !== mode)
        throw new PaymentFlowError("membership_owner_conflict", 409);
    return parsed.data;
}
export async function membershipRecord(userId: string, mode: PaymentMode) {
    return parseMembershipRecord(
        await membershipRpc("pay_membership_record", { p_user_id: userId, p_mode: mode }),
        userId,
        mode,
    );
}
export async function claimMembershipCheckout(
    userId: string,
    mode: PaymentMode,
    operationId: string,
    termsVersion: string,
    immediateStart: boolean,
) {
    return parseMembershipRecord(
        await membershipRpc("pay_membership_checkout_claim", {
            p_user_id: userId,
            p_mode: mode,
            p_operation_id: operationId,
            p_terms_version: termsVersion,
            p_immediate_start: immediateStart,
        }),
        userId,
        mode,
    );
}
