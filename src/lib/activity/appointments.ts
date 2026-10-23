export type AppointmentRequest = {
    id: string;
    application_id: string;
    appointment_id: string | null;
    requested_by: string;
    starts_at: string;
    ends_at: string | null;
    timezone: string;
    note: string | null;
    status: "pending" | "accepted" | "declined" | "withdrawn" | "superseded";
    created_at: string;
    responded_at: string | null;
};

export type AppointmentMutation = {
    applicationId: string;
    action: "propose" | "accept" | "decline" | "withdraw" | "update" | "cancel" | "add";
    appointmentId?: string | null;
    requestId?: string | null;
    startsAt?: string;
    endsAt?: string;
    note?: string;
};

export type AppointmentSystemMessageKind = "request" | "appointment";

const appointmentSystemMessages = new Map<string, AppointmentSystemMessageKind>([
    ["Ein weiterer Termin wurde angefragt.", "request"],
    ["Eine Terminänderung wurde angefragt. Der bisherige Termin bleibt bis zur Bestätigung bestehen.", "request"],
    ["Der Termin wurde verbindlich vereinbart.", "appointment"],
    ["Ein weiterer Termin wurde verbindlich vereinbart.", "appointment"],
    ["Der Termin wurde aktualisiert.", "appointment"],
    ["Der Termin wurde abgesagt. Die Zusammenarbeit bleibt geöffnet.", "appointment"],
    ["Der Terminvorschlag wurde abgelehnt. Der bisherige Termin bleibt bestehen.", "appointment"],
    ["Der Terminvorschlag wurde zurückgezogen.", "appointment"],
]);

/** Only persisted system text identifies a scheduling event, never a user's chat. */
export function getAppointmentSystemMessageKind(message: { kind?: string | null; content?: string | null }): AppointmentSystemMessageKind | null {
    if (message.kind !== "system" || typeof message.content !== "string") return null;
    return appointmentSystemMessages.get(message.content.replace(/\s+/g, " ").trim()) ?? null;
}

type AppointmentMessageSource = {
    kind?: string | null;
    content?: string | null;
    application_id?: string | null;
    sender_id?: string | null;
    created_at?: string | null;
    deleted_at?: string | null;
    is_temp?: boolean;
    failed?: boolean;
};

/** Compare transaction instants without discarding PostgreSQL's microseconds. */
function appointmentTransactionTime(value?: string | null): string | null {
    if (typeof value !== "string") return null;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value.replace(/\+00$/, "Z"));
    if (!parts) return null;
    const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
    if (!year) return null;
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 100) calendar.setUTCFullYear(year);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
        || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
    const zone = parts[8];
    const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
    const offsetMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    const offset = (offsetHour * 60 + offsetMinute) * 60 * (zone.startsWith("-") ? -1 : 1);
    return `${calendar.getTime() / 1000 - offset}:${(parts[7] ?? "").padEnd(6, "0")}`;
}

/** Only the still-pending request from this exact database transaction is actionable. */
export function isPendingAppointmentMessage(message: AppointmentMessageSource, pendingRequests: readonly AppointmentRequest[]): boolean {
    if (getAppointmentSystemMessageKind(message) !== "request" || !message.application_id || !message.sender_id
        || message.deleted_at != null || message.is_temp || message.failed) return false;
    const timestamp = appointmentTransactionTime(message.created_at);
    if (timestamp === null) return false;
    let matches = 0;
    for (const request of pendingRequests) {
        if (request.status !== "pending" || request.responded_at !== null || request.application_id !== message.application_id
            || request.requested_by !== message.sender_id || appointmentTransactionTime(request.created_at) !== timestamp) continue;
        if (++matches > 1) return false;
    }
    return matches === 1;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function appointmentMutationError(input: AppointmentMutation, now = Date.now()) {
    if (!uuid.test(input.applicationId)) return "Der Vorgang ist nicht verfügbar.";
    if (input.appointmentId && !uuid.test(input.appointmentId)) return "Der Termin ist nicht verfügbar.";
    if (input.requestId && !uuid.test(input.requestId)) return "Die Terminanfrage ist nicht verfügbar.";
    if (!["propose", "accept", "decline", "withdraw", "update", "cancel", "add"].includes(input.action)) return "Unbekannte Terminaktion.";
    if (["accept", "decline", "withdraw"].includes(input.action) && !input.requestId) return "Bitte wähle eine Terminanfrage.";
    if (["update", "cancel"].includes(input.action) && !input.appointmentId) return "Bitte wähle einen Termin.";
    if (input.action === "add" && input.appointmentId) return "Ein neuer Termin darf keinen bestehenden Termin überschreiben.";
    if ((input.note?.trim().length ?? 0) > 1000) return "Die Termininformation darf höchstens 1.000 Zeichen lang sein.";
    if (["propose", "update", "add"].includes(input.action)) {
        const start = new Date(input.startsAt ?? "").getTime();
        if (!Number.isFinite(start) || start < now - 60_000) return "Der Termin muss in der Zukunft liegen.";
        if (input.endsAt) {
            const end = new Date(input.endsAt).getTime();
            if (!Number.isFinite(end) || end <= start) return "Das Ende muss nach dem Beginn liegen.";
        }
    }
    return null;
}

/** datetime-local uses the browser's local zone; the serialized value always has an offset. */
export function appointmentInputValue(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}
