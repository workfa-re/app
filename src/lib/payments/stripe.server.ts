import "server-only";
import { inspectPaymentsConfiguration, PaymentsSetupError, type PaymentsEnvironment } from "./config";

export type SandboxStripeRuntime = Readonly<{
    provider: "stripe";
    mode: "sandbox";
    apiVersion: string;
    networkEnabled: false;
    livePaymentsEnabled: false;
}>;

/** A missing or merely falsey flag is not evidence that an object came from a sandbox. */
export function assertStripeTestObject(value: unknown): asserts value is { livemode: false } {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("livemode" in value) || value.livemode !== false) {
        throw new PaymentsSetupError("live_object_forbidden");
    }
}

/**
 * Offline sandbox foundation only. No raw SDK, payment/account methods or keys
 * are exposed. The installed SDK uses its matching default API version;
 * no unsupported version override is forced.
 */
export function createSandboxStripeClient(environment: PaymentsEnvironment = process.env) {
    if (environment.WORKFARE_PAY_MODE === "live") throw new PaymentsSetupError("sandbox_only");
    const configuration = inspectPaymentsConfiguration(environment);
    if (configuration.status !== "sandbox") {
        throw new PaymentsSetupError(configuration.status === "disabled" ? "disabled" : configuration.status === "live" ? "live_key_forbidden" : configuration.issues[0]);
    }
    // Snapshot the accepted key so later environment mutation cannot switch mode.
    const sandboxKey = environment.STRIPE_SECRET_KEY!;
    let runtimePromise: Promise<SandboxStripeRuntime> | null = null;

    return Object.freeze({
        inspect: (): Promise<SandboxStripeRuntime> => {
            runtimePromise ??= (async () => {
                const { default: Stripe } = await import("stripe");
                const blockedTransport = Stripe.createFetchHttpClient(async () => {
                    throw new PaymentsSetupError("network_disabled");
                });
                // Construction is local. Even an accidental future request is
                // blocked until a separately reviewed sandbox transport exists.
                new Stripe(sandboxKey, { typescript: true, maxNetworkRetries: 0, httpClient: blockedTransport });
                return Object.freeze({ provider: "stripe", mode: "sandbox", apiVersion: Stripe.API_VERSION, networkEnabled: false, livePaymentsEnabled: false });
            })();
            return runtimePromise;
        },
    });
}
