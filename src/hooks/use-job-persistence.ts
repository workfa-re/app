"use client";

import { useCallback, useEffect, useState } from "react";
import { readBrandStorage, writeBrandStorage, removeBrandStorage } from "@/lib/brand-storage";

const STORAGE_KEY = "workfare_create_job_draft";

export type JobDraftData = {
    title: string;
    description: string;
    wage: string;
    location?: {
        address: string;
        lat?: number;
        lng?: number;
        city?: string;
        zip?: string;
        label?: string; // For "My Location" vs "Custom"
        isDefault?: boolean;
    };
    category?: string;
    paymentType?: string;
    jobKind?: "one_time" | "recurring";
    recurrenceRule?: "weekly" | "biweekly" | "monthly" | "flexible";
    continuityPreferred?: boolean;
    isDefaultLocation?: boolean;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DraftSnapshot = { draft: JobDraftData | null; hasRestoredDraft: boolean };

/** Defaults alone are not work the user needs to recover later. */
export function hasMeaningfulJobDraft(data: Partial<JobDraftData>, hasDefaultLocation: boolean) {
    return Boolean(data.title?.trim() || data.description?.trim() || data.wage?.trim() || data.category
        || data.location || (data.paymentType && data.paymentType !== "hourly")
        || data.jobKind === "recurring" || (data.recurrenceRule && data.recurrenceRule !== "weekly")
        || data.continuityPreferred === false
        || (typeof data.isDefaultLocation === "boolean" && data.isDefaultLocation !== hasDefaultLocation));
}

/** Storage work happens in explicit operations, never in React state updaters. */
export function createJobDraftPersistence(
    storage: () => DraftStorage,
    onError: (operation: string, error: unknown) => void = (operation, error) => console.error(operation, error),
) {
    let snapshot: DraftSnapshot = { draft: null, hasRestoredDraft: false };
    let currentValue: string | null = null;
    let persistedValue: string | null = null;

    function load() {
        try {
            const saved = readBrandStorage(storage(), STORAGE_KEY);
            if (saved) {
                const parsed: unknown = JSON.parse(saved);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    const value = JSON.stringify(parsed);
                    if (value !== currentValue || !snapshot.hasRestoredDraft)
                        snapshot = { draft: parsed as JobDraftData, hasRestoredDraft: true };
                    currentValue = value;
                    persistedValue = value;
                }
            }
        } catch (error) { onError("Failed to load job draft", error); }
        return snapshot;
    }

    function save(data: Partial<JobDraftData>) {
        try {
            const updated = { ...(snapshot.draft || {}), ...data } as JobDraftData;
            const value = JSON.stringify(updated);
            if (value !== currentValue) {
                currentValue = value;
                snapshot = { ...snapshot, draft: updated };
            }
            if (value !== persistedValue) {
                writeBrandStorage(storage(), STORAGE_KEY, value);
                persistedValue = value;
            }
        } catch (error) { onError("Failed to save job draft", error); }
        return snapshot;
    }

    function clear() {
        try {
            removeBrandStorage(storage(), STORAGE_KEY);
            snapshot = { draft: null, hasRestoredDraft: false };
            currentValue = null;
            persistedValue = null;
        } catch (error) { onError("Failed to clear job draft", error); }
        return snapshot;
    }

    return { load, save, clear, getSnapshot: () => snapshot };
}

export function useJobFormPersistence() {
    const [persistence] = useState(() => createJobDraftPersistence(() => localStorage));
    const [snapshot, setSnapshot] = useState(persistence.getSnapshot);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        setSnapshot(persistence.load());
        setIsLoaded(true);
    }, [persistence]);

    const saveDraft = useCallback((data: Partial<JobDraftData>) => {
        setSnapshot(persistence.save(data));
    }, [persistence]);
    const clearDraft = useCallback(() => {
        setSnapshot(persistence.clear());
    }, [persistence]);

    return { ...snapshot, isLoaded, saveDraft, clearDraft };
}
