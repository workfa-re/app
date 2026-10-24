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
    reach?: "internal_rheinbach" | "extended";
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DraftSnapshot = { draft: JobDraftData | null; hasRestoredDraft: boolean };

/** Defaults alone are not work the user needs to recover later. */
export function hasMeaningfulJobDraft(data: Partial<JobDraftData>, hasDefaultLocation: boolean) {
    return Boolean(data.title?.trim() || data.description?.trim() || data.wage?.trim() || data.category
        || data.location || (data.paymentType && data.paymentType !== "hourly")
        || data.jobKind === "recurring" || (data.recurrenceRule && data.recurrenceRule !== "weekly")
        || data.continuityPreferred === false
        || data.reach === "extended"
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
    let completed = false;

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

    function persist(data: Partial<JobDraftData>) {
        if (completed) return { snapshot, saved: false };
        let saved = false;
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
            saved = true;
        } catch (error) { onError("Failed to save job draft", error); }
        return { snapshot, saved };
    }

    function save(data: Partial<JobDraftData>) { return persist(data).snapshot; }
    function flush(data: Partial<JobDraftData>) { return persist(data).saved; }

    function discard() {
        try {
            const store = storage();
            removeBrandStorage(store, STORAGE_KEY);
            // Verify both the current key and any recoverable legacy draft.
            if (store.getItem(STORAGE_KEY) !== null || readBrandStorage(store, STORAGE_KEY) !== null) {
                throw new Error("Job draft removal was blocked.");
            }
            snapshot = { draft: null, hasRestoredDraft: false };
            currentValue = null;
            persistedValue = null;
            return true;
        } catch (error) { onError("Failed to clear job draft", error); }
        return false;
    }
    function clear() { discard(); return snapshot; }
    function complete() {
        completed = true;
        return discard();
    }

    return { load, save, flush, clear, discard, complete, getSnapshot: () => snapshot };
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
        const saved = persistence.flush(data);
        setSnapshot(persistence.getSnapshot());
        return saved;
    }, [persistence]);
    const clearDraft = useCallback(() => {
        const cleared = persistence.discard();
        setSnapshot(persistence.getSnapshot());
        return cleared;
    }, [persistence]);
    const completeDraft = useCallback(() => {
        const cleared = persistence.complete();
        setSnapshot(persistence.getSnapshot());
        return cleared;
    }, [persistence]);

    return { ...snapshot, isLoaded, saveDraft, clearDraft, completeDraft };
}
