import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

async function responseHeaders() {
  const rules = await nextConfig.headers!();
  expect(rules).toHaveLength(1);
  expect(rules[0].source).toBe("/:path*");
  return Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
}
function enableDemo() {
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
}
function directive(policy: string, name: string) {
  return policy.split("; ").find((part) => part.startsWith(`${name} `));
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("full application deployment framing policy", () => {
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
    expect(directive(policy, "img-src")).toContain("https://*.basemaps.cartocdn.com");
    expect(directive(policy, "img-src")).toContain("https://abcdefghijklmnopqrst.supabase.co");
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("unsafe-eval");
    expect(headers).not.toHaveProperty("X-Frame-Options");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow, noarchive");
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
