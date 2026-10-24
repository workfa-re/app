"use server";

import { requireCompleteProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";
import { getPaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import {
    parseJobEditFormData,
    resolveJobStatusTransition,
    validateJobId,
} from "./jobEditValidation";

export async function updateJobAction(jobId: string, formData: FormData): Promise<{ success: true } | { success: false; error: string; code?: string }> {
    const { profile } = await requireCompleteProfile();

    if (!validateJobId(jobId).success) {
        return { success: false, error: "Die Job-ID ist ungültig." };
    }

    const parsedForm = parseJobEditFormData(formData);
    if (!parsedForm.success) {
        return parsedForm;
    }

    const supabase = await supabaseServer();

    const { data: existingJob, error: ownershipError } = await supabase
        .from("jobs")
        .select("posted_by, status, job_kind")
        .eq("id", jobId)
        .single();

    if (ownershipError || !existingJob || existingJob.posted_by !== profile.id) {
        return { success: false, error: "Du hast keine Berechtigung, diesen Job zu bearbeiten." };
    }

    const statusResult = resolveJobStatusTransition(existingJob.status, parsedForm.data.status);
    if (!statusResult.success) {
        return statusResult;
    }

    if (
        ["reserved", "reviewing", "filled"].includes(existingJob.status)
        && parsedForm.data.job_kind !== existingJob.job_kind
    ) {
        return {
            success: false,
            error: "Die Jobart kann nach Beginn des Bewerbungsablaufs nicht mehr geändert werden.",
        };
    }

    if (statusResult.status === "open" && existingJob.status !== "open") {
        const payment = await getPaymentSettingsSnapshot(profile.id);
        if (payment.featureEnabled && !payment.buyerReady) {
            return { success: false, code: "buyer_payment_required", error: "Hinterlege vor dem Veröffentlichen ein Zahlungsmittel. Deine Änderungen bleiben hier erhalten." };
        }
    }

    const { data: result, error } = await supabase.rpc("update_owned_job_details", {
        p_job_id: jobId,
        p_expected_status: existingJob.status,
        p_title: parsedForm.data.title,
        p_description: parsedForm.data.description,
        p_wage_hourly: parsedForm.data.wage_hourly,
        p_category: parsedForm.data.category,
        p_payment_type: parsedForm.data.payment_type,
        p_reach: parsedForm.data.reach,
        p_status: statusResult.status,
        p_job_kind: parsedForm.data.job_kind,
        p_recurrence_rule: parsedForm.data.job_kind === "recurring"
            ? parsedForm.data.recurrence_rule
            : null,
        p_continuity_preferred: parsedForm.data.job_kind === "recurring"
            ? parsedForm.data.continuity_preferred
            : false,
    });

    if (error) {
        if (error.message.includes("buyer_payment_required")) {
            return { success: false, code: "buyer_payment_required", error: "Hinterlege vor dem Veröffentlichen ein Zahlungsmittel. Deine Änderungen bleiben hier erhalten." };
        }
        if (error.message.includes("provider_verification_required")) {
            return { success: false, code: "provider_verification_required", error: "Lass deine Adresse im Profil prüfen, bevor du den Job veröffentlichst. Deine Änderungen bleiben hier erhalten." };
        }
        console.error("Job update error:", error);
        return { success: false, error: "Datenbankfehler beim Speichern." };
    }

    const response = result && typeof result === "object" && !Array.isArray(result)
        ? result as { ok?: boolean; error?: string }
        : null;
    if (!response?.ok) {
        if (response?.error === "buyer_payment_required") {
            return { success: false, code: "buyer_payment_required", error: "Hinterlege vor dem Veröffentlichen ein Zahlungsmittel. Deine Änderungen bleiben hier erhalten." };
        }
        if (response?.error === "provider_verification_required") {
            return { success: false, code: "provider_verification_required", error: "Lass deine Adresse im Profil prüfen, bevor du den Job veröffentlichst. Deine Änderungen bleiben hier erhalten." };
        }
        const messages: Record<string, string> = {
            status_changed: "Der Jobstatus hat sich inzwischen geändert. Bitte lade die Seite neu.",
            workflow_status_locked: "Dieser Job wird bereits über den Bewerbungsablauf verwaltet.",
            job_details_locked: "Die Angaben sind während eines laufenden Auftrags geschützt.",
            workflow_details_locked: "Die Angaben sind während eines laufenden Auftrags geschützt.",
            job_kind_locked: "Die Jobart kann während eines laufenden Bewerbungsablaufs nicht geändert werden.",
            not_authorized: "Du hast keine Berechtigung, diesen Job zu bearbeiten.",
        };

        return {
            success: false,
            error: messages[response?.error ?? ""] ?? "Die Änderungen konnten nicht gespeichert werden.",
        };
    }

    revalidatePath("/app-home/offers");
    revalidatePath(`/app-home/offers/${jobId}`);
    revalidatePath(`/app-home/offers/edit/${jobId}`);

    return { success: true };
}
