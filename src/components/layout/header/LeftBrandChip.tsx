"use client";

import { currentBrandLabel } from "@/lib/brand-compat";

import Link from "next/link";
import { BRAND_NAME } from "@/lib/constants";
import type { Market } from "@/lib/types";
import { BrandLogoImage } from "@/components/ui/BrandLogoImage";

export function LeftBrandChip({ market }: { market: Market | null }) {
    return (
        <Link
            href="/app-home"
            prefetch={false}
            className="app-brand-chip group flex h-[52px] items-center gap-2 rounded-full border border-transparent pl-[6px] pr-3 outline-none transition-[box-shadow,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none motion-reduce:active:scale-100 md:pr-4"
        >
            <div className="app-brand-logo-ring relative h-10 w-10 shrink-0 rounded-[10px] border p-[1px]">
                <div className="app-brand-logo-badge h-full w-full overflow-hidden rounded-[9px]">
                    <BrandLogoImage
                        alt={`${BRAND_NAME} Logo`}
                        width={44}
                        height={44}
                        priority
                        className="app-brand-logo-image h-full w-full object-contain object-center"
                    />
                </div>
            </div>

            <div className="app-brand-chip-label hidden min-w-0 flex-col justify-center md:flex">
                <span className="app-brand-chip-title -my-[3px] max-w-[7.5rem] truncate py-[3px] text-base font-semibold leading-[1.02] tracking-[-0.035em] text-white md:max-w-none md:text-[19px]">
                    {currentBrandLabel(market?.brand_prefix)}
                </span>
                {market?.display_name && (
                    <span className="app-brand-chip-subtitle hidden text-xs font-medium leading-[1.15] tracking-[-0.01em] text-sky-100/70 lg:block">
                        {currentBrandLabel(market.display_name)}
                    </span>
                )}
            </div>
        </Link>
    );
}
