"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { useRouter } from "next/navigation";
import { OnboardingFrame, OnboardingHeading } from "@/components/onboarding/OnboardingFrame";
import { guardianReturnPath } from "@/lib/guardian/navigation";

export default function UpdatePasswordPage() {
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabaseBrowser.auth.updateUser({ password });
            if (error) throw error;

            // Redirect to home/dashboard after success
            router.push(guardianReturnPath(new URLSearchParams(window.location.search).get("redirectTo")) || "/app-home");
            router.refresh();
        } catch (err: unknown) {
            setError(err instanceof Error && err.message ? err.message : "Fehler beim Aktualisieren des Passworts.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <OnboardingFrame step="auth" mode="signin" onBack={loading ? undefined : () => router.push("/")}>
            <div className="onboarding-step-panel">
                <OnboardingHeading
                    title="Neues Passwort"
                    subtitle="Bitte lege ein neues Passwort für deinen Account fest."
                />
                <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading}>
                    <div className="onboarding-field">
                        <label htmlFor="password">Neues Passwort</label>
                        <input
                            id="password"
                            name="password"
                            autoComplete="new-password"
                            type="password"
                            required
                            minLength={6}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mindestens 6 Zeichen"
                        />
                    </div>

                    {error && (
                        <div className="onboarding-inline-feedback" data-tone="danger" role="alert">
                            {error}
                        </div>
                    )}

                    <div className="onboarding-auth-actions">
                        <ButtonPrimary type="submit" disabled={loading} className="onboarding-primary w-full">
                            {loading ? "Speichern..." : "Passwort speichern"}
                        </ButtonPrimary>
                    </div>
                </form>
            </div>
        </OnboardingFrame>
    );
}
