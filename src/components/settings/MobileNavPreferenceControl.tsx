"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
    normalizeMobileNavPreference,
    type MobileNavPreference,
} from "@/lib/mobile-nav-preference";

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
        <div className="mobile-nav-control space-y-2">
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
                        className={cn(
                            "mobile-nav-option group grid w-full grid-cols-[4.6rem_minmax(0,1fr)_1.7rem] items-center gap-3 text-left outline-none",
                            "disabled:cursor-not-allowed disabled:opacity-70"
                        )}
                    >
                        <NavigationPreview preference={option.value} active={active} />

                        <span className="mobile-nav-option-copy min-w-0">
                            <span className="block truncate text-sm font-semibold">{option.title}</span>
                            <span className="mt-0.5 block truncate text-xs font-medium">{option.status}</span>
                        </span>

                        <span className={cn(
                            "mobile-nav-option-check flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                            active ? "is-active" : "text-transparent"
                        )}>
                            {saving ? (
                                <Loader2 size={13} className="animate-spin text-slate-950" />
                            ) : (
                                <Check size={13} strokeWidth={3} />
                            )}
                        </span>
                    </button>
                );
            })}

            {error && (
                <p className="mobile-nav-error rounded-xl border px-3 py-2 text-xs font-medium">
                    {error}
                </p>
            )}
        </div>
    );
}

function NavigationPreview({ preference, active }: { preference: MobileNavPreference; active: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "mobile-nav-preview relative h-12 overflow-hidden rounded-xl border",
                active && "is-active"
            )}
        >
            <span className="mobile-nav-preview-line absolute left-2 right-2 top-2 h-1 rounded-full" />
            <span className="mobile-nav-preview-tile absolute left-2 top-5 h-4 w-7 rounded-md border" />
            <span className="mobile-nav-preview-tile absolute right-2 top-5 h-4 w-7 rounded-md border" />

            {preference === "top" ? (
                <span className="mobile-nav-preview-pill absolute left-1/2 top-1.5 flex h-4 w-11 -translate-x-1/2 items-center gap-0.5 rounded-full border p-0.5">
                    <span className="mobile-nav-preview-segment-active h-full flex-1 rounded-full" />
                    <span className="mobile-nav-preview-segment-idle h-full flex-1 rounded-full" />
                    <span className="mobile-nav-preview-segment-idle h-full flex-1 rounded-full" />
                </span>
            ) : (
                <>
                    <span className="mobile-nav-preview-bottom-fade absolute inset-x-0 bottom-0 h-5" />
                    <span className="mobile-nav-preview-pill absolute bottom-1.5 left-1/2 flex h-4 w-12 -translate-x-1/2 items-center gap-0.5 rounded-full border p-0.5">
                        <span className="mobile-nav-preview-segment-active h-full flex-1 rounded-full" />
                        <span className="mobile-nav-preview-segment-idle h-full flex-1 rounded-full" />
                        <span className="mobile-nav-preview-segment-idle h-full flex-1 rounded-full" />
                    </span>
                </>
            )}
        </span>
    );
}
