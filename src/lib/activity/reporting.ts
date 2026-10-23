import type { ActivityMessage } from "./chat";

export type ReportScope = "person" | "conversation" | "message";
export type ReportReason = "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other";
export type ActivityReportInput = {
    applicationId: string;
    scope: ReportScope;
    reasonCode: ReportReason;
    details?: string;
    reportedUserId?: string | null;
    messageId?: string | null;
    reopenRequestId?: string | null;
};
export type ReportableReopenRequest = {
    id: string;
    requested_by: string;
    message: string;
    created_at: string;
};
export type ReportableContent = {
    key: string;
    kind: "message" | "reopen_request";
    id: string;
    content: string;
    createdAt: string | null;
    label: string;
};
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
    { value: "inappropriate", label: "Unangemessener Inhalt" },
    { value: "harassment", label: "Belästigung oder Druck" },
    { value: "fraud", label: "Betrugsverdacht" },
    { value: "safety", label: "Sicherheitsbedenken" },
    { value: "spam", label: "Spam" },
    { value: "other", label: "Anderer Grund" },
];

/** Only persisted content written by this conversation's counterpart is selectable. */
export function getReportableContent(messages: readonly ActivityMessage[], requests: readonly ReportableReopenRequest[], personId: string): ReportableContent[] {
    const items = new Map<string, ReportableContent>();
    for (const message of messages) {
        if (message.sender_id !== personId || message.kind === "system" || message.is_temp || message.failed || message.deleted_at || !message.content.trim()) continue;
        const key = `message:${message.id}`;
        items.set(key, { key, kind: "message", id: message.id, content: message.content, createdAt: message.created_at, label: message.kind === "application" ? "Bewerbungsnachricht" : "Nachricht" });
    }
    for (const request of requests) {
        if (request.requested_by !== personId || !request.message.trim()) continue;
        const key = `reopen_request:${request.id}`;
        items.set(key, { key, kind: "reopen_request", id: request.id, content: request.message, createdAt: request.created_at, label: "Öffnungsanfrage" });
    }
    return [...items.values()].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0) || b.key.localeCompare(a.key));
}
