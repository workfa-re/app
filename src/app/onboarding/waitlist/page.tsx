"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { OnboardingFrame, OnboardingHeading } from "@/components/onboarding/OnboardingFrame";

type WaitlistShellProps = {
    children: ReactNode;
    onBack?: () => void;
};

function WaitlistShell({ children, onBack }: WaitlistShellProps) {
    return (
        <OnboardingFrame step="location" mode="signup" onBack={onBack}>
            <div className="onboarding-step-panel">{children}</div>
        </OnboardingFrame>
    );
}

function WaitlistContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const city = searchParams.get("city") || "";
    const state = searchParams.get("state") || "";
    const country = searchParams.get("country") || "DE";
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!email || !city || !role) {
            setError("Bitte fülle alle Pflichtfelder aus.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const supabase = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            );
            const { data: result, error: insertError } = await supabase.rpc("join_launch_waitlist", {
                p_email: email.trim().toLowerCase(),
                p_city: city,
                p_federal_state: state || null,
                p_country: country,
                p_role: role,
            });

            if (insertError) throw insertError;

            const response = result && typeof result === "object" && !Array.isArray(result)
                ? result as { ok?: boolean; error?: string }
                : null;
            if (!response?.ok) throw new Error(response?.error ?? "waitlist_join_failed");

            setSuccess(true);
        } catch (err) {
            console.error(err);
            setError("Die Eintragung war nicht möglich. Bitte versuche es erneut.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back();
            return;
        }
        router.push("/?authMode=signup");
    };

    if (!city.trim()) {
        return (
            <WaitlistShell onBack={handleBack}>
                <OnboardingHeading
                    title="Wähle zuerst deine Stadt."
                    subtitle="Prüfe die Verfügbarkeit in deiner Region. Wenn Workfare dort noch nicht gestartet ist, kannst du dich auf die Warteliste setzen lassen."
                />
                <Link href="/?authMode=signup" className="onboarding-primary">
                    Stadt auswählen <ArrowRight size={20} aria-hidden="true" />
                </Link>
            </WaitlistShell>
        );
    }

    if (success) {
        return (
            <WaitlistShell onBack={() => router.push("/")}>
                <div role="status" className="onboarding-waitlist-success">
                    <CheckCircle2 size={32} aria-hidden="true" />
                    <OnboardingHeading
                        title="Du stehst auf der Warteliste."
                        subtitle={`Wir melden uns per E-Mail bei dir, sobald Workfare in ${city} startet.`}
                    />
                </div>
            </WaitlistShell>
        );
    }

    return (
        <WaitlistShell onBack={isSubmitting ? undefined : handleBack}>
            <OnboardingHeading
                title={`${city} ist noch nicht gestartet.`}
                subtitle="Trag dich auf die Warteliste ein. Wir informieren dich per E-Mail, sobald Workfare bei dir verfügbar ist."
            />

            <form onSubmit={handleSubmit} className="onboarding-waitlist-form" aria-label={`Warteliste für ${city}`}>
                <fieldset disabled={isSubmitting} aria-busy={isSubmitting} className="onboarding-waitlist-fields space-y-5">
                    <div className="onboarding-field">
                        <label htmlFor="waitlist-email">Deine E-Mail-Adresse</label>
                        <input
                            id="waitlist-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                            placeholder="name@beispiel.de"
                        />
                    </div>

                    <div className="onboarding-field">
                        <label htmlFor="waitlist-role">Ich bin …</label>
                        <div className="onboarding-select-control">
                            <select id="waitlist-role" value={role} onChange={(event) => setRole(event.target.value)} required>
                                <option value="">Bitte wählen</option>
                                <option value="youth">Jugendliche/r</option>
                                <option value="parent">Elternteil</option>
                                <option value="client">Auftraggeber/in</option>
                                <option value="company">Organisation</option>
                            </select>
                            <ChevronDown className="onboarding-select-chevron" size={18} strokeWidth={1.6} aria-hidden="true" focusable="false" />
                        </div>
                    </div>
                </fieldset>

                {error && <p className="onboarding-inline-feedback" data-tone="danger" role="alert">{error}</p>}

                <div className="onboarding-waitlist-actions space-y-3 pt-6">
                    <button type="submit" disabled={isSubmitting} className="onboarding-primary">
                        {isSubmitting ? (
                            <><Loader2 size={20} className="animate-spin" aria-hidden="true" /> Wird gespeichert …</>
                        ) : (
                            <>Auf Warteliste eintragen <ArrowRight size={20} aria-hidden="true" /></>
                        )}
                    </button>
                </div>
            </form>
        </WaitlistShell>
    );
}

export default function WaitlistPage() {
    return (
        <Suspense fallback={<WaitlistShell><p role="status">Warteliste wird geladen …</p></WaitlistShell>}>
            <WaitlistContent />
        </Suspense>
    );
}
