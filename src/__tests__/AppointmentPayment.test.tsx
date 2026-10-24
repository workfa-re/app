import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
import { AppointmentPayment, AppointmentPaymentAmounts, AppointmentPaymentsProvider, canCancelAppointmentPayment, estimateAppointmentPrice, nextAppointmentPaymentAction, refreshAppointmentPaymentStatus, paymentConversationShortcut, latestAppointmentPaymentOrder } from "@/components/payments/AppointmentPayment";
import { paymentOrder } from "./fixtures/paymentOrders";
import { paymentOrderPreviewVisible } from "@/lib/payments/order-feature";
import { LIVE_SERVICE_FEE_POLICY, quoteLiveServiceFee } from "@/lib/payments/tariff";
afterEach(() => vi.unstubAllGlobals());

describe("appointment payment UI consent and stage contract", () => {
    it("shows the provider the full fee-inclusive total and preserves recipient earnings", () => {
        const payer = renderToStaticMarkup(<AppointmentPaymentAmounts earnings={1000} fee={50} provider />);
        expect(payer).toContain("Vergütung"); expect(payer).toContain("Servicegebühr"); expect(payer).toContain("Testtarif");
        for (const value of ["10,00", "0,50", "10,50"]) expect(payer).toContain(value);
        const recipient = renderToStaticMarkup(<AppointmentPaymentAmounts earnings={1000} fee={50} provider={false} />);
        expect(recipient).toContain("10,00"); expect(recipient).not.toContain("10,50"); expect(recipient).not.toContain("0,50");
    });
    it("uses a live service price without showing a test tariff or reducing the agreed earnings", () => {
        const html = renderToStaticMarkup(<AppointmentPaymentAmounts earnings={1000} fee={50} feePolicy={LIVE_SERVICE_FEE_POLICY} provider />);
        expect(html).toContain("10,00"); expect(html).toContain("0,50"); expect(html).toContain("10,50");
        expect(html).not.toMatch(/Testtarif|Testbetrieb/);
    });
    it("accepts only mode-consistent live payment synchronization and retains exact quote checks", async () => {
        const feeTariff = quoteLiveServiceFee(1000);
        const live = paymentOrder({ mode: "live", livePaymentsEnabled: true, earningsCents: 1000, serviceFeeCents: 50, totalCents: 1050,
            feePolicy: LIVE_SERVICE_FEE_POLICY, feeTariff });
        const scope = { applicationId: live.applicationId, currentUserId: live.providerId, isProvider: true };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: live }) }));
        expect(await refreshAppointmentPaymentStatus(live, scope)).toEqual(live);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...live, mode: "sandbox" } }) }));
        await expect(refreshAppointmentPaymentStatus(live, scope)).rejects.toThrow();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...live, totalCents: 1000 } }) }));
        await expect(refreshAppointmentPaymentStatus(live, scope)).rejects.toThrow();
    });
    it("keeps the normal chat completely free of payment UI and requests without its preview context", () => {
        const html = renderToStaticMarkup(<AppointmentPaymentsProvider context={null}><AppointmentPayment
            appointment={{ id: paymentOrder().appointmentId, starts_at: paymentOrder().startsAt, status: "scheduled", updated_at: paymentOrder().appointmentVersion }}
            job={{ wage_hourly: 30, payment_type: "fixed" }} /></AppointmentPaymentsProvider>);
        expect(html).toBe("");
    });
    it.each([
        [{ wage: 30, type: "fixed", minutes: 90 }, 3000], [{ wage: 14.99, type: "hourly", minutes: 90 }, 2249],
        [{ wage: 15, type: "hourly", minutes: 60 }, 1500], [{ wage: 15, type: "hourly", minutes: 0 }, null],
        [{ wage: 15, type: "hourly", minutes: 481 }, null], [{ wage: -1, type: "fixed", minutes: 60 }, null],
    ])("shows a bounded preview for %j", (value, expected) => {
        expect(estimateAppointmentPrice(value.wage, value.type, value.minutes)).toBe(expected);
    });
    it("offers recipient acceptance only for the exact current proposed quote", () => {
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "awaiting_confirmation" }), false, Date.now())).toBe("confirm");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "awaiting_confirmation", termsCurrent: false }), false, Date.now())).toBeNull();
        for (const state of ["ready", "authorized", "paid", "refunded"] as const) {
            expect(nextAppointmentPaymentAction(paymentOrder({ state }), false, Date.now())).toBeNull();
        }
    });
    it("keeps authorization separate from capture and never charges from an appointment status alone", () => {
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "ready" }), true, Date.now())).toBe("authorize");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorization_pending" }), true, Date.now())).toBe("authorize");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", startsAt: "2035-01-01T00:00:00Z", captureBefore: "2035-01-02T00:00:00Z" }), true, Date.parse("2034-12-31T00:00:00Z"))).toBeNull();
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", startsAt: "2035-01-01T00:00:00Z", captureBefore: "2035-01-02T00:00:00Z" }), true, Date.parse("2035-01-01T01:00:00Z"))).toBe("capture");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", captureBefore: "2000-01-01T00:00:00Z" }), true, Date.now())).toBeNull();
    });
    it("does not offer financial next actions for stale or terminal orders", () => {
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "ready", termsCurrent: false }), true, Date.now())).toBeNull();
        for (const state of ["paid", "canceled", "refunded", "review_required"] as const) {
            expect(nextAppointmentPaymentAction(paymentOrder({ state }), true, Date.now())).toBeNull();
        }
    });
    it.each([["capture_pending", "capture"], ["cancel_pending", "cancel"], ["refund_pending", "refund"]] as const)("lets only the buyer resume an interrupted %s operation", (state, action) => {
        const order = paymentOrder({ state });
        expect(nextAppointmentPaymentAction(order, true, Date.now())).toBe(action);
        expect(nextAppointmentPaymentAction(order, false, Date.now())).toBeNull();
    });
    it("actually synchronizes the owned PSP status instead of presenting a cached list read as a check", async () => {
        const order = paymentOrder({ state: "cancel_pending" });
        const verified = paymentOrder({ state: "canceled" });
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: verified }) });
        vi.stubGlobal("fetch", fetch);
        expect(await refreshAppointmentPaymentStatus(order, { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true })).toEqual(verified);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(`/api/payments/orders/${order.id}/sync`, expect.objectContaining({ method: "POST", body: "{}", cache: "no-store", credentials: "same-origin" }));
        expect(fetch.mock.calls[0][0]).not.toContain("/action");
    });
    it("never accepts a foreign participant or unconfirmed status as a successful synchronization", async () => {
        const order = paymentOrder();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: paymentOrder({ providerId: "other", recipientId: "foreign" }) }) }));
        await expect(refreshAppointmentPaymentStatus(order, { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true })).rejects.toThrow();
    });
    it("offers the buyer a cancellation after interrupted bank authentication", () => {
        expect(canCancelAppointmentPayment(paymentOrder({ state: "authorization_pending" }), true)).toBe(true);
        expect(canCancelAppointmentPayment(paymentOrder({ state: "authorization_pending" }), false)).toBe(false);
        for (const state of ["capture_pending", "paid", "refund_pending", "refunded"] as const) expect(canCancelAppointmentPayment(paymentOrder({ state }), true)).toBe(false);
    });
    it("does not reveal test payment controls merely because a key or local flag exists", () => {
        expect(paymentOrderPreviewVisible({ STRIPE_SECRET_KEY: "sk_test_fixture", WORKFARE_PAY_MODE: "sandbox" })).toBe(false);
        expect(paymentOrderPreviewVisible({ WORKFARE_PAY_ORDER_PREVIEW: "enabled", WORKFARE_DEMO_MODE: "hosted", WORKFARE_PAY_MODE: "local_simulation" })).toBe(false);
        expect(paymentOrderPreviewVisible({ WORKFARE_PAY_ORDER_PREVIEW: "enabled", WORKFARE_DEMO_MODE: "local", WORKFARE_PAY_MODE: "sandbox" })).toBe(false);
        expect(paymentOrderPreviewVisible({ WORKFARE_PAY_ORDER_PREVIEW: "enabled", WORKFARE_DEMO_MODE: "local", WORKFARE_PAY_MODE: "local_simulation" })).toBe(true);
    });
    it("offers only the role's concrete next payment step and keeps ordinary waiting states quiet", () => {
        const now = Date.parse("2026-10-24T00:30:00Z");
        const proposed = paymentOrder({ state: "awaiting_confirmation" });
        expect(paymentConversationShortcut([proposed], false, now)?.label).toBe("Preis bestätigen");
        expect(paymentConversationShortcut([proposed], true, now)).toBeNull();
        expect(paymentConversationShortcut([paymentOrder({ state: "ready" })], true, now)?.label).toBe("Zahlung freigeben");
        expect(paymentConversationShortcut([paymentOrder({ state: "ready" })], false, now)).toBeNull();
        expect(paymentConversationShortcut([paymentOrder({ state: "authorized", captureBefore: "2026-10-25T00:00:00Z" })], true, now)?.label).toBe("Vergütung bezahlen");
        expect(paymentConversationShortcut([paymentOrder({ state: "paid" })], true, now)).toBeNull();
        expect(paymentConversationShortcut([paymentOrder({ state: "ready", startsAt: "2026-10-30T00:00:00Z" })], true, now)).toBeNull();
    });
    it("does not let a late response for an old quote conceal its replacement", () => {
        const old = paymentOrder({ state: "canceled", quoteVersion: 1 });
        const current = paymentOrder({ id: "77777777-7777-4777-8777-777777777777", state: "awaiting_confirmation", quoteVersion: 2 });
        expect(latestAppointmentPaymentOrder([old, current], old.appointmentId)?.id).toBe(current.id);
        expect(paymentConversationShortcut([old, current], false, Date.now())?.label).toBe("Preis bestätigen");
    });
    it("opens review for expired or unresolved money state without calling it payable", () => {
        const now = Date.parse("2026-10-24T02:00:00Z");
        for (const order of [paymentOrder({ state: "review_required" }), paymentOrder({ state: "authorized", captureBefore: "2026-10-24T01:00:00Z" }), paymentOrder({ state: "refund_pending" })]) {
            expect(paymentConversationShortcut([order], true, now)?.label).toBe("Zahlung prüfen");
        }
    });
});
