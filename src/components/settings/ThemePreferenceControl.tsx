"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { normalizeThemePreference, type ThemePreference } from "@/lib/theme-preference";
import { useTheme } from "@/components/providers/ThemeProvider";
import styles from "./Settings.module.css";

type ThemePreferenceControlProps = {
    initialPreference: ThemePreference;
};

const options: Array<{
    value: ThemePreference;
    label: string;
    icon: typeof Monitor;
}> = [
    {
        value: "system",
        label: "System",
        icon: Monitor,
    },
    {
        value: "light",
        label: "Hell",
        icon: Sun,
    },
    {
        value: "dark",
        label: "Dunkel",
        icon: Moon,
    },
];

export function ThemePreferenceControl({ initialPreference }: ThemePreferenceControlProps) {
    const router = useRouter();
    const { setTheme } = useTheme();
    const [preference, setPreference] = useState(() => normalizeThemePreference(initialPreference));
    const [pendingPreference, setPendingPreference] = useState<ThemePreference | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        const nextPreference = normalizeThemePreference(initialPreference);
        setPreference(nextPreference);
        setTheme(nextPreference);
    }, [initialPreference, setTheme]);

    const syncPreference = async (nextPreference: ThemePreference) => {
        if (nextPreference === preference || pendingPreference) return;

        const previousPreference = preference;
        setError(null);
        setPendingPreference(nextPreference);
        setPreference(nextPreference);
        setTheme(nextPreference);

        const { data: { user } } = await supabaseBrowser.auth.getUser();
        if (!user) {
            setPreference(previousPreference);
            setTheme(previousPreference);
            setPendingPreference(null);
            setError("Bitte melde dich erneut an.");
            return;
        }

        const { error: updateError } = await supabaseBrowser
            .from("profiles")
            .update({ theme_preference: nextPreference })
            .eq("id", user.id);

        if (updateError) {
            setPreference(previousPreference);
            setTheme(previousPreference);
            setError("Die Auswahl konnte nicht gespeichert werden.");
        } else {
            startTransition(() => router.refresh());
        }

        setPendingPreference(null);
    };

    return (
        <div className={styles.control}>
            <div className={styles.themeChoices} role="group" aria-label="Farbmodus">
                {options.map((option) => {
                    const active = preference === option.value;
                    const saving = pendingPreference === option.value || (isPending && active);
                    const Icon = option.icon;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => syncPreference(option.value)}
                            disabled={Boolean(pendingPreference)}
                            aria-pressed={active}
                            data-active={active}
                            className={styles.themeOption}
                        >
                            {saving ? <Loader2 size={15} className={styles.spinner} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                            <span className={styles.optionLabel}>{option.label}</span>
                        </button>
                    );
                })}
            </div>

            {error && (
                <p role="alert" className={styles.controlError}>
                    {error}
                </p>
            )}
        </div>
    );
}
