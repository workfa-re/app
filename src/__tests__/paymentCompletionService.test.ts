import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentOrderOperation, PrivatePaymentOrder, VerifiedOrderState } from "@/lib/payments/order-types";

vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({
    auth: vi.fn(), create: vi.fn(), confirm: vi.fn(), get: vi.fn(), privateGet: vi.fn(),
    completion: vi.fn(), beginCompletion: vi.fn(), begin: vi.fn(), apply: vi.fn(),
    authorize: vi.fn(), inspect: vi.fn(), capture: vi.fn(), verify: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthState: mock.auth }));
vi.mock("@/lib/payments/order-repository.server", () => ({
    createPaymentOrder: mock.create, confirmPaymentOrder: mock.confirm,
    getPaymentOrder: mock.get, getPrivatePaymentOrder: mock.privateGet,
    getCompletionPaymentContext: mock.completion, beginCompletionPayment: mock.beginCompletion,
    beginPaymentOrderOperation: mock.begin, applyPaymentOrderState: mock.apply,
}));
vi.mock("@/lib/payments/order-stripe.server", () => ({
    createPaymentOrderStripeAdapter: () => ({
        authorize: mock.authorize, inspect: mock.inspect, capture: mock.capture, verifyWebhook: mock.verify,
    }),
}));

import {
    actOnAppointmentPayment, confirmAppointmentPayment, handlePaymentOrderWebhook,
    proposeAppointmentPayment, syncAppointmentPayment,
} from "@/lib/payments/order-service.server";
import { PaymentFlowError } from "@/lib/payments/runtime.server";
import { orderEnvironment, orderId, orderOperation, orderRecipient, orderUser, paymentOrder } from "./fixtures/paymentOrders";

const anotherRequest = "88888888-8888-4888-8888-888888888888";
let current: PrivatePaymentOrder;
let requested: boolean;
let processor: VerifiedOrderState;

function verified(state: VerifiedOrderState["state"]): VerifiedOrderState {
    return {
        state, intentRef: "pi_orderFixture", refundRef: null,
        captureBefore: state === "authorized" ? "2036-10-26T00:00:00.000Z" : null,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries(orderEnvironment)) vi.stubEnv(key, value);
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_publicFixture");
    // Completing work early is explicit: the planned appointment is still in the future.
    current = paymentOrder({ state: "ready", startsAt: "2035-10-25T23:00:00.000Z", intentRef: null });
    requested = false;
    processor = verified("authorization_pending");
    mock.auth.mockResolvedValue({ state: "ready", session: { user: { id: orderUser } }, profile: { account_type: "job_provider" } });
    mock.get.mockImplementation(async () => ({ ...current }));
    mock.privateGet.mockImplementation(async () => ({ ...current }));
    mock.completion.mockImplementation(async () => ({
        orderId, providerId: orderUser, requested, operationId: requested ? orderOperation : null,
    }));
    mock.beginCompletion.mockImplementation(async () => {
        const replay = requested;
        requested = true;
        const paymentAction = ["authorized", "capture_pending", "paid"].includes(current.state) ? "capture" : "authorize";
        if (current.state === "ready") current = { ...current, state: "authorization_pending" };
        if (current.state === "authorized") current = { ...current, state: "capture_pending" };
        return { ...current, paymentAction, replay, operationId: orderOperation };
    });
    mock.apply.mockImplementation(async (_orderId: string, _eventId: string, value: VerifiedOrderState) => {
        current = { ...current, ...value };
        return { ...current };
    });
    mock.create.mockImplementation(async () => {
        current = { ...current, state: "awaiting_confirmation", recipientConfirmedAt: null };
        return { ...current };
    });
    mock.confirm.mockImplementation(async () => {
        current = { ...current, state: "ready", recipientConfirmedAt: "2026-10-25T20:00:00.000Z" };
        return { ...current };
    });
    mock.authorize.mockResolvedValue({ intentRef: "pi_orderFixture", clientSecret: "pi_orderFixture_secret_fixture" });
    mock.inspect.mockImplementation(async () => ({ ...processor }));
    mock.capture.mockImplementation(async () => {
        processor = verified("paid");
        return { ...processor };
    });
    mock.verify.mockResolvedValue({
        id: "evt_completionFixture", type: "payment_intent.amount_capturable_updated",
        data: { object: { id: "pi_orderFixture", object: "payment_intent", metadata: {
            workfare_pay_order: orderId, workfare_pay_provider: orderUser,
        } } },
    });
});
afterEach(() => vi.unstubAllEnvs());

describe("one explicit payment after completed work", () => {
    it("proposes and confirms a price without creating payment consent or charging", async () => {
        await proposeAppointmentPayment({
            appointmentId: current.appointmentId, appointmentVersion: current.appointmentVersion,
            quoteFeePolicy: "test-service-5-v1", consent: true, operationId: orderOperation,
        });
        mock.auth.mockResolvedValue({ state: "ready", session: { user: { id: orderRecipient } }, profile: { account_type: "job_seeker" } });
        expect((await confirmAppointmentPayment(orderId, { termsVersion: "appointment-price-v1", consent: true })).order.state).toBe("ready");
        expect(mock.confirm).toHaveBeenCalledWith(orderRecipient, orderId, "appointment-price-v1");
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(requested).toBe(false);
    });

    it("accepts an explicit completed-work payment before the planned start and returns card confirmation", async () => {
        const response = await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest });
        expect(response).toMatchObject({
            kind: "confirmation", clientSecret: "pi_orderFixture_secret_fixture", publishableKey: "pk_test_publicFixture",
            order: { state: "authorization_pending", startsAt: "2035-10-25T23:00:00.000Z" },
        });
        expect(mock.beginCompletion).toHaveBeenCalledWith(orderUser, orderId, anotherRequest);
        expect(mock.authorize).toHaveBeenCalledWith(expect.objectContaining({ id: orderId }), orderOperation);
        expect(requested).toBe(true);
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.begin).not.toHaveBeenCalled();
    });

    it("completes the persisted payment after fresh SCA reconciliation with the same operation", async () => {
        await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest });
        processor = verified("authorized");
        expect((await syncAppointmentPayment(orderId)).order.state).toBe("paid");
        expect(mock.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            id: orderId, state: "capture_pending", intentRef: "pi_orderFixture", operationId: orderOperation,
        }), orderOperation);
        expect(mock.apply).toHaveBeenLastCalledWith(orderId, `order-completion:${orderOperation}:paid`, verified("paid"));
        await syncAppointmentPayment(orderId);
        expect(mock.authorize).toHaveBeenCalledOnce();
        expect(mock.capture).toHaveBeenCalledOnce();
    });

    it("also finishes the payer's persisted request when the recipient refreshes its state", async () => {
        await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation });
        processor = verified("authorized");
        mock.auth.mockResolvedValue({ state: "ready", session: { user: { id: orderRecipient } }, profile: { account_type: "job_seeker" } });
        expect((await syncAppointmentPayment(orderId)).order.state).toBe("paid");
        expect(mock.completion).toHaveBeenCalledWith(orderRecipient, orderId);
        expect(mock.beginCompletion).toHaveBeenLastCalledWith(orderUser, orderId, orderOperation);
        expect(mock.capture).toHaveBeenCalledOnce();
    });

    it("continues an explicitly requested payment through a verified webhook, then ignores the settled replay", async () => {
        await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation });
        processor = verified("authorized");
        expect(await handlePaymentOrderWebhook("fixture payload", "fixture signature")).toEqual({ received: true });
        expect(current.state).toBe("paid");
        expect(mock.capture).toHaveBeenCalledOnce();
        await handlePaymentOrderWebhook("fixture payload", "fixture signature");
        expect(mock.capture).toHaveBeenCalledOnce();
        expect(mock.authorize).toHaveBeenCalledOnce();
    });

    it.each(["sync", "webhook"] as const)("never captures an old pre-work card hold during %s without completion consent", async source => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        processor = verified("authorized");
        if (source === "sync") expect((await syncAppointmentPayment(orderId)).order.state).toBe("authorized");
        else await handlePaymentOrderWebhook("fixture payload", "fixture signature");
        expect(current.state).toBe("authorized");
        expect(requested).toBe(false);
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it.each(["PAYMENT_ORDER_RECIPIENT_REQUIRED", "PAYMENT_ORDER_TERMS_CHANGED"])("acknowledges a reconciled background event blocked by %s without capturing", async code => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        mock.beginCompletion.mockRejectedValue(new PaymentFlowError(code, 409));
        expect(await handlePaymentOrderWebhook("fixture payload", "fixture signature")).toEqual({ received: true });
        expect(mock.apply).toHaveBeenCalledWith(orderId, "evt_completionFixture", verified("authorized"));
        expect(current.state).toBe("authorized");
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it.each(["PAYMENT_ORDER_RECIPIENT_REQUIRED", "PAYMENT_ORDER_TERMS_CHANGED"])("surfaces %s to an explicit refresh and payment attempt", async code => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        mock.beginCompletion.mockRejectedValue(new PaymentFlowError(code, 409));
        await expect(syncAppointmentPayment(orderId)).rejects.toMatchObject({ code });
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }))
            .rejects.toMatchObject({ code });
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("preserves retryable infrastructure failures during background completion", async () => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        mock.beginCompletion.mockRejectedValue(new PaymentFlowError("payment_order_unavailable", 503));
        await expect(handlePaymentOrderWebhook("fixture payload", "fixture signature"))
            .rejects.toMatchObject({ code: "payment_order_unavailable", status: 503 });
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it("reuses an existing authorized hold only after a new explicit completed-work payment", async () => {
        current = { ...current, state: "authorized", intentRef: "pi_orderFixture", captureBefore: "2036-10-26T00:00:00.000Z" };
        processor = verified("authorized");
        const response = await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest });
        expect(response).toMatchObject({ kind: "state", order: { state: "paid" } });
        expect(mock.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: orderId }), orderOperation);
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("reconciles an interrupted authorization before resuming, without creating another intent", async () => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        expect(await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }))
            .toMatchObject({ kind: "state", order: { state: "paid" } });
        expect(mock.inspect).toHaveBeenCalledOnce();
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ intentRef: "pi_orderFixture" }), orderOperation);
    });

    it("keeps a processing payment pending instead of presenting it as paid", async () => {
        current = { ...current, state: "capture_pending", intentRef: "pi_orderFixture" };
        requested = true;
        mock.capture.mockResolvedValue(verified("capture_pending"));
        const response = await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest });
        expect(response.order.state).toBe("capture_pending");
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.capture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ intentRef: "pi_orderFixture" }), orderOperation);
    });

    it.each(["pay", "sync"] as const)("keeps %s pending while a captured charge's fee evidence is not visible", async source => {
        current = { ...current, state: "authorized", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        mock.capture.mockImplementationOnce(async () => {
            processor = verified("paid");
            throw new PaymentFlowError("payment_order_fee_evidence_pending", 503);
        });
        const response = source === "pay"
            ? await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest })
            : await syncAppointmentPayment(orderId);
        expect(response.order.state).toBe("capture_pending");
        expect(current.state).toBe("capture_pending");
        expect(mock.capture).toHaveBeenCalledOnce();
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.apply.mock.calls.some(call => ["paid", "failed"].includes(call[2].state))).toBe(false);
        expect((await syncAppointmentPayment(orderId)).order.state).toBe("paid");
        expect(mock.capture).toHaveBeenCalledOnce();
    });

    it("keeps incomplete post-capture fee evidence retryable for a background webhook", async () => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        processor = verified("authorized");
        mock.capture.mockImplementationOnce(async () => {
            processor = verified("paid");
            throw new PaymentFlowError("payment_order_fee_evidence_pending", 503);
        });
        await expect(handlePaymentOrderWebhook("fixture payload", "fixture signature"))
            .rejects.toMatchObject({ code: "payment_order_fee_evidence_pending", status: 503 });
        expect(current.state).toBe("capture_pending");
        expect(mock.apply.mock.calls.some(call => ["paid", "failed"].includes(call[2].state))).toBe(false);
        expect(await handlePaymentOrderWebhook("fixture payload", "fixture signature")).toEqual({ received: true });
        expect(current.state).toBe("paid");
        expect(mock.capture).toHaveBeenCalledOnce();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("keeps the saved capture pending when a foreground inspect is still missing fee evidence", async () => {
        current = { ...current, state: "capture_pending", intentRef: "pi_orderFixture" };
        requested = true;
        mock.inspect.mockRejectedValueOnce(new PaymentFlowError("payment_order_fee_evidence_pending", 503));
        expect((await syncAppointmentPayment(orderId)).order.state).toBe("capture_pending");
        expect(mock.apply).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
        processor = verified("paid");
        expect((await syncAppointmentPayment(orderId)).order.state).toBe("paid");
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it("returns only the saved state when an explicit payment resume cannot inspect complete fee evidence", async () => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        mock.inspect.mockRejectedValueOnce(new PaymentFlowError("payment_order_fee_evidence_pending", 503));
        expect(await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }))
            .toMatchObject({ kind: "state", order: { state: "authorization_pending" } });
        expect(mock.apply).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("does not acknowledge a background inspect while fee evidence is missing", async () => {
        current = { ...current, state: "capture_pending", intentRef: "pi_orderFixture" };
        requested = true;
        mock.inspect.mockRejectedValueOnce(new PaymentFlowError("payment_order_fee_evidence_pending", 503));
        await expect(handlePaymentOrderWebhook("fixture payload", "fixture signature"))
            .rejects.toMatchObject({ code: "payment_order_fee_evidence_pending", status: 503 });
        expect(mock.apply).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it.each(["pay", "sync"] as const)("does not hide a generic processor inspection error during %s", async source => {
        current = { ...current, state: "authorization_pending", intentRef: "pi_orderFixture" };
        requested = true;
        mock.inspect.mockRejectedValueOnce(new PaymentFlowError("payment_order_object_mismatch", 409));
        const action = source === "pay" ? actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }) : syncAppointmentPayment(orderId);
        await expect(action).rejects.toMatchObject({ code: "payment_order_object_mismatch" });
        expect(mock.apply).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("retries an uncertain capture with its persisted operation and existing intent", async () => {
        current = { ...current, state: "authorized", intentRef: "pi_orderFixture" };
        requested = true;
        mock.capture.mockRejectedValueOnce(new PaymentFlowError("stripe_unavailable", 503));
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }))
            .rejects.toMatchObject({ code: "stripe_unavailable" });
        expect(current.state).toBe("capture_pending");
        expect((await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest })).order.state).toBe("paid");
        expect(mock.capture).toHaveBeenCalledTimes(2);
        for (const [operation, key] of mock.capture.mock.calls as [PaymentOrderOperation, string][]) {
            expect(operation.intentRef).toBe("pi_orderFixture");
            expect(key).toBe(orderOperation);
        }
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("retries uncertain intent creation with the original database operation", async () => {
        mock.authorize.mockRejectedValueOnce(new PaymentFlowError("stripe_unavailable", 503));
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest }))
            .rejects.toMatchObject({ code: "stripe_unavailable" });
        expect((await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest })).kind).toBe("confirmation");
        expect(mock.authorize).toHaveBeenCalledTimes(2);
        expect(mock.authorize.mock.calls.map(call => call[1])).toEqual([orderOperation, orderOperation]);
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it.each(["paid", "refunded", "review_required", "canceled", "failed"] as const)("returns an existing %s state without another processor action", async state => {
        current = { ...current, state, intentRef: "pi_orderFixture" };
        requested = true;
        expect((await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: anotherRequest })).order.state).toBe(state);
        expect(mock.inspect).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it.each(["PAYMENT_ORDER_NOT_CONFIRMED", "PAYMENT_ORDER_TERMS_CHANGED", "PAYMENT_ORDER_IN_PROGRESS"])("honors the database's %s guard before contacting Stripe", async code => {
        mock.beginCompletion.mockRejectedValue(new PaymentFlowError(code, 409));
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation })).rejects.toMatchObject({ code });
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
        expect(mock.apply).not.toHaveBeenCalled();
    });

    it.each([false, undefined, "true", 1])("requires the payer's explicit consent (%j)", async consent => {
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent, operationId: orderOperation }))
            .rejects.toMatchObject({ code: "explicit_consent_required" });
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("prevents a recipient from initiating the payer's financial action", async () => {
        mock.auth.mockResolvedValue({ state: "ready", session: { user: { id: orderRecipient } }, profile: { account_type: "job_seeker" } });
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation }))
            .rejects.toMatchObject({ code: "payment_order_account_required", status: 403 });
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it("validates an explicit operation id before allocating the payment", async () => {
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: "client-price" }))
            .rejects.toMatchObject({ code: "invalid_operation_id" });
        expect(mock.beginCompletion).not.toHaveBeenCalled();
    });

    it("validates the publishable key before creating an authorization", async () => {
        vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "invalid_public_fixture");
        await expect(actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation }))
            .rejects.toMatchObject({ code: "invalid_publishable_key" });
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.authorize).not.toHaveBeenCalled();
    });

    it("rejects a persisted request associated with another payer before capture", async () => {
        current = { ...current, state: "authorized", intentRef: "pi_orderFixture" };
        processor = verified("authorized");
        mock.completion.mockResolvedValue({ orderId, providerId: orderRecipient, requested: true, operationId: orderOperation });
        await expect(syncAppointmentPayment(orderId)).rejects.toMatchObject({ code: "payment_order_object_mismatch" });
        expect(mock.beginCompletion).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
    });

    it("simulates an explicitly requested completion without initializing a real processor action", async () => {
        vi.stubEnv("WORKFARE_PAY_MODE", "local_simulation");
        current = { ...current, mode: "local_simulation" };
        expect((await actOnAppointmentPayment(orderId, { action: "pay", consent: true, operationId: orderOperation })).order.state).toBe("paid");
        expect(mock.authorize).not.toHaveBeenCalled();
        expect(mock.inspect).not.toHaveBeenCalled();
        expect(mock.capture).not.toHaveBeenCalled();
    });
});
