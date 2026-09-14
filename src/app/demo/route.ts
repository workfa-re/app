import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { demoAuthCookieOptions } from "@/lib/demo/auth-cookie";
import { demoHomePath, parseDemoRole } from "@/lib/demo/roles";
import { DEMO_THEME_COOKIE, DEMO_THEME_MAX_AGE, parseDemoTheme, resolveDemoTheme } from "@/lib/demo/theme";
import { DEMO_VISITOR_COOKIE, getDemoLoginToken, getOrCreateDemoVisit } from "@/lib/demo/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function HEAD() {
  return new NextResponse(null, { status: process.env.WORKFARE_DEMO_ENABLED === "true" ? 200 : 404, headers: noStoreHeaders });
}

export async function GET(request: NextRequest) {
  if (process.env.WORKFARE_DEMO_ENABLED !== "true") {
    return new NextResponse(null, { status: 404, headers: noStoreHeaders });
  }
  const roleValues = request.nextUrl.searchParams.getAll("role");
  const role = parseDemoRole(roleValues.length === 0 ? "seeker" : roleValues.length === 1 ? roleValues[0] : null);
  if (!role) return new NextResponse("Unbekannte Demoansicht.", { status: 400, headers: noStoreHeaders });

  const themeValues = request.nextUrl.searchParams.getAll("theme");
  const theme = themeValues.length === 0
    ? resolveDemoTheme(request.cookies.get(DEMO_THEME_COOKIE)?.value)
    : themeValues.length === 1 ? parseDemoTheme(themeValues[0]) : null;
  if (!theme) return new NextResponse("Unbekannter Darstellungsmodus.", { status: 400, headers: noStoreHeaders });

  try {
    const environment = requireDemoEnvironment();
    const { visit, token } = await getOrCreateDemoVisit(request.cookies.get(DEMO_VISITOR_COOKIE)?.value, request.headers);
    const loginToken = await getDemoLoginToken(visit, role);
    // No caller-controlled destination: only the normal platform's role-specific home.
    const response = NextResponse.redirect(new URL(demoHomePath(role), request.url), 303);
    for (const [name, value] of Object.entries(noStoreHeaders)) response.headers.set(name, value);
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!publicKey) throw new Error("Demo public credentials are not configured.");
    const supabase = createServerClient(environment.supabaseUrl, publicKey, {
      cookieOptions: demoAuthCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    });
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: loginToken, type: "email" });
    if (error || data.user?.id !== visit.identities[role]) throw new Error("Demo login verification failed.");
    response.cookies.set(DEMO_VISITOR_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/",
      expires: new Date(visit.expires_at),
    });
    response.cookies.set(DEMO_THEME_COOKIE, theme, {
      sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: DEMO_THEME_MAX_AGE,
    });
    return response;
  } catch (error) {
    // No Auth response, credential, cookie or personal data is written to the log.
    console.error("Demo entry unavailable:", error instanceof Error ? error.message : "unknown error");
    return new NextResponse("Die Demo ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.", { status: 503, headers: noStoreHeaders });
  }
}
