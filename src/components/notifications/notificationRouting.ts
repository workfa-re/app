const NOTIFICATION_ROUTE_ORIGIN = "https://workfare.internal";

const ALLOWED_ROUTE_ROOTS = [
    "/app-home/activities",
    "/app-home/applications",
    "/app-home/jobs",
    "/app-home/messages",
    "/app-home/notifications",
    "/app-home/offers",
    "/app-home/profile",
    "/app-home/settings",
] as const;

const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
    "/notifications": "/app-home/notifications",
    "/notifications/settings": "/app-home/settings/notifications",
    "/app-home/notifications/settings": "/app-home/settings/notifications",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedPath(pathname: string) {
    if (pathname === "/app-home") return true;
    return ALLOWED_ROUTE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * Returns a normalized, internal destination for a notification payload.
 * External URLs, protocol-relative URLs and paths outside the consumer app
 * are deliberately rejected before they reach Next.js navigation.
 */
export function getNotificationRoute(data: unknown): string | null {
    if (!isRecord(data) || typeof data.route !== "string") return null;

    const rawRoute = data.route.trim();
    if (
        rawRoute.length === 0
        || rawRoute.length > 2_048
        || !rawRoute.startsWith("/")
        || rawRoute.startsWith("//")
        || rawRoute.includes("\\")
        || /[\u0000-\u001F\u007F]/.test(rawRoute)
    ) {
        return null;
    }

    try {
        const parsed = new URL(rawRoute, NOTIFICATION_ROUTE_ORIGIN);
        if (parsed.origin !== NOTIFICATION_ROUTE_ORIGIN || parsed.username || parsed.password) return null;

        const canonicalPath = LEGACY_ROUTE_REDIRECTS[parsed.pathname] ?? parsed.pathname;
        if (!isAllowedPath(canonicalPath)) return null;

        return `${canonicalPath}${parsed.search}${parsed.hash}`;
    } catch {
        return null;
    }
}
