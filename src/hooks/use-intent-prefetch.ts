"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Warm an intended destination, never every visible route on first paint. */
export function useIntentPrefetch() {
    const router = useRouter();
    const pathname = usePathname();
    const recent = useRef(new Map<string, number>());
    return useCallback((href: string) => {
        if (href === pathname) return;
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        if (connection?.saveData || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return;
        const now = Date.now();
        if (now - (recent.current.get(href) ?? 0) < 30_000) return;
        recent.current.set(href, now);
        router.prefetch(href);
    }, [pathname, router]);
}
