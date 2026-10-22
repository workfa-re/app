"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { startPerfMark } from "@/lib/perf";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useAppNavigation } from "../AppNavigationProvider";
import { getAppNavItems } from "./navItems";

export function MobileBottomDock({ profile, enabled }: { profile: Profile | null; enabled: boolean }) {
    const pathname = usePathname();
    const warmRoute = useIntentPrefetch();
    const reducedMotion = useReducedMotion();
    const { pendingHref, beginNavigation } = useAppNavigation();
    const currentPath = pendingHref || pathname || "";
    const committedPath = pathname || "";
    const navItems = getAppNavItems(profile);
    if (!enabled) return null;

    return (
        <LayoutGroup id="app-mobile-navigation"><nav
            aria-label="Hauptnavigation"
            className="app-mobile-dock-shell"
        >
            <div className="app-mobile-dock-panel">
                {navItems.map((item) => {
                    const isActive = item.activePattern.test(currentPath);
                    const isCurrent = item.activePattern.test(committedPath);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={false}
                            aria-label={item.label}
                            aria-current={isCurrent ? "page" : undefined}
                            onClick={(event) => {
                                const isPlainPrimaryClick = event.button === 0
                                    && !event.metaKey
                                    && !event.ctrlKey
                                    && !event.shiftKey
                                    && !event.altKey;
                                if (isCurrent && isPlainPrimaryClick) {
                                    beginNavigation(item.href);
                                }
                            }}
                            onNavigate={() => {
                                beginNavigation(item.href);
                                if (!isCurrent) {
                                    startPerfMark("app-mobile-dock-route");
                                }
                            }}
                            onPointerEnter={event => { if (event.pointerType === "mouse") warmRoute(item.href); }}
                            onFocus={() => warmRoute(item.href)}
                            className={cn(
                                "app-mobile-dock-item",
                                isActive && "is-active"
                            )}
                        >
                            {isActive && <motion.span aria-hidden="true" className="app-mobile-dock-active"
                                layoutId="app-mobile-navigation-selection" initial={false}
                                transition={{ type: "spring", duration: reducedMotion ? 0 : 0.32, bounce: 0 }} />}
                            <span className="app-mobile-dock-content">
                                <item.icon
                                    aria-hidden="true"
                                    size={19}
                                    strokeWidth={1.7}
                                    className="app-mobile-dock-icon"
                                />
                                <span className="app-mobile-dock-label">
                                    {item.label}
                                </span>
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav></LayoutGroup>
    );
}
