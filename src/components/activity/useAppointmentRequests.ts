"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAppointmentRequests } from "@/app/app-home/applications/actions";
import type { AppointmentRequest } from "@/lib/activity/appointments";
import { supabaseBrowser } from "@/lib/supabaseClient";

type RequestSnapshot = { requests: AppointmentRequest[]; available: boolean };
const NO_REQUESTS: AppointmentRequest[] = [];

/** Serialize refreshes and discard a response invalidated while it was loading. */
export function createAppointmentRequestsLoader(
    load: () => Promise<RequestSnapshot>,
    publish: (snapshot: RequestSnapshot) => void,
) {
    let active = true;
    let dirty = false;
    let inFlight: Promise<void> | null = null;

    const refresh = (): Promise<void> => {
        if (!active) return Promise.resolve();
        dirty = true;
        if (inFlight) return inFlight;

        const drain = async () => {
            try {
                while (active && dirty) {
                    dirty = false;
                    let snapshot: RequestSnapshot;
                    try { snapshot = await load(); }
                    catch { snapshot = { requests: [], available: false }; }
                    if (!active) return;
                    if (!dirty) publish(snapshot);
                }
            } finally {
                inFlight = null;
            }
        };

        inFlight = Promise.resolve().then(drain);
        return inFlight;
    };

    return {
        refresh,
        dispose() { active = false; dirty = false; },
    };
}

/** One owner per conversation shares pending proposals between header and details. */
export function useAppointmentRequests(applicationId: string, enabled: boolean) {
    const scope = useMemo(() => ({ applicationId, enabled }), [applicationId, enabled]);
    const [snapshot, setSnapshot] = useState<(RequestSnapshot & { scope: typeof scope }) | null>(null);
    const loaderRef = useRef<{ scope: typeof scope; loader: ReturnType<typeof createAppointmentRequestsLoader> } | null>(null);

    useEffect(() => {
        if (!scope.enabled || !scope.applicationId) return;
        const loader = createAppointmentRequestsLoader(async () => {
            const result = await getAppointmentRequests(scope.applicationId);
            return { available: result.available, requests: "requests" in result ? result.requests ?? [] : [] };
        }, next => setSnapshot({ ...next, scope }));
        loaderRef.current = { scope, loader };

        void loader.refresh();
        const channel = supabaseBrowser.channel(`appointment-details:${scope.applicationId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "job_appointment_requests", filter: `application_id=eq.${scope.applicationId}` }, () => { void loader.refresh(); })
            .subscribe(status => { if (status === "SUBSCRIBED") void loader.refresh(); });
        const refreshVisible = () => { if (document.visibilityState === "visible") void loader.refresh(); };
        document.addEventListener("visibilitychange", refreshVisible);

        return () => {
            loader.dispose();
            if (loaderRef.current?.loader === loader) loaderRef.current = null;
            document.removeEventListener("visibilitychange", refreshVisible);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [scope]);

    const refresh = useCallback(() => loaderRef.current?.scope === scope
        ? loaderRef.current.loader.refresh()
        : Promise.resolve(), [scope]);
    const current = scope.enabled && snapshot?.scope === scope ? snapshot : null;
    return { requests: current?.requests ?? NO_REQUESTS, available: current?.available ?? null, refresh };
}
