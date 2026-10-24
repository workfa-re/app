import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => ({
    customerCreate: vi.fn(), customerRetrieve: vi.fn(), customerUpdate: vi.fn(), sessionCreate: vi.fn(), sessionRetrieve: vi.fn(), intentRetrieve: vi.fn(),
    methodRetrieve: vi.fn(), methodDetach: vi.fn(),
}));
vi.mock("stripe", async (importOriginal) => {
    const { default: Actual } = await importOriginal<typeof import("stripe")>();
    return { default: class extends Actual {
        constructor(...args: ConstructorParameters<typeof Actual>) {
            super(...args);
            this.customers.create = api.customerCreate;
            this.customers.retrieve = api.customerRetrieve;
            this.customers.update = api.customerUpdate;
            this.checkout.sessions.create = api.sessionCreate;
            this.checkout.sessions.retrieve = api.sessionRetrieve;
            this.setupIntents.retrieve = api.intentRetrieve;
            this.paymentMethods.retrieve = api.methodRetrieve;
            this.paymentMethods.detach = api.methodDetach;
        }
    } };
});
import Stripe from "stripe";
import { createStripeSandboxAdapter } from "@/lib/payments/stripe-sandbox.server";

const userId = "11111111-1111-4111-8111-111111111111";
const setupId = "22222222-2222-4222-8222-222222222222";
const customerId = "cus_testFixture";
const metadata = { workfare_pay_user: userId, workfare_pay_setup: setupId };
const environment = {
    WORKFARE_PAY_MODE: "sandbox", WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
    WORKFARE_DEMO_MODE: "local", WORKFARE_DEMO_PROJECT_REF: "local-payment-tests",
    WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    APP_ORIGIN: "http://127.0.0.1:3000", STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly", STRIPE_WEBHOOK_SECRET: "whsec_offlineFixtureOnly",
};
const session = () => ({ id: "cs_test_fixture", livemode: false, mode: "setup", status: "complete", customer: customerId,
    client_reference_id: setupId, metadata, setup_intent: "seti_fixture", url: "https://checkout.stripe.com/c/pay/cs_test_fixture", expires_at: 1_900_000_000 });
const intent = () => ({ id: "seti_fixture", livemode: false, status: "succeeded", customer: customerId, metadata, payment_method: "pm_fixture" });
const method = () => ({ id: "pm_fixture", livemode: false, customer: customerId, type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
const embedded = () => ({ ...session(), ui_mode: "embedded_page", status: "open", url: null, client_secret: "cs_test_fixture_secret_fixture" });

describe("restricted Stripe sandbox setup adapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.customerCreate.mockResolvedValue({ id: customerId, livemode: false, metadata: { workfare_pay_user: userId } });
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, metadata: { workfare_pay_user: userId } });
        api.customerUpdate.mockImplementation(async (id, input) => ({ id, livemode: false, email: input.email, metadata: { workfare_pay_user: userId } }));
        api.sessionCreate.mockResolvedValue(session()); api.sessionRetrieve.mockResolvedValue(session());
        api.intentRetrieve.mockResolvedValue(intent()); api.methodRetrieve.mockResolvedValue(method());
        api.methodDetach.mockResolvedValue({ ...method(), customer: null });
    });

    it("creates only a test customer/setup session with server metadata, approved return URL and idempotency", async () => {
        const adapter = createStripeSandboxAdapter(environment);
        expect(Object.keys(adapter)).toEqual(["createCustomer", "createSetup", "createEmbeddedSetup", "inspectSetup", "detachMethod", "verifyWebhook"]);
        await adapter.createCustomer(userId, "stable-customer-operation");
        expect(api.customerCreate).toHaveBeenCalledWith({ metadata: { workfare_pay_user: userId } }, { idempotencyKey: "stable-customer-operation" });
        await adapter.createSetup(customerId, userId, setupId, "/app-home/offers/new?resume=payment");
        const [params, options] = api.sessionCreate.mock.calls[0];
        expect(params).toMatchObject({ mode: "setup", ui_mode: "hosted_page", customer: customerId, currency: "eur", client_reference_id: setupId, metadata, setup_intent_data: { metadata }, wallet_options: { link: { display: "never" } } });
        expect(params).not.toHaveProperty("line_items");
        expect(new URL(params.success_url).searchParams.get("session_id")).toBe(setupId);
        expect(new URL(params.success_url).origin).toBe(environment.APP_ORIGIN);
        expect(options.idempotencyKey).toBe(`workfare-pay:setup:${setupId}`);
    });

    it("creates embedded setup in place with the stable SDK API surface and an owner-bound return", async () => {
        api.sessionCreate.mockResolvedValue(embedded());
        expect(await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, "/app-home/offers/new?resume=payment"))
            .toEqual({ status: "pending", id: "cs_test_fixture", clientSecret: "cs_test_fixture_secret_fixture", expiresAt: new Date(1_900_000_000_000).toISOString() });
        const [params, options] = api.sessionCreate.mock.calls[0];
        expect(params).toMatchObject({ mode: "setup", ui_mode: "embedded_page", redirect_on_completion: "if_required", customer: customerId,
            allowed_payment_method_types: ["card"], metadata, setup_intent_data: { metadata },
            branding_settings: { display_name: "Workfare", font_family: "inter", border_style: "rounded", background_color: "#f7f7f7", button_color: "#202020" },
            wallet_options: { link: { display: "never" } } });
        expect(params).not.toHaveProperty("success_url");
        expect(params).not.toHaveProperty("cancel_url");
        expect(params).not.toHaveProperty("line_items");
        const returnUrl = new URL(params.return_url);
        expect(returnUrl.origin).toBe(environment.APP_ORIGIN);
        expect([...returnUrl.searchParams]).toEqual([["session_id", setupId]]);
        expect(options.idempotencyKey).toBe(`workfare-pay:embedded-setup:${setupId}`);
    });

    it("uses neutral session branding in dark mode without changing dashboard settings", async () => {
        api.sessionCreate.mockResolvedValue(embedded());
        await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, null, "dark");
        expect(api.sessionCreate.mock.calls[0][0].branding_settings).toMatchObject({ background_color: "#101010", button_color: "#f2f2f2", font_family: "inter" });
    });

    it.each(["hosted", "embedded"])("sets the verified owner's email before creating %s Checkout, without a second customer", async surface => {
        if (surface === "embedded") api.sessionCreate.mockResolvedValue(embedded());
        const email = "provider@example.com";
        const adapter = createStripeSandboxAdapter(environment);
        if (surface === "embedded") await adapter.createEmbeddedSetup(customerId, userId, setupId, null, null, "light", email);
        else await adapter.createSetup(customerId, userId, setupId, null, email);
        expect(api.customerUpdate).toHaveBeenCalledWith(customerId, { email }, { idempotencyKey: expect.stringMatching(new RegExp(`^workfare-pay:setup-email:${setupId}:[a-f0-9]{64}$`)) });
        expect(api.customerUpdate.mock.invocationCallOrder[0]).toBeLessThan(api.sessionCreate.mock.invocationCallOrder[0]);
        expect(api.sessionCreate.mock.calls[0][0]).toMatchObject({ customer: customerId });
        expect(api.sessionCreate.mock.calls[0][0]).not.toHaveProperty("customer_email");
        expect(api.customerCreate).not.toHaveBeenCalled();
        expect(api.customerUpdate.mock.calls[0][2].idempotencyKey).not.toContain(email);
    });

    it("does not update a matching email, and syncs the Customer before resuming an already owned session", async () => {
        const email = "provider@example.com";
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, email, metadata: { workfare_pay_user: userId } });
        api.sessionRetrieve.mockResolvedValue(embedded());
        await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, "cs_test_fixture", "light", email);
        expect(api.customerUpdate).not.toHaveBeenCalled();
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, email: "old@example.com", metadata: { workfare_pay_user: userId } });
        await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, "cs_test_fixture", "light", email);
        expect(api.customerUpdate).toHaveBeenCalledOnce();
        expect(api.sessionCreate).not.toHaveBeenCalled();
    });

    it.each([{ id: "cus_foreign" }, { metadata: { workfare_pay_user: "other" } }, { livemode: true }, { deleted: true }])
    ("cannot overwrite an unbound customer email (%j)", async patch => {
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, metadata: { workfare_pay_user: userId }, ...patch });
        await expect(createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, null, "light", "provider@example.com")).rejects.toThrow();
        expect(api.customerUpdate).not.toHaveBeenCalled();
        expect(api.sessionCreate).not.toHaveBeenCalled();
    });

    it.each([{ id: "cus_foreign" }, { metadata: { workfare_pay_user: "other" } }, { livemode: true }, { email: "wrong@example.com" }])
    ("verifies the email-update response before creating Checkout (%j)", async patch => {
        api.customerUpdate.mockResolvedValue({ id: customerId, livemode: false, email: "provider@example.com", metadata: { workfare_pay_user: userId }, ...patch });
        await expect(createStripeSandboxAdapter(environment).createSetup(customerId, userId, setupId, null, "provider@example.com")).rejects.toThrow();
        expect(api.sessionCreate).not.toHaveBeenCalled();
    });
    it("accepts opaque Stripe secrets with punctuation instead of guessing their alphabet", async () => {
        const secret = `cs_test_fixture_secret_${"offline".repeat(60)}-._~+/=|`;
        api.sessionCreate.mockResolvedValue({ ...embedded(), client_secret: secret });
        expect((await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null))).toHaveProperty("clientSecret", secret);
        for (const unsafe of [secret + "\n", secret + "\u0000", `cs_test_fixture_secret_${"x".repeat(4_096)}`]) {
            api.sessionCreate.mockResolvedValue({ ...embedded(), client_secret: unsafe });
            await expect(createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null)).rejects.toThrow();
        }
    });

    it("resumes only the persisted embedded session without making another session", async () => {
        api.sessionRetrieve.mockResolvedValue(embedded());
        expect((await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, "cs_test_fixture")).status).toBe("pending");
        expect(api.sessionRetrieve).toHaveBeenCalledWith("cs_test_fixture");
        expect(api.sessionCreate).not.toHaveBeenCalled();
    });

    it("returns completed embedded sessions for authoritative SetupIntent synchronization without exposing a secret", async () => {
        api.sessionRetrieve.mockResolvedValue({ ...embedded(), status: "complete" });
        const result = await createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, "cs_test_fixture");
        expect(result).toMatchObject({ id: "cs_test_fixture", status: "complete" });
        expect(result).not.toHaveProperty("clientSecret");
    });

    it.each([
        { livemode: true }, { ui_mode: "hosted_page" }, { mode: "payment" }, { customer: "cus_other" },
        { client_reference_id: "other" }, { metadata: {} }, { status: "expired" }, { expires_at: 0 },
        { client_secret: null }, { client_secret: "cs_test_other_secret_fixture" }, { client_secret: "cs_test_fixture_secret_" },
        { client_secret: "cs_test_fixture_secret_private value" },
    ])("rejects embedded secret/session mismatches before returning a form (%j)", async (patch) => {
        api.sessionCreate.mockResolvedValue({ ...embedded(), ...patch });
        await expect(createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null)).rejects.toThrow();
    });

    it("does not switch a hosted operation to an embedded one or accept an arbitrary return path", async () => {
        api.sessionRetrieve.mockResolvedValue({ ...session(), ui_mode: "hosted_page" });
        await expect(createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, null, "cs_test_fixture"))
            .rejects.toMatchObject({ code: "setup_surface_mismatch" });
        expect(api.sessionCreate).not.toHaveBeenCalled();
        api.customerRetrieve.mockClear();
        await expect(createStripeSandboxAdapter(environment).createEmbeddedSetup(customerId, userId, setupId, "//evil.example"))
            .rejects.toMatchObject({ code: "invalid_return_path" });
        expect(api.customerRetrieve).not.toHaveBeenCalled();
    });

    it("verifies Checkout, SetupIntent, Customer and method ownership before returning minimal card details", async () => {
        expect(await createStripeSandboxAdapter(environment).inspectSetup("cs_test_fixture", customerId, userId, setupId))
            .toEqual({ status: "complete", method: { id: "pm_fixture", kind: "card", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2030 } });
    });

    it.each([
        ["session", { livemode: true }], ["session", { mode: "payment" }], ["session", { customer: "cus_someoneElse" }],
        ["session", { client_reference_id: "other" }], ["session", { metadata: { ...metadata, workfare_pay_user: "other" } }],
        ["intent", { livemode: true }], ["intent", { customer: "cus_someoneElse" }], ["intent", { status: "requires_action" }],
        ["intent", { metadata: {} }], ["method", { livemode: true }], ["method", { customer: null }], ["method", { customer: "cus_someoneElse" }],
    ])("rejects mismatched %s objects (%j)", async (target, patch) => {
        if (target === "session") api.sessionRetrieve.mockResolvedValue({ ...session(), ...(patch as object) });
        if (target === "intent") api.intentRetrieve.mockResolvedValue({ ...intent(), ...(patch as object) });
        if (target === "method") api.methodRetrieve.mockResolvedValue({ ...method(), ...(patch as object) });
        await expect(createStripeSandboxAdapter(environment).inspectSetup("cs_test_fixture", customerId, userId, setupId)).rejects.toThrow();
    });

    it("does not promote pending sessions and does not retrieve payment objects prematurely", async () => {
        api.sessionRetrieve.mockResolvedValue({ ...session(), status: "open" });
        expect(await createStripeSandboxAdapter(environment).inspectSetup("cs_test_fixture", customerId, userId, setupId)).toEqual({ status: "pending" });
        expect(api.intentRetrieve).not.toHaveBeenCalled();
        expect(api.methodRetrieve).not.toHaveBeenCalled();
    });

    it("rejects a live/mismatched customer and non-Stripe checkout redirects", async () => {
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, metadata: { workfare_pay_user: "other" } });
        await expect(createStripeSandboxAdapter(environment).createSetup(customerId, userId, setupId, null)).rejects.toThrow();
        expect(api.sessionCreate).not.toHaveBeenCalled();
        api.customerRetrieve.mockResolvedValue({ id: customerId, livemode: false, metadata: { workfare_pay_user: userId } });
        api.sessionCreate.mockResolvedValue({ ...session(), url: "https://checkout.stripe.com.evil.example/pay" });
        await expect(createStripeSandboxAdapter(environment).createSetup(customerId, userId, setupId, null)).rejects.toThrow();
    });

    it("only detaches an owned test method and tolerates an already detached method", async () => {
        const adapter = createStripeSandboxAdapter(environment);
        await adapter.detachMethod(customerId, "pm_fixture", userId, "remove-operation");
        expect(api.methodDetach).toHaveBeenCalledWith("pm_fixture", {}, { idempotencyKey: "remove-operation" });
        api.methodDetach.mockClear();
        api.methodRetrieve.mockResolvedValue({ ...method(), customer: "cus_other" });
        await expect(adapter.detachMethod(customerId, "pm_fixture", userId, "remove-operation")).rejects.toThrow();
        expect(api.methodDetach).not.toHaveBeenCalled();
        api.methodRetrieve.mockResolvedValue({ ...method(), customer: null });
        await adapter.detachMethod(customerId, "pm_fixture", userId, "remove-operation");
        expect(api.methodDetach).not.toHaveBeenCalled();
    });

    it("verifies real SDK signatures over the untouched payload and refuses live events", async () => {
        const adapter = createStripeSandboxAdapter(environment);
        const payload = JSON.stringify({ id: "evt_fixture", object: "event", livemode: false, type: "checkout.session.completed", data: { object: session() } });
        const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: environment.STRIPE_WEBHOOK_SECRET });
        expect((await adapter.verifyWebhook(payload, signature)).id).toBe("evt_fixture");
        await expect(adapter.verifyWebhook(`${payload} `, signature)).rejects.toMatchObject({ code: "invalid_webhook_signature" });
        await expect(adapter.verifyWebhook(payload, "invalid")).rejects.toMatchObject({ code: "invalid_webhook_signature" });
        const livePayload = payload.replace('"livemode":false', '"livemode":true');
        const liveSignature = Stripe.webhooks.generateTestHeaderString({ payload: livePayload, secret: environment.STRIPE_WEBHOOK_SECRET });
        await expect(adapter.verifyWebhook(livePayload, liveSignature)).rejects.toThrow();
        expect(api.customerCreate).not.toHaveBeenCalled();
        expect(api.sessionCreate).not.toHaveBeenCalled();
    });
});
