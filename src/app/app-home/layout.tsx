import { AppHeader } from "@/components/layout/AppHeader";
import "./surface-refinement.css";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { getAppHomeSnapshot } from "@/lib/app-shell";
import {
    AppNavigationProvider,
    AppNavigationViewport,
} from "@/components/layout/AppNavigationProvider";

export default async function AppHomeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const snapshot = await getAppHomeSnapshot();

    return (
        <AppNavigationProvider>
            <div className="app-shell relative flex min-h-dvh flex-col">

                <RoleGuard profile={snapshot.profile} />

                {/* Persistent Header */}
                <AppHeader snapshot={snapshot} />

                {/* Page Content */}
                <main className="app-shell-main relative flex-1">
                    <AppNavigationViewport>{children}</AppNavigationViewport>
                </main>

                {/* Shared Footer (Optional, can be added later) */}
            </div>
        </AppNavigationProvider>
    );
}
