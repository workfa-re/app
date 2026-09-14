import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ createBrowserClient: vi.fn(), createServerClient: vi.fn(), createClient: vi.fn(), cookies: vi.fn(), getAll: vi.fn(), set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: state.createBrowserClient, createServerClient: state.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.createClient }));
vi.mock("next/headers", () => ({ cookies: state.cookies }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-server-only-key");
  state.cookies.mockResolvedValue({ getAll: state.getAll, set: state.set });
  state.getAll.mockReturnValue([{ name: "wf-demo-auth", value: "fixture-session" }]);
  state.createBrowserClient.mockReturnValue({ kind: "fixture-browser" });
  state.createServerClient.mockReturnValue({ kind: "fixture-server" });
  state.createClient.mockReturnValue({ kind: "fixture-admin" });
});
afterEach(() => vi.unstubAllEnvs());

describe("actual app Supabase clients use the same deployment cookie boundary", () => {
  it.each([false, true])("browser and server share cookie options without changing the production default (demo %s)", async (demo) => {
    if (!demo) {
      vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
      vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "false");
    }
    await import("@/lib/supabaseClient");
    const { supabaseServer } = await import("@/lib/supabaseServer");
    await supabaseServer();
    const expected = demo ? { name: "wf-demo-auth", sameSite: "lax", path: "/" } : undefined;
    for (const factory of [state.createBrowserClient, state.createServerClient]) {
      expect(factory).toHaveBeenCalledOnce();
      expect(factory.mock.calls[0].slice(0, 2)).toEqual(["https://abcdefghijklmnopqrst.supabase.co", "fixture-public-key"]);
      expect(factory.mock.calls[0][2].cookieOptions).toEqual(expected);
      expect(JSON.stringify(factory.mock.calls)).not.toContain("fixture-server-only-key");
    }
  });
  it("retains the server cookie adapter and response options", async () => {
    const { supabaseServer } = await import("@/lib/supabaseServer");
    await supabaseServer();
    const adapter = state.createServerClient.mock.calls[0][2].cookies;
    const options = { path: "/", secure: true, sameSite: "lax", maxAge: 60 };
    expect(adapter.getAll()).toEqual([{ name: "wf-demo-auth", value: "fixture-session" }]);
    adapter.setAll([{ name: "wf-demo-auth", value: "refreshed-fixture", options }]);
    expect(state.set).toHaveBeenCalledExactlyOnceWith("wf-demo-auth", "refreshed-fixture", options);
    state.set.mockImplementation(() => { throw new Error("Read-only server component cookies"); });
    expect(() => adapter.setAll([{ name: "wf-demo-auth", value: "refreshed-fixture", options }])).not.toThrow();
  });
  it("keeps the service key exclusively in the nonpersisting admin client", async () => {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    getSupabaseAdminClient();
    expect(state.createClient).toHaveBeenCalledExactlyOnceWith("https://abcdefghijklmnopqrst.supabase.co", "fixture-server-only-key", {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, db: { schema: "public" },
    });
    expect(state.createBrowserClient).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"])("rejects production %s before normal or admin server access", async (variable) => {
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    vi.stubEnv(variable, "https://fqaditikccbxivpxukxp.supabase.co");
    await expect(supabaseServer()).rejects.toThrow("production Supabase project is forbidden");
    expect(() => getSupabaseAdminClient()).toThrow("production Supabase project is forbidden");
    expect(state.cookies).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
    expect(state.createClient).not.toHaveBeenCalled();
  });
  it("revalidates the demo environment even when an admin client was cached", async () => {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    getSupabaseAdminClient();
    vi.stubEnv("SUPABASE_URL", "https://fqaditikccbxivpxukxp.supabase.co");
    expect(() => getSupabaseAdminClient()).toThrow("production Supabase project is forbidden");
    expect(state.createClient).toHaveBeenCalledOnce();
  });
  it("preserves the browser guard against accidentally configured service-role JWTs", async () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", `fixture.${payload}.fixture`);
    await expect(import("@/lib/supabaseClient")).rejects.toThrow("service_role key");
    expect(state.createBrowserClient).not.toHaveBeenCalled();
  });
});
