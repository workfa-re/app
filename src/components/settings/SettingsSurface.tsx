import Link from "next/link";
import { Bell, ChevronRight, Compass, Monitor, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MobileNavPreferenceControl } from "@/components/settings/MobileNavPreferenceControl";
import { ThemePreferenceControl } from "@/components/settings/ThemePreferenceControl";
import type { MobileNavPreference } from "@/lib/mobile-nav-preference";
import type { ThemePreference } from "@/lib/theme-preference";
import styles from "./Settings.module.css";

type SettingsSurfaceProps = {
    mobileNavPreference: MobileNavPreference;
    themePreference: ThemePreference;
};

export function SettingsSurface({ mobileNavPreference, themePreference }: SettingsSurfaceProps) {
    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>Einstellungen</h1>
                <p>Richte Workfare so ein, wie es für dich passt.</p>
            </header>

            <div className={styles.preferenceGrid}>
                <SettingsGroup id="appearance" title="Darstellung" icon={Monitor}
                    description="Hell, dunkel oder passend zu deinem Gerät.">
                    <ThemePreferenceControl initialPreference={themePreference} />
                </SettingsGroup>

                <SettingsGroup id="navigation" title="Navigation" icon={Compass}
                    description="Wähle, wie du Workfare auf dem Handy bedienst.">
                    <MobileNavPreferenceControl initialPreference={mobileNavPreference} />
                </SettingsGroup>
            </div>

            <SettingsGroup id="konto" title="Konto" icon={UserRound}
                description="Dein Profil, deine Mitteilungen und deine Sicherheit." className={styles.accountGroup}>
                <div className={styles.linkList}>
                    <SettingsLinkRow href="/app-home/profile" icon={UserRound} title="Profil"
                        description="Persönliche Daten, Sichtbarkeit und Verifizierung" />
                    <SettingsLinkRow href="/app-home/settings/notifications" icon={Bell} title="Benachrichtigungen"
                        description="Persönliche Hinweise und E-Mails" />
                    <SettingsLinkRow href="/app-home/settings/security" icon={ShieldCheck} title="Sicherheit"
                        description="Passwort und Sicherheitsaktivität" />
                </div>
            </SettingsGroup>
        </div>
    );
}

function SettingsGroup({ id, title, description, icon: Icon, children, className = "" }: {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section id={id} aria-labelledby={`${id}-title`} className={`${styles.group} ${className}`}>
            <div className={styles.groupHeading}>
                <span className={styles.groupIcon}><Icon size={21} strokeWidth={1.6} aria-hidden="true" /></span>
                <div>
                    <h2 id={`${id}-title`}>{title}</h2>
                    <p>{description}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

function SettingsLinkRow({ href, title, description, icon: Icon }: {
    href: string;
    title: string;
    description: string;
    icon: LucideIcon;
}) {
    return (
        <Link href={href} prefetch={false} className={styles.linkRow}>
            <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
            <span className={styles.linkCopy}>
                <span className={styles.linkTitle}>{title}</span>
                <span className={styles.linkDescription}>{description}</span>
            </span>
            <ChevronRight size={17} strokeWidth={1.6} aria-hidden="true" />
        </Link>
    );
}
