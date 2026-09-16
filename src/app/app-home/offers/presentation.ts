import type { ApplicationStatus, JobStatus } from "@/lib/types/platform";

export type ProviderJobStatusTone = "positive" | "informative" | "caution" | "neutral";

export type ProviderJobStatusMeta = {
    label: string;
    tone: ProviderJobStatusTone;
};

export type ProviderJobPrimaryAction = {
    href: string;
    label: "Bearbeiten" | "Angebot öffnen";
    kind: "edit" | "open";
};

export type ProtectedJobStatus = Extract<JobStatus, "reviewing" | "reserved" | "filled">;

const JOB_STATUS_META: Record<JobStatus, ProviderJobStatusMeta> = {
    draft: { label: "Entwurf", tone: "neutral" },
    open: { label: "Aktiv", tone: "positive" },
    reviewing: { label: "In Prüfung", tone: "informative" },
    reserved: { label: "Reserviert", tone: "caution" },
    filled: { label: "Vergeben", tone: "informative" },
    closed: { label: "Archiviert", tone: "neutral" },
};

export function getProviderJobStatusMeta(
    status: JobStatus,
    applicationStatuses: ApplicationStatus[] = [],
): ProviderJobStatusMeta {
    if (status === "open" && applicationStatuses.includes("negotiating")) {
        return { label: "In Abstimmung", tone: "caution" };
    }

    return JOB_STATUS_META[status];
}

export function isProtectedJobStatus(status: JobStatus): status is ProtectedJobStatus {
    return status === "reviewing" || status === "reserved" || status === "filled";
}

export function getProviderJobPrimaryAction(status: JobStatus, jobId: string): ProviderJobPrimaryAction {
    if (status === "draft") {
        return {
            href: `/app-home/offers/edit/${jobId}`,
            label: "Bearbeiten",
            kind: "edit",
        };
    }

    return {
        href: `/app-home/offers/${jobId}`,
        label: "Angebot öffnen",
        kind: "open",
    };
}

export function formatProviderCompensation(
    wage: number | null | undefined,
    paymentType: "hourly" | "fixed" | string | null | undefined,
) {
    const label = paymentType === "fixed" ? "Pauschale" : "Stundenlohn";

    if (wage == null || !Number.isFinite(wage)) {
        return { label, value: "Noch offen" };
    }

    const amount = new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(wage);

    return {
        label,
        value: paymentType === "fixed" ? `${amount} € pauschal` : `${amount} €/Std.`,
    };
}

export function formatProviderApplicationSummary(
    applicationCount: number,
    applicationsLoaded: boolean,
) {
    if (!applicationsLoaded) {
        return "Bewerbungen konnten gerade nicht geladen werden.";
    }

    if (applicationCount === 0) return "Noch keine Bewerbungen eingegangen.";
    if (applicationCount === 1) return "Eine Bewerbung ist eingegangen.";
    return `${applicationCount} Bewerbungen sind eingegangen.`;
}
