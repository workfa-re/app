import type { ApplicationStatus, JobStatus } from "@/lib/types/platform";
import { getActivityConversationHref } from "@/lib/activity/navigation";
import { getActivityStatusMeta } from "@/lib/activity/chat";

export type ProviderJobApplicationSummary = { conversationId: string; status: ApplicationStatus };
const ACTIVE_CONVERSATION_STATUSES = new Set<ApplicationStatus>(["submitted", "negotiating", "accepted"]);

export function summarizeProviderApplications(rows: Array<{ id: string; job_id: string; status: ApplicationStatus }>) {
    const summaries: Record<string, ProviderJobApplicationSummary> = {};
    for (const row of rows) {
        if (row.id && ACTIVE_CONVERSATION_STATUSES.has(row.status) && !summaries[row.job_id]) {
            summaries[row.job_id] = { conversationId: row.id, status: row.status };
        }
    }
    return summaries;
}

export function getProviderConversationLabel(status?: ApplicationStatus | null) {
    if (status && ACTIVE_CONVERSATION_STATUSES.has(status)) return getActivityStatusMeta(status).label;
    return "Noch kein Gespräch";
}

export type ProviderJobStatusTone = "positive" | "informative" | "caution" | "neutral";

export type ProviderJobStatusMeta = {
    label: string;
    tone: ProviderJobStatusTone;
};

export type ProviderJobPrimaryAction = {
    href: string;
    label: "Bearbeiten" | "Angebot öffnen" | "Gespräch öffnen";
    kind: "edit" | "open" | "conversation";
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
    if (status === "closed" || status === "draft") return JOB_STATUS_META[status];
    if (applicationStatuses.includes("accepted")) return { label: getActivityStatusMeta("accepted").label, tone: "informative" };
    if (applicationStatuses.some(status => status === "submitted" || status === "negotiating")) return { label: "Reserviert", tone: "caution" };

    return JOB_STATUS_META[status];
}

export function isProtectedJobStatus(status: JobStatus): status is ProtectedJobStatus {
    return status === "reviewing" || status === "reserved" || status === "filled";
}

export function getProviderJobPrimaryAction(status: JobStatus, jobId: string, conversationId?: string | null): ProviderJobPrimaryAction {
    if (status === "draft") {
        return {
            href: `/app-home/offers/edit/${jobId}`,
            label: "Bearbeiten",
            kind: "edit",
        };
    }

    if (conversationId?.trim()) return { href: getActivityConversationHref(conversationId), label: "Gespräch öffnen", kind: "conversation" };

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
    applicationStatus: ApplicationStatus | null,
    applicationsLoaded: boolean,
    jobStatus: JobStatus = "open",
) {
    if (!applicationsLoaded) {
        return "Das Gespräch konnte gerade nicht geladen werden.";
    }
    if (applicationStatus === "submitted" || applicationStatus === "negotiating") return "Der Job ist exklusiv reserviert. Stimmt jetzt den Termin im Gespräch ab.";
    if (applicationStatus === "accepted") return "Der Termin ist bestätigt. Eure Zusammenarbeit kann starten.";
    if (jobStatus === "open") return "Die erste Bewerbung reserviert diesen Job. Danach klärt ihr alles direkt im Gespräch.";
    if (jobStatus === "draft") return "Veröffentliche den Job, damit sich jemand bewerben kann.";
    if (jobStatus === "reserved") return "Dieser Job ist bereits reserviert.";
    return "Den bisherigen Verlauf findest du unter „Nachrichten“.";
}
