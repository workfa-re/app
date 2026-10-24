import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabaseServer";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { isRecipientSandboxEnabled } from "./recipient-config";
import type { PaymentMode } from "./types";
import type { RecipientAccountPrefill, RecipientComponent, RecipientRecord, RecipientSession, RecipientSettingsSnapshot, VerifiedRecipientState } from "./recipient-types";

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
const disabled: RecipientSettingsSnapshot = Object.freeze({ kind: "disabled", featureEnabled: false, status: "not_started", canStart: false,
    eligibility: "ineligible", requirementCount: 0, hasPayoutMethod: false, detailsSubmitted: false, transfersActive: false, payoutsEnabled: false, checkedAt: null });

async function serviceRpc<T>(name: string, args: Record<string, unknown>, mode?: PaymentMode): Promise<T> {
    const runtime = requirePaymentRuntime();
    if (mode && runtime.mode !== mode) throw new PaymentFlowError("recipient_mode_mismatch", 409);
    const { data, error } = await (getSupabaseAdminClient() as unknown as RpcClient).rpc(name, args);
    if (error) throw new PaymentFlowError(error.message.match(/\b(?:RECIPIENT_[A-Z_]+|PAYMENTS_DISABLED)\b/)?.[0] ?? "recipient_persistence_failed", 409);
    return data as T;
}

export async function getRecipientSettingsSnapshot(userId: string): Promise<RecipientSettingsSnapshot> {
    let mode: PaymentMode;
    try { mode = requirePaymentRuntime().mode; } catch { return disabled; }
    const client = await supabaseServer();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth.user?.id !== userId) throw new PaymentFlowError("owner_mismatch", 403);
    const { data, error } = await (client as unknown as RpcClient).rpc("get_recipient_settings_snapshot");
    if (error) {
        if (["PGRST202", "42883", "42P01"].includes(error.code ?? "")) return disabled;
        throw new PaymentFlowError("recipient_settings_unavailable", 503);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PaymentFlowError("recipient_settings_unavailable", 503);
    const row = data as Record<string, unknown>;
    const kind = mode === "local_simulation" ? "local" : mode;
    if (row.kind !== kind) return disabled;
    const statuses = ["not_started", "onboarding", "pending", "ready", "restricted", "unavailable"] as const;
    const eligibilities = ["local_demo", "adult", "minor_review_required", "ineligible"] as const;
    if (!statuses.includes(row.status as typeof statuses[number]) || !eligibilities.includes(row.eligibility as typeof eligibilities[number])) {
        throw new PaymentFlowError("recipient_settings_unavailable", 503);
    }
    const count = Number.isSafeInteger(row.requirementCount) && Number(row.requirementCount) >= 0 ? Number(row.requirementCount) : 0;
    return { kind, featureEnabled: row.featureEnabled === true, ...(row.setupEnabled !== undefined ? { setupEnabled: row.setupEnabled === true } : {}), status: row.status as RecipientSettingsSnapshot["status"],
        eligibility: row.eligibility as RecipientSettingsSnapshot["eligibility"], canStart: row.canStart === true && (mode !== "sandbox" || isRecipientSandboxEnabled()),
        requirementCount: count, hasPayoutMethod: row.hasPayoutMethod === true, detailsSubmitted: row.detailsSubmitted === true,
        transfersActive: row.transfersActive === true, payoutsEnabled: row.payoutsEnabled === true,
        checkedAt: typeof row.checkedAt === "string" ? row.checkedAt : null };
}

export const enrollLocalRecipientPreview = (userId: string) => serviceRpc<void>("pay_recipient_enroll_local", { p_user_id: userId }, "local_simulation");
export const claimRecipientAccount = (userId: string, mode: PaymentMode, operationId: string) => serviceRpc<{ claimed: boolean; accountRef: string | null; prefill?: RecipientAccountPrefill }>("pay_recipient_claim", { p_user_id: userId, p_mode: mode, p_operation_id: operationId }, mode);
export const saveRecipientAccount = (userId: string, mode: PaymentMode, operationId: string, accountRef: string) => serviceRpc<void>("pay_recipient_save_account", { p_user_id: userId, p_mode: mode, p_operation_id: operationId, p_account_ref: accountRef }, mode);
export const getRecipientAccount = (userId: string, mode: PaymentMode) => serviceRpc<RecipientRecord | null>("pay_recipient_get_account", { p_user_id: userId, p_mode: mode }, mode);
export const createRecipientLocalSession = (userId: string, operationId: string, component: RecipientComponent) => serviceRpc<RecipientSession>("pay_recipient_create_local_session", { p_user_id: userId, p_operation_id: operationId, p_component: component }, "local_simulation");
export const finishRecipientLocalSession = (userId: string, sessionId: string, outcome: "complete" | "cancel") => serviceRpc<void>("pay_recipient_finish_local_session", { p_user_id: userId, p_session_id: sessionId, p_outcome: outcome }, "local_simulation");
export const beginRecipientSync = (userId: string, eventId: string) => serviceRpc<{ generation: number; duplicate: boolean; accountRef: string }>("pay_recipient_begin_sync", { p_user_id: userId, p_event_id: eventId }, requirePaymentRuntime().mode);
export const applyRecipientSync = (userId: string, eventId: string, generation: number, accountRef: string, state: VerifiedRecipientState) => serviceRpc<{ applied: boolean }>("pay_recipient_apply_sync", { p_user_id: userId, p_event_id: eventId, p_generation: generation, p_account_ref: accountRef, p_state: state, p_livemode: requirePaymentRuntime().mode === "live" }, requirePaymentRuntime().mode);
export const findRecipientByAccount = (accountRef: string) => serviceRpc<RecipientRecord | null>("pay_recipient_find_account", { p_account_ref: accountRef }, requirePaymentRuntime().mode);
