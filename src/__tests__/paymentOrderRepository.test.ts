import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: api.rpc }) }));
import { getPaymentOrder, getPrivatePaymentOrder, listPaymentOrders, readPaymentOrderOverview, createPaymentOrder, beginPaymentOrderOperation } from "@/lib/payments/order-repository.server";
import { quoteTestServiceFee, TEST_SERVICE_FEE_POLICY } from "@/lib/payments/tariff";
import { paymentOrder, orderEnvironment, orderUser, orderId, orderOperation } from "./fixtures/paymentOrders";

const withFee = () => paymentOrder({ feePolicy: TEST_SERVICE_FEE_POLICY, feeTariff: quoteTestServiceFee(3000), serviceFeeCents: 150, totalCents: 3150 });
beforeEach(() => {
    vi.resetAllMocks(); for (const [key, value] of Object.entries(orderEnvironment)) vi.stubEnv(key, value);
    api.rpc.mockResolvedValue({ data: withFee(), error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("strict payment repository projections", () => {
    it("returns exact immutable fee/VAT cents and strips all private/unknown fields from public getters", async () => {
        api.rpc.mockResolvedValue({ data: { ...withFee(), clientSecret: "never_expose", foreignField: "never_expose" }, error: null });
        const result = await getPaymentOrder(orderUser, orderId);
        expect(result).toMatchObject({ earningsCents: 3000, serviceFeeCents: 150, totalCents: 3150, feeTariff: { taxCents: 24, netCents: 126 } });
        for (const field of ["customerRef", "methodRef", "accountRef", "intentRef", "refundRef", "revision", "clientSecret", "foreignField"]) expect(result).not.toHaveProperty(field);
        expect(api.rpc).toHaveBeenCalledWith("pay_order_get", { p_user_id: orderUser, p_order_id: orderId, p_private: false });
    });
    it("normalizes old zero-fee projections without changing their amounts", async () => {
        api.rpc.mockResolvedValue({ data: paymentOrder(), error: null });
        expect(await getPaymentOrder(orderUser, orderId)).toMatchObject({ serviceFeeCents: 0, totalCents: 3000, feePolicy: "local-zero-fee-v1", feeTariff: null });
    });
    it.each([{ serviceFeeCents: 149 }, { totalCents: 3149 }, { feeTariff: null }, { feePolicy: "not-approved" }, { currency: "usd" }, { bankPayoutConfirmed: true }, { livePaymentsEnabled: true }, { refundedCents: 150 }])
    ("rejects inconsistent/forged financial evidence before any order is returned (%j)", async patch => {
        api.rpc.mockResolvedValue({ data: { ...withFee(), ...patch }, error: null });
        await expect(getPaymentOrder(orderUser, orderId)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
    it("checks every list entry and does not return a partial seemingly valid list", async () => {
        api.rpc.mockResolvedValue({ data: [withFee(), { ...withFee(), totalCents: 1 }], error: null });
        await expect(listPaymentOrders(orderUser, paymentOrder().applicationId)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
    it.each(["local-zero-fee-v1", TEST_SERVICE_FEE_POLICY])("reads the current proposal tariff and orders in exactly one owner-bound roundtrip (%s)", async quoteFeePolicy => {
        api.rpc.mockResolvedValue({ data: { orders: [], quoteFeePolicy, privateSetting: "never_expose" }, error: null });
        expect(await readPaymentOrderOverview(orderUser, paymentOrder().applicationId)).toEqual({ orders: [], quoteFeePolicy });
        expect(api.rpc).toHaveBeenCalledExactlyOnceWith("pay_order_overview", { p_user_id: orderUser, p_application_id: paymentOrder().applicationId });
    });
    it.each([undefined, null, "unknown-tariff", 500, ["test-service-5-v1"]])("rejects an unavailable or unrecognized current proposal tariff (%j)", async quoteFeePolicy => {
        api.rpc.mockResolvedValue({ data: { orders: [withFee()], quoteFeePolicy }, error: null });
        await expect(readPaymentOrderOverview(orderUser, paymentOrder().applicationId)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
    it("validates historical order quotes independently of the current proposal tariff", async () => {
        api.rpc.mockResolvedValue({ data: { orders: [paymentOrder(), withFee()], quoteFeePolicy: "local-zero-fee-v1" }, error: null });
        const result = await readPaymentOrderOverview(orderUser, paymentOrder().applicationId);
        expect(result.quoteFeePolicy).toBe("local-zero-fee-v1");
        expect(result.orders.map(order => order.serviceFeeCents)).toEqual([0, 150]);
        api.rpc.mockResolvedValue({ data: { orders: [withFee(), { ...withFee(), totalCents: 1 }], quoteFeePolicy: TEST_SERVICE_FEE_POLICY }, error: null });
        await expect(readPaymentOrderOverview(orderUser, paymentOrder().applicationId)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
    it("sends the displayed policy only to the tariff-bound create RPC", async () => {
        await createPaymentOrder(orderUser, orderOperation, withFee().appointmentId, withFee().appointmentVersion, null, TEST_SERVICE_FEE_POLICY);
        expect(api.rpc).toHaveBeenCalledExactlyOnceWith("pay_order_create_for_tariff", { p_user_id: orderUser, p_mode: "sandbox", p_operation_id: orderOperation,
            p_appointment_id: withFee().appointmentId, p_appointment_version: withFee().appointmentVersion, p_planned_minutes: null, p_quote_fee_policy: TEST_SERVICE_FEE_POLICY });
    });
    it("keeps private exact PSP references separate and refuses another mode's references", async () => {
        expect(await getPrivatePaymentOrder(orderUser, orderId)).toMatchObject({ customerRef: "cus_orderFixture", feeTariff: { grossCents: 150 } });
        api.rpc.mockResolvedValue({ data: { ...withFee(), customerRef: "local_cus_other" }, error: null });
        await expect(getPrivatePaymentOrder(orderUser, orderId)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
    it("requires the persisted original operation identity instead of trusting a replay-shaped object", async () => {
        api.rpc.mockResolvedValue({ data: { ...withFee(), operationId: orderOperation, replay: true }, error: null });
        expect(await beginPaymentOrderOperation(orderUser, orderId, "refund", orderOperation)).toMatchObject({ operationId: orderOperation, replay: true });
        api.rpc.mockResolvedValue({ data: { ...withFee(), operationId: "caller-controlled", replay: true }, error: null });
        await expect(beginPaymentOrderOperation(orderUser, orderId, "refund", orderOperation)).rejects.toMatchObject({ code: "payment_order_invalid_snapshot" });
    });
});
