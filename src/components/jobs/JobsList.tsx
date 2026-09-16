"use client";

import React, { startTransition, useState, useCallback, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { JobsListSection } from "@/components/jobs/JobsListSection";
import { Briefcase, CheckCircle2, Clock, ListFilter } from "lucide-react";
import type { JobsListItem } from "@/lib/types/platform";
import { cn } from "@/lib/utils";
import {
    deriveVisibleJobs,
    sortJobs,
    isValidSortOption,
    isValidMaxDistanceKm,
    DEFAULT_SORT_OPTION,
    DEFAULT_FILTER_STATE,
    SORT_META,
    type SortOption,
    type FilterState,
} from "@/lib/jobs/sortFilter";
import { warmJobsUI } from "@/lib/ui-warmup";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import { supabaseBrowser } from "@/lib/supabaseClient";

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
    waitlistedJobs: JobsListItem[];
    appliedJobs: JobsListItem[];
    canApply: boolean;
    guardianStatus: string;
}

type Tab = "active" | "waitlist" | "applied";

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "jb_filter_sort_v1";

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
    waitlistedJobs,
    appliedJobs,
    canApply,
    guardianStatus,
}: JobsListProps) {
    const router = useRouter();
    const [selectedJob, setSelectedJob] = useState<JobsListItem | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("active");
    const [visitedTabs, setVisitedTabs] = useState<Record<Tab, boolean>>({
        active: true,
        waitlist: false,
        applied: false,
    });
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [hasOpenedFilterPanel, setHasOpenedFilterPanel] = useState(false);

    const [sortOption, setSortOption] = useState<SortOption>(DEFAULT_SORT_OPTION);
    const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTER_STATE);

    // Load persisted state after hydration
    useEffect(() => {
        const { sortOption: s, filterState: f } = loadPersistedState();
        setSortOption(s);
        setFilterState(f);
    }, []);

    // Persist whenever state changes, debounced to avoid hammering storage on rapid chip toggles.
    // Timer lives in a ref so it is cancelled on unmount (no stale writes).
    const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        persistTimerRef.current && clearTimeout(persistTimerRef.current);
        persistTimerRef.current = setTimeout(
            () => persistState(sortOption, filterState),
            400
        );
        return () => { persistTimerRef.current && clearTimeout(persistTimerRef.current); };
    }, [sortOption, filterState]);

    // Derived UI state
    const activeFilterCount =
        (filterState.categories.length > 0 ? 1 : 0) +
        (filterState.maxDistanceKm !== null ? 1 : 0);
    const isNonDefaultSort = sortOption !== DEFAULT_SORT_OPTION;
    const hasChanges = activeFilterCount > 0 || isNonDefaultSort;
    const totalBadgeCount = activeFilterCount + (isNonDefaultSort ? 1 : 0);
    const currentSortLabel = SORT_META[sortOption].label;

    const handleTabChange = useCallback((tab: Tab) => {
        if (tab === activeTab) return;
        startPerfMark("jobs-tab-switch");
        setActiveTab(tab);
        setVisitedTabs((current) => ({ ...current, [tab]: true }));
    }, [activeTab]);

    const handleJobSelect = useCallback((job: JobsListItem) => {
        startPerfMark("job-detail-open");
        void warmJobsUI();
        setSelectedJob(job);
        setIsDetailOpen(true);
    }, []);

    const handleReset = useCallback(() => {
        setSortOption(DEFAULT_SORT_OPTION);
        setFilterState(DEFAULT_FILTER_STATE);
    }, []);

    // Filtered + sorted lists (memoized)
    const filteredLocalJobs = useMemo(
        () => deriveVisibleJobs(localActiveJobs, filterState, sortOption),
        [localActiveJobs, filterState, sortOption]
    );
    const filteredExtendedJobs = useMemo(
        () => deriveVisibleJobs(extendedActiveJobs, filterState, sortOption),
        [extendedActiveJobs, filterState, sortOption]
    );
    const sortedWaitlistedJobs = useMemo(
        () => sortJobs(waitlistedJobs, sortOption).sort((first, second) => {
            const firstIsOwn = first.application_status === "waitlisted";
            const secondIsOwn = second.application_status === "waitlisted";
            if (firstIsOwn !== secondIsOwn) return firstIsOwn ? -1 : 1;

            if (firstIsOwn && secondIsOwn) {
                return (first.my_waitlist_position ?? Number.MAX_SAFE_INTEGER)
                    - (second.my_waitlist_position ?? Number.MAX_SAFE_INTEGER);
            }

            return 0;
        }),
        [waitlistedJobs, sortOption]
    );
    const sortedAppliedJobs = useMemo(
        () => sortJobs(appliedJobs, sortOption),
        [appliedJobs, sortOption]
    );

    const totalVisibleActiveJobs = filteredLocalJobs.length + filteredExtendedJobs.length;

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            endPerfMark("jobs-tab-switch");
        });
        return () => cancelAnimationFrame(frameId);
    }, [activeTab]);

    useEffect(() => {
        if (showFilterPanel) setHasOpenedFilterPanel(true);
    }, [showFilterPanel]);

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

    const getPanelClassName = (tab: Tab) => {
        return cn(
            "col-start-1 row-start-1 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            activeTab === tab
                ? "relative z-10 translate-y-0 opacity-100 pointer-events-auto"
                : visitedTabs[tab]
                    ? "pointer-events-none opacity-0 translate-y-1"
                    : "hidden",
        );
    };

    return (
        <>
            {/* ── Mobile Tab Bar ───────────────────────────────────────── */}
            <div className="mb-7 flex w-full justify-center md:hidden">
                <div className="jobs-mobile-tabs flex w-full items-center justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950/95 p-1.5 shadow-[0_18px_50px_-26px_rgba(0,0,0,0.75)]">
                    <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
                        <MobileTab
                            active={activeTab === "active"}
                            onClick={() => handleTabChange("active")}
                            activeClass="bg-white/[0.075] text-white border-white/10"
                        >
                            <Briefcase size={14} />
                            Aktuell
                            {totalVisibleActiveJobs > 0 && (
                                <span className="jobs-mobile-tab-badge">
                                    {totalVisibleActiveJobs}
                                </span>
                            )}
                        </MobileTab>
                        <MobileTab
                            active={activeTab === "waitlist"}
                            onClick={() => handleTabChange("waitlist")}
                            activeClass="bg-white/[0.075] text-white border-white/10"
                        >
                            <Clock size={14} />
                            Warteliste
                            {sortedWaitlistedJobs.length > 0 && (
                                <span className="jobs-mobile-tab-badge">
                                    {sortedWaitlistedJobs.length}
                                </span>
                            )}
                        </MobileTab>
                        <MobileTab
                            active={activeTab === "applied"}
                            onClick={() => handleTabChange("applied")}
                            activeClass="bg-white/[0.075] text-white border-white/10"
                        >
                            <CheckCircle2 size={14} />
                            Beworben
                            {sortedAppliedJobs.length > 0 && (
                                <span className="jobs-mobile-tab-badge">
                                    {sortedAppliedJobs.length}
                                </span>
                            )}
                        </MobileTab>
                    </div>

                    <div className="jobs-mobile-tabs-divider mx-1 h-7 w-px shrink-0 bg-white/10" />

                    <FilterButton
                        onClick={() => setShowFilterPanel(true)}
                        badgeCount={totalBadgeCount}
                        isActive={hasChanges}
                        isOpen={showFilterPanel}
                        className="h-11 w-11 rounded-xl"
                    />
                </div>
            </div>

            {/* ── Desktop Tab Bar ──────────────────────────────────────── */}
            <div className="jobs-desktop-tabs hidden items-center justify-between border-b border-white/[0.08] pb-5 md:mb-10 md:flex">
                <div className="jobs-tab-group flex items-center gap-2">
                    <DesktopTab
                        active={activeTab === "active"}
                        onClick={() => handleTabChange("active")}
                        activeClass="bg-indigo-500/10 text-white ring-indigo-400/20"
                    >
                        <Briefcase size={15} className={cn(activeTab === "active" ? "text-indigo-400" : "text-slate-500")} />
                        Aktuell
                        {totalVisibleActiveJobs > 0 && <TabBadge>{totalVisibleActiveJobs}</TabBadge>}
                    </DesktopTab>
                        <DesktopTab
                            active={activeTab === "waitlist"}
                            onClick={() => handleTabChange("waitlist")}
                            activeClass="bg-white/[0.075] text-white ring-white/10"
                        >
                            <Clock size={15} className={cn(activeTab === "waitlist" ? "text-indigo-400" : "text-slate-500")} />
                        Warteliste
                        {sortedWaitlistedJobs.length > 0 && <TabBadge>{sortedWaitlistedJobs.length}</TabBadge>}
                    </DesktopTab>
                    <DesktopTab
                        active={activeTab === "applied"}
                        onClick={() => handleTabChange("applied")}
                        activeClass="bg-emerald-500/10 text-white ring-emerald-400/20"
                    >
                        <CheckCircle2 size={15} className={cn(activeTab === "applied" ? "text-emerald-400" : "text-slate-500")} />
                        Beworben
                        {sortedAppliedJobs.length > 0 && <TabBadge>{sortedAppliedJobs.length}</TabBadge>}
                    </DesktopTab>
                </div>

                <button
                    onClick={() => setShowFilterPanel(true)}
                    data-active={showFilterPanel || hasChanges}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={showFilterPanel}
                    aria-controls={showFilterPanel ? "job-filter-panel" : undefined}
                    aria-label={totalBadgeCount > 0
                        ? `Filter und Sortierung öffnen, ${totalBadgeCount} ${totalBadgeCount === 1 ? "Bereich" : "Bereiche"} angepasst`
                        : "Filter und Sortierung öffnen"}
                    className="jobs-filter-trigger relative ml-4 flex h-[3.3125rem] min-w-[6.625rem] items-center justify-center gap-2.5 whitespace-nowrap rounded-full border border-transparent px-4 py-0 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out active:scale-[0.96]"
                    title="Filter & Sortierung"
                >
                    <ListFilter size={17} />
                    <span className="hidden sm:inline">
                        {isNonDefaultSort && !activeFilterCount ? currentSortLabel : "Filter"}
                    </span>
                    {totalBadgeCount > 0 && (
                        <span aria-hidden="true" className="w-5 h-5 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {totalBadgeCount}
                        </span>
                    )}
                </button>
            </div>

            {/* ── Tab Content ──────────────────────────────────────────── */}
            <div className="relative pb-20" style={{ minHeight: 200 }}>
                <div className="grid">
                    <div
                        className={getPanelClassName("active")}
                        aria-hidden={activeTab !== "active"}
                        inert={activeTab !== "active"}
                    >
                        <div className="space-y-16">
                            <JobsListSection
                                title="Lokale Angebote"
                                colorClass="text-indigo-400"
                                jobs={filteredLocalJobs}
                                emptyMsg={
                                    <EmptyState
                                        icon={Briefcase}
                                        title="Keine lokalen Jobs gefunden"
                                        message={
                                            hasChanges
                                                ? "Keine lokalen Jobs für deine aktuellen Filter. Versuche, die Filter anzupassen."
                                                : extendedActiveJobs.length > 0
                                                    ? "Entdecke unten spannende überregionale Angebote aus benachbarten Städten."
                                                    : "In deiner Stadt wird gerade keine Unterstützung gesucht."
                                        }
                                    />
                                }
                                isWhiteTitle={true}
                                canApply={canApply}
                                hideStatusLabel={true}
                                onSelect={handleJobSelect}
                            />

                            {(filteredExtendedJobs.length > 0 || (hasChanges && extendedActiveJobs.length > 0)) && (
                                <JobsListSection
                                    title="Überregionale Angebote"
                                    colorClass="text-violet-400"
                                    jobs={filteredExtendedJobs}
                                    emptyMsg="Keine überregionalen Jobs für deine aktuellen Filter."
                                    isWhiteTitle={false}
                                    canApply={canApply}
                                    hideStatusLabel={true}
                                    isExtendedSection={true}
                                    onSelect={handleJobSelect}
                                />
                            )}
                        </div>
                    </div>

                    <div
                        className={getPanelClassName("waitlist")}
                        aria-hidden={activeTab !== "waitlist"}
                        inert={activeTab !== "waitlist"}
                    >
                        <JobsListSection
                            title="Warteliste"
                            colorClass="text-slate-300"
                            jobs={sortedWaitlistedJobs}
                            emptyMsg="Aktuell sind keine Jobs für die Warteliste verfügbar."
                            canApply={canApply}
                            hideStatusLabel={true}
                            onSelect={handleJobSelect}
                        />
                    </div>

                    <div
                        className={getPanelClassName("applied")}
                        aria-hidden={activeTab !== "applied"}
                        inert={activeTab !== "applied"}
                    >
                        <JobsListSection
                            title="Bereits Beworben"
                            colorClass="text-emerald-400"
                            jobs={sortedAppliedJobs}
                            emptyMsg="Noch keine Bewerbungen versendet."
                            canApply={canApply}
                            hideStatusLabel={true}
                            onSelect={handleJobSelect}
                        />
                    </div>
                </div>
            </div>

            {selectedJob && (
                <JobDetailModal
                    job={selectedJob}
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    onClosed={() => setSelectedJob(null)}
                    canApply={canApply}
                    guardianStatus={guardianStatus}
                />
            )}

            {hasOpenedFilterPanel && (
                <JobFilterSortPanel
                    isOpen={showFilterPanel}
                    sortOption={sortOption}
                    filterState={filterState}
                    onSortChange={setSortOption}
                    onFilterChange={setFilterState}
                    onClose={() => setShowFilterPanel(false)}
                    onReset={handleReset}
                    hasChanges={hasChanges}
                />
            )}
        </>
    );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function MobileTab({
    active,
    onClick,
    activeClass,
    children,
}: {
    active: boolean;
    onClick: () => void;
    activeClass: string;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            data-active={active}
            aria-pressed={active}
            className={cn(
                "jobs-mobile-tab relative flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors sm:gap-1.5 sm:rounded-xl sm:px-3 sm:text-xs",
                active ? activeClass : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border-transparent"
            )}
        >
            {children}
        </button>
    );
}

function DesktopTab({
    active,
    onClick,
    activeClass,
    children,
}: {
    active: boolean;
    onClick: () => void;
    activeClass: string;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            data-active={active}
            aria-pressed={active}
            className={cn(
                "jobs-desktop-tab relative flex items-center gap-2.5 whitespace-nowrap rounded-xl border border-transparent px-3.5 py-2.5 text-sm font-semibold transition-colors duration-200 sm:px-4",
                active
                    ? cn("ring-1", activeClass)
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
            )}
        >
            {children}
        </button>
    );
}

function TabBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="jobs-tab-badge ml-0.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-slate-300">
            {children}
        </span>
    );
}

function FilterButton({
    onClick,
    badgeCount,
    isActive,
    isOpen,
    className,
}: {
    onClick: () => void;
    badgeCount: number;
    isActive: boolean;
    isOpen: boolean;
    className?: string;
}) {
    return (
        <button
            onClick={onClick}
            type="button"
            data-active={isOpen || isActive}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls={isOpen ? "job-filter-panel" : undefined}
            aria-label={badgeCount > 0
                ? `Filter und Sortierung öffnen, ${badgeCount} ${badgeCount === 1 ? "Bereich" : "Bereiche"} angepasst`
                : "Filter und Sortierung öffnen"}
            className={cn(
                "jobs-filter-icon-button relative flex shrink-0 items-center justify-center text-slate-400 transition-colors hover:bg-white/5 hover:text-white",
                className
            )}
        >
            <ListFilter size={17} />
            {badgeCount > 0 && (
                <span aria-hidden="true" className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {badgeCount}
                </span>
            )}
        </button>
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
