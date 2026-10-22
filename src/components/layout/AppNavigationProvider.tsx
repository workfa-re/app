"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { endPerfMark } from "@/lib/perf";

type AppNavigationContextValue = {
    pendingHref: string | null;
    isStalled: boolean;
    beginNavigation: (href: string) => void;
    completeNavigation: (href: string) => void;
};

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

function matchesPath(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavigationProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname() || "";
    const [pendingHref, setPendingHref] = useState<string | null>(null);
    const [isStalled, setIsStalled] = useState(false);
    const previousPathnameRef = useRef(pathname);

    const beginNavigation = useCallback((href: string) => {
        setPendingHref(matchesPath(pathname, href) ? null : href);
    }, [pathname]);

    const completeNavigation = useCallback((href: string) => {
        setPendingHref((currentHref) => (
            currentHref && matchesPath(href, currentHref) ? null : currentHref
        ));
    }, []);

    useEffect(() => {
        endPerfMark("app-header-route");
        endPerfMark("app-mobile-dock-route");
        if (previousPathnameRef.current === pathname) return;
        previousPathnameRef.current = pathname;

        setPendingHref((currentHref) => (
            currentHref && !matchesPath(pathname, currentHref) ? null : currentHref
        ));
    }, [pathname]);

    useEffect(() => {
        setIsStalled(false);
        if (!pendingHref) return;

        const timeoutId = window.setTimeout(() => setIsStalled(true), 15_000);
        return () => window.clearTimeout(timeoutId);
    }, [pendingHref]);

    const value = useMemo(
        () => ({ pendingHref, isStalled, beginNavigation, completeNavigation }),
        [beginNavigation, completeNavigation, isStalled, pendingHref],
    );

    return (
        <AppNavigationContext.Provider value={value}>
            {children}
        </AppNavigationContext.Provider>
    );
}

export function useAppNavigation() {
    const context = useContext(AppNavigationContext);
    if (!context) {
        throw new Error("useAppNavigation must be used within AppNavigationProvider");
    }
    return context;
}

export function AppNavigationViewport({ children }: { children: ReactNode }) {
    const { pendingHref, isStalled } = useAppNavigation();

    return (
        <>
            <div className="app-navigation-content" aria-busy={Boolean(pendingHref)}>
                {children}
            </div>
            <span className="sr-only" role="status">{pendingHref ? "Seite wird geladen." : ""}</span>
            {isStalled && pendingHref ? (
                <div className="container mx-auto -mt-3 px-4 pb-8 md:px-6" role="alert">
                    <div className="mx-auto flex max-w-[78rem] flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200/80 bg-white/90 px-4 py-3 text-sm text-neutral-700 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/85 dark:text-neutral-200">
                        <span>Das Laden dauert ungewöhnlich lange.</span>
                        <a
                            href={pendingHref}
                            className="font-medium text-neutral-950 underline underline-offset-4 dark:text-white"
                        >
                            Seite neu laden
                        </a>
                    </div>
                </div>
            ) : null}
        </>
    );
}

export function AppRouteReady({ href }: { href: string }) {
    const { completeNavigation } = useAppNavigation();

    useEffect(() => {
        completeNavigation(href);
    }, [completeNavigation, href]);

    return null;
}
