"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { appointmentMutationError, getAppointmentSystemMessageKind, type AppointmentMutation, type AppointmentRequest } from "@/lib/activity/appointments";
import type { ActivityReportInput, ReportScope } from "@/lib/activity/reporting";

type RpcPayload = {
    ok?: boolean;
    error?: string;
    unchanged?: boolean;
    message?: Record<string, unknown>;
    request?: Record<string, unknown>;
    engagement?: Record<string, unknown>;
    appointment?: Record<string, unknown>;
    agreement?: Record<string, unknown>;
    report_id?: string;
    status?: string;
    is_primary?: boolean;
    scheduled_for?: string;
    agreed_at?: string;
    updated_count?: number;
    accepted?: boolean;
    [key: string]: unknown;
};

function readPayload(value: unknown): RpcPayload {
    return value && typeof value === "object" ? value as RpcPayload : {};
}

function resultError(payload: RpcPayload, rpcError: { message?: string; code?: string } | null, fallback: string) {
    if ((rpcError?.code === "42501" && rpcError.message === "GUARDIAN_CONSENT_REQUIRED")
        || (!rpcError && payload.ok === false && ["GUARDIAN_CONSENT_REQUIRED", "Vor der Bewerbung fehlt die aktive Elternbestätigung."].includes(payload.error ?? ""))) {
        return { code: "GUARDIAN_CONSENT_REQUIRED", error: "Für die erneute Zusammenarbeit fehlt noch die Elternfreigabe. Die gesetzliche Vertretung kann die Zustimmung im Familienbereich bestätigen." } as const;
    }
    const failure = rpcError?.message ?? (payload.ok === false ? payload.error : null);
    if (failure?.includes("RECIPIENT_SETUP_REQUIRED")) return "Hinterlege zuerst unter Einstellungen → Workfare Pay dein Auszahlkonto. Danach kannst du das Gespräch wieder öffnen.";
    if (failure?.includes("buyer_payment_required")) return "Hinterlege zuerst unter Einstellungen → Workfare Pay ein Zahlungsmittel. Danach kannst du das Gespräch wieder öffnen.";
    if ((failure?.includes("provider_verification_required") || failure?.includes("provider_address_required"))) return "Ergänze zuerst deine Adresse im Profil. Danach kannst du das Gespräch wieder öffnen.";
    if (rpcError) return fallback;
    if (payload.ok === false) return payload.error || fallback;
    return null;
}

function revalidateActivityPaths() {
    revalidatePath("/app-home/activities");
    revalidatePath("/app-home/offers");
    revalidatePath("/app-home/jobs");
    revalidatePath("/app-home/offers/[jobId]", "page");
}

async function callActivityRpc(
    name: string,
    args: Record<string, unknown>,
    fallback: string,
) {
    const supabase = await supabaseServer();
    const { data, error } = await (supabase.rpc as any)(name, args);
    const payload = readPayload(data);
    const failure = resultError(payload, error, fallback);
    if (failure) return typeof failure === "string" ? { error: failure } as const : failure;
    return { success: true, ...payload } as const;
}

export async function rejectApplication(applicationId: string, reason = "") {
    const normalizedReason = reason.trim();
    if (normalizedReason.length > 500) return { error: "Der Grund darf höchstens 500 Zeichen lang sein." };

    const result = await callActivityRpc("reject_application", {
        p_application_id: applicationId,
        p_reason: normalizedReason || null,
    }, "Die Bewerbung konnte nicht abgelehnt werden.");
    if ("error" in result) return result;
    if (result.ok !== true) return { error: "Die Freigabe wurde nicht bestätigt." };
    revalidateActivityPaths();
    return result;
}

export async function withdrawApplication(applicationId: string, reason = "") {
    const normalizedReason = reason.trim();
    if (normalizedReason.length > 500) return { error: "Der Grund darf höchstens 500 Zeichen lang sein." };

    const result = await callActivityRpc("withdraw_application", {
        p_application_id: applicationId,
        p_reason: normalizedReason || null,
    }, "Die Bewerbung konnte nicht zurückgezogen werden.");
    if ("error" in result) return result;
    if (result.ok !== true) return { error: "Das Zurückziehen wurde nicht bestätigt." };
    revalidateActivityPaths();
    return result;
}

export async function reopenApplication(applicationId: string) {
    const result = await callActivityRpc("reopen_application", {
        p_application_id: applicationId,
    }, "Das Gespräch konnte nicht wieder geöffnet werden.");
    if ("error" in result) return result;
    revalidateActivityPaths();
    return result;
}

export async function requestConversationReopen(applicationId: string, message: string) {
    const normalizedMessage = message.trim();
    if (normalizedMessage.length < 10) return { error: "Bitte beschreibe deine Anfrage in mindestens 10 Zeichen." };
    if (normalizedMessage.length > 500) return { error: "Die Anfrage darf höchstens 500 Zeichen lang sein." };

    const result = await callActivityRpc("request_conversation_reopen", {
        p_application_id: applicationId,
        p_message: normalizedMessage,
    }, "Die Öffnungsanfrage konnte nicht gesendet werden.");
    if ("error" in result) return result;
    revalidatePath("/app-home/activities");
    return result;
}

export async function respondToConversationReopenRequest(
    requestId: string,
    accept: boolean,
    reason = "",
) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length > 500) return { error: "Die Antwort darf höchstens 500 Zeichen lang sein." };

    const result = await callActivityRpc("respond_to_conversation_reopen_request", {
        p_request_id: requestId,
        p_accept: accept,
        p_reason: normalizedReason || null,
    }, "Die Anfrage konnte nicht beantwortet werden.");
    if ("error" in result) return result;
    revalidateActivityPaths();
    return result;
}

export async function sendMessage(applicationId: string, content: string) {
    const normalizedContent = content.trim();
    if (!normalizedContent) return { error: "Nachricht darf nicht leer sein." };
    if (normalizedContent.length > 1200) return { error: "Die Nachricht darf höchstens 1.200 Zeichen lang sein." };

    const result = await callActivityRpc("send_application_message", {
        p_application_id: applicationId,
        p_content: normalizedContent,
        p_client_nonce: randomUUID(),
    }, "Die Nachricht konnte nicht gesendet werden.");
    if ("error" in result) return result;
    if (!result.message) return { error: "Die Nachricht wurde nicht bestätigt." };
    revalidatePath("/app-home/activities");
    return result;
}

export async function markApplicationMessagesRead(applicationId: string) {
    const result = await callActivityRpc("mark_application_messages_read", {
        p_application_id: applicationId,
    }, "Nachrichten konnten nicht als gelesen markiert werden.");
    if ("error" in result) return result;
    return { success: true, updatedCount: Number(result.updated_count ?? 0) };
}

export async function confirmJobAgreement(applicationId: string, scheduledFor: string, note = "") {
    const scheduledDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() - 60_000) {
        return { error: "Der Termin muss in der Zukunft liegen." };
    }

    const result = await callActivityRpc("confirm_job_engagement", {
        p_application_id: applicationId,
        p_starts_at: scheduledDate.toISOString(),
        p_ends_at: null,
        p_timezone: "Europe/Berlin",
        p_note: note.trim() || null,
    }, "Der Termin konnte nicht gespeichert werden.");
    if ("error" in result) return result;
    revalidateActivityPaths();
    return {
        ...result,
        scheduled_for: result.scheduled_for || scheduledDate.toISOString(),
        agreed_at: result.agreed_at || new Date().toISOString(),
    };
}

export async function completeJobEngagement(applicationId: string, reason = "") {
    const normalizedReason = reason.trim();
    if (normalizedReason.length > 500) return { error: "Der Abschlussgrund darf höchstens 500 Zeichen lang sein." };

    const result = await callActivityRpc("complete_job_engagement", {
        p_application_id: applicationId,
        p_reason: normalizedReason || null,
    }, "Die Zusammenarbeit konnte nicht abgeschlossen werden.");
    if ("error" in result) return result;
    revalidateActivityPaths();
    return result;
}

export async function getAppointmentRequests(applicationId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return { error: "Der Vorgang ist nicht verfügbar.", available: false } as const;
    const client = await supabaseServer();
    const { data, error } = await client.from("job_appointment_requests")
        .select("id, application_id, appointment_id, requested_by, starts_at, ends_at, timezone, note, status, created_at, responded_at")
        .eq("application_id", applicationId).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
    if (error) return { error: "Terminanfragen konnten nicht geladen werden.", available: false } as const;
    return { requests: (data ?? []) as AppointmentRequest[], available: true } as const;
}

export async function getAppointmentRequestForMessage(applicationId: string, messageId: string) {
    const unavailable = { available: false, request: null, error: "Die Terminanfrage konnte nicht geladen werden." } as const;
    const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!identifier.test(applicationId) || !identifier.test(messageId)) return unavailable;

    try {
        const client = await supabaseServer();
        const messageResult = await client.from("messages")
            .select("id, application_id, sender_id, content, created_at, kind, deleted_at")
            .eq("application_id", applicationId).eq("id", messageId).eq("kind", "system").limit(1);
        if (messageResult.error) return unavailable;
        const message = messageResult.data?.[0];
        if (!message || message.deleted_at || !message.sender_id || !message.created_at || getAppointmentSystemMessageKind(message) !== "request") {
            return { available: true, request: null } as const;
        }

        // The RPC creates both records with PostgreSQL's transaction timestamp.
        // Compare in SQL to retain microseconds; never substitute the latest request.
        const requestResult = await client.from("job_appointment_requests")
            .select("id, application_id, appointment_id, requested_by, starts_at, ends_at, timezone, note, status, created_at, responded_at")
            .eq("application_id", applicationId).eq("requested_by", message.sender_id)
            .eq("created_at", message.created_at).limit(2);
        if (requestResult.error) return unavailable;
        const request = requestResult.data?.length === 1 ? requestResult.data[0] as AppointmentRequest : null;
        return { available: true, request } as const;
    } catch {
        return unavailable;
    }
}

export async function manageJobAppointment(input: AppointmentMutation) {
    const validation = appointmentMutationError(input);
    if (validation) return { error: validation } as const;
    const result = await callActivityRpc("manage_job_appointment", {
        p_application_id: input.applicationId,
        p_action: input.action,
        p_appointment_id: input.appointmentId ?? null,
        p_request_id: input.requestId ?? null,
        p_starts_at: ["propose", "update", "add"].includes(input.action) && input.startsAt ? new Date(input.startsAt).toISOString() : null,
        p_ends_at: ["propose", "update", "add"].includes(input.action) && input.endsAt ? new Date(input.endsAt).toISOString() : null,
        p_note: input.note?.trim() || null,
    }, "Die Terminänderung konnte nicht gespeichert werden.");
    if ("error" in result) return result;
    if (result.ok !== true) return { error: "Die Terminänderung wurde nicht bestätigt." } as const;
    revalidateActivityPaths();
    return { ...result, appointment: result.appointment && typeof result.appointment.id === "string" ? result.appointment : null };
}

export async function reportActivityItem(input: Omit<ActivityReportInput, "scope"> & { scope?: ReportScope }) {
    const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (!input || !isUuid(input.applicationId)
        || [input.reportedUserId, input.messageId, input.reopenRequestId].some(value => value != null && !isUuid(value))) {
        return { error: "Das ausgewählte Gespräch oder der Inhalt ist ungültig." };
    }
    const scope = input.scope === undefined ? (input.messageId || input.reopenRequestId ? "message" : "person") : input.scope;
    if (!["person", "conversation", "message"].includes(scope)) return { error: "Bitte wähle aus, was du melden möchtest." };
    const selectedContents = Number(input.messageId != null) + Number(input.reopenRequestId != null);
    if ((scope === "message" && selectedContents !== 1) || (scope !== "message" && selectedContents !== 0)) {
        return { error: "Bitte wähle genau den Inhalt aus, den du melden möchtest." };
    }
    if (!["harassment", "fraud", "safety", "inappropriate", "spam", "other"].includes(input.reasonCode)) {
        return { error: "Bitte wähle einen gültigen Meldegrund." };
    }
    if (input.details !== undefined && typeof input.details !== "string") return { error: "Die Beschreibung ist ungültig." };
    const details = input.details?.trim() ?? "";
    if (details.length > 1500) return { error: "Die Beschreibung darf höchstens 1.500 Zeichen lang sein." };

    const result = await callActivityRpc("report_activity_item_scoped", {
        p_application_id: input.applicationId,
        p_scope: scope,
        p_reason_code: input.reasonCode,
        p_details: details || null,
        p_reported_user_id: input.reportedUserId ?? null,
        p_message_id: input.messageId ?? null,
        p_reopen_request_id: input.reopenRequestId ?? null,
    }, "Die Meldung konnte nicht gesendet werden.");
    if ("error" in result) return result;
    if (result.ok !== true || !isUuid(result.report_id)) return { error: "Die Meldung wurde nicht bestätigt. Bitte versuche es erneut." };
    revalidatePath("/app-home/activities");
    return result;
}
