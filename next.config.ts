import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    const realtimeOrigin = supabaseOrigin.replace(/^http/, "ws");
    const parents = ["https://workfa.re", "https://www.workfa.re"];
    if (isDevelopment) parents.push("http://localhost:3000", "http://127.0.0.1:3000");
    const policy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabaseOrigin} https://*.basemaps.cartocdn.com`,
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin}${isDevelopment ? " ws://localhost:3001 ws://127.0.0.1:3001" : ""}`,
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
