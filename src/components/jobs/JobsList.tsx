"use client";

import React, { startTransition, useState, useCallback, useMemo, useEffect, useRef, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { resolveSelectedJobSnapshot } from "./job-presentation";
import { JobsListSection } from "@/components/jobs/JobsListSection";
import { Briefcase, ListFilter } from "lucide-react";
import type { JobsListItem } from "@/lib/types/platform";
import { getActivityConversationHref } from "@/lib/activity/navigation";
import {
    deriveVisibleJobs,
    isValidSortOption,
    isValidMaxDistanceKm,
    DEFAULT_SORT_OPTION,
    DEFAULT_FILTER_STATE,
    SORT_META,
    type SortOption,
    type FilterState,
} from "@/lib/jobs/sortFilter";
import { warmJobsUI } from "@/lib/ui-warmup";
import { startPerfMark } from "@/lib/perf";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { getJobDiscoveryHref, type JobDiscoveryPreferences } from "@/lib/jobs/discovery";

const JobDetailModal = dynamic(
    () => import("@/components/jobs/JobDetailModal").then((mod) => mod.JobDetailModal),
    { ssr: false }
);

const JobFilterSortPanel = dynamic(
    () => import("@/components/jobs/JobFilterSortPanel").then((mod) => mod.JobFilterSortPanel),
    { ssr: false }
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobsListProps {
    currentUserId: string;
    localActiveJobs: JobsListItem[];
    extendedActiveJobs: JobsListItem[];
    applicationConversations: Record<string, string | null>;
    initialPreferences?: JobDiscoveryPreferences;
    hasExplicitPreferences?: boolean;
    hasLocation?: boolean;
    canApply: boolean;
    guardianStatus: string;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "jb_filter_sort_v1";
const DEFAULT_PREFERENCES: JobDiscoveryPreferences = { sortOption: DEFAULT_SORT_OPTION, filterState: DEFAULT_FILTER_STATE };

function loadPersistedState(): { sortOption: SortOption; filterState: FilterState } {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { sortOption: DEFAULT_SORT_OPTION, filterState: DEFAULT_FILTER_STATE };
        const parsed = JSON.parse(raw) as { sortOption?: unknown; filterState?: Partial<FilterState> };
        const fs = parsed.filterState;
        return {
            sortOption: isValidSortOption(parsed.sortOption)
                ? parsed.sortOption
                : DEFAULT_SORT_OPTION,
            filterState: {
                categories: Array.isArray(fs?.categories)
                    ? fs.categories.filter((c): c is string => typeof c === "string")
                    : [],
                maxDistanceKm:
                    isValidMaxDistanceKm(fs?.maxDistanceKm)
                        ? fs.maxDistanceKm
                        : null,
            },
        };
    } catch {
        return { sortOption: DEFAULT_SORT_OPTION, filterState: DEFAULT_FILTER_STATE };
    }
}

function persistState(sortOption: SortOption, filterState: FilterState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sortOption, filterState }));
    } catch { /* storage unavailable — ignore */ }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobsList({
    currentUserId,
    localActiveJobs,
    extendedActiveJobs,
    applicationConversations,
    initialPreferences = DEFAULT_PREFERENCES,
    hasExplicitPreferences = false,
    hasLocation = true,
    canApply,
    guardianStatus,
}: JobsListProps) {
    const router = useRouter();
    const [selectedJob, setSelectedJob] = useState<JobsListItem | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const detailTriggerRef = useRef<HTMLElement | null>(null);
    const resultsRef = useRef<HTMLElement | null>(null);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [hasOpenedFilterPanel, setHasOpenedFilterPanel] = useState(false);

    const [sortOption, setSortOption] = useState<SortOption>(initialPreferences.sortOption);
    const [filterState, setFilterState] = useState<FilterState>(initialPreferences.filterState);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [isUpdating, startFilterTransition] = useTransition();
    const initialConfig = useRef({ initialPreferences, hasExplicitPreferences, hasLocation });
    const preferencesLoaded = useRef(false);
    const incomingKey = JSON.stringify(initialPreferences);
    const lastIncomingKey = useRef(incomingKey);

    const updatePreferences = useCallback((preferences: JobDiscoveryPreferences) => {
        setSortOption(preferences.sortOption);
        setFilterState(preferences.filterState);
        const href = getJobDiscoveryHref(window.location.href, preferences);
        if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
            startFilterTransition(() => router.replace(href, { scroll: false }));
        }
    }, [router]);

    // Load persisted state after hydration
    useEffect(() => {
        if (preferencesLoaded.current) return;
        preferencesLoaded.current = true;
        const config = initialConfig.current;
        if (!config.hasExplicitPreferences) {
            const stored = loadPersistedState();
            const preferences = config.hasLocation ? stored : { sortOption: "newest" as const, filterState: { ...stored.filterState, maxDistanceKm: null } };
            if (JSON.stringify(preferences) !== JSON.stringify(config.initialPreferences)) updatePreferences(preferences);
        }
        setPreferencesReady(true);
    }, [updatePreferences]);

    // Back/forward and a refreshed location may change server preferences.
    useEffect(() => {
        if (lastIncomingKey.current === incomingKey) return;
        lastIncomingKey.current = incomingKey;
        setSortOption(initialPreferences.sortOption);
        setFilterState(initialPreferences.filterState);
    }, [incomingKey, initialPreferences]);

    // These small, discrete preferences must survive an immediate route change.
    useEffect(() => {
        if (preferencesReady) persistState(sortOption, filterState);
    }, [sortOption, filterState, preferencesReady]);

    // Derived UI state
    const activeFilterCount =
        (filterState.categories.length > 0 ? 1 : 0) +
        (filterState.maxDistanceKm !== null ? 1 : 0);
    const isNonDefaultSort = sortOption !== DEFAULT_SORT_OPTION;
    const hasChanges = activeFilterCount > 0 || isNonDefaultSort;
    const totalBadgeCount = activeFilterCount + (isNonDefaultSort ? 1 : 0);
    const currentSortLabel = SORT_META[sortOption].label;

    const handleJobSelect = useCallback((job: JobsListItem) => {
        if (Object.hasOwn(applicationConversations, job.id) || job.is_applied || job.application_id || job.application_status) {
            router.push(getActivityConversationHref(applicationConversations[job.id] ?? job.application_id));
            return;
        }
        detailTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        startPerfMark("job-detail-open");
        void warmJobsUI();
        setSelectedJob(job);
        setIsDetailOpen(true);
    }, [applicationConversations, router]);

    const currentSelectedJob = useMemo(() => resolveSelectedJobSnapshot(
        selectedJob, localActiveJobs, extendedActiveJobs,
    ), [selectedJob, localActiveJobs, extendedActiveJobs]);

    useEffect(() => {
        if (!selectedJob || !Object.hasOwn(applicationConversations, selectedJob.id)) return;
        setIsDetailOpen(false);
        setSelectedJob(null);
        router.push(getActivityConversationHref(applicationConversations[selectedJob.id]));
    }, [applicationConversations, router, selectedJob]);

    const handleReset = useCallback(() => {
        updatePreferences({ sortOption: hasLocation ? DEFAULT_SORT_OPTION : "newest", filterState: DEFAULT_FILTER_STATE });
    }, [hasLocation, updatePreferences]);

    const handleFilterChange = useCallback<React.Dispatch<React.SetStateAction<FilterState>>>((action) => {
        const next = typeof action === "function" ? action(filterState) : action;
        updatePreferences({ sortOption, filterState: next });
    }, [filterState, sortOption, updatePreferences]);

    // Filtered + sorted lists (memoized)
    const filteredLocalJobs = useMemo(
        () => deriveVisibleJobs(localActiveJobs, filterState, sortOption),
        [localActiveJobs, filterState, sortOption]
    );
    const filteredExtendedJobs = useMemo(
        () => deriveVisibleJobs(extendedActiveJobs, filterState, sortOption),
        [extendedActiveJobs, filterState, sortOption]
    );

    useEffect(() => {
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                startTransition(() => router.refresh());
            }, 120);
        };

        const channel = supabaseBrowser
            .channel(`personal-job-feed:${currentUserId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "jobs" },
                scheduleRefresh,
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "jobs",
                },
                scheduleRefresh,
            )
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "applications",
                    filter: `user_id=eq.${currentUserId}`,
                },
                scheduleRefresh,
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "applications",
                    filter: `user_id=eq.${currentUserId}`,
                },
                scheduleRefresh,
            )
            .subscribe();

        return () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, router]);

    const openFilters = () => {
        setHasOpenedFilterPanel(true);
        setShowFilterPanel(true);
    };

    return (
        <>
            <div className="jobs-home-toolbar jobs-discovery-toolbar">
                <div className="jobs-home-heading"><h1>Jobs finden</h1></div>
                <button type="button" className="jobs-toolbar-filter app-glass-control ml-auto" onClick={openFilters}
                    data-active={showFilterPanel || hasChanges} aria-haspopup="dialog" aria-expanded={showFilterPanel}
                    aria-controls={showFilterPanel ? "job-filter-panel" : undefined}
                    aria-label={totalBadgeCount > 0
                        ? `Filter und Sortierung öffnen, ${totalBadgeCount} ${totalBadgeCount === 1 ? "Bereich" : "Bereiche"} angepasst`
                        : "Filter und Sortierung öffnen"} title="Filter und Sortierung">
                    <ListFilter aria-hidden="true" />
                    <span>{isNonDefaultSort && !activeFilterCount ? currentSortLabel : "Filter"}</span>
                    {totalBadgeCount > 0 && <span className="jobs-view-count" aria-hidden="true">{totalBadgeCount}</span>}
                </button>
            </div>

            <section ref={resultsRef} className="jobs-results" aria-label="Jobangebote" aria-busy={isUpdating} tabIndex={-1}>
                <div className="space-y-12">
                    <JobsListSection title="Lokale Angebote" colorClass="text-current" jobs={filteredLocalJobs}
                        emptyMsg={<EmptyState icon={Briefcase} title="Keine Jobs in deiner Nähe"
                            message={hasChanges ? "Passe deine Filter an, um weitere Jobs zu sehen." : "Sobald neue Jobs verfügbar sind, findest du sie hier."} />}
                        isWhiteTitle canApply={canApply} hideStatusLabel onSelect={handleJobSelect} />
                    {(filteredExtendedJobs.length > 0 || (hasChanges && extendedActiveJobs.length > 0)) &&
                        <JobsListSection title="Überregionale Angebote" colorClass="text-current" jobs={filteredExtendedJobs}
                            emptyMsg="Keine überregionalen Jobs für deine aktuellen Filter."
                            isWhiteTitle={false} canApply={canApply} hideStatusLabel isExtendedSection onSelect={handleJobSelect} />}
                </div>
            </section>

            {selectedJob && (
                <JobDetailModal
                    job={currentSelectedJob}
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    onClosed={() => {
                        setSelectedJob(null);
                        requestAnimationFrame(() => {
                            const trigger = detailTriggerRef.current;
                            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
                            else resultsRef.current?.focus({ preventScroll: true });
                        });
                    }}
                    canApply={canApply}
                    availableForApplication={[...localActiveJobs, ...extendedActiveJobs].some(job => job.id === selectedJob.id && job.status === "open")}
                    guardianStatus={guardianStatus}
                />
            )}

            {hasOpenedFilterPanel && (
                <JobFilterSortPanel
                    isOpen={showFilterPanel}
                    sortOption={sortOption}
                    filterState={filterState}
                    onSortChange={(sortOption) => updatePreferences({ sortOption, filterState })}
                    onFilterChange={handleFilterChange}
                    onClose={() => setShowFilterPanel(false)}
                    onReset={handleReset}
                    hasChanges={hasChanges}
                    hasLocation={hasLocation}
                />
            )}
        </>
    );
}

function EmptyState({
    icon: Icon,
    title,
    message,
}: {
    icon: React.ElementType;
    title: string;
    message: string;
}) {
    return (
        <div className="jobs-empty-copy flex flex-col items-center justify-center space-y-3 px-4 py-8">
            <div className="jobs-empty-icon flex h-12 w-12 items-center justify-center rounded-[0.95rem] border border-white/[0.05] bg-slate-900/40 text-indigo-300/50">
                <Icon size={20} className="opacity-[0.62]" />
            </div>
            <div className="space-y-1.5 text-center">
                <h3 className="jobs-empty-title text-lg font-bold leading-tight tracking-tight text-white">{title}</h3>
                <p className="jobs-empty-message mx-auto max-w-sm text-sm leading-relaxed text-slate-400">{message}</p>
            </div>
        </div>
    );
}
