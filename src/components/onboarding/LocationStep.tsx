"use client";

import { BRAND_SUPPORT_EMAIL } from "@/lib/constants";

import { useState } from "react";
import { LocationAutocomplete, type LocationDetails } from "@/components/ui/LocationAutocomplete";
import { LogoBadge } from "@/components/ui/LogoBadge";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CircleAlert, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

interface LocationStepProps {
    onComplete: (regionData: any) => void;
    onBack: () => void;
}

const SUPPORT_EMAIL = BRAND_SUPPORT_EMAIL;
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Hilfe bei der Stadtangabe")}&body=${encodeURIComponent("Hallo Workfare Support,\n\nich bin mir nicht sicher, welche Stadt ich bei meiner Anmeldung angeben soll.\n\nBitte helft mir weiter.")}`;

export function LocationStep({ onComplete, onBack }: LocationStepProps) {
    const [selectedLocality, setSelectedLocality] = useState<LocationDetails | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isNoticeOpen, setIsNoticeOpen] = useState(false);
    const router = useRouter();

    const handleContinue = async () => {
        if (!selectedLocality) return;

        setIsChecking(true);
        setError(null);

        try {
            const response = await fetch("/api/region/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    city: selectedLocality.city,
                    postal_code: selectedLocality.postal_code,
                    federal_state: selectedLocality.state || "",
                    country: "DE",
                }),
            });

            if (!response.ok) {
                throw new Error("Fehler bei der Überprüfung");
            }

            const data = await response.json();

            if (data.status === "live") {
                // Region is live
                onComplete({
                    city: selectedLocality.city,
                    postal_code: selectedLocality.postal_code,
                    federal_state: selectedLocality.state || "",
                    country: "DE",
                    region_live_id: data.region?.id
                });
            } else {
                // Not live or unknown -> Waitlist
                const params = new URLSearchParams({
                    city: selectedLocality.city,
                    state: selectedLocality.state || "",
                    country: "DE",
                });
                if (selectedLocality.postal_code) {
                    params.append("zip", selectedLocality.postal_code);
                }

                // Use window.location to ensure full redirect, or router.push
                router.push(`/onboarding/waitlist?${params.toString()}`);
            }
        } catch (err) {
            console.error(err);
            setError("Die Regionsprüfung ist fehlgeschlagen. Bitte versuche es erneut.");
            setIsChecking(false);
        }
    };

    return (
        <div className="onboarding-location-step space-y-6 md:space-y-7">
            <div className="onboarding-location-header flex items-center gap-4">
                <LogoBadge size="md" className="onboarding-location-header-badge shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                    <h2 className="onboarding-location-heading text-2xl font-bold leading-tight text-white md:text-3xl">Wo möchtest du Workfare nutzen?</h2>
                    <p className="onboarding-location-copy text-base leading-relaxed text-gray-400">
                        Wir starten Schritt für Schritt in ausgewählten Regionen. Wähle deine Stadt, damit wir dir zeigen können, was in deiner Nähe möglich ist.
                    </p>
                </div>
            </div>

            <LocationAutocomplete
                cityOnly={true}
                placeholder="Stadt (z.B. Bonn)"
                onInputChange={() => {
                    setSelectedLocality(null);
                    setError(null);
                }}
                onSelect={(loc) => {
                    setSelectedLocality(loc);
                    setError(null);
                }}
            />

            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="onboarding-location-notice relative overflow-hidden rounded-2xl border border-amber-200/10 bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
            >
                <motion.div
                    aria-hidden="true"
                    className="onboarding-location-notice-sheen pointer-events-none absolute top-0 h-px w-1/2 bg-gradient-to-r from-transparent via-amber-200/35 to-transparent"
                    animate={{ x: ["-70%", "170%"], opacity: [0.2, 0.55, 0.2] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                />

                <button
                    type="button"
                    onClick={() => setIsNoticeOpen((open) => !open)}
                    aria-expanded={isNoticeOpen}
                    className="onboarding-location-notice-trigger flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-[background-color,box-shadow] duration-200 ease-out hover:bg-white/[0.025] focus:outline-none focus:ring-2 focus:ring-amber-200/20"
                >
                    <span className="flex min-w-0 items-center gap-3">
                        <span className="onboarding-location-notice-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-200/15 bg-amber-200/[0.06] text-amber-200/90">
                            <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                            <span className="onboarding-location-notice-title block text-sm font-semibold text-white">Stadt bitte wahrheitsgemäß angeben!</span>
                            <span className="onboarding-location-notice-subtitle block text-xs text-slate-500">Falsche Angaben werden erkannt und bestraft.</span>
                        </span>
                    </span>
                    <span className="onboarding-location-notice-toggle flex shrink-0 items-center gap-1.5 text-xs font-semibold text-amber-100/80">
                        Warum wichtig?
                        <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${isNoticeOpen ? "rotate-180" : ""}`}
                            aria-hidden="true"
                        />
                    </span>
                </button>

                <AnimatePresence initial={false}>
                    {isNoticeOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: "easeOut" }}
                            className="overflow-hidden"
                        >
                            <div className="onboarding-location-notice-body border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="space-y-1.5">
                                        <p className="onboarding-location-notice-copy text-sm leading-relaxed text-slate-400">
                                            Trage die Stadt ein, in der du tatsächlich wohnst. Falsche Angaben können zu einer umfangreichen Einschränkung deines Kontos und deiner Nutzungsmöglichkeiten führen.
                                        </p>
                                        <p className="onboarding-location-notice-note text-xs leading-relaxed text-slate-500">
                                            Wenn du unsicher bist, welche Stadt du auswählen sollst, kontaktiere bitte den Support.
                                        </p>
                                    </div>
                                    <a
                                        href={SUPPORT_MAILTO}
                                        className="onboarding-location-notice-support inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-slate-100 transition-[background-color,border-color,color,box-shadow,scale] duration-200 ease-out hover:border-amber-200/25 hover:bg-amber-200/[0.08] hover:text-white active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-amber-200/20 sm:w-auto"
                                    >
                                        <Mail className="h-4 w-4" aria-hidden="true" />
                                        <span>Support kontaktieren</span>
                                    </a>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            {error && (
                <div className="text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                    {error}
                </div>
            )}

            <div className="onboarding-location-actions grid grid-cols-2 gap-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="onboarding-location-back flex w-full items-center justify-center px-6 font-semibold transition-[background-color,border-color,box-shadow,color,scale] duration-200 ease-out active:scale-[0.96]"
                >
                    Zurück
                </button>

                <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!selectedLocality || isChecking}
                    className="onboarding-location-primary flex w-full items-center justify-center gap-2 bg-blue-600 px-6 font-semibold text-white transition-[background-color,box-shadow,color,scale] duration-200 ease-out hover:bg-blue-500 enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isChecking ? (
                        <>
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Prüfen...</span>
                        </>
                    ) : (
                        <span>Weiter</span>
                    )}
                </button>
            </div>
        </div>
    );
}
