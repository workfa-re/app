import Image from "next/image";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/constants";
import type { Market } from "@/lib/types";

export function LeftBrandChip({ market }: { market: Market | null }) {
    const city = market?.display_name?.trim();

    return (
        <Link href="/app-home" prefetch={false} className="app-brand-link" aria-label={`${BRAND_NAME}${city ? ` ${city}` : ""}`}>
            <span className="app-logo-orb app-glass-control">
                <Image src="/brand/workfare-mark-compact.png" width={32} height={20} alt="" priority />
            </span>
            <span className="app-brand-copy">
                <span className="app-brand-name">{BRAND_NAME}</span>
                {city && <span className="app-brand-location" title={city}>{city}</span>}
            </span>
        </Link>
    );
}
