"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { getRecipientSettingsHref } from "@/lib/payments/recipient-return-path";

type ApplicationPayload = {
    ok?: boolean;
    error?: string;
    application?: Record<string, unknown>;
    is_primary?: boolean;
};

type ApplicationResult =
    | { success: true; application: Record<string, unknown>; error?: never; code?: never }
    | { success?: false; application?: never; error: string; code?: "GUARDIAN_CONSENT_REQUIRED" | "RECIPIENT_SETUP_REQUIRED"; paymentHref?: string };

export async function applyToJob(formData: FormData | string): Promise<ApplicationResult> {
    const jobId = typeof formData === "string"
        ? formData
        : String(formData.get("jobId") ?? "");
    const inputMessage = typeof formData === "string"
        ? "Ich interessiere mich für diesen Job."
        : String(formData.get("message") ?? "").trim();
    const message = inputMessage || "Ich interessiere mich für diesen Job.";

    if (!jobId) return { error: "Job nicht gefunden." };
    if (message.length < 3) return { error: "Bitte schreibe eine kurze Bewerbungsnachricht." };
    if (message.length > 1200) return { error: "Die Bewerbungsnachricht darf höchstens 1.200 Zeichen lang sein." };

    const supabase = await supabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: "Nicht authentifiziert." };

    const { data, error } = await (supabase.rpc as any)("submit_job_application", {
        p_job_id: jobId,
        p_message: message,
    });
    const payload = (data ?? {}) as ApplicationPayload;
    const guardianConsentRequired: ApplicationResult = { code: "GUARDIAN_CONSENT_REQUIRED", error: "Deine Elternfreigabe fehlt noch. Dein Elternteil kann die Zustimmung im Familienbereich bestätigen." };

    if (error) {
        if (error.code === "42501" && error.message === "GUARDIAN_CONSENT_REQUIRED") return guardianConsentRequired;
        if (error.message?.includes("RECIPIENT_SETUP_REQUIRED")) return { code: "RECIPIENT_SETUP_REQUIRED", error: "Hinterlege zuerst dein Auszahlkonto. Danach kannst du dich auf diesen Job bewerben.", paymentHref: getRecipientSettingsHref(jobId) };
        console.error("Atomic application RPC failed:", error.code ?? "unknown");
        return { error: "Die Bewerbung konnte nicht gesendet werden." };
    }
    if (payload.ok === false && payload.error === "Vor der Bewerbung fehlt die aktive Elternbestätigung.") return guardianConsentRequired;
    if (payload.ok !== true) return { error: payload.error || "Die Bewerbung konnte nicht bestätigt werden." };
    if (payload.is_primary !== true || typeof payload.application?.id !== "string"
        || !["submitted", "negotiating", "accepted"].includes(String(payload.application.status))) {
        return { error: "Der Job konnte nicht für dich reserviert werden. Bitte aktualisiere die Jobübersicht." };
    }

    revalidatePath("/app-home/jobs");
    revalidatePath("/app-home/activities");
    revalidatePath("/app-home/offers");

    return {
        success: true,
        application: payload.application,
    };
}
