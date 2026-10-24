import type { PrivatePaymentOrder } from "@/lib/payments/order-types";

export const orderUser = "11111111-1111-4111-8111-111111111111";
export const orderRecipient = "22222222-2222-4222-8222-222222222222";
export const orderId = "33333333-3333-4333-8333-333333333333";
export const orderOperation = "44444444-4444-4444-8444-444444444444";
export function paymentOrder(patch: Partial<PrivatePaymentOrder> = {}): PrivatePaymentOrder {
    return { id: orderId, mode: "sandbox", appointmentId: "55555555-5555-4555-8555-555555555555", applicationId: "66666666-6666-4666-8666-666666666666",
        providerId: orderUser, recipientId: orderRecipient, title: "Garden help", startsAt: "2026-10-24T00:00:00.000Z", endsAt: null,
        timezone: "Europe/Berlin", appointmentVersion: "2026-10-24T00:00:00.000Z", quoteVersion: 1, paymentType: "fixed", rateCents: 3000, plannedMinutes: null,
        earningsCents: 3000, serviceFeeCents: 0, totalCents: 3000, currency: "eur", feePolicy: "local-zero-fee-v1", termsVersion: "appointment-price-v1",
        recipientConfirmedAt: "2026-10-24T00:01:00.000Z", state: "authorization_pending", captureBefore: null, refundedCents: 0,
        createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:01:00.000Z", termsCurrent: true, bankPayoutConfirmed: false,
        livePaymentsEnabled: false, customerRef: "cus_orderFixture", methodRef: "pm_orderFixture", accountRef: "acct_orderFixture", intentRef: "pi_orderFixture",
        refundRef: null, revision: 2, ...patch };
}
export const orderEnvironment = {
    WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true", WORKFARE_DEMO_MODE: "local",
    WORKFARE_DEMO_PROJECT_REF: "local-payment-tests", WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_URL: "http://127.0.0.1:54321", APP_ORIGIN: "http://127.0.0.1:3000", STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly",
    STRIPE_PAYMENT_WEBHOOK_SECRET: "whsec_offlineFixtureOnly", WORKFARE_PAY_RECIPIENT_SANDBOX: "enabled", WORKFARE_PAY_ORDER_PREVIEW: "enabled", WORKFARE_PAY_ORDER_SANDBOX: "enabled",
};
