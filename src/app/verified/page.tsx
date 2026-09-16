"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { LogoBadge } from "@/components/ui/LogoBadge";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { CheckCircle2 } from "lucide-react";
import { currentContactEmail } from "@/lib/brand-compat";

export default function VerifiedPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-[#07090f]">
            {/* Glass Card Container */}
            <div className="relative z-10 max-w-lg w-full">
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                >
                    <div className="relative bg-white/10 backdrop-blur-[28px] backdrop-saturate-[180%] border border-white/10 rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.75)] p-8 md:p-12 overflow-hidden text-center">
                        {/* Lichtkante */}
                        <div className="pointer-events-none absolute -top-16 -left-16 w-56 h-56 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_60%)] opacity-70 mix-blend-screen" />
                        {/* Subtile Textur */}
                        <div
                            className="pointer-events-none absolute inset-0 opacity-15 mix-blend-soft-light"
                            style={{
                                backgroundImage:
                                    "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 40%, rgba(255,255,255,0.08) 60%, transparent 100%)",
                            }}
                        />

                        <div className="flex items-center justify-center gap-4 mb-6 text-left">
                            <LogoBadge size="md" className="flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3">
                                    <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                                        E-Mail-Adresse erfolgreich bestätigt
                                    </h1>
                                    <CheckCircle2 className="hidden md:block h-8 w-8 text-green-400 flex-shrink-0" />
                                </div>
                                <div className="md:hidden mt-2 flex items-center gap-2 text-green-400">
                                    <CheckCircle2 className="h-5 w-5" />
                                    <span className="text-sm font-medium">Bestätigt</span>
                                </div>
                            </div>
                        </div>

                        <p className="mt-4 text-base text-slate-300 leading-relaxed max-w-sm mx-auto">
                            Du kannst dieses Fenster schließen und zur App zurückkehren, um fortzufahren.
                        </p>

                        <div className="mt-8 space-y-6">
                            <ButtonPrimary
                                onClick={() => router.push("/onboarding?verified=true")}
                                className="w-full h-14 text-lg font-semibold shadow-[0_0_25px_rgba(56,189,248,0.4)] hover:shadow-[0_0_35px_rgba(56,189,248,0.6)] transition-shadow"
                            >
                                Zurück zur App
                            </ButtonPrimary>

                            <div>
                                <a
                                    href={`mailto:${currentContactEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL)}`}
                                    className="text-sm text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline"
                                >
                                    Probleme? Support kontaktieren
                                </a>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
