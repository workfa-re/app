import type { NextConfig } from "next";

/** Build-time permission only; payment APIs independently enforce their runtime. */
function localStripeSandbox(supabaseOrigin: string) {
  if (process.env.WORKFARE_PAY_MODE !== "sandbox") return false;
  const projectRef = process.env.WORKFARE_DEMO_PROJECT_REF;
  const canonical = (value: string | undefined) => {
    const url = new URL(value ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash
      || (value !== url.origin && value !== `${url.origin}/`)) throw new Error();
    return url;
  };
  try {
    const database = canonical(process.env.WORKFARE_DEMO_LOCAL_URL);
    const server = canonical(process.env.SUPABASE_URL ?? supabaseOrigin);
    const app = canonical(process.env.APP_ORIGIN);
    if (process.env.WORKFARE_DEMO_MODE !== "local" || !projectRef
      || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectRef) || projectRef === "fqaditikccbxivpxukxp"
      || !["localhost", "127.0.0.1"].includes(database.hostname) || !database.port
      || database.origin !== supabaseOrigin || server.origin !== supabaseOrigin
      || !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)) throw new Error();
    return true;
  } catch {
    // Environment values may contain credentials; never interpolate them.
    throw new Error("Stripe browser access requires the verified isolated local demo configuration.");
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  agentRules: false,
  async headers() {
    const demoEnabled = process.env.WORKFARE_DEMO_ENABLED === "true";
    const publicDemoEnabled = process.env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED === "true";
    if (demoEnabled !== publicDemoEnabled) {
      throw new Error("Workfare demo server and public activation flags must match.");
    }

    if (!demoEnabled) {
      return [{
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      }];
    }

    // Runtime identity validation lives in the server-only demo environment helper.
    // Here only a canonical origin may enter the build-time response policy.
    let supabaseOrigin: string;
    try {
      const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const url = new URL(value ?? "");
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== "/"
        || (value !== url.origin && value !== `${url.origin}/`)) throw new Error();
      supabaseOrigin = url.origin;
    } catch {
      throw new Error("Workfare demo requires a canonical Supabase base URL.");
    }
    const isDevelopment = process.env.NODE_ENV !== "production";
    const stripeSandbox = localStripeSandbox(supabaseOrigin);
    // https://docs.stripe.com/security/guide#content-security-policy
    // Restrict Stripe.js' documented sharded frames to *.js.stripe.com, not
    // arbitrary Stripe/Link/Google hosts. No extra eval or device permissions.
    const stripeScripts = stripeSandbox ? " https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://connect-js.stripe.com" : "";
    const stripeConnections = stripeSandbox ? " https://api.stripe.com https://checkout.stripe.com" : "";
    const stripeImages = stripeSandbox ? " https://js.stripe.com https://checkout.stripe.com https://connect-js.stripe.com" : "";
    const realtimeOrigin = supabaseOrigin.replace(/^http/, "ws");
    const parents = ["https://workfa.re", "https://www.workfa.re"];
    if (isDevelopment) parents.push("http://localhost:3000", "http://127.0.0.1:3000");
    const policy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}${stripeScripts}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabaseOrigin} https://tile.openstreetmap.org${stripeImages}`,
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin}${isDevelopment ? " ws://localhost:3001 ws://127.0.0.1:3001" : ""}${stripeConnections}`,
      ...(stripeSandbox ? ["frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://connect-js.stripe.com"] : []),
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${parents.join(" ")}`,
    ].join("; ");

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: policy },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
