import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest, NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => void;
};
const state = vi.hoisted(() => ({
  createServerClient: vi.fn(), getUser: vi.fn(),
  getCurrentSessionAndProfile: vi.fn(), themeProvider: vi.fn(), bridge: vi.fn(), cookies: vi.fn(), cookieGet: vi.fn(), script: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.createServerClient }));
vi.mock("next/font/google", () => ({ Plus_Jakarta_Sans: () => ({ variable: "test-font" }) }));
vi.mock("next/script", () => ({ default: state.script }));
vi.mock("next/headers", () => ({ cookies: state.cookies }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionAndProfile: state.getCurrentSessionAndProfile }));
vi.mock("@/components/providers/ThemeProvider", () => ({ ThemeProvider: state.themeProvider }));
vi.mock("@/components/demo/DemoEmbedBridge", () => ({ DemoEmbedBridge: state.bridge }));

let proxy: typeof import("@/proxy").proxy;
let RootLayout: typeof import("@/app/layout").default;
async function loadRuntime() {
  vi.resetModules();
  ({ proxy } = await import("@/proxy"));
  ({ default: RootLayout } = await import("@/app/layout"));
}
async function enableDemo() {
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  await loadRuntime();
}
function requestFor(path: string, cookie = "test-session=existing-session", method = "GET") {
  return new NextRequest(`https://platform.example${path}`, {
    method, headers: { cookie, "x-request-id": "demo-proxy-test", "x-workfare-public-demo": "1" },
  });
}
function forwardedHeaders(response: NextResponse) {
  const headers = new Headers();
  const names = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  for (const name of names.map((value) => value.trim()).filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}
function configuredCookies(): CookieAdapter {
  return state.createServerClient.mock.calls[0][2].cookies as CookieAdapter;
}
async function renderLayout() {
  return renderToStaticMarkup(await RootLayout({ children: createElement("span", null, "Actual app content") }));
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", undefined);
  vi.stubEnv("SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  state.createServerClient.mockReturnValue({ auth: { getUser: state.getUser } });
  state.getUser.mockResolvedValue({ data: { user: null }, error: null });
  state.getCurrentSessionAndProfile.mockResolvedValue({ profile: { account_type: "job_seeker", theme_preference: "light" } });
  state.themeProvider.mockImplementation(({ children }: { children?: ReactNode }) => children);
  state.bridge.mockReturnValue(null);
  state.script.mockReturnValue(null);
  state.cookies.mockResolvedValue({ get: state.cookieGet });
  await loadRuntime();
});
afterEach(() => vi.unstubAllEnvs());

describe("normal session validation in both deployments", () => {
  it.each(["/demo?role=company", "/app-home", "/demo/unterpfad", "/api/profile", "/login"])(
    "a forged old marker cannot skip auth on %s", async (path) => {
      const response = await proxy(requestFor(path));
      expect(response).toBeInstanceOf(NextResponse);
      expect(state.getUser).toHaveBeenCalledOnce();
      expect(state.createServerClient.mock.calls[0][2].cookieOptions).toBeUndefined();
    },
  );
  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "the real demo follows normal auth and routing for %s", async (method) => {
      await enableDemo();
      const response = await proxy(requestFor("/demo?role=company", undefined, method));
      expect(response.status).toBe(200);
      expect(response.headers.get("allow")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(state.getUser).toHaveBeenCalledOnce();
      expect(state.createServerClient.mock.calls[0][2].cookieOptions).toEqual({ name: "wf-demo-auth", sameSite: "lax", path: "/" });
    },
  );
  it("preserves the existing public legal exemption", async () => {
    await proxy(requestFor("/legal/privacy"));
    expect(state.createServerClient).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps refreshed cookies downstream and on the response (demo %s)", async (demo) => {
    if (demo) await enableDemo();
    const request = requestFor("/app-home", "fixture-auth.0=old-part; preference=dark");
    const options: CookieOptions = { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600 };
    const refreshed = [
      { name: "fixture-auth.0", value: "refreshed-one", options },
      { name: "fixture-auth.1", value: "refreshed-two", options },
    ];
    state.getUser.mockImplementation(async () => {
      expect(configuredCookies().getAll()).toEqual([
        { name: "fixture-auth.0", value: "old-part" }, { name: "preference", value: "dark" },
      ]);
      configuredCookies().setAll(refreshed);
      return { data: { user: { id: "fixture-user" } }, error: null };
    });
    const response = await proxy(request);
    const downstream = new NextRequest(request.url, { headers: forwardedHeaders(response) });
    for (const cookie of refreshed) {
      expect(request.cookies.get(cookie.name)?.value).toBe(cookie.value);
      expect(downstream.cookies.get(cookie.name)?.value).toBe(cookie.value);
      expect(response.cookies.get(cookie.name)).toMatchObject({ name: cookie.name, value: cookie.value, ...options });
    }
    expect(downstream.cookies.get("preference")?.value).toBe("dark");
    expect(downstream.headers.get("x-request-id")).toBe("demo-proxy-test");
    expect(response.cookies.getAll()).toHaveLength(2);
  });
  it("continues normally when auth validation throws", async () => {
    state.getUser.mockRejectedValue(new Error("Fixture invalid refresh token"));
    const response = await proxy(requestFor("/app-home"));
    expect(response.status).toBe(200);
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(response.cookies.getAll()).toEqual([]);
  });
  it("retains cookie removal when auth validation then throws", async () => {
    const cookie = { name: "fixture-auth.0", value: "", options: { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "lax" as const } };
    state.getUser.mockImplementation(async () => {
      configuredCookies().setAll([cookie]);
      throw new Error("Fixture expired refresh token");
    });
    const response = await proxy(requestFor("/app-home", "fixture-auth.0=expired; preference=dark"));
    const downstream = new NextRequest("https://platform.example/app-home", { headers: forwardedHeaders(response) });
    expect(response.status).toBe(200);
    expect(response.cookies.get(cookie.name)).toMatchObject({ name: cookie.name, value: "", ...cookie.options });
    expect(downstream.cookies.get(cookie.name)?.value).toBe("");
    expect(downstream.cookies.get("preference")?.value).toBe("dark");
  });
});

describe("root layout uses the actual profile", () => {
  it.each(["dark", "light"])("renders demo %s on the server and in bootstrap before hydration", async (theme) => {
    await enableDemo();
    state.cookieGet.mockReturnValue({ value: theme });
    const html = await renderLayout();
    expect(state.cookieGet).toHaveBeenCalledExactlyOnceWith("wf-demo-theme");
    expect(html).toContain(`class="${theme} bg-background"`);
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: theme, enableSystem: false });
    expect(state.script.mock.calls[0][0].dangerouslySetInnerHTML.__html).toContain(`const theme = "${theme}"`);
  });
  it.each([undefined, "system", "LIGHT", "dark; other=value", "<script>bad</script>"])("ignores invalid cosmetic cookie %s", async (value) => {
    await enableDemo();
    state.cookieGet.mockReturnValue(value ? { value } : undefined);
    const html = await renderLayout();
    expect(html).toContain('class="dark bg-background"');
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: "dark", enableSystem: false });
  });
  it.each(["light", "dark", "system"])("keeps normal profile preference %s without reading demo cookies", async (theme) => {
    state.getCurrentSessionAndProfile.mockResolvedValue({ profile: { account_type: "job_seeker", theme_preference: theme } });
    await renderLayout();
    expect(state.cookies).not.toHaveBeenCalled();
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: theme, enableSystem: true });
    expect(state.bridge).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps account lookup and preserves production profile theme (demo %s)", async (demo) => {
    if (demo) await enableDemo();
    await proxy(requestFor("/app-home"));
    await renderLayout();
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(state.getCurrentSessionAndProfile).toHaveBeenCalledOnce();
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: demo ? "dark" : "light", enableSystem: !demo });
    expect(state.cookies).toHaveBeenCalledTimes(demo ? 1 : 0);
    expect(state.bridge).toHaveBeenCalledTimes(demo ? 1 : 0);
  });
  it.each([
    { account_type: "job_seeker", provider_kind: null, role: "seeker" },
    { account_type: "job_provider", provider_kind: "private", role: "private-provider" },
    { account_type: "job_provider", provider_kind: "company", role: "company" },
    { account_type: "job_provider", provider_kind: null, role: null },
  ])("reports only the actual $account_type/$provider_kind profile role", async ({ account_type, provider_kind, role }) => {
    await enableDemo();
    state.getCurrentSessionAndProfile.mockResolvedValue({ profile: { account_type, provider_kind, theme_preference: "system" } });
    await renderLayout();
    expect(state.bridge.mock.calls[0][0]).toMatchObject({ role });
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: "dark", enableSystem: false });
  });
  it("keeps dark as a deterministic demo default without inventing a profile role", async () => {
    await enableDemo();
    state.getCurrentSessionAndProfile.mockResolvedValue({ profile: null });
    await renderLayout();
    expect(state.bridge.mock.calls[0][0]).toMatchObject({ role: null });
    expect(state.themeProvider.mock.calls[0][0]).toMatchObject({ defaultTheme: "dark", enableSystem: false });
  });
});

describe("demo runtime fails closed before database access", () => {
  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"])("rejects production %s in proxy and layout", async (variable) => {
    await enableDemo();
    vi.stubEnv(variable, "https://fqaditikccbxivpxukxp.supabase.co");
    await expect(proxy(requestFor("/app-home"))).rejects.toThrow("production Supabase project is forbidden");
    await expect(renderLayout()).rejects.toThrow("production Supabase project is forbidden");
    expect(state.createServerClient).not.toHaveBeenCalled();
    expect(state.getCurrentSessionAndProfile).not.toHaveBeenCalled();
  });
  it("rejects a public demo flag on an ordinary server before auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
    await expect(proxy(requestFor("/app-home"))).rejects.toThrow();
    await expect(renderLayout()).rejects.toThrow();
    expect(state.createServerClient).not.toHaveBeenCalled();
    expect(state.getCurrentSessionAndProfile).not.toHaveBeenCalled();
  });
});
