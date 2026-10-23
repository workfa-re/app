import { getNotificationRoute } from "./notificationRouting";
import type { NotificationItem, NotificationPriority } from "./notificationTypes";

export type NotificationCategory = "message" | "appointment" | "application" | "job" | "account" | "system";

function dataRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

const EVENT_TITLES: Record<string, string> = {
    application_created: "Neue Bewerbung",
    message_received: "Neue Nachricht",
    appointment_request_pending: "Neuer Terminvorschlag",
    appointment_request_accepted: "Termin bestätigt",
    appointment_request_declined: "Terminvorschlag abgelehnt",
    appointment_request_withdrawn: "Terminvorschlag zurückgezogen",
    appointment_request_superseded: "Terminvorschlag ersetzt",
    appointment_updated: "Termin aktualisiert",
    conversation_request_pending: "Neue Gesprächsanfrage",
    conversation_request_accepted: "Gespräch geöffnet",
    conversation_request_declined: "Gesprächsanfrage abgelehnt",
};

function contextText(data: Record<string, unknown>) {
    const values = [data.job_title, data.sender_name ?? data.personName ?? data.actor_name ?? data.applicant_name];
    return [...new Set(values.filter((value): value is string => typeof value === "string").map(cleanText).filter(Boolean))].join(" · ");
}

export function getNotificationPresentation(item: NotificationItem): {
    title: string;
    body: string;
    fullBody: string;
    category: NotificationCategory;
    actionLabel: string;
    route: string | null;
    priority: NotificationPriority;
} {
    const data = dataRecord(item.data);
    const event = item.event_type ?? "";
    let category: NotificationCategory = "system";
    if (item.category === "messages" || item.type === "message" || event === "message_received") category = "message";
    else if (item.category === "appointments" || data.appointment_id || data.appointment_request_id || event.startsWith("appointment_")) category = "appointment";
    else if (item.category === "account" || /^(account|security|guardian|verification)(_|$)/.test(event)) category = "account";
    else if (item.category === "applications" || data.application_id || /^(application|conversation)_/.test(event)) category = "application";
    else if (item.category === "jobs" || data.job_id || event.startsWith("job_")) category = "job";

    const route = getNotificationRoute(item.data);
    const originalTitle = cleanText(item.title);
    const title = originalTitle && originalTitle.length <= 90 && !/^(info|information|benachrichtigung)$/i.test(originalTitle)
        ? originalTitle : EVENT_TITLES[event] ?? (category === "account" ? "Hinweis zu deinem Konto" : "Neu bei Workfare");
    const fullBody = cleanText(item.body);
    const body = contextText(data) || fullBody;
    const fallbackPriority = event === "security" || event === "appointment_request_pending" || event === "conversation_request_pending" ? 1
        : category === "message" || category === "application" || category === "appointment" ? 2 : 3;
    return {
        title,
        body: body === title ? "" : body,
        fullBody,
        category,
        actionLabel: category === "message" ? "Nachricht öffnen"
            : category === "appointment" ? "Termin ansehen"
                : category === "application" ? "Zusammenarbeit öffnen"
                    : category === "job" ? "Job ansehen"
                        : category === "account" ? "Konto öffnen" : "Ansehen",
        route,
        priority: item.priority === 1 || item.priority === 2 || item.priority === 3 ? item.priority : fallbackPriority,
    };
}
