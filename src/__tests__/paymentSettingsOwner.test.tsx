import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), buyer: vi.fn(), recipient: vi.fn(), setup: vi.fn(), props: vi.fn() }));
vi.mock("@/lib/app-shell", () => ({ getAppHomeContext: mocks.context }));
vi.mock("@/lib/payments/repository.server", () => ({ getPaymentSettingsSnapshot: mocks.buyer }));
vi.mock("@/lib/payments/recipient-repository.server", () => ({ getRecipientSettingsSnapshot: mocks.recipient }));
vi.mock("@/lib/payments/service.server", () => ({ syncPaymentSetupReturn: mocks.setup, getPaymentSetupForUser: vi.fn() }));
vi.mock("@/components/layout/AppNavigationProvider", () => ({ AppRouteReady: () => null }));
vi.mock("@/components/payments/PaymentSettings", () => ({
    PaymentSettings: (props: unknown) => { mocks.props(props); return null; },
    PaymentSettingsUnavailable: () => <p>Nicht verfügbar</p>,
}));

import PaymentsPage from "@/app/app-home/settings/payments/page";

const ownerId = "11111111-1111-4111-8111-111111111111";
describe("payment settings identity and hosted return boundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context.mockResolvedValue({ sessionUserId: ownerId, effectiveView: { viewRole: "job_seeker" } });
        mocks.buyer.mockResolvedValue({ kind: "sandbox", featureEnabled: true });
        mocks.recipient.mockResolvedValue({ kind: "sandbox", status: "pending" });
    });

    it("binds the embedded account to the authenticated session owner, never a URL identifier", async () => {
        renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({ recipientHosted: "returned", returnTo: "https://example.invalid" }) }));
        expect(mocks.buyer).toHaveBeenCalledWith(ownerId);
        expect(mocks.recipient).toHaveBeenCalledWith(ownerId);
        expect(mocks.props).toHaveBeenCalledWith(expect.objectContaining({ ownerId, role: "job_seeker", returnTo: null }));
    });

    it("uses a hosted return only as a recipient recheck request, never payment or payout success", async () => {
        renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({ recipientHosted: "returned" }) }));
        expect(mocks.props).toHaveBeenCalledWith(expect.objectContaining({ recipientHostedReturned: true, result: null,
            recipientSnapshot: { kind: "sandbox", status: "pending" } }));
        expect(mocks.setup).not.toHaveBeenCalled();
    });

    it.each([undefined, "success", "true", "returned?success=1"])("ignores an unrecognized hosted marker %s", async recipientHosted => {
        renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({ recipientHosted }) }));
        expect(mocks.props).toHaveBeenCalledWith(expect.objectContaining({ recipientHostedReturned: false, result: null }));
    });

    it("never starts recipient return handling in an employer view", async () => {
        mocks.context.mockResolvedValue({ sessionUserId: ownerId, effectiveView: { viewRole: "job_provider" } });
        renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({ recipientHosted: "returned" }) }));
        expect(mocks.recipient).not.toHaveBeenCalled();
        expect(mocks.props).toHaveBeenCalledWith(expect.objectContaining({ recipientHostedReturned: false, result: null }));
    });
});
