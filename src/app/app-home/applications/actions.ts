"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { appointmentMutationError, type AppointmentMutation, type AppointmentRequest } from "@/lib/activity/appointments";

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

function resultError(payload: RpcPayload, rpcError: { message?: string } | null, fallback: string) {
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
    if (failure) return { error: failure } as const;
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

export async function reportActivityItem(input: {
    applicationId: string;
    reasonCode: "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other";
    details?: string;
    reportedUserId?: string | null;
    messageId?: string | null;
    reopenRequestId?: string | null;
}) {
    const details = input.details?.trim() ?? "";
    if (details.length > 1500) return { error: "Die Beschreibung darf höchstens 1.500 Zeichen lang sein." };

    const result = await callActivityRpc("report_activity_item", {
        p_application_id: input.applicationId,
        p_reason_code: input.reasonCode,
        p_details: details || null,
        p_reported_user_id: input.reportedUserId ?? null,
        p_message_id: input.messageId ?? null,
        p_reopen_request_id: input.reopenRequestId ?? null,
    }, "Die Meldung konnte nicht gesendet werden.");
    if ("error" in result) return result;
    revalidatePath("/app-home/activities");
    return result;
}
