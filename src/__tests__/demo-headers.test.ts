import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

async function responseHeaders() {
  const rules = await nextConfig.headers!();
  const global = rules.find(rule => rule.source === "/:path*");
  expect(global).toBeDefined();
  return Object.fromEntries(global!.headers.map(({ key, value }) => [key, value]));
}
function enableDemo() {
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
}
function enableLocalSandbox() {
  enableDemo();
  vi.stubEnv("WORKFARE_PAY_MODE", "sandbox");
  vi.stubEnv("WORKFARE_DEMO_MODE", "local");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", "workfare-local");
  vi.stubEnv("WORKFARE_DEMO_LOCAL_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3001");
}
function directive(policy: string, name: string) {
  return policy.split("; ").find((part) => part.startsWith(`${name} `));
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("WORKFARE_PAY_MODE", "disabled");
});
afterEach(() => vi.unstubAllEnvs());

describe("full application deployment framing policy", () => {
  it.each([false, true])("protects invitation and receipt pages independently of demo mode (%s)", async demo => {
    if (demo) enableDemo();
    const rules = await nextConfig.headers!();
    const index = rules.findIndex(rule => rule.source === "/guardian/:path*");
    expect(index).toBeGreaterThan(rules.findIndex(rule => rule.source === "/:path*"));
    expect(Object.fromEntries(rules[index].headers.map(({ key, value }) => [key, value]))).toEqual({
      "Referrer-Policy": "no-referrer", "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
  });
  it("keeps the real production platform unframeable without constraining normal requests", async () => {
    expect(await responseHeaders()).toEqual({ "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" });
  });
  it("permits the hosted demo only inside the two website origins", async () => {
    enableDemo();
    const headers = await responseHeaders();
    const policy = headers["Content-Security-Policy"];
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors https://workfa.re https://www.workfa.re");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "img-src")).toContain("https://tile.openstreetmap.org");
    expect(directive(policy, "img-src")).not.toContain("cartocdn.com");
    expect(directive(policy, "img-src")).toContain("https://abcdefghijklmnopqrst.supabase.co");
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("unsafe-eval");
    expect(headers).not.toHaveProperty("X-Frame-Options");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow, noarchive");
  });
  it.each(["disabled", "local_simulation", undefined])("does not allow Stripe in demo mode %s", async (mode) => {
    enableDemo();
    vi.stubEnv("WORKFARE_PAY_MODE", mode);
    expect((await responseHeaders())["Content-Security-Policy"]).not.toContain("stripe.com");
  });
  it("does not alter production framing even if the payment mode is accidentally set", async () => {
    vi.stubEnv("WORKFARE_PAY_MODE", "sandbox");
    expect(await responseHeaders()).toEqual({ "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" });
  });
  it("permits documented embedded Stripe surfaces only in the isolated local sandbox", async () => {
    enableLocalSandbox();
    const headers = await responseHeaders();
    const policy = headers["Content-Security-Policy"];
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://connect-js.stripe.com");
    expect(directive(policy, "frame-src")).toBe("frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://connect-js.stripe.com");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' http://127.0.0.1:55321 ws://127.0.0.1:55321 https://api.stripe.com https://checkout.stripe.com");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors https://workfa.re https://www.workfa.re");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), payment=()");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("https://*.stripe.com");
    expect(policy).not.toContain("link.com");
    expect(policy).not.toContain("googleapis.com");
  });
  it.each([
    ["WORKFARE_DEMO_MODE", "hosted"],
    ["WORKFARE_DEMO_PROJECT_REF", "fqaditikccbxivpxukxp"],
    ["WORKFARE_DEMO_PROJECT_REF", ""],
    ["WORKFARE_DEMO_LOCAL_URL", "https://example.test:55321"],
    ["WORKFARE_DEMO_LOCAL_URL", "http://127.0.0.1"],
    ["SUPABASE_URL", "http://127.0.0.1:55322"],
    ["APP_ORIGIN", "https://app.workfa.re"],
    ["APP_ORIGIN", "http://private:secret@localhost:3001"],
    ["APP_ORIGIN", "http://localhost:3001/path"],
    ["APP_ORIGIN", "http://localhost:3001?x=1"],
  ])("rejects a sandbox CSP outside the local identity contract: %s", async (key, value) => {
    enableLocalSandbox();
    vi.stubEnv(key, value);
    await expect(responseHeaders()).rejects.toThrow("isolated local demo configuration");
  });
  it("allows explicitly listed local website and local demo service in development", async () => {
    enableDemo();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    const policy = (await responseHeaders())["Content-Security-Policy"];
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors https://workfa.re https://www.workfa.re http://localhost:3000 http://127.0.0.1:3000");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' http://127.0.0.1:55321 ws://127.0.0.1:55321 ws://localhost:3001 ws://127.0.0.1:3001");
  });
  it.each(["WORKFARE_DEMO_ENABLED", "NEXT_PUBLIC_WORKFARE_DEMO_ENABLED"])("rejects mismatched flag %s", async (variable) => {
    vi.stubEnv(variable, "true");
    await expect(responseHeaders()).rejects.toThrow("activation flags must match");
  });
  it.each([undefined, "javascript:alert(1)", "https://user:private@example.test", "https://example.test/;connect-src *", "https://example.test?x=1", "https://example.test/#demo", "https://example.test\n"])(
    "never interpolates a noncanonical endpoint into CSP", async (value) => {
      enableDemo();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value);
      await expect(responseHeaders()).rejects.toThrow("canonical Supabase base URL");
    },
  );
});
