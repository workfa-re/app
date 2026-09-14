import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/lib/types";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { demoAuthCookieOptions } from "@/lib/demo/auth-cookie";

export async function proxy(request: NextRequest) {
  // Deployment identity is checked before any account or database access.
  if (process.env.WORKFARE_DEMO_ENABLED === "true" || process.env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED === "true") {
    requireDemoEnvironment(process.env);
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Public legal pages keep their existing session-refresh exemption.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/legal")) {
    return response;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: demoAuthCookieOptions,
      db: {
        schema: "public",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Keep request cookies in sync so downstream middleware/handlers see latest auth.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set({ name, value });
          });

          // Re-create the response once, then apply all cookie mutations.
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options });
          });
        },
      },
    }
  );

  // IMPORTANT: Use getUser() instead of getSession() in middleware.
  // getUser() contacts the Supabase Auth server, validates the JWT, and
  // refreshes the session if the access token has expired.
  // Wrap in try/catch: stale/invalid refresh tokens should not crash the middleware.
  try {
    await supabase.auth.getUser();
  } catch {
    // Invalid or missing refresh token — treat as unauthenticated.
    // The browser will get fresh tokens on next login.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)"],
};
