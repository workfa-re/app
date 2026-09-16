import { NextResponse } from 'next/server';
import {
    buildOpenPlzUrl,
    openPlzToSearchResults,
    splitLocationQuery,
    type LocationSearchResult,
    type OpenPlzLocality,
} from '@/lib/locationSearch';

const SEARCH_WINDOW_MS = 60_000;
const SEARCH_LIMIT = 30;
const MAX_QUERY_LENGTH = 120;
const requestWindows = new Map<string, { count: number; resetAt: number }>();

function getClientKey(request: Request) {
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(key: string, now = Date.now()) {
    const current = requestWindows.get(key);
    if (!current || current.resetAt <= now) {
        requestWindows.set(key, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
        return false;
    }

    current.count += 1;
    if (requestWindows.size > 1_000) {
        for (const [entryKey, entry] of requestWindows) {
            if (entry.resetAt <= now) requestWindows.delete(entryKey);
        }
    }
    return current.count > SEARCH_LIMIT;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || "";
    const cityOnly = searchParams.get('cityOnly') === 'true';

    if (q.length < 3) {
        return NextResponse.json([]);
    }
    if (q.length > MAX_QUERY_LENGTH) {
        return NextResponse.json({ error: "Ungültige Suchanfrage." }, { status: 400 });
    }
    if (isRateLimited(getClientKey(request))) {
        return NextResponse.json(
            { error: "Zu viele Suchanfragen. Bitte warte kurz." },
            { status: 429, headers: { "Retry-After": "60" } },
        );
    }

    try {
        if (cityOnly) {
            const openPlzUrl = buildOpenPlzUrl(q);
            if (!openPlzUrl) return NextResponse.json([]);

            const response = await fetch(openPlzUrl, {
                next: { revalidate: 3600 },
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "WorkfareAppServer/1.0 (contact: kontakt@workfare.team)"
                }
            });

            if (!response.ok) {
                console.error(`OpenPLZ API returned status: ${response.status}`);
                return NextResponse.json([]);
            }

            const data = await response.json();
            const localities = Array.isArray(data) ? data as OpenPlzLocality[] : [];

            return NextResponse.json(openPlzToSearchResults(localities, q).slice(0, 5));
        }

        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("format", "json");
        url.searchParams.set("q", q);
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "5");
        url.searchParams.set("countrycodes", "de");
        url.searchParams.set("dedupe", "1");

        const response = await fetch(url.toString(), {
            cache: "no-store",
            headers: {
                "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
                "User-Agent": "WorkfareAppServer/1.0 (contact: kontakt@workfare.team)"
            }
        });

        if (!response.ok) {
            console.error(`Nominatim API returned status: ${response.status}`);
                return NextResponse.json([]);
        }

        const { postcode } = splitLocationQuery(q);
        const data = await response.json();
        const results = Array.isArray(data) ? data as LocationSearchResult[] : [];
        const filteredResults = postcode
            ? results.filter((result) => !result.address?.postcode || result.address.postcode === postcode)
            : results;

        return NextResponse.json(filteredResults);
    } catch (error) {
        console.error("Location search error:", error);
        return NextResponse.json([]);
    }
}
