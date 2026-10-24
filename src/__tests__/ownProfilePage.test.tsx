import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ requireProfile: vi.fn(), guardians: vi.fn(), wards: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/guardian/access-state.server", () => ({ getGuardianApplicationAccess: state.access }));
vi.mock("@/lib/auth", () => ({ requireCompleteProfile: state.requireProfile }));
vi.mock("@/app/actions/guardian", () => ({ getGuardians: state.guardians, getWards: state.wards }));
vi.mock("@/components/profile/ProfileEditForm", () => ({ ProfileEditForm: () => null }));
import ProfilePage from "@/app/app-home/profile/page";

describe("own profile server data", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        state.requireProfile.mockResolvedValue({ profile: { id: "own-profile" }, systemRoles: [], session: { user: { last_sign_in_at: "2026-10-24T10:00:00Z", email_confirmed_at: "2026-10-20T12:00:00Z" } } });
        state.guardians.mockResolvedValue({ guardians: [] });
        state.wards.mockResolvedValue({ wards: [] });
        state.access.mockResolvedValue(null);
    });

    it("loads both account directions concurrently after checking profile access", async () => {
        let resolveGuardians!: (value: unknown) => void;
        state.guardians.mockReturnValue(new Promise(resolve => { resolveGuardians = resolve; }));
        const result = ProfilePage();
        await Promise.resolve();
        expect(state.guardians).toHaveBeenCalledOnce();
        expect(state.wards).toHaveBeenCalledOnce();
        resolveGuardians({ guardians: [{ id: "guardian", full_name: "Parent", email: null }] });
        const page = await result as ReactElement<Record<string, unknown>>;
        expect(page.props).toMatchObject({ guardians: [{ id: "guardian" }], wards: [], guardianLoadError: null, wardsLoadError: null, emailConfirmed: true, lastLogin: { created_at: "2026-10-24T10:00:00Z" } });
    });

    it("passes independent relationship errors without hiding successful rows", async () => {
        state.guardians.mockResolvedValue({ error: "Elternfreigaben nicht verfügbar" });
        state.wards.mockResolvedValue({ wards: [{ id: "child", full_name: "Child", email: null }] });
        const page = await ProfilePage() as ReactElement<Record<string, unknown>>;
        expect(page.props).toMatchObject({ guardians: [], wards: [{ id: "child" }], guardianLoadError: "Elternfreigaben nicht verfügbar", wardsLoadError: null });
    });

    it("uses verified auth confirmation rather than a stale profile confirmation field", async () => {
        state.requireProfile.mockResolvedValue({ profile: { id: "own-profile", email_verified_at: null }, systemRoles: [], session: { user: { email_confirmed_at: "2026-10-20T12:00:00Z" } } });
        const page = await ProfilePage() as ReactElement<Record<string, unknown>>;
        expect(page.props.emailConfirmed).toBe(true);
        expect(page.props.lastLogin).toBeNull();
    });

    it("does not interpret phone or generic confirmation as email confirmation", async () => {
        state.requireProfile.mockResolvedValue({ profile: { id: "own-profile", email_verified_at: "2026-10-20T12:00:00Z" }, systemRoles: [], session: { user: {
            email_confirmed_at: null, phone_confirmed_at: "2026-10-20T12:00:00Z", confirmed_at: "2026-10-20T12:00:00Z",
        } } });
        const page = await ProfilePage() as ReactElement<Record<string, unknown>>;
        expect(page.props.emailConfirmed).toBe(false);
    });

    it("never starts privileged linked-account loads when profile access redirects", async () => {
        state.requireProfile.mockRejectedValue(new Error("REDIRECT:/"));
        await expect(ProfilePage()).rejects.toThrow("REDIRECT:/");
        expect(state.guardians).not.toHaveBeenCalled();
        expect(state.wards).not.toHaveBeenCalled();
    });
});
