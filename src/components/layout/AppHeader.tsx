"use client";

import { useEffect, useState } from "react";
import { AppHeaderFrame } from "./AppHeaderFrame";
import { LeftBrandChip } from "./header/LeftBrandChip";
import { CenterNavPill } from "./header/CenterNavPill";
import { RightActionGroup } from "./header/RightActionGroup";
import { MobileBottomDock } from "./header/MobileBottomDock";
import type { AppHomeSnapshot } from "@/lib/types/jobbridge";
import { usePhoneDevice } from "@/hooks/use-phone-device";
import {
    normalizeMobileNavPreference,
    type MobileNavPreference,
} from "@/lib/mobile-nav-preference";

export function AppHeader({ snapshot }: { snapshot: AppHomeSnapshot }) {
    const isPhoneDevice = usePhoneDevice();
    const [mobileNavPreference, setMobileNavPreference] = useState<MobileNavPreference>(
        normalizeMobileNavPreference(snapshot.profile.mobile_nav_preference)
    );
    const useBottomDock = isPhoneDevice && mobileNavPreference === "bottom";
    useEffect(() => {
        setMobileNavPreference(normalizeMobileNavPreference(snapshot.profile.mobile_nav_preference));
    }, [snapshot.profile.mobile_nav_preference]);

    useEffect(() => {
        document.documentElement.dataset.mobileNavPreference = mobileNavPreference;
        return () => {
            delete document.documentElement.dataset.mobileNavPreference;
        };
    }, [mobileNavPreference]);

    useEffect(() => {
        const handlePreferenceChange = (event: Event) => {
            const nextPreference = (event as CustomEvent<{ preference?: unknown }>).detail?.preference;
            setMobileNavPreference(normalizeMobileNavPreference(nextPreference));
        };

        window.addEventListener("jobbridge:mobile-nav-preference", handlePreferenceChange);
        return () => window.removeEventListener("jobbridge:mobile-nav-preference", handlePreferenceChange);
    }, []);

    return (
        <AppHeaderFrame
            brand={<LeftBrandChip market={snapshot.market} />}
            desktopNavigation={useBottomDock ? null : <CenterNavPill profile={snapshot.profile} instanceId="desktop" />}
            mobileNavigation={useBottomDock ? null : <CenterNavPill profile={snapshot.profile} instanceId="mobile" />}
            actions={
                <RightActionGroup
                    profile={snapshot.profile}
                    isStaff={snapshot.isStaff}
                    accountEmail={snapshot.accountEmail}
                    unreadCount={snapshot.unreadCount}
                    notificationsPreview={snapshot.notificationsPreview}
                />
            }
            bottomDock={<MobileBottomDock profile={snapshot.profile} enabled={useBottomDock} />}
        />
    );
}
