import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), record: vi.fn(), snapshot: vi.fn(), beginSync: vi.fn(), applySync: vi.fn(), inspect: vi.fn(), rpc: vi.fn(), sdk: vi.fn(), runtime: vi.fn(), retrieveAccount: vi.fn(), updateAccount: vi.fn(), settings: vi.fn(), updateSettings: vi.fn(), balance: vi.fn(), banks: vi.fn(), listPayouts: vi.fn(), retrievePayout: vi.fn(), createPayout: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthState: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/payments/recipient-repository.server", () => ({ getRecipientAccount: mocks.record, getRecipientSettingsSnapshot:mocks.snapshot, beginRecipientSync: mocks.beginSync, applyRecipientSync: mocks.applySync }));
vi.mock("@/lib/payments/recipient-stripe.server", () => ({ createRecipientStripeAdapter: () => ({ inspect: mocks.inspect }) }));
vi.mock("@/lib/payments/runtime.server", async original => ({ ...await original<typeof import("@/lib/payments/runtime.server")>(), requirePaymentRuntime: mocks.runtime }));
vi.mock("@/lib/payments/stripe-mode.server", async original => ({ ...await original<typeof import("@/lib/payments/stripe-mode.server")>(), paymentStripeSdk: () => mocks.sdk }));
import { assertPayoutRecoveryToken, changeRecipientPayoutSettings, handleRecipientPayoutSnapshot, initializeRecipientMonthlySchedule, payoutRecoveryToken, readRecipientPayoutSettings, recoverRecipientPayoutOperations } from "@/lib/payments/recipient-payout-settings.server";
import type Stripe from "stripe";

const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", nonce = "33333333-3333-4333-8333-333333333333", id = "44444444-4444-4444-8444-444444444444", accountRef = "acct_payoutFixture";
const metadata = { workfare_pay_user: user, workfare_pay_role: "recipient", workfare_pay_minor: "preserved" };
const account = () => ({ id: accountRef, livemode: false, metadata: { ...metadata }, dashboard: "none", identity: { country: "de", entity_type: "individual" }, defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } } });
const bank = () => ({ id: "ba_fixture", object: "bank_account", account: accountRef, currency: "eur", default_for_currency: true, status: "new" });
let schedule: Record<string, unknown>, available: number, op: Record<string, unknown> | null, history: Map<string, Record<string, unknown>>;
const settings = () => ({ object: "balance_settings", payments: { payouts: { status: "enabled", schedule } } });
const payout = (patch = {}) => ({ id: "po_fixture", object: "payout", livemode: false, automatic: false, method: "standard", currency: "eur", amount: 1700, source_type: "card", destination: "ba_fixture", metadata: { workfare_operation: id, workfare_user: user }, status: "pending", arrival_date: 2_000_000_000, ...patch });
const operation = (patch = {}) => ({ id, operationId: nonce, userId: user, mode: "sandbox", accountRef, kind: "payout", originalSchedule: { interval: "monthly", monthlyDays: [1] }, targetSchedule: null, amountCents: 1700, sourceType: "card", destinationRef: "ba_fixture", payoutRef: null, payoutStatus: null, arrivalAt: null, state: "pending", restored: false, createdAt: new Date().toISOString(), finished: false, ...patch });
const stripe = { v2: { core: { accounts: { retrieve: mocks.retrieveAccount, update: mocks.updateAccount } } }, balanceSettings: { retrieve: mocks.settings, update: mocks.updateSettings }, balance: { retrieve: mocks.balance }, accounts: { listExternalAccounts: mocks.banks }, payouts: { list: mocks.listPayouts, retrieve: mocks.retrievePayout, create: mocks.createPayout }, webhooks: { constructEvent: mocks.event } } as unknown as Stripe;
const request = { action: "payout", consent: true, amountCents: 1700 };
beforeEach(() => {
    vi.resetAllMocks(); schedule = { interval: "monthly", monthly_payout_days: [1] }; available = 1700; op = null; history = new Map();
    mocks.runtime.mockReturnValue({ mode: "sandbox", origin: "https://example.test" }); mocks.sdk.mockResolvedValue(stripe);
    mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user, email_confirmed_at: new Date().toISOString() } }, profile: { account_type: "job_seeker" } });
    mocks.snapshot.mockResolvedValue({status:"ready",hasPayoutMethod:true,payoutsEnabled:true,transfersActive:true,detailsSubmitted:true,requirementCount:0});
    mocks.record.mockResolvedValue({ userId: user, mode: "sandbox", accountRef, minorBinding: null }); mocks.beginSync.mockResolvedValue({ generation: 1, accountRef }); mocks.applySync.mockResolvedValue({ applied: true }); mocks.inspect.mockResolvedValue({ status: "ready", requirementCount:0, hasPayoutMethod: true, payoutsEnabled: true, transfersActive: true, detailsSubmitted: true });
    mocks.retrieveAccount.mockImplementation(async () => account()); mocks.updateAccount.mockImplementation(async (_ref, body) => ({ ...account(), metadata: body.metadata }));
    mocks.settings.mockImplementation(async () => settings()); mocks.updateSettings.mockImplementation(async body => { schedule = body.payments.payouts.schedule; return settings(); });
    mocks.balance.mockImplementation(async () => ({ object: "balance", livemode: false, available: [{ currency: "eur", amount: available, source_types: { card: available } }], pending: [{ currency: "eur", amount: 2300 }] }));
    mocks.banks.mockResolvedValue({ object: "list", data: [bank()], has_more: false }); mocks.listPayouts.mockResolvedValue({ object: "list", data: [], has_more: false }); mocks.retrievePayout.mockResolvedValue(payout());
    mocks.createPayout.mockImplementation(async () => { available = 0; return payout(); });
    mocks.rpc.mockImplementation(async (name, args) => {
        if (name === "pay_recipient_payout_attempt") return { data: history.get(args.p_operation_id) ?? (op?.operationId === args.p_operation_id ? op : null), error: null };
        if (name === "pay_recipient_payout_current" || name === "pay_recipient_payout_find") return { data: op, error: null };
        if (name === "pay_recipient_payout_lease") return { data: true, error: null };
        if (name === "pay_recipient_payout_begin") { op = operation({ operationId: args.p_operation_id, kind: args.p_kind, originalSchedule: args.p_original_schedule, targetSchedule: args.p_target_schedule, amountCents: args.p_amount_cents, sourceType: args.p_source_type, destinationRef: args.p_destination_ref }); history.set(String(op.operationId), op); return { data: op, error: null }; }
        if (name === "pay_recipient_payout_mark") { const previous = [...history.values()].find(row => row.id === args.p_id) ?? op!; const updated: Record<string, unknown> = { ...previous, state: args.p_state, restored: args.p_restored, payoutRef: args.p_payout_ref, payoutStatus: args.p_payout_status, arrivalAt: args.p_arrival_at, finished: args.p_restored && ["complete", "failed"].includes(args.p_state) }; history.set(String(updated.operationId), updated); if (op?.id === updated.id) op = updated; return { data: null, error: null }; }
        if (name === "pay_recipient_payout_recovery_list") return { data: op ? [op] : [], error: null };
        throw new Error(`unexpected RPC ${name}`);
    });
    vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", "offline-only-recovery-secret-at-least-32-chars"); vi.stubEnv("STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET", "whsec_offlineFixture");
});
describe("recipient payout schedule and balance", () => {
    it("reads the fresh actual schedule, balance and pending amount without changing Stripe", async () => {
        const value = await readRecipientPayoutSettings(user);
        expect(value).toMatchObject({ ownerId: user, availableCents: 1700, pendingCents: 2300, schedule: { interval: "monthly", monthlyDays: [1] }, canRequestPayout: true });
        expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.createPayout).not.toHaveBeenCalled();
        expect(mocks.applySync.mock.calls[0][1]).toMatch(/^payout-settings:/);
    });
    it("shows an existing daily schedule truthfully", async () => { schedule = { interval: "daily" }; expect((await readRecipientPayoutSettings(user)).schedule).toEqual({ interval: "daily" }); });
    it("does not offer payout for unavailable balances or mixed sources", async () => {
        available = 0; expect((await readRecipientPayoutSettings(user)).reasonCode).toBe("balance_not_available");
        mocks.balance.mockResolvedValue({ object: "balance", livemode: false, available: [{ currency: "eur", amount: 1700, source_types: { card: 1200, bank_account: 500 } }], pending: [] });
        expect((await readRecipientPayoutSettings(user)).reasonCode).toBe("multiple_payment_sources");
    });
    it.each(["owner", "mode", "not-ready", "unconfirmed", "foreign-bank", "incomplete-banks", "closed", "wrong-country"])("rejects %s before any mutation", async cause => {
        if (cause === "owner") mocks.record.mockResolvedValue({ userId: other, mode: "sandbox", accountRef });
        if (cause === "mode") mocks.retrieveAccount.mockResolvedValue({ ...account(), livemode: true });
        if (cause === "not-ready") mocks.inspect.mockResolvedValue({ status: "pending" });
        if (cause === "unconfirmed") mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user } }, profile: { account_type: "job_seeker" } });
        if (cause === "foreign-bank") mocks.banks.mockResolvedValue({ object: "list", data: [{ ...bank(), account: "acct_foreign" }], has_more: false });
        if (cause === "incomplete-banks") mocks.banks.mockResolvedValue({ object: "list", data: [bank()], has_more: true });
        if (cause === "closed") mocks.retrieveAccount.mockResolvedValue({ ...account(), closed: { applied: true } });
        if (cause === "wrong-country") mocks.retrieveAccount.mockResolvedValue({ ...account(), identity: { country: "US", entity_type: "individual" } });
        await expect(readRecipientPayoutSettings(user)).rejects.toThrow(); expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("rejects a changed recipient identity after a concurrent verification", async () => {
        mocks.applySync.mockResolvedValue({ applied: false });
        mocks.record.mockResolvedValueOnce({ userId: user, mode: "sandbox", accountRef, minorBinding: null }).mockResolvedValue({ userId: user, mode: "sandbox", accountRef:"acct_changed", minorBinding: null });
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_setup_changed" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("requires explicit confirmation and a valid date", async () => {
        await expect(changeRecipientPayoutSettings({ action: "schedule", monthlyDay: 1 }, nonce, user)).rejects.toMatchObject({ code: "explicit_consent_required" });
        await expect(changeRecipientPayoutSettings({ action: "schedule", monthlyDay: 32, consent: true }, nonce, user)).rejects.toMatchObject({ code: "invalid_request" });
        expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("saves a monthly day through a durable command before Stripe", async () => {
        const value = await changeRecipientPayoutSettings({ action: "schedule", monthlyDay: 15, consent: true }, nonce, user);
        expect(value.schedule).toEqual({ interval: "monthly", monthlyDays: [15] });
        const begin = mocks.rpc.mock.calls.find(call => call[0] === "pay_recipient_payout_begin")!;
        expect(begin[1]).toMatchObject({ p_operation_id: nonce, p_target_schedule: { interval: "monthly", monthlyDays: [15] } });
        expect(mocks.updateSettings.mock.calls[0]).toEqual([{ payments: { payouts: { schedule: { interval: "monthly", monthly_payout_days: [15] } } } }, { stripeAccount: accountRef, idempotencyKey: `workfare:payout-plan:${id}` }]);
    });
    it("lets an existing manually scheduled account explicitly choose automation", async () => { schedule = { interval: "manual" }; expect((await changeRecipientPayoutSettings({ action: "schedule", monthlyDay: 1, consent: true }, nonce, user)).schedule).toEqual({ interval: "monthly", monthlyDays: [1] }); });
});
describe("explicit standard payout", () => {
    it("does not start a manual payout when its recovery secret is absent", async () => {
        vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", "");
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_recovery_unavailable" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
        expect(mocks.rpc.mock.calls.some(call => call[0] === "pay_recipient_payout_begin")).toBe(false);
        expect((await readRecipientPayoutSettings(user)).schedule.interval).toBe("monthly");
        await changeRecipientPayoutSettings({ action: "schedule", consent: true, monthlyDay: 15 }, nonce, user);
        expect(mocks.updateSettings).toHaveBeenCalledOnce();
    });
    it("does not create a new payout for a pending replay after its recovery secret was removed", async () => {
        op = operation(); vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", "");
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_recovery_unavailable" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
        expect(op).toMatchObject({ finished: false, restored: true, state: "review_required" });
    });
    it("still resolves a completed exact replay read-only when recovery is not configured", async () => {
        op = operation({ finished: true, restored: true, state: "complete", payoutRef: "po_fixture", payoutStatus: "paid" });
        available = 0; vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", ""); mocks.retrievePayout.mockResolvedValue(payout({ status: "paid" }));
        expect((await changeRecipientPayoutSettings(request, nonce, user)).operation).toMatchObject({ operationId: nonce, replayed: true, payoutStatus: "paid" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("locks the durable command, pauses automation, pays exact amount and restores the plan", async () => {
        const value = await changeRecipientPayoutSettings(request, nonce, user);
        expect(value).toMatchObject({ availableCents: 0, schedule: { interval: "monthly", monthlyDays: [1] }, operation: { finished: true, payoutStatus: "pending" } });
        expect(mocks.updateSettings.mock.calls.map(call => call[0].payments.payouts.schedule.interval)).toEqual(["manual", "monthly"]);
        expect(mocks.createPayout).toHaveBeenCalledExactlyOnceWith({ amount: 1700, currency: "eur", destination: "ba_fixture", method: "standard", source_type: "card", metadata: { workfare_operation: id, workfare_user: user } }, { stripeAccount: accountRef, idempotencyKey: `workfare:payout:${id}` });
        expect(mocks.rpc.mock.calls.findIndex(call => call[0] === "pay_recipient_payout_begin")).toBeLessThan(mocks.rpc.mock.calls.findIndex(call => call[0] === "pay_recipient_payout_lease"));
    });
    it("restores automatic payouts on unknown API outcomes and retries the same operation", async () => {
        mocks.createPayout.mockRejectedValueOnce(new Error("connection lost after send"));
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toThrow("connection lost");
        expect(schedule).toEqual({ interval: "monthly", monthly_payout_days: [1] }); expect(op).toMatchObject({ state: "review_required", restored: true, finished: false });
        await changeRecipientPayoutSettings(request, "55555555-5555-4555-8555-555555555555", user);
        expect(mocks.createPayout.mock.calls[0][1]).toEqual(mocks.createPayout.mock.calls[1][1]);
        expect(mocks.rpc.mock.calls.filter(call => call[0] === "pay_recipient_payout_begin")).toHaveLength(1);
    });
    it("reconciles a returned payout instead of creating a second one", async () => {
        op = operation(); mocks.listPayouts.mockResolvedValue({ object: "list", data: [payout()], has_more: false });
        await changeRecipientPayoutSettings(request, nonce, user); expect(mocks.createPayout).not.toHaveBeenCalled(); expect(op).toMatchObject({ finished: true, payoutRef: "po_fixture" });
    });
    it("resolves an old completed payout after a second tab completed a newer command, even at zero available", async () => {
        const old = operation({ finished: true, restored: true, state: "complete", payoutRef: "po_fixture", payoutStatus: "pending" });
        history.set(nonce, old);
        op = operation({ id: "66666666-6666-4666-8666-666666666666", operationId: "77777777-7777-4777-8777-777777777777", kind: "schedule", amountCents: null, sourceType: null, destinationRef: null, targetSchedule: { interval: "monthly", monthlyDays: [15] }, state: "complete", restored: true, finished: true });
        available = 0; schedule = { interval: "monthly", monthly_payout_days: [15] };
        mocks.retrievePayout.mockResolvedValue(payout({ status: "paid" }));
        const result = await changeRecipientPayoutSettings(request, nonce, user);
        expect(result).toMatchObject({ availableCents: 0, schedule: { interval: "monthly", monthlyDays: [15] }, operation: { id, operationId: nonce, finished: true, payoutStatus: "paid", replayed: true } });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
        expect(mocks.rpc.mock.calls.filter(call => call[0] === "pay_recipient_payout_begin")).toHaveLength(0);
    });
    it("resolves an older completed date change without overwriting a newer chosen day", async () => {
        history.set(nonce, operation({ kind: "schedule", amountCents: null, sourceType: null, destinationRef: null, targetSchedule: { interval: "monthly", monthlyDays: [1] }, state: "complete", restored: true, finished: true }));
        op = operation({ id: "66666666-6666-4666-8666-666666666666", operationId: "77777777-7777-4777-8777-777777777777", kind: "schedule", amountCents: null, sourceType: null, destinationRef: null, targetSchedule: { interval: "monthly", monthlyDays: [15] }, state: "complete", restored: true, finished: true });
        schedule = { interval: "monthly", monthly_payout_days: [15] };
        const result = await changeRecipientPayoutSettings({ action: "schedule", consent: true, monthlyDay: 1 }, nonce, user);
        expect(result).toMatchObject({ schedule: { interval: "monthly", monthlyDays: [15] }, operation: { operationId: nonce, replayed: true } });
        expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("does not reuse a historical nonce with a different confirmed amount", async () => {
        history.set(nonce, operation({ finished: true, restored: true, state: "complete", payoutRef: "po_fixture", payoutStatus: "paid" }));
        await expect(changeRecipientPayoutSettings({ ...request, amountCents: 1800 }, nonce, user)).rejects.toMatchObject({ code: "RECIPIENT_PAYOUT_CONFLICT" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("does not retry a payout beyond the idempotency retention window", async () => {
        op = operation({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_review_required" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(op).toMatchObject({ finished: false, restored: true });
    });
    it("rejects a different amount returned by a racing durable claim", async () => {
        const original = mocks.rpc.getMockImplementation()!;
        mocks.rpc.mockImplementation(async (name, args) => name === "pay_recipient_payout_begin" ? { data: operation({ amountCents: 1000 }), error: null } : original(name, args));
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_in_progress" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("rejects a different monthly day returned by a racing durable claim", async () => {
        const original = mocks.rpc.getMockImplementation()!;
        mocks.rpc.mockImplementation(async (name, args) => name === "pay_recipient_payout_begin" ? { data: operation({ kind: "schedule", amountCents: null, sourceType: null, destinationRef: null, targetSchedule: { interval: "monthly", monthlyDays: [15] } }), error: null } : original(name, args));
        await expect(changeRecipientPayoutSettings({ action: "schedule", consent: true, monthlyDay: 1 }, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_in_progress" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("does not touch Stripe while another execution owns the lease", async () => {
        mocks.rpc.mockImplementation(async name => ({ data: name === "pay_recipient_payout_current" || name === "pay_recipient_payout_attempt" ? operation() : false, error: null }));
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_in_progress" }); expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
    });
    it("rejects a changed bank/balance after automation is paused and restores it", async () => {
        mocks.updateSettings.mockImplementation(async body => { schedule = body.payments.payouts.schedule; if (schedule.interval === "manual") available = 100; return settings(); });
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_balance_changed" });
        expect(mocks.createPayout).not.toHaveBeenCalled(); expect(schedule.interval).toBe("monthly"); expect(op).toMatchObject({ state: "failed", finished: true });
    });
    it.each([{ livemode: true }, { destination: "ba_other" }, { amount: 1800 }, { metadata: { workfare_operation: id, workfare_user: other } }])("does not trust an unexpected payout response %j", async patch => {
        mocks.createPayout.mockResolvedValue(payout(patch)); await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toThrow(); expect(schedule.interval).toBe("monthly"); expect(op).toMatchObject({ state: "review_required", finished: false });
    });
    it("keeps an unresolved restore durable for recovery", async () => {
        mocks.updateSettings.mockImplementation(async body => { if (body.payments.payouts.schedule.interval !== "manual") throw new Error("offline"); schedule = body.payments.payouts.schedule; return settings(); });
        await expect(changeRecipientPayoutSettings(request, nonce, user)).rejects.toMatchObject({ code: "recipient_payout_restore_pending" }); expect(op).toMatchObject({ restored: false, finished: false, payoutRef: "po_fixture" });
    });
});
describe("monthly default and read-only recovery", () => {
    it("initializes only new accounts with monthly day one, preserving owner and minor metadata", async () => {
        await initializeRecipientMonthlySchedule(stripe, user, accountRef, "sandbox");
        expect(mocks.updateAccount.mock.calls[0][1]).toMatchObject({ metadata: { ...metadata, workfare_pay_default_schedule: "monthly_1_v1" } });
        expect(mocks.updateSettings.mock.calls[0][1]).toEqual({ stripeAccount: accountRef, idempotencyKey: `workfare:initial-payout-schedule:${accountRef}` });
    });
    it("does not reset a marked account's chosen schedule", async () => { mocks.retrieveAccount.mockResolvedValue({ ...account(), metadata: { ...metadata, workfare_pay_default_schedule: "monthly_1_v1" } }); await initializeRecipientMonthlySchedule(stripe, user, accountRef, "sandbox"); expect(mocks.updateSettings).not.toHaveBeenCalled(); });
    it("uses identical initializer keys after an interrupted marker write", async () => { mocks.updateAccount.mockRejectedValueOnce(new Error("offline")); await expect(initializeRecipientMonthlySchedule(stripe, user, accountRef, "sandbox")).rejects.toThrow(); await initializeRecipientMonthlySchedule(stripe, user, accountRef, "sandbox"); expect(mocks.updateSettings.mock.calls[0]).toEqual(mocks.updateSettings.mock.calls[1]); expect(mocks.updateAccount.mock.calls[0]).toEqual(mocks.updateAccount.mock.calls[1]); });
    it("restores an orphaned manual schedule with no authenticated user or current guardian consent, without moving money", async () => {
        op = operation(); schedule = { interval: "manual" }; mocks.auth.mockResolvedValue({ state: "no-session" });
        expect(await recoverRecipientPayoutOperations()).toEqual({ ok: true, reconciled: 0, pending: 1 }); expect(schedule.interval).toBe("monthly"); expect(mocks.createPayout).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled(); expect(op).toMatchObject({ state: "review_required", restored: true });
    });
    it("does not restore a foreign actual account", async () => { op = operation(); schedule = { interval: "manual" }; mocks.retrieveAccount.mockResolvedValue({ ...account(), metadata: { ...metadata, workfare_pay_user: other } }); expect((await recoverRecipientPayoutOperations()).pending).toBe(1); expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.createPayout).not.toHaveBeenCalled(); });
    it("requires a scope-bound bearer token for background recovery", () => { const token = payoutRecoveryToken(); expect(token).toMatch(/^[a-f0-9]{64}$/); expect(() => assertPayoutRecoveryToken(`Bearer ${token}`)).not.toThrow(); expect(() => assertPayoutRecoveryToken(`Bearer ${"a".repeat(64)}`)).toThrow(); expect(() => assertPayoutRecoveryToken(null)).toThrow(); });
    it("reads the actual payout behind a signed event and leaves later schedules alone", async () => {
        op = operation({ finished: true, restored: true, state: "complete", payoutRef: "po_fixture", payoutStatus: "pending" });
        mocks.event.mockReturnValue({ livemode: false, type: "payout.failed", account: accountRef, data: { object: payout({ status: "paid" }) } }); mocks.retrievePayout.mockResolvedValue(payout({ status: "failed" }));
        await handleRecipientPayoutSnapshot("signed-body", "fixture-signature"); expect(mocks.rpc).toHaveBeenCalledWith("pay_recipient_payout_find", { p_account_ref: accountRef, p_operation_id: id }); expect(op).toMatchObject({ payoutStatus: "failed" }); expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.createPayout).not.toHaveBeenCalled();
    });
});

describe("concurrent harmless recipient observations", () => {
    it("accepts the latest ready state for an unchanged identity after another read wins the generation", async () => {
        mocks.applySync.mockResolvedValue({ applied: false });
        expect((await changeRecipientPayoutSettings({action:"schedule",monthlyDay:17,consent:true},nonce,user)).schedule).toEqual({interval:"monthly",monthlyDays:[17]});
        expect(mocks.createPayout).not.toHaveBeenCalled();
    });
    it("still refuses a newer genuinely restricted recipient state", async () => {
        mocks.applySync.mockResolvedValue({ applied: false }); mocks.snapshot.mockResolvedValue({status:"restricted",hasPayoutMethod:true,payoutsEnabled:false,transfersActive:true,detailsSubmitted:true,requirementCount:1});
        await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_required"});
        expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.createPayout).not.toHaveBeenCalled();
    });
});

describe("one bounded renewal for an in-flight observation",()=>{
 const ready={status:"ready",requirementCount:0,hasPayoutMethod:true,payoutsEnabled:true,transfersActive:true,detailsSubmitted:true};
 function race(){
  const original={id:"88888888-8888-4888-8888-888888888888",userId:user,mode:"sandbox",accountRef,generation:1,minorBinding:null};
  mocks.record.mockResolvedValueOnce(original).mockResolvedValueOnce({...original,generation:3}).mockResolvedValue({...original,generation:4});
  mocks.beginSync.mockResolvedValueOnce({generation:2,accountRef}).mockResolvedValue({generation:4,accountRef});
  mocks.applySync.mockResolvedValueOnce({applied:false}).mockResolvedValue({applied:true});
  mocks.snapshot.mockResolvedValue({...ready,status:"pending"});
  return original;
 }
 function noFinancialCalls(){expect(mocks.createPayout).not.toHaveBeenCalled();expect(mocks.updateSettings).not.toHaveBeenCalled();}
 it("saves the day on the first request after renewing and applying a second fresh Stripe inspection",async()=>{
  race();const result=await changeRecipientPayoutSettings({action:"schedule",monthlyDay:17,consent:true},nonce,user);
  expect(result.schedule).toEqual({interval:"monthly",monthlyDays:[17]});
  expect(mocks.inspect).toHaveBeenCalledTimes(3); // two before the write, one for its returned current projection
  expect(mocks.applySync.mock.invocationCallOrder[1]).toBeLessThan(mocks.updateSettings.mock.invocationCallOrder[0]);
  expect(mocks.inspect.mock.invocationCallOrder[1]).toBeLessThan(mocks.applySync.mock.invocationCallOrder[1]);
  expect(mocks.updateSettings).toHaveBeenCalledOnce();expect(mocks.createPayout).not.toHaveBeenCalled();
 });
 it("does not retry indefinitely if the second observation also loses its generation",async()=>{
  race();mocks.applySync.mockResolvedValue({applied:false});await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_changed"});
  expect(mocks.inspect).toHaveBeenCalledTimes(2);expect(mocks.beginSync).toHaveBeenCalledTimes(2);noFinancialCalls();
 });
 it("rejects a second fresh inspection that is no longer ready",async()=>{
  race();mocks.inspect.mockResolvedValueOnce(ready).mockResolvedValue({...ready,status:"pending",requirementCount:1,payoutsEnabled:false});
  await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_required"});noFinancialCalls();
 });
 it("requires zero current requirements even if a provider result incorrectly labels itself ready",async()=>{
  mocks.inspect.mockResolvedValue({...ready,requirementCount:1});await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_required"});noFinancialCalls();
 });
 it("refuses a changed owner after the second inspection",async()=>{
  const original=race();mocks.record.mockReset().mockResolvedValueOnce(original).mockResolvedValueOnce({...original,generation:3}).mockResolvedValue({...original,userId:other,generation:4});
  await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_changed"});noFinancialCalls();
 });
 it("refuses a changed consent without starting a second inspection",async()=>{
  const original=race();const binding={guardianId:other,consentId:nonce,childBirthdate:"2010-01-01",guardianBirthdate:"1980-01-01",guardianEmail:"parent@example.test",guardianName:"Parent Fixture"};
  mocks.record.mockReset().mockResolvedValueOnce({...original,minorBinding:binding}).mockResolvedValue({...original,generation:3,minorBinding:{...binding,consentId:id}});
  await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_changed"});expect(mocks.inspect).toHaveBeenCalledOnce();noFinancialCalls();
 });
 it("does not reinterpret a pending result at the same generation as a harmless concurrent begin",async()=>{
  const original=race();mocks.record.mockReset().mockResolvedValueOnce(original).mockResolvedValue({...original,generation:2});
  await expect(changeRecipientPayoutSettings(request,nonce,user)).rejects.toMatchObject({code:"recipient_setup_required"});expect(mocks.inspect).toHaveBeenCalledOnce();noFinancialCalls();
 });
});
