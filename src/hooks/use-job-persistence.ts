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

export function useJobFormPersistence() {
    const [draft, setDraft] = useState<JobDraftData | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load from storage on mount
    useEffect(() => {
        try {
            const saved = readBrandStorage(localStorage, STORAGE_KEY);
            if (saved) {
                setDraft(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Failed to load job draft", e);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    // Save to storage
    const saveDraft = useCallback((data: Partial<JobDraftData>) => {
        try {
            setDraft((current) => {
                const updated = { ...(current || {}), ...data } as JobDraftData;
                writeBrandStorage(localStorage, STORAGE_KEY, JSON.stringify(updated));
                return updated;
            });
        } catch (e) {
            console.error("Failed to save job draft", e);
        }
    }, []);

    // Clear storage
    const clearDraft = useCallback(() => {
        try {
            removeBrandStorage(localStorage, STORAGE_KEY);
            setDraft(null);
        } catch (e) {
            console.error("Failed to clear job draft", e);
        }
    }, []);

    return { draft, isLoaded, saveDraft, clearDraft };
}
