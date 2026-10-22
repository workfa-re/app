import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

const state = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), queries: [] as Array<{ table: string; steps: Array<[string, ...unknown[]]> }> }));
vi.mock("@/lib/auth", () => ({ getAuthState: state.auth }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ from: state.from }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));

import { getAppHomeAccess, getAppHomeContext, getAppHomeSnapshot } from "@/lib/app-shell";

const profile = {
  id: "synthetic-user", account_type: "job_seeker", provider_kind: null,
  market_id: "synthetic-market", guardian_status: "pending", email: " synthetic@example.test ",
  provider_verification_status: null, provider_verified_at: null,
} as Profile;

describe("app shell data and page access contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.queries = [];
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

  it("uses a bounded existence query and preserves guardian access semantics", async () => {
    const context = await getAppHomeContext();
    const access = await getAppHomeAccess(context);
    expect(access).toEqual({ guardianStatus: "linked", hasActiveGuardian: true, isVerified: true, canApply: true });
    expect(state.queries).toEqual([{ table: "guardian_relationships", steps: [["select", "child_id"], ["eq", "child_id", profile.id], ["eq", "status", "active"], ["limit", 1]] }]);
  });

  it("does not query guardian relationships for provider views", async () => {
    state.auth.mockResolvedValue({ state: "ready", profile: { ...profile, provider_verification_status: "verified" }, effectiveView: { viewRole: "job_provider", roles: [] }, systemRoles: [] });
    const access = await getAppHomeAccess(await getAppHomeContext());
    expect(access).toMatchObject({ canApply: false, isVerified: true, hasActiveGuardian: false });
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([{ data: [], error: null }, { data: null, error: { message: "Synthetic query failure" } }])("keeps applying disabled without a confirmed active relationship: %o", async (response) => {
    state.from.mockImplementation(() => {
      const builder = { select: () => builder, eq: () => builder, limit: async () => response };
      return builder;
    });
    const access = await getAppHomeAccess(await getAppHomeContext());
    expect(access).toEqual({ guardianStatus: "none", hasActiveGuardian: false, isVerified: false, canApply: false });
  });

  it("preserves the full header snapshot, exact unread count and bounded preview", async () => {
    const snapshot = await getAppHomeSnapshot();
    expect(snapshot).toMatchObject({ unreadCount: 17, notificationsPreview: [{ id: "synthetic-notification" }], canApply: true, guardianStatus: "linked", market: { id: profile.market_id } });
    expect(snapshot.profile).toBe(snapshot.profileLite);
    expect(snapshot.profile).toMatchObject({ guardian_status: "linked", has_active_guardian: true });
    const preview = state.queries.find((query) => query.table === "notifications" && query.steps.some(([method]) => method === "limit"));
    expect(preview?.steps).toContainEqual(["limit", 10]);
    expect(preview?.steps).toContainEqual(["order", "id", { ascending: false }]);
  });
});
