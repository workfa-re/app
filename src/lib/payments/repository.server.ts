import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabaseServer";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import type { CustomerRecord, PaymentMode, SetupRecord, StoredMethod } from "./types";

export type PaymentSettingsSnapshot = Readonly<{
    kind: "disabled" | "local" | "sandbox" | "live";
    featureEnabled: boolean;
    setupEnabled?: boolean;
    buyerReady: boolean;
    method: Readonly<{ brand: string | null; last4: string | null; expiryMonth: number | null; expiryYear: number | null }> | null;
    recipientStatus: "not_started";
    pendingRemoval?: boolean;
}>;

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type PaymentRpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult> };
const disabledSnapshot: PaymentSettingsSnapshot = Object.freeze({ kind: "disabled", featureEnabled: false, buyerReady: false, method: null, recipientStatus: "not_started", pendingRemoval: false });

function persistenceError(message: string): never {
    // Do not expose SQL detail, customer references or failed parameter values.
    const known = message.match(/\b(?:PAYMENT_[A-Z_]+|PAYMENTS_DISABLED|LIVE_PAYMENTS_FORBIDDEN)\b/)?.[0];
    throw new PaymentFlowError(known ?? "payment_persistence_failed", 409);
}

/** Private service RPCs are available only inside the validated payment runtime. */
async function serviceRpc<T>(name: string, args: Record<string, unknown>, mode?: PaymentMode): Promise<T> {
    const runtime = requirePaymentRuntime();
    if (mode && runtime.mode !== mode) throw new PaymentFlowError("payment_mode_mismatch", 409);
    const client = getSupabaseAdminClient() as unknown as PaymentRpcClient;
    const { data, error } = await client.rpc(name, args);
    if (error) persistenceError(error.message);
    return data as T;
}

/** Returns an owner-bound public projection, never the private customer/session rows. */
export async function getPaymentSettingsSnapshot(userId: string): Promise<PaymentSettingsSnapshot> {
    if (!["local_simulation", "sandbox", "live"].includes(process.env.WORKFARE_PAY_MODE ?? "")) return disabledSnapshot;
    let mode: PaymentMode;
    try { mode = requirePaymentRuntime().mode; } catch { return disabledSnapshot; }
    const client = await supabaseServer();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user || auth.user.id !== userId) throw new PaymentFlowError("owner_mismatch", 403);
    const { data, error } = await (client as unknown as PaymentRpcClient).rpc("get_payment_settings_snapshot");
    if (error) {
        // A deployment without this additive migration stays safely disabled.
        if (["PGRST202", "42883", "42P01"].includes(error.code ?? "")) return disabledSnapshot;
        throw new PaymentFlowError("payment_settings_unavailable", 503);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PaymentFlowError("payment_settings_unavailable", 503);
    const row = data as Record<string, unknown>;
    const kind = mode === "local_simulation" ? "local" : mode;
    if (row.kind === "disabled" || row.kind !== kind) return disabledSnapshot;
    let method: PaymentSettingsSnapshot["method"] = null;
    if (row.method && typeof row.method === "object" && !Array.isArray(row.method)) {
        const stored = row.method as Record<string, unknown>;
        method = {
            brand: typeof stored.brand === "string" ? stored.brand : null,
            last4: typeof stored.last4 === "string" && /^\d{4}$/.test(stored.last4) ? stored.last4 : null,
            expiryMonth: typeof stored.expiryMonth === "number" ? stored.expiryMonth : null,
            expiryYear: typeof stored.expiryYear === "number" ? stored.expiryYear : null,
        };
    }
    return { kind, featureEnabled: row.featureEnabled === true, ...(row.setupEnabled !== undefined ? { setupEnabled: row.setupEnabled === true } : {}), buyerReady: row.buyerReady === true, method, recipientStatus: "not_started", pendingRemoval: row.pendingRemoval === true };
}

export function claimPaymentCustomer(userId: string, mode: PaymentMode, operationId: string) {
    return serviceRpc<{ claimed: boolean; customerRef: string | null }>("pay_claim_customer", { p_user_id: userId, p_mode: mode, p_operation_id: operationId }, mode);
}

export async function savePaymentCustomer(userId: string, mode: PaymentMode, operationId: string, customerRef: string): Promise<void> {
    await serviceRpc("pay_save_customer", { p_user_id: userId, p_mode: mode, p_operation_id: operationId, p_customer_ref: customerRef }, mode);
}

export function getPaymentCustomer(userId: string, mode: PaymentMode): Promise<CustomerRecord | null> {
    return serviceRpc("pay_get_customer", { p_user_id: userId, p_mode: mode }, mode);
}

export function createPaymentSetup(userId: string, mode: PaymentMode, operationId: string, returnPath: string | null, consentVersion: string): Promise<SetupRecord> {
    return serviceRpc("pay_create_setup", { p_user_id: userId, p_mode: mode, p_operation_id: operationId, p_return_path: returnPath, p_consent_version: consentVersion }, mode);
}

export async function attachPaymentSetupSession(setupId: string, checkoutSessionRef: string, expiresAt: string): Promise<void> {
    await serviceRpc("pay_attach_setup_session", { p_setup_id: setupId, p_external_ref: checkoutSessionRef, p_expires_at: expiresAt });
}

export function getPaymentSetup(setupId: string): Promise<SetupRecord | null> {
    return serviceRpc("pay_get_setup", { p_setup_id: setupId });
}

export async function completePaymentSetup(setupId: string, eventId: string, customerRef: string, method: StoredMethod): Promise<void> {
    const result = await serviceRpc<{ applied: boolean; duplicate?: boolean; reason?: string }>("pay_complete_setup", {
        p_setup_id: setupId, p_event_id: eventId, p_customer_ref: customerRef, p_method_ref: method.id, p_method_kind: method.kind,
        p_brand: method.brand, p_last4: method.last4, p_expiry_month: method.expiryMonth, p_expiry_year: method.expiryYear, p_livemode: requirePaymentRuntime().mode === "live",
    });
    if (result.reason === "PAYMENT_SETUP_STALE") throw new PaymentFlowError("PAYMENT_SETUP_STALE", 409);
}

export async function removePaymentMethod(userId: string, mode: PaymentMode, eventId: string, methodRef: string | null): Promise<void> {
    await serviceRpc("pay_remove_method", { p_user_id: userId, p_mode: mode, p_event_id: eventId, p_method_ref: methodRef }, mode);
}

export async function removePaymentMethodByReference(mode: PaymentMode, eventId: string, methodRef: string): Promise<void> {
    await serviceRpc("pay_remove_method_by_reference", { p_mode: mode, p_event_id: eventId, p_method_ref: methodRef }, mode);
}

export async function confirmPaymentMethodDetached(userId: string, mode: PaymentMode, methodRef: string): Promise<void> {
    await serviceRpc("pay_confirm_method_detached", { p_user_id: userId, p_mode: mode, p_method_ref: methodRef }, mode);
}

export async function cancelPaymentSetup(setupId: string, userId: string): Promise<void> {
    await serviceRpc("pay_cancel_setup", { p_setup_id: setupId, p_user_id: userId });
}

/** Explicit opt-in after the local demo visit has finished seeding. */
export async function enrollLocalPaymentPreview(userId: string): Promise<void> {
    await serviceRpc("pay_enroll_local_preview", { p_user_id: userId }, "local_simulation");
}
