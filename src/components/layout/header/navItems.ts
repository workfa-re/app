import { Activity, Briefcase, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Profile } from "@/lib/types";

export type AppNavItem = {
    label: string;
    icon: LucideIcon;
    href: string;
    activePattern: RegExp;
};

export function getAppNavItems(profile: Profile | null): AppNavItem[] {
    const isProvider = profile?.account_type === "job_provider";

    return [
        {
            label: isProvider ? "Meine Jobs" : "Jobs finden",
            icon: Briefcase,
            href: isProvider ? "/app-home/offers" : "/app-home/jobs",
            activePattern: isProvider ? /^\/app-home\/offers/ : /^\/app-home\/jobs/,
        },
        {
            label: isProvider ? "Bewerbungen" : "Meine Jobs",
            icon: Activity,
            href: "/app-home/activities",
            activePattern: /^\/app-home\/activities/,
        },
        {
            label: "Einstellungen",
            icon: Settings,
            href: "/app-home/settings",
            activePattern: /^\/app-home\/settings/,
        },
    ];
}
