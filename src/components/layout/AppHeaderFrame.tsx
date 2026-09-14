import type { ReactNode } from "react";

type AppHeaderFrameProps = {
    brand: ReactNode;
    desktopNavigation: ReactNode;
    mobileNavigation: ReactNode;
    actions: ReactNode;
    bottomDock?: ReactNode;
};

// Presentation only: callers supply either connected app controls or local demo controls.
export function AppHeaderFrame({ brand, desktopNavigation, mobileNavigation, actions, bottomDock }: AppHeaderFrameProps) {
    return (
        <>
            <div aria-hidden="true" className="app-header-scrim pointer-events-none fixed inset-x-0 top-0 z-40" />
            <header className="app-header-shell pointer-events-none fixed left-0 right-0 top-0 z-50 px-4 md:px-6 lg:px-8">
                <div className="pointer-events-auto mx-auto flex h-[52px] max-w-7xl items-center justify-between gap-1.5 md:gap-3 lg:gap-4">
                    <div className="flex flex-shrink-0 items-center gap-1 md:gap-3">{brand}</div>
                    {desktopNavigation ? (
                        <div className="hidden md:flex app-header-center-nav absolute left-1/2 -translate-x-1/2">{desktopNavigation}</div>
                    ) : null}
                    {mobileNavigation ? (
                        <div className="flex md:hidden app-phone-top-nav-fallback">{mobileNavigation}</div>
                    ) : null}
                    <div className="flex flex-shrink-0 justify-end gap-2 md:gap-3 lg:gap-4">
                        <div className="flex items-center">{actions}</div>
                    </div>
                </div>
            </header>
            {bottomDock}
        </>
    );
}
