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
