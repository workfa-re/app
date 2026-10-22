"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RotateCcw, X } from "lucide-react";
import { JOB_CATEGORIES } from "@/lib/constants/jobCategories";
import { MAX_DISTANCE_KM_OPTIONS, type SortOption, type FilterState } from "@/lib/jobs/sortFilter";
import styles from "./JobFilterSortPanel.module.css";

const SORT_OPTIONS: readonly { value: SortOption; label: string }[] = [
    { value: "distance", label: "Am nächsten" },
    { value: "newest", label: "Neueste" },
    { value: "wage_desc", label: "Bester Lohn" },
];
const DISTANCES = [...MAX_DISTANCE_KM_OPTIONS, null];
const SECTION_VARIANTS = {
    hidden: { opacity: 0, y: 5 },
    visible: { opacity: 1, y: 0, transition: { duration: .18, ease: [.16, 1, .3, 1] as const } },
};

interface JobFilterSortPanelProps {
    isOpen: boolean;
    sortOption: SortOption;
    filterState: FilterState;
    onSortChange: (sort: SortOption) => void;
    onFilterChange: Dispatch<SetStateAction<FilterState>>;
    onClose: () => void;
    onReset: () => void;
    hasChanges: boolean;
    hasLocation?: boolean;
}

export function JobFilterSortPanel({ isOpen, sortOption, filterState, onSortChange, onFilterChange, onClose, onReset, hasChanges, hasLocation = true }: JobFilterSortPanelProps) {
    const shellRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLElement | null>(null);
    const closeRef = useRef(onClose);
    const restoreFocus = useRef(true);
    const reducedMotion = useReducedMotion() ?? false;
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    const positionPanel = useCallback(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const viewport = window.visualViewport;
        const width = viewport?.width ?? innerWidth;
        const height = viewport?.height ?? innerHeight;
        const anchor = anchorRef.current?.getBoundingClientRect();
        const panelWidth = Math.min(404, width - 32);
        const bottomSpace = height - (anchor?.bottom ?? 108) - 28;
        const topSpace = (anchor?.top ?? 108) - 28;
        const above = bottomSpace < 300 && topSpace > bottomSpace;
        const available = above ? topSpace : bottomSpace;
        const panelHeight = Math.max(160, Math.min(650, available));
        const top = above ? Math.max(16, (anchor?.top ?? 108) - panelHeight - 12)
            : Math.max(16, Math.min((anchor?.bottom ?? 108) + 12, height - 176));
        shell.style.setProperty("--filter-left", `${Math.max(16, Math.min((anchor?.right ?? width - 16) - panelWidth, width - panelWidth - 16))}px`);
        shell.style.setProperty("--filter-top", `${top}px`);
        shell.style.setProperty("--filter-width", `${panelWidth}px`);
        shell.style.setProperty("--filter-height", `${Math.max(140, Math.min(panelHeight, height - top - 16))}px`);
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return;
        restoreFocus.current = true;
        anchorRef.current = document.querySelector<HTMLElement>('[aria-controls="job-filter-panel"]');
        positionPanel();
        const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
        const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || shellRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
            restoreFocus.current = false;
            closeRef.current();
        };
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
        };
        const focusOutside = (event: FocusEvent) => {
            if (!(event.target instanceof Node) || shellRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
            restoreFocus.current = false;
            closeRef.current();
        };
        const otherPopover = () => { restoreFocus.current = false; closeRef.current(); };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("focusin", focusOutside);
        document.addEventListener("keydown", keydown);
        window.addEventListener("resize", positionPanel);
        window.addEventListener("scroll", positionPanel, true);
        window.visualViewport?.addEventListener("resize", positionPanel);
        window.addEventListener("workfare:header-popover-open", otherPopover);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("focusin", focusOutside);
            document.removeEventListener("keydown", keydown);
            window.removeEventListener("resize", positionPanel);
            window.removeEventListener("scroll", positionPanel, true);
            window.visualViewport?.removeEventListener("resize", positionPanel);
            window.removeEventListener("workfare:header-popover-open", otherPopover);
        };
    }, [isOpen, positionPanel]);

    const toggleCategory = (id: string) => onFilterChange(current => ({
        ...current,
        categories: current.categories.includes(id) ? current.categories.filter(category => category !== id) : [...current.categories, id],
    }));

    if (typeof document === "undefined") return null;
    const target = document.querySelector(".app-shell") ?? document.body;
    return createPortal(<AnimatePresence initial={false} onExitComplete={() => {
        if (!isOpen && restoreFocus.current && anchorRef.current?.isConnected) {
            anchorRef.current.focus({ preventScroll: true });
        }
    }}>
        {isOpen && <motion.div key="job-filter-window" ref={shellRef} className={styles.shell}
            initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : .16 }}>
            <motion.div ref={panelRef} id="job-filter-panel" role="dialog" aria-modal="false" aria-labelledby="filter-panel-title" tabIndex={-1}
                className={styles.panel}
                initial={reducedMotion ? false : { y: -38, clipPath: "inset(0% 0% 88% 78% round 24px)" }}
                animate={{ y: 0, clipPath: "inset(0% 0% 0% 0% round 28px)" }}
                exit={{ y: reducedMotion ? 0 : -10, transition: { duration: reducedMotion ? 0 : .16 } }}
                transition={{ duration: reducedMotion ? 0 : .46, ease: [.16, 1, .3, 1] }}>
                <div className={styles.header}><h2 id="filter-panel-title">Jobs filtern</h2>
                    {hasChanges && <button type="button" className={styles.close} aria-label="Filter zurücksetzen" title="Filter zurücksetzen" onClick={() => { onReset(); panelRef.current?.focus({ preventScroll: true }); }}><RotateCcw aria-hidden="true" /></button>}
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Filter schließen"><X aria-hidden="true" /></button>
                </div>
                <motion.div className={styles.body} initial={reducedMotion ? false : "hidden"} animate="visible"
                    variants={{ visible: { transition: { staggerChildren: .04, delayChildren: .06 } } }}>
                    <motion.fieldset variants={reducedMotion ? undefined : SECTION_VARIANTS}>
                        <legend>Sortieren nach</legend><div className={styles.segment}>{SORT_OPTIONS.map(option => <div key={option.value}>
                            <input id={`job-filter-sort-${option.value}`} className={styles.radio} type="radio" name="job-filter-sort" value={option.value} checked={sortOption === option.value} disabled={!hasLocation && option.value === "distance"} onChange={() => onSortChange(option.value)} />
                            <label htmlFor={`job-filter-sort-${option.value}`}>{option.label}</label>
                        </div>)}</div>
                    </motion.fieldset>
                    <motion.section variants={reducedMotion ? undefined : SECTION_VARIANTS} aria-labelledby="filter-category-title">
                        <h3 id="filter-category-title">Jobart</h3><div className={styles.categories}>{JOB_CATEGORIES.map(category => <button key={category.id} type="button" className={styles.chip}
                            aria-pressed={filterState.categories.includes(category.id)} onClick={() => toggleCategory(category.id)}>
                            {category.label}
                        </button>)}</div>
                    </motion.section>
                    <motion.fieldset variants={reducedMotion ? undefined : SECTION_VARIANTS}>
                        <legend>Maximale Entfernung</legend><div className={styles.distances}>{DISTANCES.map(distance => <div key={distance ?? "all"}>
                            <input id={`job-filter-distance-${distance ?? "all"}`} type="radio" name="job-filter-distance" className={styles.radio}
                                aria-label={distance === null ? "Alle Entfernungen, keine Begrenzung" : `Bis zu ${distance} Kilometer`}
                                value={distance ?? "all"} disabled={!hasLocation && distance !== null} checked={filterState.maxDistanceKm === distance} onChange={() => onFilterChange(current => ({ ...current, maxDistanceKm: distance }))} />
                            <label htmlFor={`job-filter-distance-${distance ?? "all"}`}>{distance === null ? "Alle" : `${distance} km`}</label>
                        </div>)}</div>
                        {!hasLocation ? <p className={styles.hint}><Link href="/app-home/profile?focus=location">Wohnort hinzufügen</Link>, um nach Entfernung zu filtern.</p>
                            : filterState.maxDistanceKm !== null && <p className={styles.hint}>Ungefähre Luftlinie. Jobs ohne Standort werden ausgeblendet.</p>}
                    </motion.fieldset>
                </motion.div>
            </motion.div>
        </motion.div>}
    </AnimatePresence>, target);
}
