import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerRecord, SetupRecord } from "@/lib/payments/types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    claimPaymentCustomer: vi.fn(), savePaymentCustomer: vi.fn(), getPaymentCustomer: vi.fn(), createPaymentSetup: vi.fn(),
    attachPaymentSetupSession: vi.fn(), getPaymentSetup: vi.fn(), completePaymentSetup: vi.fn(), removePaymentMethod: vi.fn(),
    removePaymentMethodByReference: vi.fn(), confirmPaymentMethodDetached: vi.fn(), cancelPaymentSetup: vi.fn(),
    createCustomer: vi.fn(), createSetup: vi.fn(), createEmbeddedSetup: vi.fn(), inspectSetup: vi.fn(), detachMethod: vi.fn(), verifyWebhook: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthState: mocks.auth }));
vi.mock("@/lib/payments/repository.server", () => ({
    claimPaymentCustomer: mocks.claimPaymentCustomer, savePaymentCustomer: mocks.savePaymentCustomer, getPaymentCustomer: mocks.getPaymentCustomer,
    createPaymentSetup: mocks.createPaymentSetup, attachPaymentSetupSession: mocks.attachPaymentSetupSession, getPaymentSetup: mocks.getPaymentSetup,
    completePaymentSetup: mocks.completePaymentSetup, removePaymentMethod: mocks.removePaymentMethod,
    removePaymentMethodByReference: mocks.removePaymentMethodByReference, confirmPaymentMethodDetached: mocks.confirmPaymentMethodDetached, cancelPaymentSetup: mocks.cancelPaymentSetup,
}));
vi.mock("@/lib/payments/stripe-sandbox.server", () => ({ createStripeSandboxAdapter: () => ({
    createCustomer: mocks.createCustomer, createSetup: mocks.createSetup, createEmbeddedSetup: mocks.createEmbeddedSetup, inspectSetup: mocks.inspectSetup,
    detachMethod: mocks.detachMethod, verifyWebhook: mocks.verifyWebhook,
}) }));
import { finishLocalPaymentSetup, getPaymentSetupForUser, handlePaymentWebhook, removeBuyerPaymentMethod, retryBuyerPaymentMethodRemoval, startPaymentSetup, syncPaymentSetupReturn } from "@/lib/payments/service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const setupId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const operationId = "55555555-5555-4555-8555-555555555555";
const setup = (): SetupRecord => ({ id: setupId, userId, customerId, mode: "local_simulation", externalSessionId: null,
    returnTo: "/app-home/offers/new?resume=payment", status: "pending", consentVersion: "buyer-method-setup-v1", createdAt: "2026-10-24T00:00:00.000Z", expiresAt: "2035-01-01T00:00:00.000Z" });
const customer = (): CustomerRecord => ({ id: customerId, userId, mode: "local_simulation", stripeCustomerId: `local_cus_${userId}`, method: null });
const paymentMethod = { id: "pm_fixture", kind: "card" as const, brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2035 };
function sandbox() {
    vi.stubEnv("WORKFARE_PAY_MODE", "sandbox");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offlineFixture");
    mocks.getPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", externalSessionId: "cs_test_fixture" });
    mocks.getPaymentCustomer.mockResolvedValue({ ...customer(), mode: "sandbox", stripeCustomerId: "cus_fixture", method: paymentMethod });
    mocks.inspectSetup.mockResolvedValue({ status: "complete", method: paymentMethod });
}

function removalQueue(methodIds: string[], initialMethod: CustomerRecord["method"] = paymentMethod) {
    const queue = [...methodIds];
    let currentMethod = initialMethod;
    mocks.getPaymentCustomer.mockImplementation(async () => ({ ...customer(), mode: "sandbox", stripeCustomerId: "cus_fixture",
        method: currentMethod, pendingDetachMethodId: queue[0] ?? null }));
    mocks.removePaymentMethod.mockImplementation(async () => {
        if (currentMethod && !queue.includes(currentMethod.id)) queue.push(currentMethod.id);
        currentMethod = null;
    });
    mocks.confirmPaymentMethodDetached.mockImplementation(async (_userId, _mode, methodRef) => {
        const index = queue.indexOf(methodRef);
        if (index >= 0) queue.splice(index, 1);
    });
    return { queue, current: () => currentMethod };
}

beforeEach(() => {
    vi.resetAllMocks();
    const environment = { WORKFARE_PAY_MODE: "local_simulation", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
        WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: "http://127.0.0.1:3000" };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    mocks.auth.mockResolvedValue({ state: "ready", session: { user: { id: userId } }, profile: { account_type: "job_provider" } });
    mocks.claimPaymentCustomer.mockResolvedValue({ claimed: true, customerRef: null });
    mocks.createPaymentSetup.mockResolvedValue(setup());
    mocks.getPaymentSetup.mockResolvedValue(setup());
    mocks.getPaymentCustomer.mockResolvedValue(customer());
    mocks.createCustomer.mockResolvedValue("cus_fixture");
    mocks.createSetup.mockResolvedValue({ id: "cs_test_fixture", url: "https://checkout.stripe.com/c/pay/cs_test_fixture", expiresAt: "2035-01-01T00:00:00.000Z" });
    mocks.createEmbeddedSetup.mockResolvedValue({ id: "cs_test_fixture", status: "pending", clientSecret: "cs_test_fixture_secret_fixture", expiresAt: "2035-01-01T00:00:00.000Z" });
});
afterEach(() => vi.unstubAllEnvs());

describe("provider-owned payment setup service", () => {
    it("accepts the explicit supported card without changing legacy setup behavior", async () => {
        await startPaymentSetup({ consent: true, paymentMethod: "card", operationId });
        expect(mocks.createPaymentSetup).toHaveBeenCalledOnce();
    });

    it.each(["local_simulation", "sandbox"])("rejects SEPA before any customer/setup persistence or PSP call (%s)", async mode => {
        if (mode === "sandbox") sandbox();
        await expect(startPaymentSetup({ consent: true, paymentMethod: "sepa_debit", uiMode: "embedded" }))
            .rejects.toMatchObject({ code: "sepa_async_collection_unavailable", status: 409 });
        for (const mutation of [mocks.claimPaymentCustomer, mocks.savePaymentCustomer, mocks.createPaymentSetup, mocks.createCustomer, mocks.createSetup, mocks.createEmbeddedSetup])
            expect(mutation).not.toHaveBeenCalled();
    });

    it.each([null, "paypal", "automatic", {}, true])("rejects unknown setup methods before persistence (%j)", async paymentMethod => {
        await expect(startPaymentSetup({ consent: true, paymentMethod })).rejects.toMatchObject({ code: "invalid_payment_method" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it("persists explicit consent and starts a clearly separate local simulator without Stripe", async () => {
        expect(await startPaymentSetup({ consent: true, returnTo: setup().returnTo, operationId }))
            .toEqual({ url: `/app-home/settings/payments/setup?session_id=${setupId}` });
        expect(mocks.savePaymentCustomer).toHaveBeenCalledWith(userId, "local_simulation", operationId, `local_cus_${userId}`);
        expect(mocks.createPaymentSetup).toHaveBeenCalledWith(userId, "local_simulation", operationId, setup().returnTo, "buyer-method-setup-v1");
        expect(mocks.createCustomer).not.toHaveBeenCalled();
        expect(mocks.createSetup).not.toHaveBeenCalled();
    });

    it("starts the local simulator inline without a setup-page or PSP redirect", async () => {
        expect(await startPaymentSetup({ consent: true, uiMode: "embedded", returnTo: setup().returnTo, operationId }))
            .toEqual({ kind: "local", sessionId: setupId });
        expect(mocks.createPaymentSetup).toHaveBeenCalledWith(userId, "local_simulation", operationId, setup().returnTo, "buyer-method-setup-v1");
        expect(mocks.createEmbeddedSetup).not.toHaveBeenCalled();
    });

    it.each([null, "hosted", "elements", {}, true])("rejects unsupported setup surfaces before persistence (%j)", async (uiMode) => {
        await expect(startPaymentSetup({ consent: true, uiMode })).rejects.toMatchObject({ code: "invalid_setup_surface" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it("forwards only a supported requested theme to the embedded session", async () => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixtureOnly");
        await startPaymentSetup({ consent: true, uiMode: "embedded", theme: "dark" });
        expect(mocks.createEmbeddedSetup.mock.calls[0].at(-1)).toBe("dark");
        mocks.claimPaymentCustomer.mockClear();
        await expect(startPaymentSetup({ consent: true, uiMode: "embedded", theme: "blue" })).rejects.toMatchObject({ code: "invalid_setup_theme" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it("returns only the owner-bound embedded secret and public test key after storing its session", async () => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixtureOnly");
        mocks.createPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", externalSessionId: null });
        expect(await startPaymentSetup({ consent: true, uiMode: "embedded", operationId, returnTo: setup().returnTo }))
            .toEqual({ kind: "embedded", sessionId: setupId, clientSecret: "cs_test_fixture_secret_fixture", publishableKey: "pk_test_fixtureOnly" });
        expect(mocks.createEmbeddedSetup).toHaveBeenCalledWith("cus_fixture", userId, setupId, setup().returnTo, null, "light");
        expect(mocks.attachPaymentSetupSession).toHaveBeenCalledWith(setupId, "cs_test_fixture", "2035-01-01T00:00:00.000Z");
        expect(mocks.createSetup).not.toHaveBeenCalled();
    });

    it.each([undefined, "pk_live_fixtureOnly", "sk_test_private", "pk_test_", " pk_test_fixtureOnly", "pk_test_fixtureOnly\n"])
    ("rejects missing/live/malformed publishable keys before any customer mutation (%j)", async (key) => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", key);
        vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
        await expect(startPaymentSetup({ consent: true, uiMode: "embedded" })).rejects.toMatchObject({ code: "invalid_publishable_key" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
        expect(mocks.createEmbeddedSetup).not.toHaveBeenCalled();
    });

    it("can use the public environment key without returning any private credentials", async () => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", undefined);
        vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_publicFixture");
        const result = await startPaymentSetup({ consent: true, uiMode: "embedded" });
        expect(result).toHaveProperty("publishableKey", "pk_test_publicFixture");
        expect(JSON.stringify(result)).not.toContain("sk_test");
    });

    it("resumes the already attached session and verifies completed PSP operations before returning to the job", async () => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixtureOnly");
        mocks.createPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", externalSessionId: "cs_test_fixture" });
        mocks.createEmbeddedSetup.mockResolvedValue({ status: "complete", id: "cs_test_fixture", expiresAt: "2035-01-01T00:00:00.000Z" });
        expect(await startPaymentSetup({ consent: true, uiMode: "embedded", returnTo: setup().returnTo }))
            .toEqual({ kind: "complete", sessionId: setupId, returnTo: setup().returnTo });
        expect(mocks.createEmbeddedSetup).toHaveBeenCalledWith("cus_fixture", userId, setupId, setup().returnTo, "cs_test_fixture", "light");
        expect(mocks.inspectSetup).toHaveBeenCalledOnce();
        expect(mocks.completePaymentSetup).toHaveBeenCalledOnce();
    });

    it("does not treat an embedded completion callback as proof when provider inspection remains pending", async () => {
        sandbox();
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixtureOnly");
        mocks.createPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", externalSessionId: "cs_test_fixture" });
        mocks.createEmbeddedSetup.mockResolvedValue({ status: "complete", id: "cs_test_fixture", expiresAt: "2035-01-01T00:00:00.000Z" });
        mocks.inspectSetup.mockResolvedValue({ status: "pending" });
        await expect(startPaymentSetup({ consent: true, uiMode: "embedded" })).rejects.toMatchObject({ code: "setup_not_ready" });
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
    });

    it("returns completed local operations inline without a second setup screen", async () => {
        mocks.createPaymentSetup.mockResolvedValue({ ...setup(), status: "complete" });
        expect(await startPaymentSetup({ consent: true, uiMode: "embedded" }))
            .toEqual({ kind: "complete", sessionId: setupId, returnTo: setup().returnTo });
        expect(mocks.createEmbeddedSetup).not.toHaveBeenCalled();
    });

    it.each([undefined, false, "true", 1])("does not create a customer/session without explicit consent %j", async (consent) => {
        await expect(startPaymentSetup({ consent })).rejects.toMatchObject({ code: "explicit_consent_required" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it.each(["no-session", "email-unconfirmed", "incomplete-profile", "seeker", "guardian"])("rejects unauthenticated or non-provider setup (%s)", async (state) => {
        mocks.auth.mockResolvedValue({ state: ["seeker", "guardian"].includes(state) ? "ready" : state,
            session: { user: { id: userId } }, profile: { account_type: state === "seeker" ? "job_seeker" : null } });
        await expect(startPaymentSetup({ consent: true })).rejects.toThrow();
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it("fails closed before persistence when mode is disabled or the return path is untrusted", async () => {
        await expect(startPaymentSetup({ consent: true, returnTo: "https://evil.example" })).rejects.toMatchObject({ code: "invalid_return_path" });
        vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
        await expect(startPaymentSetup({ consent: true })).rejects.toMatchObject({ code: "payments_disabled" });
        expect(mocks.claimPaymentCustomer).not.toHaveBeenCalled();
    });

    it("does not duplicate a customer when another request owns the lease", async () => {
        sandbox();
        mocks.claimPaymentCustomer.mockResolvedValue({ claimed: false, customerRef: null });
        await expect(startPaymentSetup({ consent: true, operationId })).rejects.toMatchObject({ code: "setup_in_progress", status: 409 });
        expect(mocks.createCustomer).not.toHaveBeenCalled();
        expect(mocks.createPaymentSetup).not.toHaveBeenCalled();
    });

    it("reuses a previously persisted customer and passes stable session/idempotency references", async () => {
        sandbox();
        mocks.claimPaymentCustomer.mockResolvedValue({ claimed: false, customerRef: "cus_fixture" });
        await startPaymentSetup({ consent: true, operationId });
        expect(mocks.createCustomer).not.toHaveBeenCalled();
        expect(mocks.createSetup).toHaveBeenCalledWith("cus_fixture", userId, setupId, null);
        expect(mocks.attachPaymentSetupSession).toHaveBeenCalledWith(setupId, "cs_test_fixture", "2035-01-01T00:00:00.000Z");
    });

    it("uses one stable Stripe customer idempotency key across retried claims", async () => {
        sandbox();
        await startPaymentSetup({ consent: true, operationId });
        expect(mocks.createCustomer).toHaveBeenCalledWith(userId, `workfare-pay:customer:${userId}`);
        expect(mocks.savePaymentCustomer).toHaveBeenCalledWith(userId, "sandbox", operationId, "cus_fixture");
    });

    it("returns a completed operation to owner verification instead of creating another checkout", async () => {
        sandbox();
        mocks.createPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", status: "complete" });
        expect(await startPaymentSetup({ consent: true, operationId })).toEqual({ url: `/app-home/settings/payments?session_id=${setupId}` });
        expect(mocks.createSetup).not.toHaveBeenCalled();
    });

    it("blocks arbitrary or foreign session IDs before provider inspection", async () => {
        sandbox();
        await expect(syncPaymentSetupReturn(userId, "cs_test_someoneElse")).rejects.toMatchObject({ code: "setup_not_found" });
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), userId: otherUserId });
        await expect(syncPaymentSetupReturn(userId, setupId)).rejects.toMatchObject({ code: "setup_not_found" });
        await expect(syncPaymentSetupReturn(otherUserId, setupId)).rejects.toMatchObject({ code: "owner_mismatch" });
        expect(mocks.inspectSetup).not.toHaveBeenCalled();
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
    });

    it("synchronizes only verified complete Stripe objects into the persisted setup", async () => {
        sandbox();
        expect(await syncPaymentSetupReturn(userId, setupId)).toEqual({ status: "complete", returnTo: setup().returnTo });
        expect(mocks.inspectSetup).toHaveBeenCalledWith("cs_test_fixture", "cus_fixture", userId, setupId);
        expect(mocks.completePaymentSetup).toHaveBeenCalledWith(setupId, `return-sync:${setupId}`, "cus_fixture", paymentMethod);
    });

    it("does not convert a pending return or local query into success", async () => {
        expect(await syncPaymentSetupReturn(userId, setupId)).toEqual({ status: "pending", returnTo: setup().returnTo });
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
        sandbox();
        mocks.inspectSetup.mockResolvedValue({ status: "pending" });
        expect((await syncPaymentSetupReturn(userId, setupId)).status).toBe("pending");
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
    });

    it("exposes only a small owner-bound simulator projection", async () => {
        expect(await getPaymentSetupForUser(userId, setupId)).toEqual({ id: setupId, mode: "local_simulation", status: "pending", expiresAt: setup().expiresAt, returnTo: setup().returnTo });
    });

    it("blocks an expired simulator render on the server", async () => {
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), expiresAt: "2020-01-01T00:00:00.000Z" });
        await expect(getPaymentSetupForUser(userId, setupId)).rejects.toMatchObject({ code: "setup_expired_or_finished" });
    });
});

describe("local simulation completion and removal", () => {
    it("stores a simulated method without invented card data and returns an owner-checkable session", async () => {
        const result = await finishLocalPaymentSetup(setupId, "complete");
        expect(mocks.completePaymentSetup).toHaveBeenCalledWith(setupId, `local-complete:${setupId}`, `local_cus_${userId}`,
            { id: `local_pm_${setupId}`, kind: "simulated", brand: "simulation", last4: null, expiryMonth: null, expiryYear: null });
        expect(new URL(result.url, "http://localhost").searchParams.get("session_id")).toBe(setupId);
        expect(mocks.inspectSetup).not.toHaveBeenCalled();
    });

    it("cancels without completing a method, and handles replayed terminal outcomes idempotently", async () => {
        await finishLocalPaymentSetup(setupId, "cancel");
        expect(mocks.cancelPaymentSetup).toHaveBeenCalledWith(setupId, userId);
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
        mocks.cancelPaymentSetup.mockClear();
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), status: "canceled" });
        await finishLocalPaymentSetup(setupId, "cancel");
        expect(mocks.cancelPaymentSetup).not.toHaveBeenCalled();
        await expect(finishLocalPaymentSetup(setupId, "complete")).rejects.toThrow();
    });

    it("rejects expired or foreign simulations and refuses the local API in Stripe mode", async () => {
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), expiresAt: "2020-01-01T00:00:00.000Z" });
        await expect(finishLocalPaymentSetup(setupId, "complete")).rejects.toMatchObject({ code: "setup_expired_or_finished" });
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), userId: otherUserId });
        await expect(finishLocalPaymentSetup(setupId, "complete")).rejects.toMatchObject({ code: "setup_not_found" });
        sandbox();
        await expect(finishLocalPaymentSetup(setupId, "complete")).rejects.toMatchObject({ code: "local_simulation_required" });
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
    });

    it("withdraws readiness before Stripe detachment and can retry a persisted pending detach", async () => {
        sandbox();
        const state = removalQueue([]);
        mocks.detachMethod.mockRejectedValueOnce(new Error("temporary PSP failure with private details"));
        await expect(removeBuyerPaymentMethod()).rejects.toThrow();
        expect(mocks.removePaymentMethod.mock.invocationCallOrder[0]).toBeLessThan(mocks.detachMethod.mock.invocationCallOrder[0]);
        expect(mocks.confirmPaymentMethodDetached).not.toHaveBeenCalled();
        expect(state.queue).toEqual(["pm_fixture"]);
        mocks.removePaymentMethod.mockClear();
        expect(await retryBuyerPaymentMethodRemoval()).toEqual({ ok: true, pendingRemoval: false });
        expect(mocks.removePaymentMethod).not.toHaveBeenCalled();
        expect(mocks.detachMethod).toHaveBeenLastCalledWith("cus_fixture", "pm_fixture", userId, `workfare-pay:detach:${userId}:pm_fixture`);
        expect(mocks.confirmPaymentMethodDetached).toHaveBeenCalledWith(userId, "sandbox", "pm_fixture");
    });

    it("drains two earlier methods plus the removed current method in bounded order", async () => {
        sandbox();
        const state = removalQueue(["pm_old1", "pm_old2"]);
        expect(await removeBuyerPaymentMethod()).toEqual({ ok: true, pendingRemoval: false });
        expect(mocks.detachMethod.mock.calls.map((call) => call[1])).toEqual(["pm_old1", "pm_old2", "pm_fixture"]);
        expect(state.current()).toBeNull();
        expect(state.queue).toEqual([]);
    });

    it("retries old cleanup without withdrawing or detaching the newly verified current method", async () => {
        sandbox();
        const state = removalQueue(["pm_old1", "pm_old2"]);
        expect(await retryBuyerPaymentMethodRemoval()).toEqual({ ok: true, pendingRemoval: false });
        expect(mocks.detachMethod.mock.calls.map((call) => call[1])).toEqual(["pm_old1", "pm_old2"]);
        expect(mocks.removePaymentMethod).not.toHaveBeenCalled();
        expect(state.current()).toEqual(paymentMethod);
        expect(state.queue).toEqual([]);
    });

    it("limits each cleanup request to three provider calls and reports the remaining work", async () => {
        sandbox();
        const state = removalQueue(["pm_old1", "pm_old2", "pm_old3", "pm_old4", "pm_old5"]);
        expect(await retryBuyerPaymentMethodRemoval()).toEqual({ ok: true, pendingRemoval: true });
        expect(mocks.detachMethod).toHaveBeenCalledTimes(3);
        expect(state.queue).toEqual(["pm_old4", "pm_old5"]);
        expect(state.current()).toEqual(paymentMethod);
    });

    it("keeps a verified setup complete when old-method cleanup temporarily fails", async () => {
        sandbox();
        const state = removalQueue(["pm_old1", "pm_old2"]);
        mocks.detachMethod.mockRejectedValueOnce(new Error("temporary provider error"));
        expect(await syncPaymentSetupReturn(userId, setupId)).toEqual({ status: "complete", returnTo: setup().returnTo });
        expect(mocks.completePaymentSetup).toHaveBeenCalledOnce();
        expect(state.current()).toEqual(paymentMethod);
        expect(state.queue).toEqual(["pm_old1", "pm_old2"]);
    });

    it("rejects inconsistent queue state without detaching a current method", async () => {
        sandbox();
        removalQueue(["pm_fixture"]);
        await expect(retryBuyerPaymentMethodRemoval()).rejects.toMatchObject({ code: "payment_cleanup_conflict" });
        expect(mocks.detachMethod).not.toHaveBeenCalled();
        expect(mocks.removePaymentMethod).not.toHaveBeenCalled();
    });
});

describe("signed webhook application", () => {
    beforeEach(() => sandbox());

    it("reconciles a persisted checkout setup and relies on atomic event dedupe", async () => {
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_fixture", metadata: { workfare_pay_setup: setupId } } } });
        expect(await handlePaymentWebhook("raw", "signature")).toEqual({ received: true });
        expect(mocks.completePaymentSetup).toHaveBeenCalledWith(setupId, "evt_fixture", "cus_fixture", paymentMethod);
    });

    it("uses duplicate completion delivery to retry old cleanup without replacing the new current method", async () => {
        mocks.getPaymentSetup.mockResolvedValue({ ...setup(), mode: "sandbox", externalSessionId: "cs_test_fixture", status: "complete" });
        const state = removalQueue(["pm_old1", "pm_old2"]);
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_fixture", metadata: { workfare_pay_setup: setupId } } } });
        expect(await handlePaymentWebhook("raw", "signature")).toEqual({ received: true });
        expect(mocks.inspectSetup).not.toHaveBeenCalled();
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
        expect(mocks.detachMethod.mock.calls.map((call) => call[1])).toEqual(["pm_old1", "pm_old2"]);
        expect(state.current()).toEqual(paymentMethod);
    });

    it("ignores unknown/mismatched sessions and stale generations without reviving readiness", async () => {
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_other", metadata: { workfare_pay_setup: setupId } } } });
        await handlePaymentWebhook("raw", "signature");
        expect(mocks.inspectSetup).not.toHaveBeenCalled();
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_fixture", metadata: { workfare_pay_setup: setupId } } } });
        mocks.completePaymentSetup.mockRejectedValue(new PaymentFlowError("PAYMENT_SETUP_STALE", 409));
        expect(await handlePaymentWebhook("raw", "signature")).toEqual({ received: true });
    });

    it("never acknowledges an unpersisted transient failure as successful processing", async () => {
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_fixture", metadata: { workfare_pay_setup: setupId } } } });
        mocks.completePaymentSetup.mockRejectedValue(new Error("database temporarily unavailable"));
        await expect(handlePaymentWebhook("raw", "signature")).rejects.toThrow();
    });

    it("requests a webhook retry when the PSP has not yet exposed a complete setup", async () => {
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: "cs_test_fixture", metadata: { workfare_pay_setup: setupId } } } });
        mocks.inspectSetup.mockResolvedValue({ status: "pending" });
        await expect(handlePaymentWebhook("raw", "signature")).rejects.toMatchObject({ code: "setup_not_ready", status: 503 });
        expect(mocks.completePaymentSetup).not.toHaveBeenCalled();
    });

    it("removes only a currently persisted test method on a signed detach event", async () => {
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_detach", type: "payment_method.detached", data: { object: { id: "pm_fixture", livemode: false } } });
        await handlePaymentWebhook("raw", "signature");
        expect(mocks.removePaymentMethodByReference).toHaveBeenCalledWith("sandbox", "evt_detach", "pm_fixture");
        mocks.removePaymentMethodByReference.mockClear();
        mocks.verifyWebhook.mockResolvedValue({ id: "evt_detach", type: "payment_method.detached", data: { object: { id: "pm_fixture", livemode: true } } });
        await expect(handlePaymentWebhook("raw", "signature")).rejects.toThrow();
        expect(mocks.removePaymentMethodByReference).not.toHaveBeenCalled();
    });
});
