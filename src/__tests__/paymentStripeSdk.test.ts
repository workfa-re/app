import { afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("server-only", () => ({}));
import { createSandboxStripeClient } from "@/lib/payments/stripe.server";

afterEach(() => vi.restoreAllMocks());

it("constructs the installed SDK locally with its matching default API version and no request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
    const runtime = await createSandboxStripeClient({ WORKFARE_PAY_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly" }).inspect();
    expect(runtime).toEqual({ provider: "stripe", mode: "sandbox", apiVersion: Stripe.API_VERSION, networkEnabled: false, livePaymentsEnabled: false });
    expect(Stripe.API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
    expect(fetch).not.toHaveBeenCalled();
});
