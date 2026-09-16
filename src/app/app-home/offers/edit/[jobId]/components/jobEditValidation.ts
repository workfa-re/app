import { z } from "zod";
import { JOB_CATEGORIES } from "@/lib/constants/jobCategories";
import type { JobStatus } from "@/lib/types/platform";
import {
    isProtectedJobStatus,
    type ProtectedJobStatus,
} from "../../../presentation";

const EDITABLE_JOB_STATUSES = ["draft", "open", "closed"] as const;
const ALLOWED_FORM_FIELDS = new Set([
    "title",
    "description",
    "wage_hourly",
    "category",
    "payment_type",
    "reach",
    "status",
    "job_kind",
    "recurrence_rule",
    "continuity_preferred",
]);
const CATEGORY_IDS = new Set(JOB_CATEGORIES.map((category) => category.id));

const jobEditSchema = z.object({
    title: z.string().trim().min(5, "Der Titel muss mindestens 5 Zeichen lang sein.").max(120, "Der Titel darf höchstens 120 Zeichen lang sein."),
    description: z.string().trim().min(10, "Die Beschreibung muss mindestens 10 Zeichen lang sein.").max(5000, "Die Beschreibung darf höchstens 5.000 Zeichen lang sein."),
    wage_hourly: z.coerce.number({ error: "Bitte gib eine gültige Vergütung ein." }).finite("Bitte gib eine gültige Vergütung ein.").positive("Die Vergütung muss größer als 0 sein.").max(100000, "Die Vergütung ist zu hoch."),
    category: z.string().refine((value) => CATEGORY_IDS.has(value), "Bitte wähle eine gültige Kategorie."),
    payment_type: z.enum(["hourly", "fixed"], { error: "Bitte wähle eine gültige Vergütungsart." }),
    reach: z.enum(["internal_rheinbach", "extended"], { error: "Bitte wähle eine gültige Reichweite." }),
    status: z.enum(EDITABLE_JOB_STATUSES, { error: "Dieser Status kann hier nicht gesetzt werden." }).optional(),
    job_kind: z.enum(["one_time", "recurring"], { error: "Bitte wähle eine gültige Jobart." }),
    recurrence_rule: z.union([
        z.enum(["weekly", "biweekly", "monthly", "flexible"]),
        z.literal(""),
    ]).transform((value) => value || null),
    continuity_preferred: z.enum(["true", "false"]).transform((value) => value === "true"),
}).strict().superRefine((value, context) => {
    if (value.job_kind === "recurring" && !value.recurrence_rule) {
        context.addIssue({
            code: "custom",
            path: ["recurrence_rule"],
            message: "Bitte wähle aus, wie häufig die Hilfe gebraucht wird.",
        });
    }
});

export type JobEditValues = z.infer<typeof jobEditSchema>;
export type EditableJobStatus = (typeof EDITABLE_JOB_STATUSES)[number];

export function parseJobEditFormData(formData: FormData):
    | { success: true; data: JobEditValues }
    | { success: false; error: string } {
    const raw: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
        if (!ALLOWED_FORM_FIELDS.has(key) || key in raw || typeof value !== "string") {
            return { success: false, error: "Die übermittelten Formulardaten sind ungültig." };
        }
        raw[key] = value;
    }

    const result = jobEditSchema.safeParse(raw);
    if (!result.success) {
        return {
            success: false,
            error: result.error.issues[0]?.message ?? "Bitte prüfe deine Eingaben.",
        };
    }

    return { success: true, data: result.data };
}

export function validateJobId(jobId: string) {
    return z.string().uuid("Die Job-ID ist ungültig.").safeParse(jobId);
}

export function resolveJobStatusTransition(
    currentStatus: JobStatus,
    requestedStatus: EditableJobStatus | undefined,
): { success: true; status: JobStatus } | { success: false; error: string } {
    if (!requestedStatus) {
        return { success: true, status: currentStatus };
    }

    if (isProtectedJobStatus(currentStatus)) {
        return {
            success: false,
            error: "Dieser Status wird im Bewerbungsablauf verwaltet und kann hier nicht geändert werden.",
        };
    }

    const allowedTransitions: Record<Exclude<JobStatus, ProtectedJobStatus>, readonly EditableJobStatus[]> = {
        draft: ["draft", "open", "closed"],
        open: ["open", "closed"],
        closed: ["closed", "open"],
    };

    if (!allowedTransitions[currentStatus].includes(requestedStatus)) {
        return { success: false, error: "Dieser Statuswechsel ist nicht zulässig." };
    }

    return { success: true, status: requestedStatus };
}
