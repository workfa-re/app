import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { MobileNavPreferenceControl } from "@/components/settings/MobileNavPreferenceControl";
import { ThemePreferenceControl } from "@/components/settings/ThemePreferenceControl";
import type { MobileNavPreference } from "@/lib/mobile-nav-preference";
import type { ThemePreference } from "@/lib/theme-preference";

type SettingsSurfaceProps = {
    mobileNavPreference: MobileNavPreference;
    themePreference: ThemePreference;
};

const themePreferenceLabels: Record<ThemePreference, string> = {
    system: "Systemeinstellung",
    light: "Hellmodus",
    dark: "Dunkelmodus",
};

export function SettingsSurface({ mobileNavPreference, themePreference }: SettingsSurfaceProps) {
    const navigationStatus = mobileNavPreference === "bottom" ? "Dock unten" : "Tabs oben";
    const themeStatus = themePreferenceLabels[themePreference];

    return (
        <div className="settings-page mx-auto w-full max-w-5xl px-4 pb-14 pt-8 md:px-6">
            <header className="settings-header border-b pb-6">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
                        Einstellungen
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 md:text-base">
                        Lege fest, wie Workfare auf deinen Geräten navigiert und welche Kontobereiche du verwalten möchtest.
                    </p>
                </div>
            </header>

            <div className="settings-panel mt-7 space-y-4 md:space-y-0 md:overflow-hidden">
                <SettingsGroup
                    id="appearance"
                    title="Darstellung"
                    description="Standardmäßig folgt Workfare deinem Gerät."
                >
                    <SettingsRow
                        title="Farbmodus"
                        description={themeStatus}
                    >
                        <ThemePreferenceControl initialPreference={themePreference} />
                    </SettingsRow>
                </SettingsGroup>

                <SettingsGroup
                    id="navigation"
                    title="Navigation"
                    description="Nur für Handys. Desktop und Tablet bleiben unverändert."
                >
                    <SettingsRow
                        title="Handy-Navigation"
                        description={navigationStatus}
                    >
                        <MobileNavPreferenceControl initialPreference={mobileNavPreference} />
                    </SettingsRow>
                </SettingsGroup>

                <SettingsGroup
                    id="konto"
                    title="Konto"
                    description="Weiterführende Einstellungen, die eigene Seiten brauchen."
                >
                    <SettingsLinkRow
                        href="/app-home/profile"
                        title="Profil"
                        description="Persönliche Daten, Sichtbarkeit und Verifizierung."
                    />
                    <SettingsLinkRow
                        href="/app-home/settings/notifications"
                        title="Benachrichtigungen"
                        description="E-Mail, Push und wichtige Updates."
                    />
                    <SettingsLinkRow
                        href="/app-home/settings/security"
                        title="Sicherheit"
                        description="Passwort, Login und Kontoschutz."
                    />
                </SettingsGroup>
            </div>
        </div>
    );
}

function SettingsGroup({
    id,
    title,
    description,
    children,
}: {
    id: string;
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            className="settings-section scroll-mt-28 overflow-hidden"
        >
            <div className="settings-section-grid grid md:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="settings-section-label border-b px-5 py-5 md:border-b-0 md:border-r md:px-6 md:py-6">
                    <h2 className="text-sm font-semibold">{title}</h2>
                    <p className="mt-2 text-sm leading-6">{description}</p>
                </div>
                <div className="settings-section-content divide-y">
                    {children}
                </div>
            </div>
        </section>
    );
}

function SettingsRow({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <div className="settings-row grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.95fr)] md:items-center md:px-6">
            <div className="max-w-xl">
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6">{description}</p>
            </div>
            <div className="settings-control-slot min-w-0">{children}</div>
        </div>
    );
}

function SettingsLinkRow({
    href,
    title,
    description,
}: {
    href: string;
    title: string;
    description: string;
}) {
    return (
        <Link
            href={href}
            className="settings-link-row group grid gap-4 px-5 py-5 transition-colors md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-6"
        >
            <div>
                <h3 className="text-[15px] font-semibold transition-colors">
                    {title}
                </h3>
                <p className="mt-1 text-sm leading-6">{description}</p>
            </div>
            <span className="settings-link-action inline-flex h-9 w-fit items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors">
                Öffnen
                <ChevronRight size={15} />
            </span>
        </Link>
    );
}
