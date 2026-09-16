"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { MiniFooter } from "@/components/layout/MiniFooter";
import { LogoBadge } from "@/components/ui/LogoBadge";

type WaitlistShellProps = {
    children: ReactNode;
    size?: string;
};

function WaitlistShell({ children, size = "max-w-2xl" }: WaitlistShellProps) {
    return (
        <div className="landing-auth-shell min-h-dvh bg-[#07090f]">
            <main className="onboarding-shell waitlist-shell flex min-h-dvh items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-4 pb-16 no-scrollbar md:items-center md:py-4 md:pb-16">
                <div className={`onboarding-panel waitlist-panel relative w-full ${size} overflow-hidden rounded-3xl p-6 md:p-12`}>
                    <div className="onboarding-panel-glow pointer-events-none absolute -left-20 -top-20 h-56 w-56" />
                    <div className="onboarding-panel-texture pointer-events-none absolute inset-0" />
                    <div className="relative z-10">
                        {children}
                    </div>
                </div>
            </main>
            <MiniFooter />
        </div>
    );
}

function WaitlistContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const city = searchParams.get("city") || "";
    const state = searchParams.get("state") || "";
    const country = searchParams.get("country") || "DE";
    const cityLabel = city || "deiner Region";
    const stateLabel = state || "Noch nicht hinterlegt";
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !city || !role) {
            setError("Bitte fülle alle Pflichtfelder aus.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        const supabase = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );

        try {
            const { data: result, error: insertError } = await supabase.rpc("join_launch_waitlist", {
                p_email: email.trim().toLowerCase(),
                p_city: city,
                p_federal_state: state || null,
                p_country: country,
                p_role: role,
            });

            if (insertError) {
                throw insertError;
            }

            const response = result && typeof result === "object" && !Array.isArray(result)
                ? result as { ok?: boolean; error?: string }
                : null;
            if (!response?.ok) {
                throw new Error(response?.error ?? "waitlist_join_failed");
            }

            setSuccess(true);
        } catch (err) {
            console.error(err);
            setError("Ein Fehler ist aufgetreten. Bitte versuche es später erneut.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back();
            return;
        }

        router.push("/");
    };

    if (success) {
        return (
            <WaitlistShell size="max-w-md">
                <div className="waitlist-success text-center">
                    <div className="waitlist-success-icon mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full">
                        <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
                    </div>
                    <h2 className="waitlist-heading text-2xl font-bold text-white">Vielen Dank!</h2>
                    <p className="waitlist-copy mt-4 text-slate-300">
                        Wir melden uns per E-Mail bei dir, sobald Workfare in <strong>{cityLabel}</strong> startet.
                    </p>
                    <Link
                        href="/"
                        className="waitlist-link-button mt-8 inline-flex h-12 items-center justify-center rounded-[1.125rem] px-6 text-sm font-semibold transition-[background-color,color,box-shadow,scale] duration-200 ease-out active:scale-[0.96]"
                    >
                        Zurück zur Startseite
                    </Link>
                </div>
            </WaitlistShell>
        );
    }

    return (
        <WaitlistShell>
            <div className="waitlist-header mb-7 flex items-center gap-4">
                <LogoBadge size="md" className="waitlist-header-badge shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="waitlist-heading text-2xl font-bold leading-tight tracking-tight text-white md:text-3xl">
                        <span className="block">{cityLabel} ist noch</span>
                        {" "}
                        <span className="block">nicht gestartet.</span>
                    </h1>
                    <p className="waitlist-copy mt-2.5 leading-relaxed text-slate-300">
                        Trag dich ein, und wir informieren dich, sobald Workfare in <strong>{cityLabel}</strong> verfügbar ist.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                        <label htmlFor="waitlist-city" className="waitlist-label mb-1.5 block text-base font-semibold">
                            Stadt
                        </label>
                        <input
                            id="waitlist-city"
                            type="text"
                            value={cityLabel}
                            readOnly
                            className="waitlist-input waitlist-input-readonly w-full rounded-[1.125rem] px-4 py-3 text-base font-medium"
                        />
                    </div>
                    <div>
                        <label htmlFor="waitlist-state" className="waitlist-label mb-1.5 block text-base font-semibold">
                            Bundesland
                        </label>
                        <input
                            id="waitlist-state"
                            type="text"
                            value={stateLabel}
                            readOnly
                            className="waitlist-input waitlist-input-readonly w-full rounded-[1.125rem] px-4 py-3 text-base font-medium"
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="waitlist-email" className="waitlist-label mb-1.5 block text-base font-semibold">
                        Deine E-Mail-Adresse
                    </label>
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
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="name@beispiel.de"
                        className="waitlist-input w-full rounded-[1.125rem] px-4 py-3 text-base font-medium transition-[background-color,border-color,box-shadow,color] duration-200 ease-out focus:outline-none focus:ring-2"
                    />
                </div>

                <div>
                    <label htmlFor="waitlist-role" className="waitlist-label mb-1.5 block text-base font-semibold">
                        Ich bin...
                    </label>
                    <div className="relative">
                        <select
                            id="waitlist-role"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            required
                            data-empty={role ? undefined : "true"}
                            className="waitlist-select w-full appearance-none rounded-[1.125rem] px-4 py-3 pr-12 text-base font-medium transition-[background-color,border-color,box-shadow,color] duration-200 ease-out focus:outline-none focus:ring-2"
                        >
                            <option value="">Bitte wählen</option>
                            <option value="youth">Jugendliche/r</option>
                            <option value="parent">Elternteil</option>
                            <option value="client">Auftraggeber/in</option>
                            <option value="company">Organisation</option>
                        </select>
                        <ChevronDown className="waitlist-select-icon pointer-events-none absolute right-5 top-1/2 h-5 w-5 -translate-y-1/2" aria-hidden="true" />
                    </div>
                </div>

                {error && (
                    <div className="waitlist-error rounded-[1rem] px-4 py-3 text-sm font-medium">
                        {error}
                    </div>
                )}

                <div className="waitlist-actions space-y-3 pt-5">
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="waitlist-submit flex h-14 w-full items-center justify-center gap-2 rounded-[1.125rem] px-6 font-semibold transition-[background-color,box-shadow,color,scale] duration-200 ease-out enabled:active:scale-[0.96] disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                                <span>Wird gespeichert...</span>
                            </>
                        ) : (
                            <>
                                <span>Informiert mich</span>
                                <ArrowRight className="h-5 w-5" aria-hidden="true" />
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={handleBack}
                        className="waitlist-back-button flex h-14 w-full items-center justify-center rounded-[1.125rem] px-6 font-semibold transition-[background-color,box-shadow,color,scale] duration-200 ease-out active:scale-[0.96]"
                    >
                        Zurück
                    </button>
                </div>
            </form>
        </WaitlistShell>
    );
}

export default function WaitlistPage() {
    return (
        <Suspense fallback={
            <WaitlistShell size="max-w-md">
                <div className="text-center text-white">Laden...</div>
            </WaitlistShell>
        }>
            <WaitlistContent />
        </Suspense>
    );
}
