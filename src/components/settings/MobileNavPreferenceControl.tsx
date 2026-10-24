"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Settings.module.css";
import type { MobileNavPreference } from "@/lib/mobile-nav-preference";

type MobileNavPreferenceControlProps = {
    initialPreference: MobileNavPreference;
};

const options: Array<{
    value: MobileNavPreference;
    title: string;
    status: string;
}> = [
    {
        value: "top",
        title: "Tabs oben",
        status: "Standard",
    },
    {
        value: "bottom",
        title: "Dock unten",
        status: "Daumenfreundlich",
    },
];

export function MobileNavPreferenceControl({ initialPreference }: MobileNavPreferenceControlProps) {
    const router = useRouter();
    const [preference, setPreference] = useState(initialPreference);
    const [error, setError] = useState<string | null>(null);
    const [pendingPreference, setPendingPreference] = useState<MobileNavPreference | null>(null);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        setPreference(initialPreference);
    }, [initialPreference]);

    const syncPreference = async (nextPreference: MobileNavPreference) => {
        if (nextPreference === preference || pendingPreference) return;

        const previousPreference = preference;
        setError(null);
        setPendingPreference(nextPreference);
        setPreference(nextPreference);
        window.dispatchEvent(new CustomEvent("workfare:mobile-nav-preference", {
            detail: { preference: nextPreference },
        }));

        const { data: { user } } = await supabaseBrowser.auth.getUser();
        if (!user) {
            setPreference(previousPreference);
            setPendingPreference(null);
            setError("Bitte melde dich erneut an.");
            window.dispatchEvent(new CustomEvent("workfare:mobile-nav-preference", {
                detail: { preference: previousPreference },
            }));
            return;
        }

        const { error: updateError } = await supabaseBrowser
            .from("profiles")
            .update({ mobile_nav_preference: nextPreference })
            .eq("id", user.id);

        if (updateError) {
            setPreference(previousPreference);
            setError("Die Auswahl konnte nicht gespeichert werden.");
            window.dispatchEvent(new CustomEvent("workfare:mobile-nav-preference", {
                detail: { preference: previousPreference },
            }));
        } else {
            startTransition(() => router.refresh());
        }

        setPendingPreference(null);
    };

    return (
        <div className={styles.navigationChoices} role="group" aria-label="Handy-Navigation">
            {options.map((option) => {
                const active = preference === option.value;
                const saving = pendingPreference === option.value || (isPending && active);

                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => syncPreference(option.value)}
                        disabled={Boolean(pendingPreference)}
                        aria-pressed={active}
                        data-active={active}
                        className={styles.navigationOption}
                    >
                        <NavigationPreview preference={option.value} active={active} />

                        <span className={styles.navigationCopy}>
                            <span className={styles.optionLabel}>{option.title}</span>
                            <span className={styles.optionDescription}>{option.status}</span>
                        </span>

                        <span className={styles.navigationCheck}>
                            {saving ? (
                                <Loader2 size={13} className={styles.spinner} />
                            ) : (
                                <Check size={13} strokeWidth={3} />
                            )}
                        </span>
                    </button>
                );
            })}

            {error && (
                <p role="alert" className={styles.controlError}>
                    {error}
                </p>
            )}
        </div>
    );
}

function NavigationPreview({ preference, active }: { preference: MobileNavPreference; active: boolean }) {
    return (
        <span aria-hidden="true" className={styles.navigationPreview} data-preference={preference} data-active={active}>
            <span className={styles.previewLine} />
            <span className={styles.previewTile} />
            <span className={styles.previewTile} />
            <span className={styles.previewPill}>
                <span /><span /><span />
            </span>
        </span>
    );
}
