import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { getAuthState } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { assertStripeModeObject } from "./stripe-mode.server";
import type { PaymentMode } from "./types";

const nameSchema = z.string().trim().min(2).max(150).refine(value => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value));
const emailSchema = z.string().trim().email().max(254);
export type BuyerProfileIdentity = Readonly<{ name: string; email: string }>;

/** Financial contact identity comes from the verified account, never request fields or metadata. */
export async function getBuyerProfileIdentity(expectedOwnerId: string): Promise<BuyerProfileIdentity> {
    const state = await getAuthState();
    if (state.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (state.session.user.id !== expectedOwnerId) throw new PaymentFlowError("owner_mismatch", 409);
    if (state.state !== "ready" || state.profile?.account_type !== "job_provider") throw new PaymentFlowError("provider_account_required", 403);
    const profileName = state.profile.provider_kind === "company" && state.profile.company_name?.trim()
        ? state.profile.company_name : state.profile.full_name;
    const name = nameSchema.safeParse(profileName), email = emailSchema.safeParse(state.session.user.email);
    if (!name.success) throw new PaymentFlowError("profile_name_required", 409);
    if (!email.success || !state.session.user.email_confirmed_at) throw new PaymentFlowError("confirmed_email_required", 403);
    return { name: name.data, email: email.data };
}

export async function syncBuyerCustomerIdentity(stripe: Stripe, customerId: string, userId: string, identity: BuyerProfileIdentity, mode: PaymentMode) {
    const assertOwned = (customer: Stripe.Customer | Stripe.DeletedCustomer): Stripe.Customer => {
        assertStripeModeObject(customer, mode);
        if (customer.id !== customerId || ("deleted" in customer && customer.deleted)
            || !("metadata" in customer) || customer.metadata.workfare_pay_user !== userId) throw new PaymentFlowError("payment_account_mismatch", 409);
        return customer as Stripe.Customer;
    };
    if (!nameSchema.safeParse(identity.name).success || !emailSchema.safeParse(identity.email).success) throw new PaymentFlowError("profile_identity_required", 409);
    const existing = assertOwned(await stripe.customers.retrieve(customerId));
    if (existing.name === identity.name && existing.email === identity.email) return existing;
    // A property assignment can safely repeat after a lost response. A fresh key
    // also permits a later legitimate A -> B -> A change within Stripe's cache window.
    const updated = assertOwned(await stripe.customers.update(customerId, { name: identity.name, email: identity.email },
        { idempotencyKey: `workfare-pay:profile-contact:${userId}:${randomUUID()}` }));
    if (updated.name !== identity.name || updated.email !== identity.email) throw new PaymentFlowError("billing_sync_unconfirmed", 409);
    const current = assertOwned(await stripe.customers.retrieve(customerId));
    if (current.name !== identity.name || current.email !== identity.email) throw new PaymentFlowError("billing_sync_unconfirmed", 409);
    return current;
}

/** Initiates the normal Auth email confirmation; it does not create a separate billing address. */
export async function requestBuyerEmailChange(input: unknown, expectedOwnerId: string) {
    const runtime = requirePaymentRuntime();
    const identity = await getBuyerProfileIdentity(expectedOwnerId);
    const email = emailSchema.safeParse(input);
    if (!email.success) throw new PaymentFlowError("invalid_email", 400);
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("account_email_change_unavailable", 409);
    if (identity.email.toLowerCase() === email.data.toLowerCase()) return { ownerId: expectedOwnerId, status: "unchanged" as const };
    const client = await supabaseServer();
    const before = await client.auth.getUser();
    if (before.error || before.data.user?.id !== expectedOwnerId) throw new PaymentFlowError("authentication_required", 401);
    if (before.data.user.new_email?.toLowerCase() === email.data.toLowerCase() && before.data.user.email_change_sent_at) {
        return { ownerId: expectedOwnerId, status: "pending" as const };
    }
    const database = getSupabaseAdminClient() as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
    const permission = await database.rpc("pay_assert_account_email_change", { p_user_id: expectedOwnerId });
    if (permission.error || !permission.data || typeof permission.data !== "object" || !("allowed" in permission.data) || permission.data.allowed !== true) {
        throw new PaymentFlowError(permission.error?.message?.includes("RECIPIENT_GUARDIAN_EMAIL_CHANGE_REQUIRES_REVIEW")
            ? "account_email_family_review_required" : "email_change_unavailable", 409);
    }
    const redirect = new URL("/auth/callback", runtime.origin);
    redirect.searchParams.set("next", "/app-home/settings/payments");
    const changed = await client.auth.updateUser({ email: email.data }, { emailRedirectTo: redirect.toString() });
    if (changed.error) throw new PaymentFlowError(changed.error.status === 429 ? "email_change_rate_limited" : "email_change_unavailable", changed.error.status === 429 ? 429 : 409);
    const after = await client.auth.getUser();
    if (after.error || after.data.user?.id !== expectedOwnerId) throw new PaymentFlowError("email_change_unconfirmed", 409);
    const confirmed = after.data.user.email?.toLowerCase() === email.data.toLowerCase() && !!after.data.user.email_confirmed_at;
    return { ownerId: expectedOwnerId, status: confirmed ? "changed" as const : "pending" as const };
}
