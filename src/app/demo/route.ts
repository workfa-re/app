import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { demoAuthCookieOptions } from "@/lib/demo/auth-cookie";
import { demoHomePath, parseDemoRole } from "@/lib/demo/roles";
import { DEMO_THEME_COOKIE, DEMO_THEME_MAX_AGE, parseDemoTheme, resolveDemoTheme } from "@/lib/demo/theme";
import { DEMO_VISITOR_COOKIE, getDemoLoginToken, getOrCreateDemoVisit } from "@/lib/demo/session";
import { enrollLocalPaymentPreview } from "@/lib/payments/repository.server";
import { PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { enrollLocalRecipientPreview } from "@/lib/payments/recipient-repository.server";
import { getSandboxPreviewVisit } from "@/lib/payments/sandbox-preview.server";

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

  const payValues = request.nextUrl.searchParams.getAll("pay");
  if (payValues.length > 1 || (payValues.length === 1 && payValues[0] !== "1")) {
    return new NextResponse("Unbekannte Testansicht.", { status: 400, headers: noStoreHeaders });
  }
  const paymentPreview = payValues.length === 1;
  const recipientValues = request.nextUrl.searchParams.getAll("recipient");
  if (recipientValues.length > 1 || (recipientValues.length === 1 && (recipientValues[0] !== "adult" || !paymentPreview || role !== "seeker"))) {
    return new NextResponse("Unbekannte Testansicht.", { status: 400, headers: noStoreHeaders });
  }
  const adultRecipient = recipientValues.length === 1;

  try {
    const paymentRuntime = paymentPreview ? requirePaymentRuntime() : null;
    if (adultRecipient && paymentRuntime?.mode !== "sandbox") {
      return new NextResponse("Diese Zahlungsansicht ist nur im vorbereiteten lokalen Sandbox-Test verfügbar.", { status: 400, headers: noStoreHeaders });
    }
    if (paymentRuntime?.mode === "sandbox" && (request.nextUrl.origin !== paymentRuntime.origin
      || (request.headers.get("origin") !== null && request.headers.get("origin") !== paymentRuntime.origin)
      || ![null,"same-origin","none"].includes(request.headers.get("sec-fetch-site")))) {
      return new NextResponse("Diese Testansicht ist nur direkt im lokalen Browser verfügbar.", { status: 403, headers: noStoreHeaders });
    }
    const environment = requireDemoEnvironment();
    const preview = paymentRuntime?.mode === "sandbox"
      ? await getSandboxPreviewVisit(request.cookies.get(DEMO_VISITOR_COOKIE)?.value, role, adultRecipient)
      : { ...await getOrCreateDemoVisit(request.cookies.get(DEMO_VISITOR_COOKIE)?.value, request.headers), identity: role };
    const { visit, token, identity } = preview;
    const loginToken = await getDemoLoginToken(visit, identity);
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
    if (error || data.user?.id !== visit.identities[identity]) throw new Error("Demo login verification failed.");
    // Explicit opt-in after normal seeding: no special job-insert bypass and no
    // payment gate applied to unrelated demo visitors or real accounts.
    if (paymentPreview && paymentRuntime?.mode === "local_simulation") {
      if (role === "seeker") await enrollLocalRecipientPreview(data.user.id);
      else await enrollLocalPaymentPreview(data.user.id);
    }
    response.cookies.set(DEMO_VISITOR_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/",
      expires: new Date(visit.expires_at),
    });
    response.cookies.set(DEMO_THEME_COOKIE, theme, {
      sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: DEMO_THEME_MAX_AGE,
    });
    return response;
  } catch (error) {
    if (error instanceof PaymentFlowError && error.code === "sandbox_preview_required") {
      return new NextResponse("Diese Zahlungs-Testansicht muss zuerst für deine bestehende Demo vorbereitet werden.", { status: 403, headers: noStoreHeaders });
    }
    // No Auth response, credential, cookie or personal data is written to the log.
    console.error("Demo entry unavailable:", error instanceof Error ? error.message : "unknown error");
    return new NextResponse("Die Demo ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.", { status: 503, headers: noStoreHeaders });
  }
}
