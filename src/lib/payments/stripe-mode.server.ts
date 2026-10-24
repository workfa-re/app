import "server-only";
import type Stripe from "stripe";
import type { PaymentsEnvironment } from "./config";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import type { PaymentMode } from "./types";
import { assertStripeTestObject } from "./stripe.server";

export function assertStripeModeObject(value: unknown, mode: PaymentMode): asserts value is { livemode: boolean } {
    if (mode === "sandbox") { assertStripeTestObject(value); return; }
    if (mode === "local_simulation" || !value || typeof value !== "object" || Array.isArray(value)
        || !("livemode" in value) || value.livemode !== (mode === "live")) throw new PaymentFlowError("stripe_object_mode_mismatch", 409);
}

/** Mode is fixed before SDK creation; live keys must belong to the configured platform. */
export function paymentStripeSdk(environment: PaymentsEnvironment = process.env) {
    const runtime = requirePaymentRuntime(environment);
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("stripe_runtime_required", 503);
    const key = environment.STRIPE_SECRET_KEY!;
    let promise: Promise<Stripe> | null = null;
    return () => promise ??= import("stripe").then(async ({ default: SDK }) => {
        const stripe = new SDK(key, { typescript: true, maxNetworkRetries: 1, timeout: 10_000 });
        if (runtime.mode === "live") {
            const account = await stripe.accounts.retrieve(null);
            if (account.id !== runtime.platformAccountRef || account.country !== "DE") throw new PaymentFlowError("stripe_platform_mismatch", 503);
        }
        return stripe;
    });
}

export function stripePublishableKey(environment: PaymentsEnvironment = process.env): string {
    const mode = requirePaymentRuntime(environment).mode;
    const key = environment.STRIPE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const pattern = mode === "live" ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/;
    if (!key || mode === "local_simulation" || !pattern.test(key)) throw new PaymentFlowError("invalid_publishable_key", 503);
    return key;
}
