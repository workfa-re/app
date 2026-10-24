"use client";

import { useState, useEffect, Fragment, useCallback, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { createGuardianInvitation } from "@/app/actions/guardian";
import { X, ShieldCheck, UserPlus, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GuardianStatus } from "@/lib/types";

interface GuardianConsentModalProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: "initial" | "add"; // "initial" = mandatory first consent, "add" = adding additional guardian
    guardianStatus?: GuardianStatus | null;
}

export function GuardianConsentModal({ isOpen, onClose, variant = "initial", guardianStatus = null }: GuardianConsentModalProps) {
    const [step, setStep] = useState<"initial" | "generated">("initial");
    const [isLoading, setIsLoading] = useState(false);
    const [link, setLink] = useState("");
    const [expiresAt, setExpiresAt] = useState<string | null>(null);
    const [timeLeft, setTimeLeft] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(false);
    const shouldShowExistingLink = variant === "initial" && guardianStatus === "pending";

    // Countdown logic
    useEffect(() => {
        if (!expiresAt) return;

        const updateTimeLeft = () => {
            const now = new Date().getTime();
            const expiry = new Date(expiresAt).getTime();
            const diff = expiry - now;

            if (diff <= 0) {
                setTimeLeft("Abgelaufen");
                setStep("initial");
                setLink("");
                setExpiresAt(null);
                setError("Der bisherige Link ist abgelaufen. Erstelle einen neuen Link.");
            } else {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                setTimeLeft(`noch ${hours} Std. ${minutes} Min.`);
            }
        };

        updateTimeLeft(); // Initial call
        const interval = setInterval(updateTimeLeft, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [expiresAt]); // Run when expiresAt changes

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const fetchOrGenerateLink = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setIsLoading(true);
        setError(null);
        try {
            const res = await createGuardianInvitation();
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            if (res.error) {
                setError(res.error);
            } else if (res.token) {
                const url = `${window.location.origin}/guardian/access?token=${res.token}`;
                setLink(url);
                setExpiresAt(res.expires_at || null);
                setStep("generated");
            } else {
                setError("Einladungslink konnte nicht erstellt werden.");
            }
        } catch {
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            setError("Ein unerwarteter Fehler ist aufgetreten.");
        } finally {
            if (mountedRef.current && requestId === requestIdRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!isOpen) {
            requestIdRef.current += 1;
            setIsLoading(false);
            return;
        }

        if (isOpen) {
            setStep("initial");
            setLink("");
            setExpiresAt(null);
            setTimeLeft("");
            setError(null);
            setCopied(false);
            requestIdRef.current += 1;

            if (shouldShowExistingLink) {
                void fetchOrGenerateLink();
            }
        }
    }, [fetchOrGenerateLink, isOpen, shouldShowExistingLink]);

    const copyWithFallback = (text: string) => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const didCopy = document.execCommand("copy");
            if (!didCopy) throw new Error("Copy command failed");
        } finally {
            document.body.removeChild(textarea);
        }
    };

    const copyToClipboard = async () => {
        if (!link) return;

        setError(null);
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(link);
            } else {
                copyWithFallback(link);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
            setError("Link konnte nicht kopiert werden.");
        }
    };

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-[100]" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="guardian-consent-backdrop fixed inset-0 backdrop-blur-md" />
                </Transition.Child>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4 text-center">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-500"
                            enterFrom="opacity-0 scale-95 translate-y-4"
                            enterTo="opacity-100 scale-100 translate-y-0"
                            leave="ease-in duration-300"
                            leaveFrom="opacity-100 scale-100 translate-y-0"
                            leaveTo="opacity-0 scale-95 translate-y-4"
                        >
                            <Dialog.Panel className="guardian-consent-panel w-full max-w-lg transform overflow-hidden rounded-[2.5rem] border text-left align-middle transition-all relative">

                                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                    <div className="guardian-consent-glow absolute -top-[50%] -right-[50%] w-[100%] h-[100%] blur-[100px] rounded-full" />
                                    <div className="guardian-consent-hairline absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent opacity-50" />
                                </div>

                                <div className="absolute top-4 right-4 z-20">
                                    <button
                                        type="button"
                                        className="guardian-consent-close rounded-full p-2 transition-colors border"
                                        onClick={onClose}
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>

                                <div className="relative z-10 p-8 md:p-10 flex flex-col items-center text-center">

                                    <div className="mb-6 relative">
                                        <div className="guardian-consent-icon-glow absolute inset-0 blur-2xl rounded-full opacity-50 animate-pulse-slow" />
                                        <div className="guardian-consent-icon-shell relative w-24 h-24 rounded-3xl border flex items-center justify-center shadow-xl">
                                            {variant === "initial" ? (
                                                <ShieldCheck size={40} className="text-indigo-400" />
                                            ) : (
                                                <UserPlus size={40} className="text-indigo-400" />
                                            )}
                                        </div>
                                        <div className="guardian-consent-status-badge absolute -bottom-2 -right-2 px-3 py-1 border rounded-full flex items-center gap-1 shadow-lg">
                                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                            <span className="text-[10px] font-bold tracking-wider">ACTION</span>
                                        </div>
                                    </div>

                                    <Dialog.Title as="h3" className="guardian-consent-title text-3xl font-black tracking-tight leading-tight mb-3">
                                        {variant === "initial" ? "Erlaubnis der Eltern" : "Elternteil hinzufügen"}
                                    </Dialog.Title>

                                    <p className="guardian-consent-copy text-sm md:text-base font-medium leading-relaxed max-w-sm mb-8">
                                        {variant === "initial"
                                            ? "Damit du Jobs annehmen kannst, brauchen wir kurz das OK deiner Eltern. Sicherheit geht vor!"
                                            : "Lade einen weiteren Erziehungsberechtigten ein, um dein Profil zu verwalten."}
                                    </p>

                                    {step === "initial" ? (
                                        <div className="w-full space-y-4">
                                            {error && (
                                                <div className="guardian-consent-error w-full p-4 rounded-xl border text-xs font-semibold text-center">
                                                    {error}
                                                </div>
                                            )}

                                            <ButtonPrimary
                                                onClick={fetchOrGenerateLink}
                                                disabled={isLoading}
                                                className={cn(
                                                    "guardian-consent-primary",
                                                    "w-full py-5 text-lg rounded-2xl shadow-[0_0_40px_-10px_rgba(79,70,229,0.3)] hover:shadow-[0_0_60px_-10px_rgba(79,70,229,0.5)] transition-all",
                                                    "bg-[#4F46E5] hover:bg-[#4338CA] border border-white/10"
                                                )}
                                            >
                                                {isLoading ? (
                                                    <span className="flex items-center justify-center gap-2">
                                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                        {shouldShowExistingLink ? "Link wird geladen..." : "Einen Moment..."}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center justify-center gap-2">
                                                        <LinkIcon size={20} />
                                                        {shouldShowExistingLink ? "Link anzeigen" : "Link erstellen"}
                                                    </span>
                                                )}
                                            </ButtonPrimary>

                                            <p className="guardian-consent-helper text-xs font-medium">
                                                {shouldShowExistingLink ? "Der vorhandene Link bleibt bis zum Ablauf gültig." : "Dauert nur 30 Sekunden. Kein Papierkram."}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                            {error && (
                                                <div className="guardian-consent-error w-full p-4 rounded-xl border text-xs font-semibold text-center">
                                                    {error}
                                                </div>
                                            )}

                                            <div className="guardian-consent-link-card w-full rounded-2xl p-1 border relative overflow-hidden group">
                                                <div className="guardian-consent-link-glow absolute inset-0 transition-colors" />

                                                <div className="relative flex items-center">
                                                    <div className="guardian-consent-link-text flex-1 px-4 py-3 text-sm font-mono truncate">
                                                        {link}
                                                    </div>
                                                    <button
                                                        onClick={copyToClipboard}
                                                        className={cn(
                                                            "m-1 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg",
                                                            copied
                                                                ? "bg-emerald-500 text-white shadow-emerald-500/20"
                                                                : "bg-white text-slate-900 hover:bg-slate-200 shadow-white/10"
                                                        )}
                                                    >
                                                        {copied ? "Kopiert!" : "Kopieren"}
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="guardian-consent-expiry flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-widest">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                Gültig für {timeLeft || "24 Stunden"}
                                            </div>

                                            <div className="guardian-consent-footer pt-4 border-t">
                                                <button
                                                    onClick={onClose}
                                                    className="guardian-consent-secondary text-sm font-medium transition-colors"
                                                >
                                                    Schließen
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
}
