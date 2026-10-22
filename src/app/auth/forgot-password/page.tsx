"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { OnboardingFrame, OnboardingHeading } from "@/components/onboarding/OnboardingFrame";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/update-password`,
            });

            if (error) throw error;
            setSuccess(true);
        } catch (err: unknown) {
            setError(err instanceof Error && err.message ? err.message : "Ein Fehler ist aufgetreten.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <OnboardingFrame step="auth" mode="signin" onBack={loading ? undefined : () => router.push("/")}>
            <div className="onboarding-step-panel">
                {success ? (
                    <div role="status" aria-live="polite">
                        <CheckCircle2 size={28} className="mb-6" aria-hidden="true" />
                        <OnboardingHeading title="E-Mail gesendet" />
                        <p className="text-slate-300 leading-relaxed">
                            Wir haben dir einen Link zum Zurücksetzen deines Passworts an <strong>{email}</strong> gesendet.
                        </p>
                    </div>
                ) : (
                    <>
                        <OnboardingHeading
                            title="Passwort vergessen?"
                            subtitle="Gib deine E-Mail-Adresse ein, um dein Passwort zurückzusetzen."
                        />
                        <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading}>
                            <div className="onboarding-field">
                                <label htmlFor="email">E-Mail-Adresse</label>
                                <input
                                    id="email"
                                    name="email"
                                    autoComplete="email"
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@beispiel.de"
                                />
                            </div>

                            {error && (
                                <div className="onboarding-inline-feedback" data-tone="danger" role="alert">
                                    {error}
                                </div>
                            )}

                            <div className="onboarding-auth-actions">
                                <ButtonPrimary type="submit" disabled={loading} className="onboarding-primary w-full">
                                    {loading ? "Sende..." : "Link senden"}
                                </ButtonPrimary>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </OnboardingFrame>
    );
}
