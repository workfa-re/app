import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

const state = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), from: vi.fn(), rpc: vi.fn(), queries: [] as Array<{ table: string; steps: Array<[string, ...unknown[]]> }> }));
vi.mock("@/lib/guardian/access-state.server", () => ({ getGuardianApplicationAccess: state.access }));
vi.mock("@/lib/auth", () => ({ getAuthState: state.auth }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ from: state.from, rpc: state.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));

import { getAppHomeAccess, getAppHomeContext, getAppHomeSnapshot } from "@/lib/app-shell";

const profile = {
  id: "synthetic-user", account_type: "job_seeker", provider_kind: null,
  birthdate: `${new Date().getUTCFullYear() - 16}-01-01`,
  market_id: "synthetic-market", guardian_status: "pending", email: " synthetic@example.test ",
  provider_verification_status: null, provider_verified_at: null,
} as Profile;

describe("app shell data and page access contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.queries = [];
    state.access.mockResolvedValue({ guardianStatus: "linked", hasActiveGuardian: true, isVerified: true, canApply: true });
    state.rpc.mockResolvedValue({ data: { ok: true, notifications: [{ id: "synthetic-notification", title: "Test", type: "info", user_id: profile.id }],
      unread_count: 17, has_more: false, snapshot_at: "2026-10-23T12:00:00Z" }, error: null });
    state.auth.mockResolvedValue({ state: "ready", profile, effectiveView: { viewRole: "job_seeker", roles: [] }, systemRoles: ["moderator"] });
    state.from.mockImplementation((table: string) => {
      const query = { table, steps: [] as Array<[string, ...unknown[]]> };
      state.queries.push(query);
      const response = () => table === "guardian_relationships" ? { data: [{ child_id: profile.id }] }
        : table === "regions_live" ? { data: { id: profile.market_id, city: "Teststadt", is_live: true } }
          : query.steps.some(([method, , options]) => method === "select" && (options as { head?: boolean })?.head)
            ? { count: 17, error: null }
            : { data: [{ id: "synthetic-notification", title: "Test" }], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = (...args: unknown[]) => { query.steps.push([method, ...args]); return builder; };
      builder.maybeSingle = async () => response();
      builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response()).then(resolve, reject);
      return builder;
    });
  });

  it("provides authenticated page identity without starting header or access queries", async () => {
    const context = await getAppHomeContext();
    expect(state.from).not.toHaveBeenCalled();
    expect(context).toMatchObject({ sessionUserId: profile.id, accountEmail: "synthetic@example.test", isStaff: true });
    expect(context.profile).toBe(context.profileLite);
  });

  it("keeps redirects ahead of every protected query", async () => {
    for (const [status, href] of [["no-session", "/"], ["email-unconfirmed", "/"], ["incomplete-profile", "/onboarding"]]) {
      state.auth.mockResolvedValue({ state: status });
      await expect(getAppHomeContext()).rejects.toThrow(`REDIRECT:${href}`);
    }
    expect(state.from).not.toHaveBeenCalled();
  });

  it("uses the shared server-owned consent decision rather than treating a family link as approval", async () => {
    const context = await getAppHomeContext();
    const access = await getAppHomeAccess(context);
    expect(access).toEqual({ guardianStatus: "linked", hasActiveGuardian: true, isVerified: true, canApply: true });
    expect(state.access).toHaveBeenCalledOnce();
    expect(state.queries).toEqual([]);
  });

  it("does not query guardian relationships for provider views", async () => {
    state.auth.mockResolvedValue({ state: "ready", profile: { ...profile, provider_verification_status: "verified", provider_verified_at: "2026-10-20T12:00:00Z" }, effectiveView: { viewRole: "job_provider", roles: [] }, systemRoles: [] });
    const access = await getAppHomeAccess(await getAppHomeContext());
    expect(access).toMatchObject({ canApply: false, isVerified: true, hasActiveGuardian: false });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.access).not.toHaveBeenCalled();
  });

  it("allows adult seekers without a guardian without claiming verification", async () => {
    state.auth.mockResolvedValue({ state: "ready", profile: { ...profile, birthdate: `${new Date().getUTCFullYear() - 19}-01-01` }, effectiveView: { viewRole: "job_seeker", roles: [] }, systemRoles: [] });
    state.access.mockResolvedValue({ guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: true });
    expect(await getAppHomeAccess(await getAppHomeContext())).toEqual({ guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: true });
  });

  it.each([null, "invalid", "2030-01-01", "1990-01-01"])("does not turn a family link into seeker age eligibility: %s", birthdate => {
    state.auth.mockResolvedValue({ state: "ready", profile: { ...profile, birthdate }, effectiveView: { viewRole: "job_seeker", roles: [] }, systemRoles: [] });
    state.access.mockResolvedValue({ guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: false });
    return getAppHomeContext().then(getAppHomeAccess).then(access => expect(access.canApply).toBe(false));
  });

  it.each([
    { status: "pending", verifiedAt: "2026-10-20T12:00:00Z" },
    { status: "rejected", verifiedAt: "2026-10-20T12:00:00Z" },
    { status: "none", verifiedAt: "2026-10-20T12:00:00Z" },
    { status: "verified", verifiedAt: null },
  ])("keeps provider creation access aligned with the database insert guard: %o", async ({ status, verifiedAt }) => {
    state.auth.mockResolvedValue({ state: "ready", profile: { ...profile, provider_verification_status: status, provider_verified_at: verifiedAt }, effectiveView: { viewRole: "job_provider", roles: [] }, systemRoles: [] });
    expect(await getAppHomeAccess(await getAppHomeContext())).toMatchObject({ isVerified: false, canApply: false });
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([null, { guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: false }])("keeps applying disabled without a confirmed access decision: %o", async (response) => {
    state.access.mockResolvedValue(response);
    const access = await getAppHomeAccess(await getAppHomeContext());
    expect(access).toEqual({ guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: false });
  });

  it("preserves the full header snapshot, exact unread count and bounded preview", async () => {
    const snapshot = await getAppHomeSnapshot();
    expect(snapshot).toMatchObject({ unreadCount: 17, notificationsPreview: [{ id: "synthetic-notification" }], canApply: true, guardianStatus: "linked", market: { id: profile.market_id } });
    expect(snapshot.profile).toBe(snapshot.profileLite);
    expect(snapshot.profile).toMatchObject({ guardian_status: "linked", has_active_guardian: true });
    expect(state.rpc).toHaveBeenCalledWith("get_notification_feed", { p_limit: 25 });
    expect(state.queries.some(query => query.table === "notifications")).toBe(false);
  });

  it("keeps rolling-deployment fallback recipient-owned and visibility-filtered", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC not found" } });
    const snapshot = await getAppHomeSnapshot();
    expect(snapshot.unreadCount).toBe(17);
    const queries = state.queries.filter(query => query.table === "notifications");
    expect(queries.length).toBe(2);
    for (const query of queries) {
      expect(query.steps).toContainEqual(["eq", "user_id", profile.id]);
      expect(query.steps).toContainEqual(["eq", "in_app_visible", true]);
    }
  });

  it("does not bypass the atomic feed after an authorization or transport error", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Permission denied" } });
    const snapshot = await getAppHomeSnapshot();
    expect(snapshot.notificationsPreview).toEqual([]);
    expect(snapshot.unreadCount).toBe(0);
    expect(state.queries.some(query => query.table === "notifications")).toBe(false);
  });

  it("fails closed on a malformed feed or a mismatched recipient", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, notifications: [{ id: "foreign", title: "Test", type: "info", user_id: "other" }],
      unread_count: 1, has_more: false, snapshot_at: "2026-10-23T12:00:00Z" }, error: null });
    expect((await getAppHomeSnapshot()).notificationsPreview).toEqual([]);
    state.rpc.mockResolvedValue({ data: { ok: true, notifications: [] }, error: null });
    expect((await getAppHomeSnapshot()).unreadCount).toBe(0);
  });
});
