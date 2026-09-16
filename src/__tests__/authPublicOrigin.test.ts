import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";
import { POST } from "@/app/auth/logout/route";

type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => void;
};
const auth = vi.hoisted(() => ({ exchange: vi.fn(), signOut: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: auth.create }));
let cookies: CookieAdapter;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.workfa.re");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  auth.create.mockImplementation((_url, _key, options: { cookies: CookieAdapter }) => {
    cookies = options.cookies;
    return { auth: { exchangeCodeForSession: auth.exchange, signOut: auth.signOut } };
  });
  auth.exchange.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
function request(path: string, method = "GET") {
  return new NextRequest(`https://localhost:3000${path}`, {
    method, headers: { "x-forwarded-host": "untrusted.example", cookie: "fixture-auth=previous" },
  });
}
describe("authentication redirects behind a reverse proxy", () => {
  it("returns missing codes to the configured public origin", async () => {
    const response = await GET(request("/auth/callback"));
    expect(response.headers.get("location")).toBe("https://app.workfa.re/onboarding?error=auth_code_error");
    expect(auth.create).not.toHaveBeenCalled();
  });
  it("keeps the intended path, query and session cookies after a successful exchange", async () => {
    auth.exchange.mockImplementation(async () => {
      expect(cookies.getAll()).toEqual([{ name: "fixture-auth", value: "previous" }]);
      cookies.setAll([{ name: "fixture-auth", value: "renewed", options: { path: "/", secure: true, httpOnly: true } }]);
      return { error: null };
    });
    const response = await GET(request("/auth/callback?code=fixture&next=%2Fapp-home%3Ftab%3Djobs"));
    expect(auth.exchange).toHaveBeenCalledWith("fixture");
    expect(response.headers.get("location")).toBe("https://app.workfa.re/app-home?tab=jobs&verified=true");
    expect(response.cookies.get("fixture-auth")).toMatchObject({ value: "renewed", secure: true, httpOnly: true });
  });
  it("retains protection against external next destinations", async () => {
    const response = await GET(request("/auth/callback?code=fixture&next=https%3A%2F%2Funtrusted.example"));
    expect(response.headers.get("location")).toBe("https://app.workfa.re/onboarding?verified=true");
  });
  it("returns failed exchanges to the public origin", async () => {
    auth.exchange.mockResolvedValue({ error: new Error("Fixture invalid code") });
    const response = await GET(request("/auth/callback?code=fixture"));
    expect(response.headers.get("location")).toBe("https://app.workfa.re/onboarding?error=auth_code_error");
  });
  it("uses the local request origin when no site URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
    const response = await GET(request("/auth/callback"));
    expect(response.headers.get("location")).toBe("https://localhost:3000/onboarding?error=auth_code_error");
  });
  it("logs out with cookie removal and redirects POST to a public GET", async () => {
    auth.signOut.mockImplementation(async () => {
      cookies.setAll([{ name: "fixture-auth", value: "", options: { path: "/", maxAge: 0 } }]);
      return { error: null };
    });
    const response = await POST(request("/auth/logout", "POST"));
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.workfa.re/");
    expect(response.cookies.get("fixture-auth")).toMatchObject({ value: "", maxAge: 0 });
  });
});
