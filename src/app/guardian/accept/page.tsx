"use client";

import { useSearchParams } from "next/navigation";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { Suspense } from "react";
import { useState } from "react";
import { redeemGuardianInvitation } from "../access/actions";

const GUARDIAN_CONFIRMATION_ERROR =
    "Die Bestätigung konnte nicht abgeschlossen werden. Der Link ist möglicherweise abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen Link an.";

function GuardianAcceptContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    if (!token) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-950 text-white">
                <h1 className="text-2xl font-bold text-red-400 mb-2">Ungültiger Link</h1>
                <p className="text-slate-400">Dieser Bestätigungslink ist unvollständig.</p>
            </div>
        );
    }

    const redeem = async () => {
        setState("loading");
        setError(null);
        try {
            const result = await redeemGuardianInvitation(token);
            if (!result.success) {
                setState("error");
                setError(result.message);
                return;
            }
            setState("success");
        } catch {
            setState("error");
            setError(GUARDIAN_CONFIRMATION_ERROR);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-950 text-white">
            <div className="max-w-md w-full space-y-8 text-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Account bestätigen</h1>
                    <p className="text-slate-400">
                        Du bist dabei, den Account deines Kindes und die volle Verantwortung zu übernehmen.
                    </p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
                    <p className="text-sm text-slate-300 mb-6">
                        Durch die Bestätigung stimmst du zu, dass dein Kind über Workfare Tätigkeiten annimmt und du als gesetzlicher Vertreter fungierst.
                    </p>
                    {state === "success" ? (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                            Bestätigung erfolgreich. Das Konto deines Kindes ist jetzt freigeschaltet.
                        </div>
                    ) : (
                    <ButtonPrimary
                        onClick={redeem}
                        disabled={state === "loading"}
                        className="w-full"
                    >
                        {state === "loading" ? "Wird bestätigt..." : "Jetzt bestätigen"}
                    </ButtonPrimary>
                    )}
                    {state === "error" && (
                        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                            {error || "Bestätigung fehlgeschlagen."}
                            <div className="mt-2 text-xs text-slate-400">
                                Hinweis: Du musst als Elternteil eingeloggt sein.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function GuardianAcceptPage() {
    return (
        <Suspense fallback={<div className="text-white p-10 text-center">Laden...</div>}>
            <GuardianAcceptContent />
        </Suspense>
    );
}
