import type { JobsListItem } from "@/lib/types/platform";

const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const distance = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatJobCompensation(wage: number | null | undefined, paymentType?: string | null) {
    return {
        amount: wage != null && Number.isFinite(wage) && wage >= 0 ? currency.format(wage) : null,
        unit: paymentType === "fixed" ? "pauschal" : "/ Std.",
    };
}

export function formatJobDistance(kilometers: number | null | undefined) {
    return kilometers != null && Number.isFinite(kilometers) && kilometers >= 0 ? distance.format(kilometers) : null;
}

/** Prefer refreshed application state over a snapshot captured when the detail opened. */
export function resolveSelectedJobSnapshot(selected: JobsListItem | null, ...sources: ReadonlyArray<JobsListItem>[]) {
    if (!selected) return null;
    for (const jobs of sources) {
        const current = jobs.find((job) => job.id === selected.id);
        if (current) return current;
    }
    return selected;
}
