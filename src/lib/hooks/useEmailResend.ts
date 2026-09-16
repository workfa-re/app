"use client";

import { useState, useEffect, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

import { readBrandStorage, writeBrandStorage } from "@/lib/brand-storage";

const COOLDOWN_SECONDS = 60;
const STORAGE_PREFIX = "workfare-confirmation-email-last-sent:";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

function getStorageKey(email: string) {
    return `${STORAGE_PREFIX}${normalizeEmail(email)}`;
}

function getRemainingCooldown(email: string): number {
    if (typeof window === "undefined" || !email) return 0;

    const raw = readBrandStorage(window.localStorage, getStorageKey(email));
    const lastSentAt = raw ? Number.parseInt(raw, 10) : 0;
    if (!lastSentAt) return 0;

    const elapsedSeconds = Math.floor((Date.now() - lastSentAt) / 1000);
    return Math.max(0, COOLDOWN_SECONDS - elapsedSeconds);
}

function persistLastSent(email: string) {
    if (typeof window === "undefined" || !email) return;
    writeBrandStorage(window.localStorage, getStorageKey(email), String(Date.now()));
}

interface UseEmailResendReturn {
    cooldown: number;
    message: string;
    error: string | null;
    loading: boolean;
    resend: () => Promise<boolean>;
    forceResend: (successMessage?: string) => Promise<boolean>;
    markSent: (message?: string) => void;
}

/**
 * Hook für E-Mail-Resend mit Rate Limiting (60s Cooldown).
 */
export function useEmailResend(email: string): UseEmailResendReturn {
    const [cooldown, setCooldown] = useState(0);
    const [message, setMessage] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!email) {
            setCooldown(0);
            return;
        }

        const syncCooldown = () => {
            setCooldown(getRemainingCooldown(email));
        };

        syncCooldown();
        const interval = window.setInterval(syncCooldown, 1000);
        return () => window.clearInterval(interval);
    }, [email]);

    const markSent = useCallback((nextMessage = "Bestätigungs-E-Mail mit Code wurde gesendet.") => {
        if (!email) return;

        persistLastSent(email);
        setCooldown(getRemainingCooldown(email));
        setError(null);
        setMessage(nextMessage);
    }, [email]);

    const sendConfirmationEmail = useCallback(async (options?: {
        ignoreCooldown?: boolean;
        successMessage?: string;
    }) => {
        if ((!options?.ignoreCooldown && cooldown > 0) || !email) return false;

        setLoading(true);
        setMessage("");
        setError(null);

        try {
            let { error: err } = await supabaseBrowser.auth.resend({
                type: "signup",
                email,
            });

            if (err?.message === "Error sending confirmation email") {
                throw new Error("Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.");
            }

            if (err) throw err;

            markSent(options?.successMessage || "Bestätigungs-E-Mail mit Code wurde erneut gesendet.");
            return true;
        } catch (err) {
            const isRateLimit =
                (err as { status?: number })?.status === 429 ||
                (err as Error)?.message?.includes("security purposes");

            if (isRateLimit) {
                persistLastSent(email);
                setError("E-Mail kann nur alle 60 Sekunden gesendet werden. Prüfe deinen Spam-Ordner.");
                setCooldown(getRemainingCooldown(email));
            } else {
                setError((err as Error)?.message || "Fehler beim Senden.");
            }
            return false;
        } finally {
            setLoading(false);
        }
    }, [email, cooldown, markSent]);

    const resend = useCallback(() => sendConfirmationEmail(), [sendConfirmationEmail]);

    const forceResend = useCallback((successMessage = "Neuer Bestätigungscode wurde gesendet.") => {
        return sendConfirmationEmail({
            ignoreCooldown: true,
            successMessage,
        });
    }, [sendConfirmationEmail]);

    return { cooldown, message, error, loading, resend, forceResend, markSent };
}
