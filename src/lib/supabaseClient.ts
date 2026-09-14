"use client";

import { createBrowserClient } from "@supabase/ssr";
import { demoAuthCookieOptions } from "@/lib/demo/auth-cookie";
import { Database } from "@/lib/types/supabase";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function decodeJwtPayload(token: string): unknown | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
    let json = "";
    if (typeof atob === "function") {
      json = atob(base64);
    } else if (typeof Buffer !== "undefined") {
      json = Buffer.from(base64, "base64").toString("utf8");
    } else {
      return null;
    }
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

if (!url || !anonKey) {
  throw new Error("Missing Supabase env vars. Bitte NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local setzen.");
}

const anonPayload = decodeJwtPayload(anonKey);
if (anonPayload && typeof anonPayload === "object" && "role" in anonPayload && (anonPayload as { role?: string }).role === "service_role") {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is set to a service_role key. This would leak full database access to the browser. " +
      "Set NEXT_PUBLIC_SUPABASE_ANON_KEY to the anon/public key and put the service key into SUPABASE_SERVICE_ROLE_KEY (server-only).",
  );
}

export const supabaseBrowser = createBrowserClient<Database>(url, anonKey, {
  cookieOptions: demoAuthCookieOptions,
  db: {
    schema: "public",
  },
});

// Legacy export für Kompatibilität während der Migration
export const createSupabaseClient = () => supabaseBrowser;
