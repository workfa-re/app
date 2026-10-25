import "server-only";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireGuardianPaymentUser, getBoundGuardianRecipient } from "./guardian-native.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { readRecipientPayoutHistory } from "./recipient-summary-stripe.server";
import { recipientIdentityUnchanged } from "./recipient-identity";
import { PaymentFlowError } from "./runtime.server";
import type { GuardianFinanceSnapshot } from "./guardian-finance-types";
import { validRecipientBankSummary } from "./recipient-bank-summary";

type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const earningsSchema = z.object({ ownerId: z.string().uuid(), childId: z.string().uuid(), currency: z.literal("eur"), confirmedCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

/** Parent-only, read-only. It shares no chat, invoice, address or provider IDs. */
export async function readGuardianFinance(childIdInput: unknown, expectedOwnerId: string): Promise<GuardianFinanceSnapshot> {
    const guardianId = await requireGuardianPaymentUser(expectedOwnerId);
    const childId = z.string().uuid().safeParse(childIdInput);
    if (!childId.success) throw new PaymentFlowError("invalid_request");
    const record = await getBoundGuardianRecipient(guardianId, childId.data);
    const { data, error } = await (getSupabaseAdminClient() as unknown as Rpc).rpc("pay_guardian_recipient_earnings", { p_guardian_id: guardianId, p_child_id: childId.data });
    const earnings = earningsSchema.safeParse(data);
    if (error || !earnings.success || earnings.data.ownerId !== guardianId || earnings.data.childId !== childId.data) {
        throw new PaymentFlowError("guardian_finance_unavailable", 503);
    }
    const adapter = createRecipientStripeAdapter();
    const [fundsResult, bankResult] = await Promise.allSettled([
        adapter.readPayoutOverview(record.userId, record.accountRef, record.minorBinding),
        adapter.readBankSummary(record.userId, record.accountRef, record.minorBinding),
    ]);
    const funds = fundsResult.status === "fulfilled" ? fundsResult.value : null;
    if (funds && (funds.kind !== "live" || funds.currency !== "eur" || !Number.isSafeInteger(funds.availableCents) || !Number.isSafeInteger(funds.pendingCents))) {
        throw new PaymentFlowError("guardian_finance_unavailable", 503);
    }
    const bank = bankResult.status === "fulfilled" ? bankResult.value : null;
    if (bank && !validRecipientBankSummary(bank)) throw new PaymentFlowError("guardian_finance_unavailable", 503);
    // Payout history is contextual: only the freshly verified owner/model above
    // permits reading this particular connected account's private balance.
    const payouts = funds ? await readRecipientPayoutHistory(record.accountRef).catch(() => null) : null;
    const current = await getBoundGuardianRecipient(guardianId, childId.data);
    if (!recipientIdentityUnchanged(record, current)) throw new PaymentFlowError("recipient_setup_changed", 409);
    return {
        ownerId: guardianId, childId: childId.data, kind: "live", currency: "eur", confirmedCents: earnings.data.confirmedCents,
        availableCents: funds?.availableCents ?? null, pendingCents: funds?.pendingCents ?? null, paidOutCents: payouts?.paidOutCents ?? null,
        bank: bank ? { bankName: bank.bankName, last4: bank.last4, country: bank.country, currency: bank.currency } : null,
        recentPayouts: (payouts?.recent ?? []).slice(0, 5).map(payout => ({ amountCents: payout.amountCents, status: payout.status, createdAt: payout.createdAt, arrivalAt: payout.arrivalAt })),
        partial: !funds || !payouts || payouts.coverage !== "complete" || bankResult.status === "rejected", checkedAt: new Date().toISOString(),
    };
}
