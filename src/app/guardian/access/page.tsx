"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { ButtonSecondary } from "@/components/ui/ButtonSecondary";
import { Suspense, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { ShieldCheck, CheckCircle, AlertCircle, UserPlus } from "lucide-react";
import { LeftBrandChip } from "@/components/layout/header/LeftBrandChip";
import { redeemGuardianInvitation } from "./actions";

const GUARDIAN_CONFIRMATION_ERROR =
    "Die Bestätigung konnte nicht abgeschlossen werden. Der Link ist möglicherweise abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen Link an.";

function GuardianAccessContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");
    const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [childName, setChildName] = useState<string | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { user } } = await supabaseBrowser.auth.getUser();
            setIsAuthenticated(!!user);
            if (user?.email) {
                setCurrentUserEmail(user.email);
            }
        };
        checkAuth();

        if (token) {
            supabaseBrowser
                .rpc("get_guardian_invitation_info", { token_input: token })
                .then(({ data }) => {
                    if (data && (data as any).valid) {
                        setChildName((data as any).child_name);
                    }
                });
        }
    }, [token]);

    const handleLogout = async () => {
        await supabaseBrowser.auth.signOut();
        // Refresh to trigger unauthenticated state and redirect
        window.location.reload();
    };

    if (!token) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#07090f] text-white">
                <div className="w-full max-w-md text-center space-y-4">
                    <div className="mx-auto w-12 h-12 bg-rose-500/10 rounded-full flex items-center justify-center text-rose-500">
                        <AlertCircle className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold">Ungültiger Link</h1>
                    <p className="text-slate-400">Dieser Bestätigungslink ist unvollständig oder fehlerhaft.</p>
                </div>
            </div>
        );
    }

    const confirm = async () => {
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

    const handleLoginRedirect = () => {
        const redirectUrl = encodeURIComponent(`/guardian/access?token=${token}`);
        router.push(`/?authMode=signin&redirectTo=${redirectUrl}`);
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#07090f] text-white relative overflow-hidden">
            {/* Soft Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-indigo-500/5 blur-[120px] rounded-full" />
            </div>

            {/* Branding Top Left */}
            <div className="absolute top-6 left-6 z-20">
                <LeftBrandChip market={null} />
            </div>

            <div className="relative max-w-md w-full space-y-6 text-center z-10">

                {/* Header Section */}
                <div className="flex flex-col items-center gap-6">
                    {isAuthenticated ? (
                        <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mb-2">
                            <ShieldCheck className="w-8 h-8" />
                        </div>
                    ) : (
                        <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mb-2">
                            {/* Friendlier Icon for initial contact */}
                            <UserPlus className="w-8 h-8" />
                        </div>
                    )}

                    <div>
                        <h1 className="text-2xl font-bold tracking-tight mb-2">
                            {isAuthenticated ? "Elternbestätigung" : "Willkommen bei Workfare"}
                        </h1>
                        <p className="text-slate-400 text-base leading-relaxed">
                            {isAuthenticated ? (
                                <>
                                    Bestätige das Konto für <span className="text-white font-medium">{childName || "dein Kind"}</span>.
                                </>
                            ) : (
                                <>
                                    Dein Kind <span className="text-white font-medium">{childName || ""}</span> benötigt deine Zustimmung für Workfare.
                                </>
                            )}
                        </p>
                    </div>
                </div>

                {/* Main Card */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl shadow-xl">
                    {isAuthenticated === false ? (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <p className="text-white font-medium text-lg">Einloggen zum Fortfahren</p>
                                <p className="text-sm text-slate-400 leading-relaxed">
                                    Um die Sicherheit deines Kindes zu gewährleisten, benötigen wir deine Bestätigung über ein Workfare-Konto.
                                </p>
                            </div>

                            <ButtonPrimary
                                onClick={handleLoginRedirect}
                                className="w-full justify-center h-12 text-base font-medium shadow-lg shadow-indigo-500/20"
                            >
                                Jetzt anmelden oder registrieren
                            </ButtonPrimary>
                        </div>
                    ) : (
                        <>
                            {/* Current User Info for Authenticated State */}
                            <div className="mb-6 p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-10 h-10 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center text-white font-bold">
                                        {/* Avatar Fallback */}
                                        {(currentUserEmail || "U").charAt(0).toUpperCase()}
                                    </div>
                                    <div className="text-left overflow-hidden min-w-0">
                                        <p className="text-xs text-slate-400">Angemeldet als</p>
                                        <p className="text-sm font-medium text-white truncate w-full" title={currentUserEmail || ""}>
                                            {currentUserEmail}
                                        </p>
                                    </div>
                                </div>
                                <ButtonSecondary
                                    onClick={handleLogout}
                                    className="h-9 px-3 text-xs bg-transparent border-slate-600 hover:bg-slate-700 whitespace-nowrap flex-shrink-0"
                                >
                                    Nicht du?
                                </ButtonSecondary>
                            </div>

                            <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                                Hiermit bestätige ich, dass ich erziehungsberechtigt bin und der Nutzung von Workfare durch mein Kind zustimme.
                            </p>

                            {state === "success" ? (
                                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-6 py-6 text-center animate-in fade-in zoom-in-95 duration-300">
                                    <div className="mx-auto w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-3">
                                        <CheckCircle className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-base font-semibold text-emerald-100 mb-1">Erfolgreich bestätigt</h3>
                                    <p className="text-xs text-emerald-200/80 mb-4">
                                        Vielen Dank! Das Konto ist nun freigeschaltet.
                                    </p>
                                    <ButtonPrimary
                                        onClick={() => router.push('/app-home')}
                                        className="w-full justify-center h-10 text-sm font-medium"
                                    >
                                        Weiter zum Dashboard
                                    </ButtonPrimary>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <ButtonPrimary
                                        onClick={confirm}
                                        disabled={state === "loading" || isAuthenticated === null}
                                        className="w-full justify-center h-12 text-base font-semibold shadow-indigo-500/20 shadow-lg"
                                    >
                                        {state === "loading" ? "Wird bestätigt..." : "Jetzt bestätigen"}
                                    </ButtonPrimary>

                                    {state === "error" && (
                                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-center gap-3 text-left">
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            <div>
                                                <p className="opacity-90 leading-tight">{error || "Bestätigung fehlgeschlagen."}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function GuardianAccessPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#07090f] flex items-center justify-center text-white"><div className="animate-pulse">Laden...</div></div>}>
            <GuardianAccessContent />
        </Suspense>
    );
}
