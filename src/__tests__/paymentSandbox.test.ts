import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectPaymentsConfiguration, PaymentsSetupError } from "@/lib/payments/config";

const sdk = vi.hoisted(() => ({
    construct: vi.fn(),
    createTransport: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("stripe", () => {
    class Stripe {
        static API_VERSION = "sdk-matching-default";
        static createFetchHttpClient(fetch: typeof globalThis.fetch) {
            sdk.createTransport(fetch);
            return { transport: "blocked" };
        }
        constructor(...args: unknown[]) { sdk.construct(...args); }
    }
    return { default: Stripe };
});

import { assertStripeTestObject, createSandboxStripeClient } from "@/lib/payments/stripe.server";

const sandboxEnvironment = () => ({ WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_fixtureOnly" });

describe("Workfare Pay sandbox configuration", () => {
    beforeEach(() => vi.clearAllMocks());

    it("stays disabled by default, including when a key happens to exist", () => {
        expect(inspectPaymentsConfiguration({})).toMatchObject({ status: "disabled", secretKeyPresent: false, livePaymentsEnabled: false });
        const environment = { STRIPE_SECRET_KEY: "sk_test_fixtureOnly" };
        expect(inspectPaymentsConfiguration(environment)).toMatchObject({ status: "disabled", secretKeyPresent: true });
        expect(() => createSandboxStripeClient(environment)).toThrow(expect.objectContaining({ code: "disabled" }));
        expect(sdk.construct).not.toHaveBeenCalled();
    });

    it.each(["live", "test", "SANDBOX", " sandbox", ""])("rejects mode %j instead of silently enabling payments", (mode) => {
        expect(() => createSandboxStripeClient({ ...sandboxEnvironment(), WORKFARE_PAY_MODE: mode }))
            .toThrow(expect.objectContaining({ code: "sandbox_only" }));
    });

    it.each(["sk_live_fixtureOnly", "rk_live_fixtureOnly"])("rejects a live secret before loading the SDK", (key) => {
        const environment = { WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: key };
        const status = inspectPaymentsConfiguration(environment);
        expect(status).toMatchObject({ status: "invalid", issues: ["live_key_forbidden"], livePaymentsEnabled: false });
        expect(JSON.stringify(status)).not.toContain(key);
        expect(() => createSandboxStripeClient(environment)).toThrow(expect.objectContaining({ code: "live_key_forbidden" }));
        expect(sdk.construct).not.toHaveBeenCalled();
    });

    it.each([undefined, "", "pk_test_fixtureOnly", "sk_test_", " sk_test_fixtureOnly", "sk_test_fixtureOnly\n", "whsec_fixtureOnly"])
    ("rejects missing or malformed server credentials (%j)", (key) => {
        expect(() => createSandboxStripeClient({ WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: key })).toThrow(PaymentsSetupError);
        expect(sdk.construct).not.toHaveBeenCalled();
    });

    it.each(["sk_test_fixtureOnly", "rk_test_fixtureOnly"])("accepts only an explicit sandbox credential shape and keeps it private", (key) => {
        const status = inspectPaymentsConfiguration({ WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: key });
        expect(status).toEqual({ productName: "Workfare Pay", status: "sandbox", secretKeyPresent: true, issues: [], livePaymentsEnabled: false });
        expect(JSON.stringify(status)).not.toContain(key);
    });

    it("lazily constructs one offline SDK instance and exposes no resource endpoints", async () => {
        const environment = sandboxEnvironment();
        const client = createSandboxStripeClient(environment);
        expect(sdk.construct).not.toHaveBeenCalled();
        expect(Object.keys(client)).toEqual(["inspect"]);
        // Deliberately short fixture, never a usable credential.
        environment.STRIPE_SECRET_KEY = "sk_live_fixture";
        const [first, second] = await Promise.all([client.inspect(), client.inspect()]);
        expect(first).toBe(second);
        expect(await client.inspect()).toBe(first);
        expect(sdk.construct).toHaveBeenCalledExactlyOnceWith("sk_test_fixtureOnly", {
            typescript: true, maxNetworkRetries: 0, httpClient: { transport: "blocked" },
        });
        expect(first).toEqual({ provider: "stripe", mode: "sandbox", apiVersion: "sdk-matching-default", networkEnabled: false, livePaymentsEnabled: false });
        expect(JSON.stringify(first)).not.toContain("fixtureOnly");
        expect(Object.isFrozen(client)).toBe(true);
        expect(Object.isFrozen(first)).toBe(true);
    });

    it("blocks transport even if a future SDK call accidentally attempts a request", async () => {
        await createSandboxStripeClient(sandboxEnvironment()).inspect();
        const blockedFetch = sdk.createTransport.mock.calls[0][0] as typeof fetch;
        await expect(blockedFetch("https://api.stripe.com/v1/payment_intents"))
            .rejects.toMatchObject({ code: "network_disabled" });
    });

    it("only accepts an explicit Stripe test-object mode flag", () => {
        expect(() => assertStripeTestObject({ id: "pi_fixture", livemode: false })).not.toThrow();
        for (const value of [null, undefined, [], "false", {}, { livemode: true }, { livemode: 0 }, { livemode: "false" }]) {
            expect(() => assertStripeTestObject(value)).toThrow(expect.objectContaining({ code: "live_object_forbidden" }));
        }
    });
});
