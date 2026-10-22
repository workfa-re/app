"use client";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { LocationAutocomplete, type LocationDetails } from "@/components/ui/LocationAutocomplete";

interface LocationStepProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onComplete: (regionData: any) => void;
    onBusyChange?: (busy: boolean) => void;
}

export function LocationStep({ onComplete, onBusyChange }: LocationStepProps) {
    const fieldId = useId();
    const [selectedLocality, setSelectedLocality] = useState<LocationDetails | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        onBusyChange?.(isChecking);
        return () => onBusyChange?.(false);
    }, [isChecking, onBusyChange]);

    const handleContinue = async () => {
        if (!selectedLocality || isChecking) return;

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

            if (!response.ok) throw new Error("Region check failed");

            const data = await response.json();

            if (data.status === "live") {
                onComplete({
                    city: selectedLocality.city,
                    postal_code: selectedLocality.postal_code,
                    federal_state: selectedLocality.state || "",
                    country: "DE",
                    region_live_id: data.region?.id,
                });
            } else {
                const params = new URLSearchParams({
                    city: selectedLocality.city,
                    state: selectedLocality.state || "",
                    country: "DE",
                });
                if (selectedLocality.postal_code) params.append("zip", selectedLocality.postal_code);
                router.push(`/onboarding/waitlist?${params.toString()}`);
            }
        } catch {
            setError("Die Verfügbarkeit konnte nicht geprüft werden. Bitte versuche es erneut.");
            setIsChecking(false);
        }
    };

    return (
        <section className="onboarding-location-step" aria-labelledby={`${fieldId}-heading`}>
            <div className="onboarding-location-header">
                <h1 id={`${fieldId}-heading`} className="onboarding-location-heading">
                    Wo möchtest du Workfare nutzen?
                </h1>
                <p className="onboarding-location-copy">
                    Workfare startet in ausgewählten Regionen. Prüfe die Verfügbarkeit in deiner Stadt.
                </p>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); void handleContinue(); }}>
                <fieldset className="onboarding-location-field" disabled={isChecking} aria-busy={isChecking} aria-labelledby={`${fieldId}-label`} aria-describedby={`${fieldId}-help`}>
                    <label id={`${fieldId}-label`} htmlFor={fieldId} className="onboarding-location-label">Stadt</label>
                    <LocationAutocomplete
                        inputId={fieldId}
                        cityOnly
                        placeholder="Zum Beispiel Bonn"
                        onInputChange={() => {
                            setSelectedLocality(null);
                            setError(null);
                        }}
                        onSelect={(locality) => {
                            setSelectedLocality(locality);
                            setError(null);
                        }}
                    />
                    <p id={`${fieldId}-help`} className="sr-only">
                        Wähle deine Stadt aus den Suchvorschlägen.
                    </p>
                </fieldset>

                <p className="sr-only" role="status">
                    {isChecking ? "Die Verfügbarkeit wird geprüft …" : ""}
                </p>

                {error && <p className="onboarding-location-error" role="alert">{error}</p>}

                <div className="onboarding-location-actions">
                    <button type="submit" disabled={!selectedLocality || isChecking} className="onboarding-location-primary rounded-[10px]">
                        {isChecking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isChecking ? "Wird geprüft …" : "Weiter"}
                    </button>
                </div>
            </form>

        </section>
    );
}
