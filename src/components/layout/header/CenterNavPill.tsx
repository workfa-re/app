"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { Profile } from "@/lib/types";
import { startPerfMark } from "@/lib/perf";
import { useAppNavigation } from "../AppNavigationProvider";
import { getAppNavItems } from "./navItems";

export function CenterNavPill({ profile, instanceId = "default" }: { profile: Profile | null; instanceId?: string }) {
    const warmRoute = useIntentPrefetch();
    const pathname = usePathname() || "";
    const { pendingHref, beginNavigation } = useAppNavigation();
    const reducedMotion = useReducedMotion();
    const navItems = getAppNavItems(profile);

    return (
        <LayoutGroup id={`app-nav-${instanceId}`}>
            <nav aria-label="Hauptnavigation" className="app-glass-nav app-glass-control">
                {navItems.map((item) => {
                    const active = item.activePattern.test(pendingHref || pathname);
                    const current = item.activePattern.test(pathname);
                    return <Link key={item.href} href={item.href} prefetch={false}
                        aria-label={item.label} aria-current={current ? "page" : undefined}
                        data-active={active} className="app-nav-link"
                        onClick={event => {
                            if (current && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) beginNavigation(item.href);
                        }}
                        onNavigate={() => {
                            beginNavigation(item.href);
                            if (!current) startPerfMark("app-header-route");
                        }}
                        onPointerEnter={(event) => { if (event.pointerType === "mouse") warmRoute(item.href); }}
                        onFocus={() => warmRoute(item.href)}>
                        {active && <motion.span className="app-glass-selection" layoutId={`app-nav-selection-${instanceId}`} initial={false}
                            transition={{ type: "spring", duration: reducedMotion ? 0 : 0.34, bounce: 0 }} />}
                        <item.icon size={17} strokeWidth={1.7} aria-hidden="true" />
                        <span>{item.label}</span>
                    </Link>;
                })}
            </nav>
        </LayoutGroup>
    );
}
