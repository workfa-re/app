import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), account: vi.fn(), funds: vi.fn(), payouts: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthState: mocks.auth }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/payments/recipient-repository.server", () => ({ getRecipientAccount: mocks.account }));
vi.mock("@/lib/payments/recipient-stripe.server", () => ({ createRecipientStripeAdapter: () => ({ readPayoutOverview: mocks.funds }) }));
vi.mock("stripe", () => ({ default: class { payouts = { list: mocks.payouts }; } }));
import { getRecipientPaymentSummary } from "@/lib/payments/recipient-summary.server";
import { parseRecipientEarningsSnapshot } from "@/lib/payments/recipient-summary-parser";
import { parseRecipientPayoutPage, parseRecipientPayoutPages, readRecipientPayoutHistory } from "@/lib/payments/recipient-summary-stripe.server";
import { GET } from "@/app/api/payments/recipient/summary/route";

const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", origin = "http://localhost:3001";
const now = "2026-10-24T10:00:00.000Z";
const db = () => ({ ownerId: user, kind: "sandbox", currency: "eur", checkedAt: now,
    earnings: { scope: "confirmed_workfare_payments", confirmedCents: 3000, refundedCents: 1000, underReviewCents: 2000, underReviewCount: 1, paidJobs: 2 },
    recentPayments: [{ id: user, applicationId: other, title: "Gartenarbeit", earningsCents: 1500, state: "paid", startsAt: now, updatedAt: now }] });
const payout = (extra = {}) => ({ id: "po_fixture", object: "payout", amount: 1000, currency: "eur", status: "paid", created: 1_792_800_000, arrival_date: 1_792_886_400, automatic: true, livemode: false, original_payout: null, reversed_by: null, ...extra });
const page = (data = [payout()], has_more = false) => ({ object: "list", data, has_more, url: "/v1/payouts" }) as Stripe.ApiList<Stripe.Payout>;
beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ WORKFARE_PAY_MODE: "sandbox", WORKFARE_PAY_RECIPIENT_SANDBOX: "enabled", STRIPE_SECRET_KEY: "sk_test_offlineFixture", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true", WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-recipient-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_URL: "http://127.0.0.1:55321", APP_ORIGIN: origin })) vi.stubEnv(key, value);
    mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user } }, profile: { account_type: "job_seeker", birthdate: "2006-01-01" } });
    mocks.rpc.mockResolvedValue({ data: db(), error: null });
    mocks.account.mockResolvedValue({ accountRef: "acct_fixture" });
    mocks.funds.mockResolvedValue({ kind: "sandbox", availableCents: 1200, pendingCents: 1800 });
    mocks.payouts.mockResolvedValue(page());
});
afterEach(() => vi.unstubAllEnvs());

describe("own recipient earnings and payout overview", () => {
    it("uses a zero-argument authenticated RPC and the private own-account mapping", async () => {
        const result = await getRecipientPaymentSummary();
        expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_my_recipient_payment_summary");
        expect(result).toMatchObject({ ownerId: user, earnings: { confirmedCents: 3000 }, funds: { availableCents: 1200 }, payouts: { paidOutCents: 1000, inTransitCents: 0, coverage: "complete" } });
        expect(mocks.account).toHaveBeenCalledWith(user, "sandbox");
        expect(mocks.funds).toHaveBeenCalledWith(user, "acct_fixture");
        expect(mocks.payouts).toHaveBeenCalledWith({ limit: 100 }, { stripeAccount: "acct_fixture" });
        expect(mocks.funds.mock.invocationCallOrder[0]).toBeLessThan(mocks.payouts.mock.invocationCallOrder[0]);
        expect(JSON.stringify(result)).not.toMatch(/acct_|bank_account|destination|last4|methodRef|intentRef/);
    });
    it("loads all four genuine own-account metrics for Home", async () => {
        expect(await getRecipientPaymentSummary("home")).toMatchObject({ ownerId: user, earnings: { confirmedCents: 3000 }, funds: { availableCents: 1200, pendingCents: 1800 }, payouts: { paidOutCents: 1000, coverage: "complete" }, fundsUnavailableReason: null });
        expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_my_recipient_payment_summary");
        expect(mocks.funds).toHaveBeenCalledExactlyOnceWith(user, "acct_fixture");
        expect(mocks.payouts).toHaveBeenCalledExactlyOnceWith({ limit: 100 }, { stripeAccount: "acct_fixture" });
    });
    it("does not let a cookie/session owner mismatch cross account headers", async () => {
        mocks.rpc.mockResolvedValue({ data: { ...db(), ownerId: other }, error: null });
        await expect(getRecipientPaymentSummary()).rejects.toMatchObject({ code: "recipient_summary_unavailable" });
        expect(mocks.account).not.toHaveBeenCalled();
    });
    it("lets a teenager read only their real Workfare statistics, without granting Stripe access", async () => {
        mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: user } }, profile: { account_type: "job_seeker", birthdate: "2010-01-01" } });
        expect(await getRecipientPaymentSummary()).toMatchObject({ earnings: { confirmedCents: 3000 }, funds: null, payouts: null, fundsUnavailableReason: "minor_review_required" });
        expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.payouts).not.toHaveBeenCalled();
    });
    it("keeps simulation balances absent rather than inventing zero money", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation"); mocks.rpc.mockResolvedValue({ data: { ...db(), kind: "local" }, error: null });
        expect(await getRecipientPaymentSummary()).toMatchObject({ kind: "local", funds: null, payouts: null, fundsUnavailableReason: "local_simulation" });
        expect(mocks.account).not.toHaveBeenCalled();
    });
    it("rejects database mode mismatch and all database failures before Stripe", async () => {
        mocks.rpc.mockResolvedValue({ data: { ...db(), kind: "local" }, error: null });
        await expect(getRecipientPaymentSummary()).rejects.toThrow();
        mocks.rpc.mockResolvedValue({ data: null, error: { message: "private query data" } });
        await expect(getRecipientPaymentSummary()).rejects.toThrow(); expect(mocks.account).not.toHaveBeenCalled();
    });
    it.each(["family-only", "incomplete-profile", "email-unconfirmed"])("rejects %s before financial reads", async state => {
        mocks.auth.mockResolvedValue({ state, session: { user: { id: user } }, profile: { account_type: "job_seeker" } });
        await expect(getRecipientPaymentSummary()).rejects.toMatchObject({ status: 403 }); expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("rejects unauthenticated and provider requests", async () => {
        mocks.auth.mockResolvedValue({ state: "no-session" }); await expect(getRecipientPaymentSummary()).rejects.toMatchObject({ status: 401 });
        mocks.auth.mockResolvedValue({ state: "ready", profile: { account_type: "job_provider" } }); await expect(getRecipientPaymentSummary()).rejects.toMatchObject({ status: 403 });
    });
    it("keeps missing recipients absent and never creates one", async () => {
        mocks.account.mockResolvedValue(null);
        expect(await getRecipientPaymentSummary()).toMatchObject({ funds: null, payouts: null, fundsUnavailableReason: "recipient_setup_required" }); expect(mocks.funds).not.toHaveBeenCalled();
    });
    it("keeps earnings but never substitutes a fake zero for a provider outage", async () => {
        mocks.funds.mockRejectedValue(new Error("private provider details"));
        const result = await getRecipientPaymentSummary();
        expect(result).toMatchObject({ funds: null, payouts: null, fundsUnavailableReason: "provider_unavailable" }); expect(mocks.payouts).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain("private provider");
    });
    it("preserves confirmed balances when only the payout history fails", async () => {
        mocks.payouts.mockRejectedValue(new Error("outage"));
        expect(await getRecipientPaymentSummary()).toMatchObject({ funds: { availableCents: 1200 }, payouts: null, fundsUnavailableReason: "provider_unavailable" });
    });
    it("sends only no-store own information and rejects caller target parameters", async () => {
        const response = await GET(new Request(`${origin}/api/payments/recipient/summary`));
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
        mocks.rpc.mockClear();
        expect((await GET(new Request(`${origin}/api/payments/recipient/summary?userId=${other}`))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("allows exactly the own Home context with the same confirmed financial totals", async () => {
        const response = await GET(new Request(`${origin}/api/payments/recipient/summary?view=home`));
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({ ownerId: user, funds: { availableCents: 1200 }, payouts: { paidOutCents: 1000 }, fundsUnavailableReason: null });
        expect(mocks.payouts).toHaveBeenCalledExactlyOnceWith({ limit: 100 }, { stripeAccount: "acct_fixture" });
    });
    it.each(["view=full", "view=unknown", "view=", "view=home&view=home", `view=home&userId=${other}`, "view=home&account=acct_other", "other=home"])("rejects unsupported or extended view input %s before financial reads", async query => {
        expect((await GET(new Request(`${origin}/api/payments/recipient/summary?${query}`))).status).toBe(400);
        expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.payouts).not.toHaveBeenCalled();
    });
    it.each([{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])("refuses cross-site reads %j", async headers => {
        expect((await GET(new Request(`${origin}/api/payments/recipient/summary`, { headers }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("refuses disabled/live modes before calling Auth", async () => {
        for (const mode of ["disabled", "live"]) {
            vi.stubEnv("WORKFARE_PAY_MODE", mode); expect((await GET(new Request(`${origin}/api/payments/recipient/summary`))).status).toBe(503);
        }
        expect(mocks.auth).not.toHaveBeenCalled();
    });
});

describe("bounded payout history", () => {
    it("follows verified cursors in the same account and totals successful payouts across pages", async () => {
        mocks.payouts.mockResolvedValueOnce(page([payout(), payout({ id: "po_usd", currency: "usd" })], true))
            .mockResolvedValueOnce(page([payout({ id: "po_second", amount: 2500 }), payout({ id: "po_pending", status: "in_transit", amount: 900 })]));
        expect(await readRecipientPayoutHistory("acct_fixture")).toMatchObject({ coverage: "complete", paidOutCents: 3500, inTransitCents: 900 });
        expect(mocks.payouts).toHaveBeenNthCalledWith(1, { limit: 100 }, { stripeAccount: "acct_fixture" });
        expect(mocks.payouts).toHaveBeenNthCalledWith(2, { limit: 100, starting_after: "po_usd" }, { stripeAccount: "acct_fixture" });
    });
    it("limits reads to ten pages and never presents an unfinished total", async () => {
        for (let index = 0; index < 10; index++) mocks.payouts.mockResolvedValueOnce(page([payout({ id: `po_page${index}` })], true));
        const result = await readRecipientPayoutHistory("acct_fixture");
        expect(result).toMatchObject({ coverage: "recent_only", paidOutCents: null, inTransitCents: null });
        expect(mocks.payouts).toHaveBeenCalledTimes(10);
        expect(result.recent).toHaveLength(10);
    });
    it("keeps the public recent list to ten while counting the whole verified history", async () => {
        mocks.payouts.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => payout({ id: `po_first${index}` })), true))
            .mockResolvedValueOnce(page([payout({ id: "po_last", amount: 700 })]));
        const result = await readRecipientPayoutHistory("acct_fixture");
        expect(result).toMatchObject({ coverage: "complete", paidOutCents: 100_700 });
        expect(result.recent).toHaveLength(10);
        expect(result.recent.some(row => row.id === "po_last")).toBe(false);
    });
    it("rejects duplicate rows and mode mismatches from a later page", async () => {
        mocks.payouts.mockResolvedValueOnce(page([payout()], true)).mockResolvedValueOnce(page([payout()]));
        await expect(readRecipientPayoutHistory("acct_fixture")).rejects.toThrow();
        mocks.payouts.mockResolvedValueOnce(page([payout()], true)).mockResolvedValueOnce(page([payout({ id: "po_later", livemode: true })]));
        await expect(readRecipientPayoutHistory("acct_fixture")).rejects.toThrow();
    });
    it("does not return a partial financial total after a later network failure", async () => {
        mocks.payouts.mockResolvedValueOnce(page([payout()], true)).mockRejectedValueOnce(new Error("timeout"));
        expect(await getRecipientPaymentSummary()).toMatchObject({ funds: { availableCents: 1200 }, payouts: null, fundsUnavailableReason: "provider_unavailable" });
    });
    it("rejects non-progressing cursors, pages after completion, and cross-page overflow", () => {
        expect(() => parseRecipientPayoutPages([page([], true)], now)).toThrow();
        expect(() => parseRecipientPayoutPages([page([]), page([])], now)).toThrow();
        expect(() => parseRecipientPayoutPages([page([payout({ amount: Number.MAX_SAFE_INTEGER })], true), page([payout({ id: "po_overflow" })])], now)).toThrow();
    });
    it("separates successful bank payouts, transfers in progress, canceled and failed amounts", () => {
        const result = parseRecipientPayoutPage(page([payout(), payout({ id: "po_pending", amount: 400, status: "pending" }), payout({ id: "po_transit", amount: 300, status: "in_transit" }), payout({ id: "po_failed", status: "failed" }), payout({ id: "po_canceled", status: "canceled" })]), now);
        expect(result).toMatchObject({ paidOutCents: 1000, inTransitCents: 700, coverage: "complete" });
        expect(result.recent).toHaveLength(5);
    });
    it("exposes null totals for incomplete pagination and limits the display to ten", () => {
        const data = Array.from({ length: 100 }, (_, index) => payout({ id: `po_fixture${index}` }));
        expect(parseRecipientPayoutPage(page(data, true), now)).toMatchObject({ paidOutCents: null, inTransitCents: null, coverage: "recent_only" });
        expect(parseRecipientPayoutPage(page(data, true), now).recent).toHaveLength(10);
    });
    it("uses only the actual EUR currency and empty verified histories may be zero", () => {
        expect(parseRecipientPayoutPage(page([payout({ currency: "usd" })]), now)).toMatchObject({ paidOutCents: 0, recent: [] });
        expect(parseRecipientPayoutPage(page([]), now)).toMatchObject({ paidOutCents: 0, inTransitCents: 0, coverage: "complete" });
    });
    it.each([{ livemode: true }, { amount: -1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { status: "invented" }, { original_payout: "po_original" }, { reversed_by: "po_reversal" }, { created: NaN }])("rejects unconfirmed payout evidence %j", change => {
        expect(() => parseRecipientPayoutPage(page([payout(change)]), now)).toThrow();
    });
    it("rejects duplicate provider IDs, oversized pages, and integer overflow", () => {
        expect(() => parseRecipientPayoutPage(page([payout(), payout()]), now)).toThrow();
        expect(() => parseRecipientPayoutPage(page(Array.from({ length: 101 }, (_, index) => payout({ id: `po_fixture${index}` }))), now)).toThrow();
        expect(() => parseRecipientPayoutPage(page([payout({ amount: Number.MAX_SAFE_INTEGER }), payout({ id: "po_extra" })]), now)).toThrow();
    });
});

describe("earnings snapshot allowlist", () => {
    it("does not pass through private/unexpected top-level or transaction fields", () => {
        const source = db();
        expect(JSON.stringify(parseRecipientEarningsSnapshot({ ...source, accountRef: "acct_private", recentPayments: [{ ...source.recentPayments[0], bankAccount: "private" }] }))).not.toMatch(/acct_|bankAccount/);
    });
    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null])("rejects invalid cents %s", value => {
        expect(() => parseRecipientEarningsSnapshot({ ...db(), earnings: { ...db().earnings, confirmedCents: value } })).toThrow();
    });
    it("bounds recent rows and requires a verified owner and ISO-compatible timestamps", () => {
        expect(() => parseRecipientEarningsSnapshot({ ...db(), ownerId: "other" })).toThrow();
        expect(() => parseRecipientEarningsSnapshot({ ...db(), recentPayments: Array(11).fill(db().recentPayments[0]) })).toThrow();
        expect(() => parseRecipientEarningsSnapshot({ ...db(), checkedAt: "invented" })).toThrow();
    });
});
