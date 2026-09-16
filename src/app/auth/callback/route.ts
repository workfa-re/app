import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Database } from "@/lib/types";
import { safeInternalRedirectOr } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url);
    // Reverse proxies may expose an internal origin in request.url.
    const publicOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin).origin;
    const code = requestUrl.searchParams.get("code");
    const next = safeInternalRedirectOr(requestUrl.searchParams.get("next"), "/onboarding");

    if (code) {
        // Build the final redirect URL upfront so we know where to go.
        const nextUrl = new URL(next, publicOrigin);
        nextUrl.searchParams.set("verified", "true");

        // Create the redirect response ONCE — all cookie mutations happen on THIS object.
        const response = NextResponse.redirect(nextUrl);

        const supabase = createServerClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                db: { schema: "public" },
                cookies: {
                    getAll() {
                        return request.cookies.getAll();
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            response.cookies.set(name, value, options);
                        });
                    },
                },
            }
        );

        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error) {
            // Session cookies are now on `response` — return it directly.
            return response;
        }
    }

    // No code or exchange failed → send back to onboarding with error hint
    return NextResponse.redirect(
        new URL("/onboarding?error=auth_code_error", publicOrigin)
    );
}
