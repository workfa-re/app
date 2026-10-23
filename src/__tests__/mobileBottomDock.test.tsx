import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RenderedLink = {
    ariaCurrent?: string;
    className?: string;
    href?: string;
    label?: string;
};

const testState = vi.hoisted(() => ({
    beginNavigation: vi.fn(),
    pathname: "/app-home/jobs",
    pendingHref: null as string | null,
    prefetch: vi.fn(),
    renderedLinks: [] as RenderedLink[],
}));

vi.mock("next/navigation", () => ({
    usePathname: () => testState.pathname,
    useRouter: () => ({ prefetch: testState.prefetch }),
}));

vi.mock("next/link", () => ({
    default: ({
        children,
        onNavigate: _onNavigate,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
        children: ReactNode;
        onNavigate?: () => void;
    }) => {
        testState.renderedLinks.push({
            ariaCurrent: props["aria-current"] as string | undefined,
            className: props.className,
            href: typeof props.href === "string" ? props.href : undefined,
            label: props["aria-label"],
        });
        return <a {...props}>{children}</a>;
    },
}));

vi.mock("@/components/layout/AppNavigationProvider", () => ({
    useAppNavigation: () => ({
        beginNavigation: testState.beginNavigation,
        pendingHref: testState.pendingHref,
    }),
}));

vi.mock("@/lib/perf", () => ({
    endPerfMark: vi.fn(),
    startPerfMark: vi.fn(),
}));

import { MobileBottomDock } from "@/components/layout/header/MobileBottomDock";

function renderDock(profile: Parameters<typeof MobileBottomDock>[0]["profile"] = null) {
    return renderToStaticMarkup(<MobileBottomDock enabled profile={profile} />);
}

describe("mobile bottom dock", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        testState.pathname = "/app-home/jobs";
        testState.pendingHref = null;
        testState.renderedLinks = [];
    });

    it("does not add an empty navigation landmark when disabled", () => {
        expect(renderToStaticMarkup(<MobileBottomDock enabled={false} profile={null} />)).toBe("");
        expect(testState.renderedLinks).toHaveLength(0);
    });

    it("renders the three compact destinations and marks the committed route as current", () => {
        testState.pathname = "/app-home/activities";

        const markup = renderDock();

        expect(markup).toContain('aria-label="Hauptnavigation"');
        expect(testState.renderedLinks.map(({ href, label }) => ({ href, label }))).toEqual([
            { href: "/app-home/jobs", label: "Jobs finden" },
            { href: "/app-home/activities", label: "Nachrichten" },
            { href: "/app-home/settings", label: "Einstellungen" },
        ]);
        expect(testState.renderedLinks.find(({ ariaCurrent }) => ariaCurrent === "page")?.label)
            .toBe("Nachrichten");
        expect(testState.renderedLinks.find(({ className }) => className?.includes("is-active"))?.label)
            .toBe("Nachrichten");
    });

    it("uses the provider jobs destination without changing the dock structure", () => {
        testState.pathname = "/app-home/offers/example-offer";

        renderDock({ account_type: "job_provider" } as Parameters<typeof MobileBottomDock>[0]["profile"]);

        expect(testState.renderedLinks).toHaveLength(3);
        expect(testState.renderedLinks[0]).toMatchObject({
            ariaCurrent: "page",
            href: "/app-home/offers",
            label: "Meine Jobs",
        });
    });

    it("shows the pending destination immediately while preserving the committed aria-current route", () => {
        testState.pathname = "/app-home/jobs";
        testState.pendingHref = "/app-home/settings";

        renderDock();

        expect(testState.renderedLinks.find(({ ariaCurrent }) => ariaCurrent === "page")?.label)
            .toBe("Jobs finden");
        expect(testState.renderedLinks.find(({ className }) => className?.includes("is-active"))?.label)
            .toBe("Einstellungen");
    });
});
