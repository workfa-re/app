import type { ReactNode } from "react";
import { followGlassPointer } from "@/lib/glass-pointer";

type AppHeaderFrameProps = {
    brand: ReactNode;
    desktopNavigation: ReactNode;
    mobileNavigation: ReactNode;
    actions: ReactNode;
    bottomDock?: ReactNode;
    mobileNavPreference?: "top" | "bottom";
};

export function AppHeaderFrame({ brand, desktopNavigation, mobileNavigation, actions, bottomDock, mobileNavPreference = "top" }: AppHeaderFrameProps) {
    return (
        <div className="app-header-region" data-mobile-nav={mobileNavPreference} onPointerMove={followGlassPointer}>
            <div aria-hidden="true" className="app-header-scrim" />
            <header className="app-header-shell">
                <div className="app-header-inner">
                    <div className="app-header-brand">{brand}</div>
                    <div className="app-header-desktop-nav">{desktopNavigation}</div>
                    <div className="app-header-actions">{actions}</div>
                    <div className="app-header-mobile-nav">{mobileNavigation}</div>
                </div>
            </header>
            {bottomDock}
        </div>
    );
}
