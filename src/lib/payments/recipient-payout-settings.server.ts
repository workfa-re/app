import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type Stripe from "stripe";
import { getAuthState } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import { getRecipientAccount, beginRecipientSync, applyRecipientSync } from "./recipient-repository.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import type { PaymentMode } from "./types";
import type { AutomaticPayoutSchedule, RecipientPayoutSettings } from "./recipient-payout-types";

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const uuid = z.string().uuid();
const scheduleSchema = z.discriminatedUnion("interval", [z.object({ interval: z.literal("daily") }).strict(), z.object({ interval: z.literal("weekly"), weeklyDays: z.array(z.enum(weekdays)).min(1).max(7) }).strict(), z.object({ interval: z.literal("monthly"), monthlyDays: z.array(z.number().int().min(1).max(31)).min(1).max(31) }).strict()]);
const operationSchema = z.object({ id: uuid, operationId: uuid, userId: uuid, mode: z.enum(["live", "sandbox"]), accountRef: z.string().regex(/^acct_[A-Za-z0-9]+$/), kind: z.enum(["schedule", "payout"]), originalSchedule: scheduleSchema, targetSchedule: scheduleSchema.nullable(), amountCents: z.number().int().positive().max(999999999).nullable(), sourceType: z.enum(["card", "bank_account", "fpx"]).nullable(), destinationRef: z.string().regex(/^ba_[A-Za-z0-9]+$/).nullable(), payoutRef: z.string().regex(/^po_[A-Za-z0-9]+$/).nullable(), payoutStatus: z.enum(["pending", "in_transit", "paid", "failed", "canceled"]).nullable(), arrivalAt: z.string().nullable(), state: z.enum(["pending", "submitted", "complete", "failed", "review_required"]), restored: z.boolean(), createdAt: z.string(), finished: z.boolean() });
type Operation = z.infer<typeof operationSchema>;
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
async function rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await (getSupabaseAdminClient() as unknown as Rpc).rpc(name, args);
    if (error) throw new PaymentFlowError(error.message?.match(/\b(?:RECIPIENT_[A-Z_]+|PAYMENTS_DISABLED)\b/)?.[0] ?? "recipient_payout_unavailable", 409);
    return data;
}
function parseOperation(value: unknown): Operation | null {
    if (value === null) return null;
    const result = operationSchema.safeParse(value);
    if (!result.success || !Number.isFinite(Date.parse(result.data.createdAt))) throw new PaymentFlowError("recipient_payout_unconfirmed", 503);
    return result.data;
}
function reject(): never { throw new PaymentFlowError("recipient_payout_unconfirmed", 409); }
const accountId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
function parseSchedule(settings: Stripe.BalanceSettings): AutomaticPayoutSchedule | { interval: "manual" } {
    if (settings.object !== "balance_settings") reject();
    const value = settings.payments?.payouts?.schedule;
    if (!value) return reject();
    if (value.interval === "manual") return { interval: "manual" };
    const candidate = value.interval === "daily" ? { interval: "daily" } : value.interval === "weekly" ? { interval: "weekly", weeklyDays: value.weekly_payout_days } : { interval: value.interval, monthlyDays: value.monthly_payout_days };
    const result = scheduleSchema.safeParse(candidate);
    if (!result.success) return reject();
    return result.data;
}
function params(schedule: AutomaticPayoutSchedule | { interval: "manual" }): Stripe.BalanceSettingsUpdateParams {
    return { payments: { payouts: { schedule: schedule.interval === "monthly" ? { interval: "monthly", monthly_payout_days: schedule.monthlyDays } : schedule.interval === "weekly" ? { interval: "weekly", weekly_payout_days: schedule.weeklyDays } : { interval: schedule.interval } } } };
}
const equalSchedule = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
async function owned(stripe: Stripe, userId: string, accountRef: string, mode: PaymentMode) {
    const account = await stripe.v2.core.accounts.retrieve(accountRef, { include: ["identity", "defaults", "configuration.recipient", "requirements"] });
    assertStripeModeObject(account, mode);
    if (account.id !== accountRef || account.metadata?.workfare_pay_user !== userId || account.metadata.workfare_pay_role !== "recipient" || account.closed
        || account.identity?.country?.toUpperCase() !== "DE" || account.identity.entity_type !== "individual" || account.dashboard !== "none"
        || account.defaults?.responsibilities?.fees_collector !== "application" || account.defaults.responsibilities.losses_collector !== "application") reject();
    return account;
}
/** Called only for a newly created recipient or its identical creation retry. */
export async function initializeRecipientMonthlySchedule(stripe: Stripe, userId: string, accountRef: string, mode: PaymentMode) {
    if (mode === "local_simulation") throw new PaymentFlowError("stripe_runtime_required", 503);
    const account = await owned(stripe, userId, accountRef, mode);
    if (account.metadata?.workfare_pay_default_schedule === "monthly_1_v1") return;
    const expected: AutomaticPayoutSchedule = { interval: "monthly", monthlyDays: [1] };
    const settings = await stripe.balanceSettings.update(params(expected), { stripeAccount: accountRef, idempotencyKey: `workfare:initial-payout-schedule:${accountRef}` });
    if (!equalSchedule(parseSchedule(settings), expected)) reject();
    const updated = await stripe.v2.core.accounts.update(accountRef, { metadata: { ...account.metadata, workfare_pay_default_schedule: "monthly_1_v1" }, include: ["defaults"] }, { idempotencyKey: `workfare:initial-payout-schedule-marker:${accountRef}` });
    assertStripeModeObject(updated, mode);
    if (updated.id !== accountRef || updated.metadata?.workfare_pay_user !== userId || updated.metadata.workfare_pay_default_schedule !== "monthly_1_v1") reject();
}
async function actor(ownerId: string) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("recipient_payout_simulation_unavailable", 409);
    const auth = await getAuthState();
    if (auth.state === "no-session") throw new PaymentFlowError("authentication_required", 401);
    if (auth.session.user.id !== ownerId) throw new PaymentFlowError("owner_mismatch", 409);
    if (auth.state !== "ready" || auth.profile?.account_type !== "job_seeker" || !auth.session.user.email_confirmed_at) throw new PaymentFlowError("recipient_account_required", 403);
    const record = await getRecipientAccount(ownerId, runtime.mode);
    if (!record || record.userId !== ownerId || record.mode !== runtime.mode || !record.accountRef) throw new PaymentFlowError("recipient_setup_required", 409);
    const eventId = `payout-settings:${randomUUID()}`;
    const sync = await beginRecipientSync(ownerId, eventId);
    if (sync.accountRef !== record.accountRef) throw new PaymentFlowError("owner_mismatch", 409);
    const state = await createRecipientStripeAdapter().inspect(ownerId, record.accountRef, record.minorBinding);
    const applied = await applyRecipientSync(ownerId, eventId, sync.generation, record.accountRef, state);
    if (!applied.applied) throw new PaymentFlowError("recipient_setup_changed", 409);
    if (state.status !== "ready" || !state.hasPayoutMethod || !state.payoutsEnabled || !state.transfersActive || !state.detailsSubmitted) throw new PaymentFlowError("recipient_setup_required", 409);
    return { userId: ownerId, accountRef: record.accountRef, mode: runtime.mode, stripe: await paymentStripeSdk()() };
}
async function facts(stripe: Stripe, userId: string, accountRef: string, mode: PaymentMode) {
    await owned(stripe, userId, accountRef, mode);
    const [settings, balance, banks] = await Promise.all([stripe.balanceSettings.retrieve({}, { stripeAccount: accountRef }), stripe.balance.retrieve({}, { stripeAccount: accountRef }), stripe.accounts.listExternalAccounts(accountRef, { object: "bank_account", limit: 100 })]);
    assertStripeModeObject(balance, mode);
    const schedule = parseSchedule(settings);
    if (settings.payments?.payouts?.status !== "enabled" || balance.object !== "balance" || banks.object !== "list" || banks.has_more || banks.data.length > 100) reject();
    const matching = banks.data.filter(bank => bank.object === "bank_account" && accountId(bank.account) === accountRef && bank.currency === "eur" && bank.default_for_currency === true && ["new", "validated", "verified"].includes(bank.status));
    if (matching.length !== 1) reject();
    const bankRef = matching[0].id;
    const sum = (values: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) => {
        if (!Array.isArray(values) || values.some(row => !Number.isSafeInteger(row.amount) || typeof row.currency !== "string")) return reject();
        const total = values.filter(row => row.currency === "eur").reduce((n, row) => n + row.amount, 0);
        if (!Number.isSafeInteger(total)) return reject();
        return total;
    };
    const availableCents = sum(balance.available), pendingCents = sum(balance.pending);
    const euro = balance.available.filter(row => row.currency === "eur");
    const sources = new Map<string, number>();
    for (const row of euro) for (const [type, amount] of Object.entries(row.source_types ?? {})) {
        if (!Number.isSafeInteger(amount)) reject();
        sources.set(type, (sources.get(type) ?? 0) + Number(amount));
    }
    const positive = [...sources].filter(([, amount]) => amount > 0);
    const sourceType = positive.length === 1 && ["card", "bank_account", "fpx"].includes(positive[0][0]) && positive[0][1] >= availableCents ? positive[0][0] as "card" | "bank_account" | "fpx" : null;
    return { schedule, availableCents, pendingCents, bankRef, sourceType };
}
async function mark(op: Operation, state: Operation["state"], restored: boolean, payout?: Stripe.Payout) {
    await rpc("pay_recipient_payout_mark", { p_id: op.id, p_user_id: op.userId, p_account_ref: op.accountRef, p_state: state, p_restored: restored,
        p_payout_ref: payout?.id ?? op.payoutRef, p_payout_status: payout?.status ?? op.payoutStatus,
        p_arrival_at: payout ? new Date(payout.arrival_date * 1000).toISOString() : op.arrivalAt });
}
function validatePayout(payout: Stripe.Payout, op: Operation) {
    assertStripeModeObject(payout, op.mode);
    if (payout.object !== "payout" || !/^po_[A-Za-z0-9]+$/.test(payout.id) || payout.automatic !== false || payout.method !== "standard" || payout.currency !== "eur" || payout.amount !== op.amountCents
        || accountId(payout.destination) !== op.destinationRef || payout.source_type !== op.sourceType || payout.metadata?.workfare_operation !== op.id || payout.metadata.workfare_user !== op.userId
        || !["pending", "in_transit", "paid", "failed", "canceled"].includes(payout.status) || !Number.isSafeInteger(payout.arrival_date)) reject();
    return payout as Stripe.Payout & { status: Exclude<Operation["payoutStatus"], null> };
}
async function existingPayout(stripe: Stripe, op: Operation) {
    if (op.payoutRef) return validatePayout(await stripe.payouts.retrieve(op.payoutRef, {}, { stripeAccount: op.accountRef }), op);
    let cursor: string | undefined;
    let candidate: ReturnType<typeof validatePayout> | null = null;
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
        const page = await stripe.payouts.list({ limit: 100, created: { gte: Math.floor(Date.parse(op.createdAt) / 1000) - 5 }, ...(cursor ? { starting_after: cursor } : {}) }, { stripeAccount: op.accountRef });
        if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== "boolean" || page.has_more && page.data.length === 0) reject();
        const matches = page.data.filter(payout => payout.metadata?.workfare_operation === op.id);
        if (matches.length > 1 || candidate && matches.length) reject();
        if (matches.length === 1) candidate = validatePayout(matches[0], op);
        if (!page.has_more) return candidate;
        cursor = page.data.at(-1)?.id;
    }
    throw new PaymentFlowError("recipient_payout_review_required", 409);
}
async function restore(stripe: Stripe, op: Operation) {
    await owned(stripe, op.userId, op.accountRef, op.mode);
    const current = parseSchedule(await stripe.balanceSettings.retrieve({}, { stripeAccount: op.accountRef }));
    // Respect another explicit automatic-plan change; never overwrite it.
    if (current.interval !== "manual") return true;
    const restored = await stripe.balanceSettings.update(params(op.originalSchedule), { stripeAccount: op.accountRef, idempotencyKey: `workfare:payout-restore:${op.id}` });
    return equalSchedule(parseSchedule(restored), op.originalSchedule);
}
async function lease(op: Operation, token: string, release = false) {
    const granted = await rpc("pay_recipient_payout_lease", { p_id: op.id, p_token: token, p_release: release });
    if (granted !== true && !release) throw new PaymentFlowError("recipient_payout_in_progress", 409);
}
async function execute(stripe: Stripe, op: Operation) {
    if (op.finished) { if (op.state === "failed") throw new PaymentFlowError("recipient_payout_failed",409); return; }
    const token = randomUUID();
    await lease(op, token);
    try { await executeLocked(stripe, op, token); }
    finally { await lease(op, token, true).catch(() => undefined); }
}
async function executeLocked(stripe: Stripe, op: Operation, token: string) {
    if (op.kind === "schedule") {
        await lease(op, token);
        const settings = await stripe.balanceSettings.update(params(op.targetSchedule!), { stripeAccount: op.accountRef, idempotencyKey: `workfare:payout-plan:${op.id}` });
        if (!equalSchedule(parseSchedule(settings), op.targetSchedule)) reject();
        await mark(op, "complete", true); return;
    }
    let payout: Stripe.Payout | null = null, failure: unknown;
    try {
        payout = await existingPayout(stripe, op);
        if (!payout) {
            payoutRecoveryToken();
            if (Date.now() - Date.parse(op.createdAt) > 23 * 60 * 60_000) throw new PaymentFlowError("recipient_payout_review_required", 409);
            const checked = await facts(stripe, op.userId, op.accountRef, op.mode);
            if (checked.availableCents < op.amountCents! || checked.bankRef !== op.destinationRef || checked.sourceType !== op.sourceType) throw new PaymentFlowError("recipient_payout_balance_changed", 409);
            await lease(op, token);
            const manual = await stripe.balanceSettings.update(params({ interval: "manual" }), { stripeAccount: op.accountRef, idempotencyKey: `workfare:payout-pause:${op.id}` });
            if (parseSchedule(manual).interval !== "manual") reject();
            const fresh = await facts(stripe, op.userId, op.accountRef, op.mode);
            if (fresh.availableCents < op.amountCents! || fresh.bankRef !== op.destinationRef || fresh.sourceType !== op.sourceType) throw new PaymentFlowError("recipient_payout_balance_changed", 409);
            await lease(op, token);
            payout = validatePayout(await stripe.payouts.create({ amount: op.amountCents!, currency: "eur", destination: op.destinationRef!, method: "standard", source_type: op.sourceType!, metadata: { workfare_operation: op.id, workfare_user: op.userId } }, { stripeAccount: op.accountRef, idempotencyKey: `workfare:payout:${op.id}` }), op);
            await mark(op, "submitted", false, payout);
        }
    } catch (error) { failure = error; }
    await lease(op, token);
    const restored = await restore(stripe, op).catch(() => false);
    await mark(op, payout ? "complete" : (failure instanceof PaymentFlowError && failure.code === "recipient_payout_balance_changed" || failure && typeof failure === "object" && "type" in failure && failure.type === "StripeInvalidRequestError") ? "failed" : "review_required", restored, payout ?? undefined);
    if (!restored) throw new PaymentFlowError("recipient_payout_restore_pending", 409);
    if (failure) throw failure;
}
function operationProjection(op: Operation | null): RecipientPayoutSettings["operation"] {
    return op ? { id: op.id, operationId: op.operationId, kind: op.kind, state: op.state, amountCents: op.amountCents,
        monthlyDay: op.targetSchedule?.interval === "monthly" ? op.targetSchedule.monthlyDays[0] : null,
        payoutStatus: op.payoutStatus, arrivalAt: op.arrivalAt, finished: op.finished } : null;
}
function projection(ownerId: string, mode: "live" | "sandbox", current: Awaited<ReturnType<typeof facts>>, op: Operation | null): RecipientPayoutSettings {
    const active = !!op && !op.finished;
    const reason = active ? "operation_pending" : current.schedule.interval === "manual" ? "automatic_schedule_required" : current.availableCents <= 0 ? "balance_not_available" : !current.sourceType ? "multiple_payment_sources" : null;
    return { ownerId, kind: mode, currency: "eur", availableCents: current.availableCents, pendingCents: current.pendingCents, schedule: current.schedule, ready: true, canRequestPayout: reason === null, reasonCode: reason,
        operation: operationProjection(op), checkedAt: new Date().toISOString() };
}
export async function readRecipientPayoutSettings(expectedOwnerId: string) {
    const ctx = await actor(expectedOwnerId);
    const [current, operation] = await Promise.all([facts(ctx.stripe, ctx.userId, ctx.accountRef, ctx.mode), rpc("pay_recipient_payout_current", { p_user_id: ctx.userId })]);
    const op = parseOperation(operation);
    if (op && (op.userId !== ctx.userId || op.accountRef !== ctx.accountRef || op.mode !== ctx.mode)) reject();
    return projection(ctx.userId, ctx.mode, current, op);
}
function assertCommandPayload(op: Operation, ctx: Awaited<ReturnType<typeof actor>>, body: Record<string, unknown>) {
    if (op.userId !== ctx.userId || op.accountRef !== ctx.accountRef || op.mode !== ctx.mode) reject();
    if (op.kind !== body.action || op.kind === "payout" && op.amountCents !== body.amountCents
        || op.kind === "schedule" && (op.targetSchedule?.interval !== "monthly" || op.targetSchedule.monthlyDays.length !== 1 || op.targetSchedule.monthlyDays[0] !== body.monthlyDay)) {
        throw new PaymentFlowError("RECIPIENT_PAYOUT_CONFLICT", 409);
    }
}
async function commandResult(ctx: Awaited<ReturnType<typeof actor>>, op: Operation, replayed = false) {
    const confirmed = parseOperation(await rpc("pay_recipient_payout_attempt", { p_user_id: ctx.userId, p_operation_id: op.operationId }));
    if (!confirmed || confirmed.id !== op.id || confirmed.userId !== ctx.userId || confirmed.accountRef !== ctx.accountRef || confirmed.mode !== ctx.mode) reject();
    if (confirmed.finished && confirmed.payoutRef) {
        const actual = await existingPayout(ctx.stripe, confirmed);
        if (!actual) reject();
        await mark(confirmed, confirmed.state, true, actual);
        confirmed.payoutStatus = actual.status;
        confirmed.arrivalAt = new Date(actual.arrival_date * 1000).toISOString();
    }
    const snapshot = await readRecipientPayoutSettings(ctx.userId);
    // Balances and schedule remain current, while the result identifies exactly
    // the browser's confirmed command rather than a different tab's latest one.
    const result = operationProjection(confirmed);
    return { ...snapshot, operation: result ? { ...result, replayed } : null };
}
export async function changeRecipientPayoutSettings(body: Record<string, unknown>, operationIdInput: unknown, expectedOwnerId: string) {
    const ctx = await actor(expectedOwnerId), operationId = uuid.safeParse(operationIdInput);
    if (body.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    if (!operationId.success || !["schedule", "payout"].includes(String(body.action))) throw new PaymentFlowError("invalid_request");
    const day = z.number().int().min(1).max(31).safeParse(body.monthlyDay), requestedAmount = z.number().int().positive().max(999999999).safeParse(body.amountCents);
    if (body.action === "schedule" && (!day.success || body.amountCents !== undefined) || body.action === "payout" && (!requestedAmount.success || body.monthlyDay !== undefined)) throw new PaymentFlowError("invalid_request");
    const exact = parseOperation(await rpc("pay_recipient_payout_attempt", { p_user_id: ctx.userId, p_operation_id: operationId.data }));
    if (exact) {
        assertCommandPayload(exact, ctx, body);
        if (!exact.finished) await execute(ctx.stripe, exact);
        return commandResult(ctx, exact, exact.finished);
    }
    const previous = parseOperation(await rpc("pay_recipient_payout_current", { p_user_id: ctx.userId }));
    if (previous && !previous.finished) {
        if (previous.userId !== ctx.userId || previous.accountRef !== ctx.accountRef || previous.mode !== ctx.mode) reject();
        if (previous.kind !== body.action || previous.kind === "payout" && previous.amountCents !== body.amountCents
            || previous.kind === "schedule" && (previous.targetSchedule?.interval !== "monthly" || previous.targetSchedule.monthlyDays[0] !== body.monthlyDay)) throw new PaymentFlowError("recipient_payout_in_progress", 409);
        await execute(ctx.stripe, previous);
        return commandResult(ctx, previous);
    }
    if (body.action === "payout") payoutRecoveryToken();
    const current = await facts(ctx.stripe, ctx.userId, ctx.accountRef, ctx.mode);
    if (current.schedule.interval === "manual" && body.action === "payout") throw new PaymentFlowError("recipient_payout_automatic_plan_required", 409);
    const targetSchedule = body.action === "schedule" ? { interval: "monthly" as const, monthlyDays: [day.success ? day.data : 1] } : null;
    const amount = body.action === "payout" && requestedAmount.success ? requestedAmount.data : null;
    if (amount && (amount > current.availableCents || !current.sourceType)) throw new PaymentFlowError("recipient_payout_balance_changed", 409);
    const op = parseOperation(await rpc("pay_recipient_payout_begin", { p_user_id: ctx.userId, p_operation_id: operationId.data, p_account_ref: ctx.accountRef, p_kind: body.action,
        p_original_schedule: current.schedule.interval === "manual" ? targetSchedule : current.schedule, p_target_schedule: targetSchedule, p_amount_cents: amount,
        p_source_type: amount ? current.sourceType : null, p_destination_ref: amount ? current.bankRef : null }));
    if (!op || op.userId !== ctx.userId || op.accountRef !== ctx.accountRef || op.mode !== ctx.mode) reject();
    if (op.kind !== body.action || op.amountCents !== amount || !equalSchedule(op.targetSchedule, targetSchedule)
        || amount && (op.sourceType !== current.sourceType || op.destinationRef !== current.bankRef)) throw new PaymentFlowError("recipient_payout_in_progress", 409);
    await execute(ctx.stripe, op);
    return commandResult(ctx, op);
}
export function payoutRecoveryToken() {
    const key = process.env.WORKFARE_PAY_HOSTED_STATE_SECRET;
    if (!key || key.length < 32) throw new PaymentFlowError("recipient_payout_recovery_unavailable", 503);
    return createHmac("sha256", key).update("workfare:recipient-payout-recovery:v1").digest("hex");
}
export function assertPayoutRecoveryToken(token: string | null) {
    const expected = payoutRecoveryToken();
    if (!token || !/^Bearer [a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token.slice(7)), Buffer.from(expected))) throw new PaymentFlowError("authentication_required", 401);
}
/** Crash recovery only restores automatic plans and reconciles actual payouts. It never creates a payout. */
export async function recoverRecipientPayoutOperations() {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("stripe_runtime_required", 503);
    const rows = z.array(operationSchema).max(100).safeParse(await rpc("pay_recipient_payout_recovery_list"));
    if (!rows.success) reject();
    const stripe = await paymentStripeSdk()();
    let reconciled = 0, pending = 0;
    for (const op of rows.data) {
        if (op.mode !== runtime.mode) continue;
        const token = randomUUID();
        try {
            await lease(op, token);
            await owned(stripe, op.userId, op.accountRef, op.mode);
            if (op.kind === "schedule") {
                const current = parseSchedule(await stripe.balanceSettings.retrieve({}, { stripeAccount: op.accountRef }));
                await mark(op, equalSchedule(current, op.targetSchedule) ? "complete" : "failed", true); reconciled++; continue;
            }
            await lease(op, token);
            const restored = await restore(stripe, op);
            const payout = await existingPayout(stripe, op);
            await lease(op, token);
            await mark(op, payout ? "complete" : "review_required", restored, payout ?? undefined);
            if (payout && restored) reconciled++; else pending++;
        } catch { pending++; }
        finally { await lease(op, token, true).catch(() => undefined); }
    }
    return { ok: true, reconciled, pending };
}
export async function handleRecipientPayoutSnapshot(payload: string, signature: string) {
    const runtime = requirePaymentRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("stripe_runtime_required", 503);
    const secret = process.env.STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET;
    if (!secret || !/^whsec_[A-Za-z0-9]+$/.test(secret)) throw new PaymentFlowError("recipient_snapshot_webhook_not_configured", 503);
    const stripe = await paymentStripeSdk()();
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(payload, signature, secret); } catch { throw new PaymentFlowError("invalid_webhook_signature", 400); }
    assertStripeModeObject(event, runtime.mode);
    if (!["payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled"].includes(event.type) || !event.account) return;
    const object = event.data.object as Stripe.Payout, operationId = object.metadata?.workfare_operation;
    if (!uuid.safeParse(operationId).success) return;
    const op = parseOperation(await rpc("pay_recipient_payout_find", { p_account_ref: event.account, p_operation_id: operationId }));
    if (!op || op.accountRef !== event.account || op.mode !== runtime.mode) return;
    await owned(stripe, op.userId, op.accountRef, op.mode);
    const actual = validatePayout(await stripe.payouts.retrieve(object.id, {}, { stripeAccount: op.accountRef }), op);
    if (op.finished) { await mark(op, "complete", true, actual); return; }
    const token = randomUUID();
    try { await lease(op, token); const restored = await restore(stripe, op); await mark(op, "complete", restored, actual); }
    finally { await lease(op, token, true).catch(() => undefined); }
}
