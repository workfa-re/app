import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: vi.fn(), access: vi.fn(), market: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/app-shell", () => ({
    getAppHomeContext: state.context,
    getAppHomeAccess: state.access,
    getMarketSummary: state.market,
    getAppHomeSnapshot: () => { throw new Error("Page data must not await the notification feed"); },
}));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ from: state.from, rpc: state.rpc }) }));
vi.mock("@/lib/dal/visible-profiles", () => ({ fetchActivityPartnerProfiles: async () => ({ data: [], error: null }) }));
vi.mock("@/components/layout/AppNavigationProvider", () => ({ AppRouteReady: () => null }));
vi.mock("@/components/activity/ActivitiesPageClient", () => ({ ActivitiesPageClient: () => null }));
vi.mock("@/components/activity/ProviderActivityList", () => ({ ProviderActivityList: () => null }));
vi.mock("@/components/notifications/NotificationSettingsForm", () => ({ NotificationSettingsForm: () => null }));
vi.mock("@/components/settings/PasswordResetButton", () => ({ PasswordResetButton: () => null }));
vi.mock("@/components/jobs/CreateJobForm", () => ({ CreateJobForm: () => null }));

import ActivityPage from "@/app/app-home/activities/page";
import NotificationSettingsPage from "@/app/app-home/settings/notifications/page";
import SecuritySettingsPage from "@/app/app-home/settings/security/page";
import NewOfferPage from "@/app/app-home/offers/new/page";

describe("protected pages start their data without waiting for header notifications", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.context.mockResolvedValue({ profile: { id: "provider", market_id: "market" }, effectiveView: { viewRole: "job_provider" }, accountEmail: "synthetic@example.invalid" });
        state.access.mockResolvedValue({ isVerified: true });
        state.market.mockResolvedValue({ display_name: "Teststadt" });
        state.rpc.mockResolvedValue({ data: [], error: null });
        state.from.mockImplementation(() => {
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "eq", "order"]) builder[method] = () => builder;
            builder.maybeSingle = async () => ({ data: null, error: null });
            builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
            return builder;
        });
    });

    it.each(["job_provider", "job_seeker"])("loads the %s inbox using the shared authenticated context", async viewRole => {
        state.context.mockResolvedValue({ profile: { id: "own-user" }, effectiveView: { viewRole } });
        renderToStaticMarkup(await ActivityPage({}) as ReactElement);
        expect(state.from).toHaveBeenCalledWith("applications");
    });

    it("loads notification preferences independently of the notification feed", async () => {
        renderToStaticMarkup(await NotificationSettingsPage());
        expect(state.from).toHaveBeenCalledWith("notification_preferences");
    });

    it("starts security activity without waiting for the header feed or market", async () => {
        renderToStaticMarkup(await SecuritySettingsPage());
        expect(state.rpc).toHaveBeenCalledWith("get_my_security_events", { p_limit: 5 });
        expect(state.market).not.toHaveBeenCalled();
    });

    it("reuses the request-scoped market summary for verified job creation", async () => {
        renderToStaticMarkup(await NewOfferPage());
        expect(state.market).toHaveBeenCalledWith("market");
        expect(state.from).not.toHaveBeenCalled();
    });

    it("keeps the verification redirect ahead of form and market loading", async () => {
        state.access.mockResolvedValue({ isVerified: false });
        await expect(NewOfferPage()).rejects.toThrow("REDIRECT:/app-home/profile?focus=provider-verification&from=create-job");
        expect(state.market).not.toHaveBeenCalled();
    });

    it("redirects seekers before starting provider access or market reads", async () => {
        state.context.mockResolvedValue({ profile: { id: "seeker" }, effectiveView: { viewRole: "job_seeker" } });
        await expect(NewOfferPage()).rejects.toThrow("REDIRECT:/app-home/jobs");
        expect(state.access).not.toHaveBeenCalled();
        expect(state.market).not.toHaveBeenCalled();
    });
});
