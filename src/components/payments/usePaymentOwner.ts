"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PAYMENT_OWNER_CHANGED = "Bitte öffne Workfare Pay nach deiner Anmeldung erneut.";

/** An auth change invalidates pending UI results as well as subsequent starts. */
export function usePaymentOwner(ownerId: string | undefined) {
    const invalidated = useRef<string | null>(null);
    const mounted = useRef(false);
    const [blockedOwner, setBlockedOwner] = useState<string | null>(null);
    const isCurrentOwner = useCallback(() => Boolean(mounted.current && ownerId && UUID.test(ownerId) && invalidated.current !== ownerId), [ownerId]);
    useEffect(() => {
        if (!ownerId || !UUID.test(ownerId)) return;
        mounted.current = true;
        const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
            if (event !== "SIGNED_OUT" && (!session?.user.id || session.user.id === ownerId)) return;
            invalidated.current = ownerId;
            setBlockedOwner(ownerId);
        });
        return () => { mounted.current = false; subscription.unsubscribe(); };
    }, [ownerId]);
    return { isCurrentOwner, ownerChanged: Boolean(ownerId && blockedOwner === ownerId) };
}
