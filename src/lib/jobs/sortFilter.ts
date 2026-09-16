/**
 * Pure domain module for job list sorting and filtering.
 * No UI imports — fully unit-testable.
 */
import type { JobsListItem } from "@/lib/types/platform";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortOption = "distance" | "newest" | "wage_desc";

export interface FilterState {
    categories: string[];
    maxDistanceKm: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_SORT_OPTION: SortOption = "distance";

export const DEFAULT_FILTER_STATE: FilterState = {
    categories: [],
    maxDistanceKm: null,
};

export const MAX_DISTANCE_KM_OPTIONS = [5, 10, 20, 50] as const;
export type MaxDistanceKm = (typeof MAX_DISTANCE_KM_OPTIONS)[number] | null;

/** Label + description for each sort mode (icons live in the UI layer). */
export const SORT_META: Record<SortOption, { label: string; description: string }> = {
    distance:  { label: "Entfernung", description: "Nächstgelegene zuerst" },
    newest:    { label: "Neueste",    description: "Zuletzt eingestellt" },
    wage_desc: { label: "Vergütung",  description: "Höchste zuerst" },
};

const VALID_SORT_OPTIONS: readonly SortOption[] = ["distance", "newest", "wage_desc"];

export function isValidSortOption(v: unknown): v is SortOption {
    return typeof v === "string" && (VALID_SORT_OPTIONS as string[]).includes(v);
}

export function isValidMaxDistanceKm(v: unknown): v is MaxDistanceKm {
    return v === null || (
        typeof v === "number" &&
        (MAX_DISTANCE_KM_OPTIONS as readonly number[]).includes(v)
    );
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

/**
 * Sort jobs by the given mode with stable tie-breakers:
 *   1. Primary: chosen sort
 *   2. Tie-break 1: newest first (created_at desc)
 *   3. Tie-break 2: id asc (lexicographic, stable across JS engines)
 */
export function sortJobs(jobs: readonly JobsListItem[], mode: SortOption): JobsListItem[] {
    return [...jobs].sort((a, b) => {
        const primary = comparePrimary(a, b, mode);
        if (primary !== 0) return primary;

        const byDate =
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (byDate !== 0) return byDate;

        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function comparePrimary(a: JobsListItem, b: JobsListItem, mode: SortOption): number {
    switch (mode) {
        case "distance": {
            const aKm = a.distance_km ?? null;
            const bKm = b.distance_km ?? null;
            if (aKm === null && bKm === null) return 0;
            if (aKm === null) return 1;  // jobs without distance sink to bottom
            if (bKm === null) return -1;
            return aKm - bKm;
        }
        case "newest":
            return (
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
        case "wage_desc": {
            const aW = a.wage_hourly ?? null;
            const bW = b.wage_hourly ?? null;
            if (aW === null && bW === null) return 0;
            if (aW === null) return 1;  // jobs without wage sink to bottom
            if (bW === null) return -1;
            return bW - aW;
        }
    }
}

// ─── Filter ───────────────────────────────────────────────────────────────────

/**
 * Filter jobs by categories and max distance.
 * Jobs with unknown distance_km are hidden when a max-distance filter is active.
 */
export function applyFilters(
    jobs: readonly JobsListItem[],
    filters: FilterState
): JobsListItem[] {
    // Fast path: no filters active
    if (filters.categories.length === 0 && filters.maxDistanceKm === null) {
        return [...jobs];
    }

    return jobs.filter((job) => {
        if (
            filters.categories.length > 0 &&
            !filters.categories.includes(job.category ?? "other")
        ) {
            return false;
        }
        if (filters.maxDistanceKm !== null) {
            const km = job.distance_km ?? null;
            if (km === null || km > filters.maxDistanceKm) return false;
        }
        return true;
    });
}

// ─── Composed helper ──────────────────────────────────────────────────────────

/**
 * Apply filters then sort in a single call.
 * Use this in rendering layers to avoid repeating `sortJobs(applyFilters(...))`.
 */
export function deriveVisibleJobs(
    jobs: readonly JobsListItem[],
    filters: FilterState,
    sort: SortOption
): JobsListItem[] {
    return sortJobs(applyFilters(jobs, filters), sort);
}
