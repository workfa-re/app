"use client";

import { useRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { followGlassPointer } from "@/lib/glass-pointer";

type GlassTab<T extends string> = { value: T; label: string; count?: number };

export function GlassTabs<T extends string>({ id, label, items, value, onChange }: {
    id: string;
    label: string;
    items: GlassTab<T>[];
    value: T;
    onChange: (value: T) => void;
}) {
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);
    const reducedMotion = useReducedMotion();
    return <LayoutGroup id={id}>
        <div className="jobs-view-tabs app-glass-control" role="tablist" aria-label={label} onPointerMove={followGlassPointer}>
            {items.map((item, index) => <button key={item.value} ref={node => { buttons.current[index] = node; }}
                id={`${id}-${item.value}-tab`} type="button" role="tab" className="jobs-view-tab"
                aria-selected={value === item.value} aria-controls={`${id}-${item.value}-panel`}
                tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)}
                onKeyDown={event => {
                    const next = event.key === "ArrowRight" ? (index + 1) % items.length
                        : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
                            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
                    if (next === null) return;
                    event.preventDefault();
                    onChange(items[next].value);
                    buttons.current[next]?.focus();
                }}>
                {value === item.value && <motion.span className="app-glass-selection" layoutId={`${id}-selection`} initial={false}
                    transition={{ type: "spring", duration: reducedMotion ? 0 : 0.32, bounce: 0 }} />}
                <span>{item.label}</span>
                {Boolean(item.count) && <span className="jobs-view-count">{item.count}</span>}
            </button>)}
        </div>
    </LayoutGroup>;
}
