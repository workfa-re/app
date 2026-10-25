import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
    runtime: vi.fn(),
    rpc: vi.fn(),
    record: vi.fn(),
    sdk: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    mail: vi.fn(),
    reconcile: vi.fn(),
}));
vi.mock("@/lib/payments/runtime.server", async (original) => ({
    ...(await original<typeof import("@/lib/payments/runtime.server")>()),
    requirePaymentRuntime: m.runtime,
}));
vi.mock("@/lib/payments/stripe-mode.server", async (original) => ({
    ...(await original<typeof import("@/lib/payments/stripe-mode.server")>()),
    paymentStripeSdk: () => m.sdk,
}));
vi.mock("@/lib/payments/subscription-repository.server", () => ({ membershipRecord: m.record, membershipRpc: m.rpc }));
vi.mock("@/lib/payments/subscription-mail.server", () => ({ sendMembershipCancellationReceipt: m.mail }));
vi.mock("@/lib/payments/subscription-service.server", () => ({ reconcileMembershipAfterCancellation: m.reconcile }));
vi.mock("@/lib/demo/environment",()=>({requireDemoEnvironment:()=>({mode:"local"})}));
vi.mock("@/lib/supabase/admin",()=>({getSupabaseAdminClient:()=>({rpc:async(name:string,args:Record<string,unknown>)=>({data:await m.rpc(name,args),error:null})})}));
import {
    requestMembershipCancellation,
    recoverMembershipCancellations,
    membershipRecoveryToken,
    assertMembershipRecoveryToken,
} from "@/lib/payments/subscription-cancellation.server";
const owner = "11111111-1111-4111-8111-111111111111",
    id = "22222222-2222-4222-8222-222222222222",
    contract = "33333333-3333-4333-8333-333333333333";
let job: Record<string, unknown> | null, leased: boolean, sent: boolean, canceled: boolean;
const input = {
    contractReference: contract,
    email: "provider@fixture.invalid",
    name: "Fixture Provider",
    kind: "ordinary",
};
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN","http://127.0.0.1:3000");
    vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", "fixture-only-private-secret-long-enough-for-hmac");
    m.runtime.mockReturnValue({ mode: "sandbox", origin: "http://127.0.0.1:3000" });
    leased = false;
    sent = false;
    canceled = false;
    job = {
        id,
        userId: owner,
        mode: "sandbox",
        email: "provider@fixture.invalid",
        receivedAt: "2026-10-25T12:00:00Z",
        state: "pending",
        confirmedUntil: null,
        contractReference: contract,
        subscriptionRef: "sub_old",
        name: "Fixture Provider",
        kind: "ordinary",
        reason: null,
        requestedEnd: null,
        reviewRequired: false,
        receiptSentAt: null,
    };
    m.record.mockResolvedValue({
        userId: owner,
        mode: "sandbox",
        customerRef: "cus_fixture",
        subscriptionRef: "sub_old",
        contractReference: contract,
    });
    m.sdk.mockResolvedValue({ subscriptions: { retrieve: m.retrieve, update: m.update } });
    m.retrieve.mockImplementation(async () => ({
        id: "sub_old",
        customer: "cus_fixture",
        livemode: false,
        status: "active",
        cancel_at_period_end: canceled,
        items: { data: [{ current_period_end: 1795568400 }] },
    }));
    m.update.mockImplementation(async () => {
        canceled = true;
        return {};
    });
    m.mail.mockResolvedValue(undefined);
    m.reconcile.mockResolvedValue(undefined);
    m.rpc.mockImplementation(async (name, args) => {
        if (name === "pay_membership_cancellation_request")
            return { reference: id, receivedAt: "2026-10-25T12:00:00Z" };
        if (name === "pay_membership_cancellation_take") {
            if (!job || leased || sent) return null;
            leased = true;
            return { ...job };
        }
        if (name === "pay_membership_cancellation_complete") {
            job = { ...job, state: "complete", confirmedUntil: args.p_until };
            leased = false;
            if (args.p_mail_sent) sent = true;
            return null;
        }
        if (name === "pay_membership_cancellation_receipt") {
            job = { ...job, receiptSentAt: "2026-10-25T12:00:01Z" };
            leased = false;
            return null;
        }
        if (name === "pay_membership_cancellation_pending") return sent ? [] : [id];
        if (name === "pay_membership_cancellation_review_count") return job?.reviewRequired ? 1 : 0;
        throw new Error("unexpected fixture RPC");
    });
});
describe("public cancellation declaration", () => {
    it("accepts without login and confirms actual end in the receipt", async () => {
        expect(await requestMembershipCancellation(input, id, "192.0.2.1")).toEqual({
            received: true,
            reference: id,
            receivedAt: "2026-10-25T12:00:00Z",
        });
        expect(m.update).toHaveBeenCalledWith(
            "sub_old",
            { cancel_at_period_end: true },
            { idempotencyKey: `workfare:membership-public-cancel:${id}` },
        );
        expect(m.mail).toHaveBeenCalledTimes(1);
        expect(m.mail.mock.calls[0][4]).toMatchObject({
            confirmedUntil: new Date(1795568400 * 1000).toISOString(),
            reviewRequired: false,
        });
        expect(sent).toBe(true);
    });
    it("returns the same generic receipt for an unknown contract", async () => {
        job = null;
        const response = await requestMembershipCancellation(input, id, "192.0.2.2");
        expect(response).toEqual({ received: true, reference: id, receivedAt: "2026-10-25T12:00:00Z" });
        expect(m.update).not.toHaveBeenCalled();
        expect(m.mail).not.toHaveBeenCalled();
    });
    it("records declaration before API work and mails initial receipt on timeout", async () => {
        m.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
        expect((await requestMembershipCancellation(input, id, "192.0.2.3")).received).toBe(true);
        expect(m.rpc.mock.calls[0][0]).toBe("pay_membership_cancellation_request");
        expect(job?.state).toBe("pending");
        expect(m.mail.mock.calls[0][4]).toMatchObject({ confirmedUntil: null });
        expect(m.rpc.mock.calls.some((c) => c[0] === "pay_membership_cancellation_receipt")).toBe(true);
        expect(sent).toBe(false);
    });
    it("does not use an old contract to cancel a later subscription", async () => {
        m.record.mockResolvedValue({
            customerRef: "cus_fixture",
            subscriptionRef: "sub_new",
            contractReference: "44444444-4444-4444-8444-444444444444",
        });
        await requestMembershipCancellation(input, id, "192.0.2.4");
        expect(m.update.mock.calls[0][0]).toBe("sub_old");
        expect(m.reconcile).not.toHaveBeenCalled();
    });
    it("retains a failed email for worker retry without repeating cancellation", async () => {
        m.mail.mockRejectedValueOnce(new Error("SMTP unavailable"));
        await requestMembershipCancellation(input, id, "192.0.2.5");
        expect(canceled).toBe(true);
        expect(job?.state).toBe("complete");
        leased = false;
        const result = await recoverMembershipCancellations();
        expect(result).toMatchObject({ ok: true, complete: 1, pending: 0 });
        expect(m.update).toHaveBeenCalledTimes(1);
        expect(sent).toBe(true);
    });
    it("keeps extraordinary declaration and blocks further renewal without claiming a refund", async () => {
        job = { ...job, kind: "extraordinary", reviewRequired: true, reason: "Contract issue" };
        await requestMembershipCancellation(
            { ...input, kind: "extraordinary", reason: "Contract issue" },
            id,
            "192.0.2.6",
        );
        expect(m.update).toHaveBeenCalledTimes(1);
        expect(m.mail.mock.calls[0][4]).toMatchObject({ reviewRequired: true, kind: "extraordinary" });
    });
    it("accepts a withdrawal without a reason or a frontend time-window assertion", async () => {
        job = { ...job, kind: "withdrawal", reviewRequired: true };
        const response = await requestMembershipCancellation(
            { ...input, kind: "withdrawal", requestedEnd: null },
            id,
            "192.0.2.7",
        );
        expect(response.received).toBe(true);
        expect(m.mail.mock.calls[0][4]).toMatchObject({ kind: "withdrawal", reviewRequired: true });
        expect(m.update).toHaveBeenCalledTimes(1);
    });
    it("requires a name for withdrawal", async () => {
        await expect(
            requestMembershipCancellation({ ...input, kind: "withdrawal", name: "" }, id, "192.0.2.8"),
        ).rejects.toMatchObject({ code: "invalid_request" });
        expect(m.rpc).not.toHaveBeenCalled();
    });
    it("does not let a wrong actual Customer trigger cancellation", async () => {
        m.retrieve.mockResolvedValue({
            id: "sub_old",
            customer: "cus_foreign",
            livemode: false,
            status: "active",
            cancel_at_period_end: false,
            items: { data: [] },
        });
        await requestMembershipCancellation(input, id, "192.0.2.9");
        expect(m.update).not.toHaveBeenCalled();
        expect(job?.state).toBe("pending");
    });
    it.each([
        { email: "not-an-email" },
        { contractReference: "sub_not_a_contract_reference" },
        { requestedEnd: "2026-02-30" },
        { reason: "x".repeat(2001) },
    ])("validates declaration %#", async (patch) => {
        await expect(requestMembershipCancellation({ ...input, ...patch }, id, "192.0.2.10")).rejects.toMatchObject({
            code: "invalid_request",
        });
        expect(m.rpc).not.toHaveBeenCalled();
    });
    it("counts durable unresolved reviews even with no new queue jobs", async () => {
        sent = true;
        job = { ...job, reviewRequired: true };
        expect(await recoverMembershipCancellations()).toEqual({ ok: true, complete: 0, pending: 0, reviews: 1 });
    });
});
describe("declarations during a payment outage",()=>{
 it("persists and sends entry receipt with disabled payments and no Stripe key",async()=>{vi.stubEnv("APP_ORIGIN","https://app.workfa.re");vi.stubEnv("WORKFARE_PAY_LIVE_PROJECT_REF","abcdefghijklmnopqrst");vi.stubEnv("SUPABASE_URL","https://abcdefghijklmnopqrst.supabase.co");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://abcdefghijklmnopqrst.supabase.co");vi.stubEnv("WORKFARE_DEMO_ENABLED","false");vi.stubEnv("WORKFARE_PAY_MODE","disabled");vi.stubEnv("STRIPE_SECRET_KEY","");job={...job,mode:"live"};m.record.mockRejectedValue(new Error("payments disabled"));expect((await requestMembershipCancellation(input,id,"192.0.2.20")).received).toBe(true);expect(m.rpc.mock.calls[0][1].p_mode).toBe("live");expect(m.mail.mock.calls[0][4]).toMatchObject({phase:"received",confirmedUntil:null});expect(job?.state).toBe("pending");expect(m.sdk).not.toHaveBeenCalled();});
});
describe("private recovery authentication", () => {
    it("accepts only its own HMAC purpose", () => {
        const token = membershipRecoveryToken();
        expect(token).toMatch(/^[a-f0-9]{64}$/);
        expect(() => assertMembershipRecoveryToken(`Bearer ${token}`)).not.toThrow();
        expect(() => assertMembershipRecoveryToken(`Bearer ${"0".repeat(64)}`)).toThrow();
        expect(() => assertMembershipRecoveryToken(null)).toThrow();
    });
    it("fails closed without the private key", () => {
        vi.stubEnv("WORKFARE_PAY_HOSTED_STATE_SECRET", "");
        expect(() => membershipRecoveryToken()).toThrow();
    });
});

afterEach(()=>vi.unstubAllEnvs());
