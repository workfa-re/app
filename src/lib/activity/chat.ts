import { format, isToday, isYesterday } from "date-fns";
import { de } from "date-fns/locale";

export type ActivityRole = "seeker" | "provider";
export type ActivityFilter = "all" | "unread" | "active" | "accepted" | "closed";
export type ActivityStatusTone = "neutral" | "brand" | "success" | "warning" | "danger";

export type ActivityStatusMeta = {
    label: string;
    tone: ActivityStatusTone;
};

export type ActivityMessage = {
    id: string;
    application_id: string;
    sender_id: string | null;
    content: string;
    created_at: string | null;
    read_at?: string | null;
    kind?: "application" | "chat" | "system";
    is_temp?: boolean;
    failed?: boolean;
};

export type ActivityFailedSend = {
    id: string;
    content: string;
    error: string;
};

export type ActivityComposerState = {
    draft: string;
    failedSends: ActivityFailedSend[];
};

export function updateActivityComposerDraft(
    current: ActivityComposerState | undefined,
    draft: string,
    onlyIfEmpty = false,
): ActivityComposerState {
    if (current && (current.draft === draft || (onlyIfEmpty && current.draft))) return current;
    return { draft, failedSends: current?.failedSends ?? [] };
}

export function recordActivitySendFailure(
    current: ActivityComposerState | undefined,
    failure: ActivityFailedSend,
): ActivityComposerState {
    if (current?.failedSends.some(item => item.id === failure.id)) return current;
    return {
        draft: current?.draft || failure.content,
        failedSends: [...(current?.failedSends ?? []), failure],
    };
}

export function recoverActivityFailedSend(
    current: ActivityComposerState | undefined,
    failureId: string,
): ActivityComposerState | undefined {
    const failure = current?.failedSends.find(item => item.id === failureId);
    if (!current || !failure) return current;
    return {
        draft: current.draft === failure.content
            ? current.draft
            : current.draft ? `${current.draft}\n\n${failure.content}` : failure.content,
        failedSends: current.failedSends.filter(item => item.id !== failureId),
    };
}

type DatedActivityTimelineItem = {
    id: string;
    created_at: string | null;
};

export type ActivityTimelineEntry<TMessage, TReopenRequest> = (
    | { type: "message"; item: TMessage }
    | { type: "reopen_request"; item: TReopenRequest }
) & {
    key: string;
    createdAt: string | null;
    showDateSeparator: boolean;
};

export const ACTIVITY_STATUS_META: Record<string, ActivityStatusMeta> = {
    submitted: { label: "Reserviert", tone: "brand" },
    negotiating: { label: "Reserviert", tone: "brand" },
    waitlisted: { label: "Beendete Anfrage", tone: "neutral" },
    accepted: { label: "Vereinbart", tone: "success" },
    completed: { label: "Abgeschlossen", tone: "success" },
    rejected: { label: "Abgelehnt", tone: "danger" },
    auto_rejected: { label: "Anderweitig vergeben", tone: "neutral" },
    withdrawn: { label: "Zurückgezogen", tone: "neutral" },
    cancelled: { label: "Abgesagt", tone: "neutral" },
};

export const CLOSED_ACTIVITY_STATUSES = new Set([
    "rejected",
    "auto_rejected",
    "withdrawn",
    "cancelled",
    "completed",
    "waitlisted",
]);

export const ACTIVE_ACTIVITY_STATUSES = new Set(["submitted", "negotiating", "accepted"]);
export const WRITABLE_ACTIVITY_STATUSES = new Set(["submitted", "negotiating", "accepted"]);

export function resolveReopenApplicationPatch(result: unknown): Record<string, unknown> | null {
    if (!result || typeof result !== "object") {
        throw new Error("Der neue Gesprächsstatus konnte nicht bestätigt werden.");
    }

    const response = result as Record<string, unknown>;
    if (response.application && typeof response.application === "object") {
        return response.application as Record<string, unknown>;
    }

    if (response.unchanged === true) return null;
    if (typeof response.status !== "string" || typeof response.is_primary !== "boolean") {
        throw new Error("Der neue Gesprächsstatus konnte nicht bestätigt werden.");
    }

    return {
        conversation_state: "open",
        status: response.status,
        is_primary: response.is_primary,
        closed_by: null,
        closed_at: null,
        closed_reason: null,
        close_action: null,
    };
}

export function getActivityStatusMeta(status: string | null | undefined, closeAction?: string | null): ActivityStatusMeta {
    if (closeAction === "waitlist_retired") return ACTIVITY_STATUS_META.waitlisted;
    return ACTIVITY_STATUS_META[status ?? ""] ?? { label: "Status offen", tone: "neutral" };
}

export type ActivityStage = {
    key: "open" | "reserved" | "agreed" | "completed" | "closed";
    index: number;
    label: string;
    hint: string;
};

export function getActivityStage(source: {
    status?: string | null;
    close_action?: string | null;
    conversation_state?: string | null;
    is_primary?: boolean | null;
}, role: ActivityRole): ActivityStage {
    const status = source.status ?? "";
    if (source.close_action === "waitlist_retired") return { key: "closed", index: -1, label: "Beendete Anfrage", hint: "Diese frühere Anfrage ist beendet. Du kannst den bisherigen Verlauf lesen." };
    if (status === "completed") return { key: "completed", index: 3, label: "Abgeschlossen", hint: "Der Auftrag ist abgeschlossen. Der bisherige Verlauf bleibt erhalten." };
    if (source.conversation_state === "closed" || CLOSED_ACTIVITY_STATUSES.has(status)
        || (ACTIVE_ACTIVITY_STATUSES.has(status) && source.is_primary === false)) {
        return { key: "closed", index: -1, label: status === "waitlisted" ? "Beendete Anfrage" : CLOSED_ACTIVITY_STATUSES.has(status) ? getActivityStatusMeta(status).label : "Beendet",
            hint: status === "waitlisted" ? "Diese frühere Anfrage ist beendet. Du kannst den bisherigen Verlauf lesen." : "Diese Anfrage ist beendet. Der bisherige Verlauf bleibt erhalten." };
    }
    if (status === "accepted") return { key: "agreed", index: 2, label: "Vereinbart", hint: "Die Zusammenarbeit ist bestätigt. Termine und Änderungen klärt ihr direkt hier." };
    if (ACTIVE_ACTIVITY_STATUSES.has(status)) return { key: "reserved", index: 1, label: "Reserviert", hint: role === "provider"
        ? "Der Job ist für diese Bewerbung reserviert. Vereinbare einen Termin oder gib ihn wieder frei."
        : "Der Job ist für dich reserviert. Kläre den Termin direkt mit dem Anbieter." };
    return { key: "open", index: 0, label: "Offen", hint: "Der Job ist noch nicht reserviert." };
}

export function matchesActivityFilter(
    status: string | null | undefined,
    unreadCount: number,
    filter: ActivityFilter,
) {
    if (filter === "all") return true;
    if (filter === "unread") return unreadCount > 0;
    if (filter === "active") return ACTIVE_ACTIVITY_STATUSES.has(status ?? "");
    if (filter === "accepted") return status === "accepted";
    return CLOSED_ACTIVITY_STATUSES.has(status ?? "");
}

export function getConversationActivityTimestamp(application: {
    created_at: string;
    last_activity_at?: string | null;
    last_message_at?: string | null;
    agreed_at?: string | null;
}) {
    return [
        application.created_at,
        application.agreed_at,
        application.last_message_at,
        application.last_activity_at,
    ].reduce((latest, value) => {
        if (!value) return latest;
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
}

export function getConversationPreviewTimestamp(application: {
    created_at: string;
    last_message_preview?: string | null;
    last_message_at?: string | null;
}) {
    return application.last_message_preview?.trim() && application.last_message_at
        ? application.last_message_at
        : application.created_at;
}

export function formatConversationTime(value: string | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    if (isToday(date)) return format(date, "HH:mm", { locale: de });
    if (isYesterday(date)) return "Gestern";
    return format(date, "dd.MM.", { locale: de });
}

export function getChatDateKey(value: string | null | undefined) {
    const date = value ? new Date(value) : new Date(0);
    if (Number.isNaN(date.getTime())) return "unknown";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildActivityTimeline<
    TMessage extends DatedActivityTimelineItem,
    TReopenRequest extends DatedActivityTimelineItem,
>(
    messages: readonly TMessage[],
    reopenRequests: readonly TReopenRequest[],
): Array<ActivityTimelineEntry<TMessage, TReopenRequest>> {
    const unsortedEntries = [
        ...messages.map((item, sourceIndex) => ({
            type: "message" as const,
            item,
            key: `message:${item.id}`,
            createdAt: item.created_at,
            sourceIndex,
        })),
        ...reopenRequests.map((item, requestIndex) => ({
            type: "reopen_request" as const,
            item,
            key: `reopen-request:${item.id}`,
            createdAt: item.created_at,
            sourceIndex: messages.length + requestIndex,
        })),
    ];

    unsortedEntries.sort((left, right) => {
        const leftTimestamp = left.createdAt ? new Date(left.createdAt).getTime() : Number.NEGATIVE_INFINITY;
        const rightTimestamp = right.createdAt ? new Date(right.createdAt).getTime() : Number.NEGATIVE_INFINITY;
        const normalizedLeftTimestamp = Number.isFinite(leftTimestamp) ? leftTimestamp : Number.NEGATIVE_INFINITY;
        const normalizedRightTimestamp = Number.isFinite(rightTimestamp) ? rightTimestamp : Number.NEGATIVE_INFINITY;
        return normalizedLeftTimestamp - normalizedRightTimestamp || left.sourceIndex - right.sourceIndex;
    });

    let previousDateKey: string | null = null;
    return unsortedEntries.map(({ sourceIndex: _sourceIndex, ...entry }) => {
        const dateKey = getChatDateKey(entry.createdAt);
        const showDateSeparator = dateKey !== previousDateKey;
        previousDateKey = dateKey;

        return {
            ...entry,
            showDateSeparator,
        };
    });
}

export function formatChatDateLabel(value: string | null | undefined) {
    const date = value ? new Date(value) : new Date(0);
    if (Number.isNaN(date.getTime())) return "Datum unbekannt";
    if (isToday(date)) return "Heute";
    if (isYesterday(date)) return "Gestern";
    return format(date, "d. MMMM yyyy", { locale: de });
}

export function getProfileInitials(name: string | null | undefined) {
    const parts = (name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase()).join("") || "JB";
}

export function normalizeMessagePreview(content: string | null | undefined, fallback: string) {
    const normalized = content?.replace(/\s+/g, " ").trim();
    return normalized || fallback;
}

export function formatClosureReason(value: string | null | undefined) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || /^\d+$/.test(normalized) || normalized.length < 3) {
        return "Für diese ältere Schließung wurde kein nachvollziehbarer Grund hinterlegt.";
    }
    return `Grund: ${normalized}`;
}
