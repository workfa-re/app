import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    initialize: vi.fn(), assertOwner: vi.fn(), request: vi.fn(),
    fetchClientSecret: null as (() => Promise<string>) | null,
}));
vi.mock("@stripe/connect-js/pure", () => ({ loadConnectAndInitialize: mocks.initialize }));
vi.mock("@stripe/react-connect-js", () => ({
    ConnectComponentsProvider: ({ children }: { children: unknown }) => children,
    ConnectAccountOnboarding: () => <span>Auszahlungseinrichtung</span>,
    ConnectAccountManagement: () => null, ConnectBalances: () => null,
    ConnectNotificationBanner: () => null, ConnectPayoutsList: () => null,
}));
vi.mock("@/components/providers/ThemeProvider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/payments/payment-client", () => ({ paymentRequest: mocks.request }));
vi.mock("@/components/payments/StripeEmbedHelp", () => ({ StripeEmbedHelp: () => null }));
vi.mock("@/components/payments/recipient-connect-lifecycle", () => ({
    createRecipientConnectSession: (_owner: string, initialize: (assertOwner: () => void) => unknown) => initialize(mocks.assertOwner),
}));
import EmbeddedRecipient from "@/components/payments/EmbeddedRecipient";

const ownerId = "11111111-1111-4111-8111-111111111111";
function render(getClientSecret?: () => Promise<string>) {
    return renderToStaticMarkup(<EmbeddedRecipient ownerId={ownerId} kind="live" publishableKey="pk_live_offlineFixture"
        clientSecret="fixture_initial_session" component="onboarding" getClientSecret={getClientSecret} onExit={vi.fn()} onError={vi.fn()} />);
}
async function fetchSecret() {
    if (!mocks.fetchClientSecret) throw new Error("Stripe SDK initialization was not captured");
    return mocks.fetchClientSecret();
}
beforeEach(() => {
    vi.clearAllMocks(); mocks.assertOwner.mockReset(); mocks.fetchClientSecret = null;
    mocks.initialize.mockImplementation((options: { fetchClientSecret: () => Promise<string> }) => {
        mocks.fetchClientSecret = options.fetchClientSecret;
        return { update: vi.fn() };
    });
});

describe("embedded recipient uses its scoped guardian session renewal", () => {
    it("uses the initial session once, then the supplied guardian renewal without the generic recipient endpoint", async () => {
        const renew = vi.fn().mockResolvedValue("fixture_renewed_child_session");
        const html = render(renew);
        expect(html).toContain("Auszahlungseinrichtung");
        expect(html).not.toContain("fixture_initial_session");
        expect(await fetchSecret()).toBe("fixture_initial_session");
        expect(renew).not.toHaveBeenCalled();
        expect(await fetchSecret()).toBe("fixture_renewed_child_session");
        expect(renew).toHaveBeenCalledOnce();
        expect(mocks.request).not.toHaveBeenCalled();
        expect(mocks.assertOwner).toHaveBeenCalledTimes(3);
    });
    it("rechecks ownership after awaiting renewal and never hands a stale secret to Stripe", async () => {
        const renew = vi.fn().mockImplementation(async () => {
            mocks.assertOwner.mockImplementation(() => { throw new Error("owner_changed"); });
            return "fixture_stale_child_session";
        });
        render(renew); await fetchSecret();
        await expect(fetchSecret()).rejects.toThrow("owner_changed");
        expect(renew).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled();
    });
    it.each(["", "white space", "secret\n", "secret\u0000", "x".repeat(4097)])("rejects an invalid custom renewal secret %j", async secret => {
        render(async () => secret); await fetchSecret();
        await expect(fetchSecret()).rejects.toThrow("session_unavailable");
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("keeps the existing recipient renewal endpoint for ordinary adult sessions", async () => {
        mocks.request.mockResolvedValue({ kind: "live", clientSecret: "fixture_adult_session" });
        render(); await fetchSecret();
        expect(await fetchSecret()).toBe("fixture_adult_session");
        expect(mocks.request).toHaveBeenCalledWith("/api/payments/recipient/session", { component: "onboarding", consent: true }, expect.any(String), ownerId);
    });
});
