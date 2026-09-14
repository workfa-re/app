import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoHomePath, parseDemoRole } from "@/lib/demo/roles";

const state = vi.hoisted(() => ({
  createServerClient: vi.fn(), verifyOtp: vi.fn(), getOrCreateDemoVisit: vi.fn(), getDemoLoginToken: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.createServerClient }));
vi.mock("@/lib/demo/session", () => ({
  DEMO_VISITOR_COOKIE: "wf-demo-visitor", getOrCreateDemoVisit: state.getOrCreateDemoVisit, getDemoLoginToken: state.getDemoLoginToken,
}));
const token = "a".repeat(64);
const visit = {
  id: "00000000-0000-4000-8000-000000000001", expires_at: "2060-01-01T00:00:00.000Z",
  identities: {
    seeker: "00000000-0000-4000-8000-000000000002",
    "private-provider": "00000000-0000-4000-8000-000000000003",
    company: "00000000-0000-4000-8000-000000000004",
    guardian: "00000000-0000-4000-8000-000000000005",
    "peer-seeker": "00000000-0000-4000-8000-000000000006",
  },
};
let GET: typeof import("@/app/demo/route").GET;
let HEAD: typeof import("@/app/demo/route").HEAD;
const authCookie = { name: "wf-demo-auth.0", value: "fixture-session", options: { path: "/", secure: true, sameSite: "lax" as const, maxAge: 3600 } };
function cookieAdapter() {
  return state.createServerClient.mock.calls[0][2].cookies as {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => void;
  };
}
function request(query = "", protocol = "https") {
  return new NextRequest(`${protocol}://demo.example/demo${query}`, {
    headers: { cookie: `wf-demo-visitor=${token}; preference=dark` },
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  state.getOrCreateDemoVisit.mockResolvedValue({ visit, token });
  state.getDemoLoginToken.mockResolvedValue("fixture-hashed-otp");
  state.createServerClient.mockReturnValue({ auth: { verifyOtp: state.verifyOtp } });
  state.verifyOtp.mockImplementation(async () => {
    cookieAdapter().setAll([authCookie]);
    return { data: { user: { id: visit.identities.seeker } }, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  ({ GET, HEAD } = await import("@/app/demo/route"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("explicit demo role allowlist", () => {
  it.each(["seeker", "private-provider", "company"] as const)("accepts %s with an internal app destination", (role) => {
    expect(parseDemoRole(role)).toBe(role);
    expect(demoHomePath(role)).toBe(role === "seeker" ? "/app-home/jobs" : "/app-home/offers");
  });
  it.each([null, undefined, "", "admin", "guardian", "peer-seeker", "__proto__", "Seeker", " seeker", "company ", 1, {}, ["seeker"]])(
    "rejects unknown or coercible roles", (value) => expect(parseDemoRole(value)).toBeNull(),
  );
});

describe("demo entry is a gated cookie bootstrap", () => {
  it.each(["?theme=system", "?theme=", "?theme=dark&theme=dark", "?theme=light&theme=dark", "?theme=LIGHT", "?theme=%20dark", "?theme=__proto__"])("rejects invalid or duplicate themes before provisioning: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(state.getOrCreateDemoVisit).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });
  it.each(["dark", "light"])("sets explicit %s before each role redirect even for an existing visitor", async (theme) => {
    for (const role of ["seeker", "private-provider", "company"] as const) {
      state.verifyOtp.mockResolvedValue({ data: { user: { id: visit.identities[role] } }, error: null });
      const incoming = new NextRequest(`https://demo.example/demo?role=${role}&theme=${theme}`, {
        headers: { cookie: `wf-demo-visitor=${token}; wf-demo-theme=${theme === "dark" ? "light" : "dark"}` },
      });
      const response = await GET(incoming);
      expect(response.status).toBe(303);
      expect(response.cookies.get("wf-demo-theme")).toMatchObject({ value: theme, secure: true, sameSite: "lax", path: "/", maxAge: 86400 });
      expect(response.cookies.get("wf-demo-theme")?.httpOnly).not.toBe(true);
      expect(state.getOrCreateDemoVisit).toHaveBeenLastCalledWith(token, incoming.headers);
    }
  });
  it.each([
    { cookie: "light", expected: "light" }, { cookie: "dark", expected: "dark" },
    { cookie: "system", expected: "dark" }, { cookie: "invalid", expected: "dark" },
  ])("uses only a valid stored theme when query is absent ($cookie)", async ({ cookie, expected }) => {
    const response = await GET(new NextRequest("http://demo.example/demo", { headers: { cookie: `wf-demo-theme=${cookie}` } }));
    expect(response.status).toBe(303);
    expect(response.cookies.get("wf-demo-theme")).toMatchObject({ value: expected, secure: false });
  });
  it.each(["?role=admin", "?role=", "?role=company&role=seeker", "?role=seeker&role=seeker", "?role=%20seeker", "?role=__proto__"])(
    "refuses invalid or duplicate roles before provisioning: %s", async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(state.getOrCreateDemoVisit).not.toHaveBeenCalled();
      expect(state.createServerClient).not.toHaveBeenCalled();
      expect(response.cookies.getAll()).toEqual([]);
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
  it.each([undefined, "false", "1"])("disabled deployment does no provisioning (%s)", async (value) => {
    vi.stubEnv("WORKFARE_DEMO_ENABLED", value);
    expect((await GET(request())).status).toBe(404);
    expect((await HEAD()).status).toBe(404);
    expect(state.getOrCreateDemoVisit).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
  it("HEAD does not consume a visit or create a session", async () => {
    expect((await HEAD()).status).toBe(200);
    expect(state.getOrCreateDemoVisit).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
  it.each(["seeker", "private-provider", "company"] as const)("logs in only the visit's %s UID, then redirects internally", async (role) => {
    state.verifyOtp.mockImplementation(async () => {
      cookieAdapter().setAll([authCookie]);
      return { data: { user: { id: visit.identities[role] } }, error: null };
    });
    const incoming = request(`?role=${role}&redirectTo=https://untrusted.example&userId=arbitrary`);
    const response = await GET(incoming);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://demo.example${demoHomePath(role)}`);
    expect(state.getOrCreateDemoVisit).toHaveBeenCalledExactlyOnceWith(token, incoming.headers);
    expect(state.getDemoLoginToken).toHaveBeenCalledExactlyOnceWith(visit, role);
    expect(state.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: "fixture-hashed-otp", type: "email" });
    expect(state.createServerClient.mock.calls[0].slice(0, 2)).toEqual(["https://abcdefghijklmnopqrst.supabase.co", "fixture-public-key"]);
    expect(state.createServerClient.mock.calls[0][2].cookieOptions).toEqual({ name: "wf-demo-auth", sameSite: "lax", path: "/" });
    expect(cookieAdapter().getAll()).toEqual([{ name: "wf-demo-visitor", value: token }, { name: "preference", value: "dark" }]);
    expect(response.cookies.get(authCookie.name)).toMatchObject({ name: authCookie.name, value: authCookie.value, ...authCookie.options });
    expect(response.cookies.get("wf-demo-visitor")).toMatchObject({ value: token, httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(visit.expires_at) });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("location")).not.toContain("fixture-hashed-otp");
  });
  it("defaults an absent role to seeker and preserves local non-secure cookie transport", async () => {
    const response = await GET(request("", "http"));
    expect(response.status).toBe(303);
    expect(state.getDemoLoginToken).toHaveBeenCalledWith(visit, "seeker");
    expect(response.cookies.get("wf-demo-visitor")?.secure).toBe(false);
    expect(response.cookies.get("wf-demo-theme")?.value).toBe("dark");
  });
  it.each([
    { data: { user: { id: "arbitrary-user-id" } }, error: null },
    { data: { user: null }, error: null },
    { data: { user: { id: visit.identities.seeker } }, error: new Error("Fixture OTP failure") },
  ])("discards generated cookies and does not redirect after incorrect OTP identity", async (result) => {
    state.verifyOtp.mockImplementation(async () => { cookieAdapter().setAll([authCookie]); return result; });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.has("location")).toBe(false);
    expect(response.cookies.getAll()).toEqual([]);
  });
  it("rejects a production database endpoint before provisioning", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fqaditikccbxivpxukxp.supabase.co");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(state.getOrCreateDemoVisit).not.toHaveBeenCalled();
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
  it("does not expose provisioning errors in its response", async () => {
    state.getOrCreateDemoVisit.mockRejectedValue(new Error("private-fixture-error"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-fixture-error");
    expect(response.cookies.getAll()).toEqual([]);
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
});
