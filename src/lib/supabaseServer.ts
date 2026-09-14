import { requireDemoEnvironment } from "@/lib/demo/environment";
import { demoAuthCookieOptions } from "@/lib/demo/auth-cookie";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/lib/types/supabase";

export async function supabaseServer() {
  if (process.env.WORKFARE_DEMO_ENABLED === "true") requireDemoEnvironment();
  const cookieStore: Awaited<ReturnType<typeof cookies>> = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase env vars. Bitte NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local setzen.");
  }

  return createServerClient<Database>(
    url,
    anonKey,
    {
      cookieOptions: demoAuthCookieOptions,
      db: {
        schema: "public",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // no-op when called from a Server Component (read-only context).
            // The middleware will handle the cookie refresh in that case.
          }
        },
      },
      global: {
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            cache: "no-store",
          });
        },
      },
    }
  );
}
