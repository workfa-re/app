import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
import { AppointmentPayment, AppointmentPaymentAmounts, AppointmentPaymentsProvider, canCancelAppointmentPayment, canRenewAppointmentPayment, estimateAppointmentPrice, nextAppointmentPaymentAction, refreshAppointmentPaymentStatus, paymentConversationShortcut, latestAppointmentPaymentOrder, appointmentsArePaid, captureCompletionPayment, payCompletedAppointment, AppointmentCompletionReview } from "@/components/payments/AppointmentPayment";
import { paymentOrder } from "./fixtures/paymentOrders";
import { paymentOrderPreviewVisible } from "@/lib/payments/order-feature";
import { LIVE_SERVICE_FEE_POLICY, quoteLiveServiceFee } from "@/lib/payments/tariff";
afterEach(() => vi.unstubAllGlobals());

describe("appointment payment UI consent and stage contract", () => {
    it("closes only when every non-cancelled appointment has its latest actually paid price", () => {
        const paid = paymentOrder({ state: "paid", refundedCents: 0 });
        const appointments = [{ id: paid.appointmentId, starts_at: paid.startsAt, status: "scheduled" }];
        expect(appointmentsArePaid(appointments, [paid])).toBe(true);
        for (const state of ["ready", "authorization_pending", "authorized", "capture_pending", "failed", "review_required", "refund_pending", "refunded"] as const) {
            expect(appointmentsArePaid(appointments, [{ ...paid, state }])).toBe(false);
        }
        expect(appointmentsArePaid([], [paid])).toBe(false);
        expect(appointmentsArePaid([...appointments, { ...appointments[0], id: "88888888-8888-4888-8888-888888888888" }], [paid])).toBe(false);
        expect(appointmentsArePaid([...appointments, { ...appointments[0], id: "88888888-8888-4888-8888-888888888888", status: "cancelled" }], [paid])).toBe(true);
        expect(appointmentsArePaid(appointments, [paid, { ...paid, quoteVersion: 2, state: "awaiting_confirmation" }])).toBe(false);
        expect(appointmentsArePaid(appointments, [{ ...paid, recipientConfirmedAt: null }])).toBe(false);
        const oldPaid = { ...paid, id: "99999999-9999-4999-8999-999999999999", quoteVersion: 1 };
        const latestPaid = { ...paid, quoteVersion: 2 };
        expect(appointmentsArePaid(appointments, [oldPaid, latestPaid])).toBe(false);
        expect(appointmentsArePaid(appointments, [{ ...oldPaid, state: "refund_pending" }, latestPaid])).toBe(false);
        expect(appointmentsArePaid(appointments, [{ ...oldPaid, state: "refunded", refundedCents: oldPaid.totalCents }, latestPaid])).toBe(true);
    });
    it("pays the exact confirmed quote through one explicit action without sending a browser amount", async () => {
        const order = paymentOrder({ state: "ready", startsAt: "2035-01-01T23:00:00Z" });
        const paid = { ...order, state: "paid" };
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: paid }) }); vi.stubGlobal("fetch", fetch);
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444";
        expect((await payCompletedAppointment(order, scope, operation)).order).toEqual(paid);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/payments/orders/${order.id}/action`, expect.objectContaining({
            method: "POST", headers: expect.objectContaining({ "Idempotency-Key": operation }), body: JSON.stringify({ action: "pay", consent: true }),
        }));
        expect(fetch.mock.calls[0][1].body).not.toMatch(/amount|totalCents|startsAt|capture/);
    });
    it.each(["authorization_pending", "authorized", "capture_pending"] as const)("resumes %s through the same explicit payment action", async state => {
        const order = paymentOrder({ state });
        const response = { order: { ...order, state: "authorization_pending" }, kind: "confirmation", clientSecret: "pi_fixture_secret_scope", publishableKey: "pk_test_scope" };
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response }); vi.stubGlobal("fetch", fetch);
        const result = await payCompletedAppointment(order, { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true }, "44444444-4444-4444-8444-444444444444");
        expect(result).toEqual(response);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ action: "pay", consent: true }));
    });
    it("does not request money for an unconfirmed, stale, foreign, settled or refunded quote", async () => {
        const order = paymentOrder({ state: "ready" });
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444";
        for (const patch of [{ state: "awaiting_confirmation" as const }, { state: "paid" as const }, { state: "failed" as const }, { state: "canceled" as const },
            { state: "refunded" as const }, { termsCurrent: false }, { recipientConfirmedAt: null }, { providerId: order.recipientId }]) {
            await expect(payCompletedAppointment({ ...order, ...patch }, scope, operation)).rejects.toThrow();
        }
        await expect(payCompletedAppointment(order, { ...scope, isProvider: false }, operation)).rejects.toThrow();
        await expect(payCompletedAppointment(order, scope, "invalid")).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
    it("rejects a returned foreign quote and never turns a pending bank response into paid", async () => {
        const order = paymentOrder({ state: "ready" });
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...order, state: "capture_pending" } }) }));
        expect((await payCompletedAppointment(order, scope, operation)).order.state).toBe("capture_pending");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...order, id: "99999999-9999-4999-8999-999999999999", state: "paid" } }) }));
        await expect(payCompletedAppointment(order, scope, operation)).rejects.toThrow();
    });
    it("captures a verified own authorization with the same operation and exact stored total", async () => {
        const order = paymentOrder({ state: "authorized", captureBefore: "2035-01-02T00:00:00Z", startsAt: "2035-01-01T00:00:00Z" });
        const paid = { ...order, state: "paid" };
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: paid }) }); vi.stubGlobal("fetch", fetch);
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444";
        expect(await captureCompletionPayment(order, scope, operation, Date.parse("2035-01-01T01:00:00Z"))).toEqual(paid);
        expect(fetch).toHaveBeenCalledWith(`/api/payments/orders/${order.id}/action`, expect.objectContaining({
            method: "POST", headers: expect.objectContaining({ "Idempotency-Key": operation }), body: JSON.stringify({ action: "capture", consent: true }),
        }));
        expect(fetch.mock.calls[0][1].body).not.toMatch(/amount|totalCents/);
    });
    it("never continues a canceled bank check, foreign order, expired hold or future work into capture", async () => {
        const order = paymentOrder({ state: "authorized", captureBefore: "2035-01-02T00:00:00Z", startsAt: "2035-01-01T00:00:00Z" });
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444", now = Date.parse("2035-01-01T01:00:00Z");
        for (const patch of [{ state: "authorization_pending" as const }, { state: "capture_pending" as const }, { state: "failed" as const }, { state: "canceled" as const },
            { captureBefore: "2034-01-01T00:00:00Z" }, { startsAt: "2035-02-01T00:00:00Z" }, { termsCurrent: false }, { providerId: order.recipientId }]) {
            await expect(captureCompletionPayment({ ...order, ...patch }, scope, operation, now)).rejects.toThrow();
        }
        await expect(captureCompletionPayment(order, { ...scope, isProvider: false }, operation, now)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
    it("keeps pending capture pending and rejects another payment returned by synchronization", async () => {
        const order = paymentOrder({ state: "authorized", captureBefore: "2035-01-02T00:00:00Z", startsAt: "2035-01-01T00:00:00Z" });
        const scope = { applicationId: order.applicationId, currentUserId: order.providerId, isProvider: true };
        const operation = "44444444-4444-4444-8444-444444444444", now = Date.parse("2035-01-01T01:00:00Z");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...order, state: "capture_pending" } }) }));
        expect((await captureCompletionPayment(order, scope, operation, now)).state).toBe("capture_pending");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { ...order, id: "99999999-9999-4999-8999-999999999999", state: "paid" } }) }));
        await expect(captureCompletionPayment(order, scope, operation, now)).rejects.toThrow();
        await expect(refreshAppointmentPaymentStatus(order, scope)).rejects.toThrow();
    });
    it("offers safe renewal only for a failed attempt, stale terms or an expired hold", () => {
        const now = Date.parse("2035-01-01T01:00:00Z");
        expect(canRenewAppointmentPayment(paymentOrder({ state: "failed" }), true, now)).toBe(true);
        expect(canRenewAppointmentPayment(paymentOrder({ state: "ready", termsCurrent: false }), true, now)).toBe(true);
        expect(canRenewAppointmentPayment(paymentOrder({ state: "authorized", captureBefore: "2034-01-01T00:00:00Z" }), true, now)).toBe(true);
        for (const state of ["awaiting_confirmation", "ready", "authorization_pending", "capture_pending", "paid", "refund_pending", "refunded", "review_required"] as const) {
            expect(canRenewAppointmentPayment(paymentOrder({ state }), true, now)).toBe(false);
        }
        expect(canRenewAppointmentPayment(paymentOrder({ state: "authorized", captureBefore: "2035-01-02T00:00:00Z" }), true, now)).toBe(false);
        expect(canRenewAppointmentPayment(paymentOrder({ state: "failed" }), false, now)).toBe(false);
        expect(canRenewAppointmentPayment(paymentOrder({ state: "authorization_pending", termsCurrent: false }), true, now)).toBe(false);
    });
    it("opens a minimal branded completion review without a direct unpaid close action", () => {
        const html = renderToStaticMarkup(<AppointmentCompletionReview appointments={[]} job={{ title: "Gartenarbeit" }} pending={false} error={null} onComplete={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain("Auftrag abschließen"); expect(html).toContain("Gartenarbeit"); expect(html).toContain("Workfare");
        expect(html).toContain('role="dialog"'); expect(html).not.toContain("Als abgeschlossen markieren"); expect(html).not.toContain("Abschlussnotiz");
    });
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
    it("explains the five-percent fee on a 17-euro job without reducing the recipient's pay", () => {
        const payer = renderToStaticMarkup(<AppointmentPaymentAmounts earnings={1700} fee={85} feePolicy={LIVE_SERVICE_FEE_POLICY} provider />);
        for (const value of ["17,00", "0,85", "17,85", "5 %"]) expect(payer).toContain(value);
        const recipient = renderToStaticMarkup(<AppointmentPaymentAmounts earnings={1700} fee={85} feePolicy={LIVE_SERVICE_FEE_POLICY} provider={false} />);
        expect(recipient).toContain("17,00"); expect(recipient).not.toContain("17,85"); expect(recipient).not.toContain("0,85");
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
    it("offers one explicit payment action after price confirmation, including an early completed job", () => {
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "ready" }), true, Date.now())).toBe("pay");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorization_pending" }), true, Date.now())).toBe("pay");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", startsAt: "2035-01-01T00:00:00Z", captureBefore: "2035-01-02T00:00:00Z" }), true, Date.parse("2034-12-31T00:00:00Z"))).toBe("pay");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", startsAt: "2035-01-01T00:00:00Z", captureBefore: "2035-01-02T00:00:00Z" }), true, Date.parse("2035-01-01T01:00:00Z"))).toBe("pay");
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "authorized", captureBefore: "2000-01-01T00:00:00Z" }), true, Date.now())).toBeNull();
    });
    it("does not offer financial next actions for stale or terminal orders", () => {
        expect(nextAppointmentPaymentAction(paymentOrder({ state: "ready", termsCurrent: false }), true, Date.now())).toBeNull();
        for (const state of ["paid", "canceled", "refunded", "review_required"] as const) {
            expect(nextAppointmentPaymentAction(paymentOrder({ state }), true, Date.now())).toBeNull();
        }
    });
    it.each([["capture_pending", "pay"], ["cancel_pending", "cancel"], ["refund_pending", "refund"]] as const)("lets only the buyer resume an interrupted %s operation", (state, action) => {
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
        expect(paymentConversationShortcut([paymentOrder({ state: "ready" })], true, now)?.label).toBe("Jetzt bezahlen");
        expect(paymentConversationShortcut([paymentOrder({ state: "ready" })], false, now)).toBeNull();
        expect(paymentConversationShortcut([paymentOrder({ state: "authorized", captureBefore: "2026-10-25T00:00:00Z" })], true, now)?.label).toBe("Jetzt bezahlen");
        expect(paymentConversationShortcut([paymentOrder({ state: "paid" })], true, now)).toBeNull();
        expect(paymentConversationShortcut([paymentOrder({ state: "ready", startsAt: "2026-10-30T00:00:00Z" })], true, now)?.label).toBe("Jetzt bezahlen");
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
