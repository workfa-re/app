import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthState: mock.auth }));
vi.mock("@/lib/app-shell", () => ({ getDefaultAppHomePath: () => "/app-home/offers" }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => null }));
vi.mock("@/components/AuthBridge", () => ({ default: () => null }));
import HomePage from "@/app/page";
import AppHomePage from "@/app/app-home/page";
import OnboardingPage from "@/app/onboarding/page";

const profile = { id: "parent", full_name: "Paula Beispiel", birthdate: "1984-02-12", account_type: null, provider_kind: null, market_id: null, city: null };
describe("family-purpose account routing and explicit provider upgrade", () => {
    beforeEach(() => {
        mock.auth.mockResolvedValue({ state: "family-only", profile, session: { user: { id: "parent", email: "parent@example.invalid", user_metadata: {} } }, systemRoles: [], effectiveView: null });
    });
    it("returns a signed-in parent to family without automatically starting provider registration", async () => {
        await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/guardian/access");
        await expect(AppHomePage()).rejects.toThrow("REDIRECT:/guardian/access");
        await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/guardian/access");
    });
    it("starts explicit provider setup on the same parent identity and retains known details", async () => {
        const screen = await OnboardingPage({ searchParams: Promise.resolve({ purpose: "provider" }) });
        expect(screen.props).toMatchObject({ providerUpgrade: true, forcedStep: "location", initialProfile: profile, initialEmail: "parent@example.invalid", isJustVerified: false });
    });
    it("keeps an existing real market and skips repeated location selection", async () => {
        mock.auth.mockResolvedValue({ state: "family-only", profile: { ...profile, city: "Rheinbach", market_id: "actual-market" }, session: { user: { email: "parent@example.invalid", user_metadata: {} } } });
        const screen = await OnboardingPage({ searchParams: Promise.resolve({ purpose: "provider", verified: "true" }) });
        expect(screen.props).toMatchObject({ providerUpgrade: true, forcedStep: "summary", isJustVerified: false });
    });
    it("does not turn a completed provider back into onboarding", async () => {
        mock.auth.mockResolvedValue({ state: "ready" });
        await expect(OnboardingPage({ searchParams: Promise.resolve({ purpose: "provider" }) })).rejects.toThrow("REDIRECT:/app-home");
    });
    it("does not preassign a provider role to a generic incomplete signup", async () => {
        mock.auth.mockResolvedValue({ state: "incomplete-profile", profile: null, session: { user: { email: "new@example.invalid", user_metadata: {} } } });
        const screen = await OnboardingPage({ searchParams: Promise.resolve({ purpose: "provider" }) });
        expect(screen.props).toMatchObject({ providerUpgrade: false, forcedStep: "role", initialProfile: null });
    });
    it("resumes a known private-provider parent with missing region without another role choice", async () => {
        const partial = { ...profile, account_type: "job_provider", provider_kind: "private" };
        mock.auth.mockResolvedValue({ state: "incomplete-profile", profile: partial, session: { user: { email: "parent@example.invalid", user_metadata: {} } } });
        const screen = await OnboardingPage({ searchParams: Promise.resolve({ purpose: "provider" }) });
        expect(screen.props).toMatchObject({ providerUpgrade: true, forcedStep: "location", initialProfile: partial });
    });
    it("keeps an invitation and a Stripe return when a family account signs in normally", async () => {
        for (const path of ["/guardian/access?token=private-invite", "/guardian/access?recipientHosted=returned&childId=child"]) {
            await expect(HomePage({ searchParams: Promise.resolve({ redirectTo: path, authMode: "signin" }) })).rejects.toThrow(`REDIRECT:${path}`);
        }
        await expect(HomePage({ searchParams: Promise.resolve({ redirectTo: "/app-home/offers" }) })).rejects.toThrow("REDIRECT:/guardian/access");
    });
    it("starts family registration in the shared auth form without choosing a marketplace role or city", async () => {
        mock.auth.mockResolvedValue({ state: "no-session" });
        const screen = await OnboardingPage({ searchParams: Promise.resolve({ purpose: "family", authMode: "signup", redirectTo: "/guardian/access?token=invite" }) });
        expect(screen.props).toMatchObject({ familySetup: true, initialMode: "signup", providerUpgrade: false, redirectTo: "/guardian/access?token=invite" });
    });
    it("a verified incomplete family signup resumes minimal family details instead of provider onboarding", async () => {
        mock.auth.mockResolvedValue({ state: "incomplete-profile", profile: null, session: { user: { email: "parent@example.invalid", user_metadata: { signup_purpose: "family" } } } });
        await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/guardian/access");
        await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/guardian/access");
    });
    it("resumes the shared email confirmation for family signup after the first tab was closed", async () => {
        mock.auth.mockResolvedValue({ state: "email-unconfirmed", profile: null, session: { user: { email: "parent@example.invalid", user_metadata: { signup_purpose: "family" } } } });
        const screen = await OnboardingPage({ searchParams: Promise.resolve({}) });
        expect(screen.props).toMatchObject({ familySetup: true, forcedStep: "email-confirm", initialEmail: "parent@example.invalid" });
    });
});
