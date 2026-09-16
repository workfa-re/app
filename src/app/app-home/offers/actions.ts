"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createJob as createJobDAL, getEffectiveView } from "@/lib/dal/platform";
import type { ErrorInfo } from "@/lib/types/platform";
import type { AccountType } from "@/lib/types";
import { Database } from "@/lib/types/supabase";
import { resolveLocationCoordinates } from "@/lib/location-privacy";
import { parseCreateJobCompensation } from "./createJobValidation";

const RHEINBACH_CENTER_PUBLIC_COORDINATES = { lat: 50.63, lng: 6.95 } as const;

const createJobSchema = z.object({
    title: z.string().min(5, "Titel muss mindestens 5 Zeichen lang sein.").max(120, "Titel darf höchstens 120 Zeichen lang sein."),
    description: z.string().min(10, "Beschreibung muss mindestens 10 Zeichen lang sein.").max(5000, "Beschreibung darf höchstens 5.000 Zeichen lang sein."),
    address_full: z.string().optional(),
    wage: z.number().finite().positive().max(100000),
    category: z.string().min(1, "Bitte wähle eine Kategorie aus."),
    payment_type: z.enum(["hourly", "fixed"]).default("hourly"),
    reach: z.enum(["internal_rheinbach", "extended"]).optional(),
    job_kind: z.enum(["one_time", "recurring"]).default("one_time"),
    recurrence_rule: z.enum(["weekly", "biweekly", "monthly", "flexible"]).nullable().optional(),
    continuity_preferred: z.boolean().default(false),
}).superRefine((data, context) => {
    if (data.job_kind === "recurring" && !data.recurrence_rule) {
        context.addIssue({
            code: "custom",
            path: ["recurrence_rule"],
            message: "Bitte wähle eine Häufigkeit für den regelmäßigen Job.",
        });
    }
});

export type CreateJobActionState =
    | null
    | { status: "error"; error: ErrorInfo };

export async function createJob(_prevState: CreateJobActionState, formData: FormData): Promise<CreateJobActionState> {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        const state: CreateJobActionState = { status: "error", error: { message: "Nicht authentifiziert" } };
        return state;
    }

    const intent = (formData.get("intent") as string | null) ?? "create";

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("market_id, account_type, street, house_number, zip, city, lat, lng, provider_verification_status, provider_verified_at")
        .eq("id", user.id)
        .single();

    // Debug Error
    if (profileError || !profile) {
        console.error("CreateJobs Profile Fetch Error:", profileError);
        const state: CreateJobActionState = { status: "error", error: { message: "Kein Profil gefunden. Bitte Profil vervollständigen." } };
        return state;
    }

    let marketId = profile.market_id;

    if (!marketId) {
        // Fallback: Fetch "Rheinbach" market from regions_live (v13 fix)
        const { data: defaultMarkets } = await supabase.from("regions_live").select("id").ilike("city", "%Rheinbach%").limit(1);
        marketId = defaultMarkets?.[0]?.id ?? null;
    }

    if (!marketId) {
        // Ultimate fallback if even DB fetch fails (should not happen in prod)
        const state: CreateJobActionState = { status: "error", error: { message: "Systemfehler: Kein Markt zuweisbar." } };
        return state;
    }

    const baseAccountType = (profile as unknown as { account_type?: AccountType | null } | null)?.account_type ?? null;
    const viewRes = await getEffectiveView({ userId: user.id, baseAccountType });
    if (!viewRes.ok) {
        const state: CreateJobActionState = { status: "error", error: viewRes.error };
        return state;
    }

    const view = viewRes.data;
    if (view.viewRole !== "job_provider") {
        const state: CreateJobActionState = { status: "error", error: { message: "Nicht berechtigt: Nur Jobanbieter können Jobs erstellen." } };
        return state;
    }

    const providerIsVerified = profile.provider_verification_status === "verified"
        || Boolean(profile.provider_verified_at);
    if (!providerIsVerified) {
        return {
            status: "error",
            error: { message: "Dein Anbieterprofil muss vor der Veröffentlichung geprüft sein." },
        };
    }

    const useProfileLocation = formData.get("use_default_location") === "true";
    const submittedAddress = formData.get("address_full");
    let privateAddress = typeof submittedAddress === "string" ? submittedAddress.trim() : "";
    let publicLocationLabel = "Rheinbach (Zentrum)";
    let latitudeInput: string | number | null | undefined;
    let longitudeInput: string | number | null | undefined;

    if (useProfileLocation) {
        const profileStreet = profile.street?.trim();
        const profileCity = profile.city?.trim();
        const profilePostalCode = profile.zip?.trim();
        if (!profileStreet || !profileCity || !profilePostalCode) {
            const state: CreateJobActionState = { status: "error", error: { message: "Kein Standard-Ort gefunden. Bitte Adresse im Profil vervollständigen." } };
            return state;
        }

        const profileAddressLine = [profileStreet, profile.house_number?.trim()].filter(Boolean).join(" ");
        privateAddress = `${profileAddressLine}, ${profilePostalCode} ${profileCity}`;
        publicLocationLabel = "Privatadresse";
        latitudeInput = profile.lat;
        longitudeInput = profile.lng;
    } else {
        if (privateAddress.length < 5) {
            const state: CreateJobActionState = { status: "error", error: { message: "Bitte gib eine Adresse ein oder wähle Standard-Ort." } };
            return state;
        }

        const submittedLatitude = formData.get("public_lat");
        const submittedLongitude = formData.get("public_lng");
        latitudeInput = typeof submittedLatitude === "string"
            ? submittedLatitude
            : submittedLatitude === null ? null : "";
        longitudeInput = typeof submittedLongitude === "string"
            ? submittedLongitude
            : submittedLongitude === null ? null : "";
    }

    const compensation = parseCreateJobCompensation(formData.get("wage"));
    if (!compensation.success) {
        return { status: "error", error: { message: compensation.error } };
    }

    const rawData = {
        title: (formData.get("title") as string)?.trim(),
        description: (formData.get("description") as string)?.trim(),
        address_full: privateAddress || undefined,
        wage: compensation.data,
        category: formData.get("category") as string,
        payment_type: (formData.get("payment_type") as string) || "hourly",
        reach: (formData.get("reach") as string) || "internal_rheinbach",
        job_kind: (formData.get("job_kind") as string) || "one_time",
        recurrence_rule: (formData.get("recurrence_rule") as string) || null,
        continuity_preferred: formData.get("continuity_preferred") === "true",
    };

    const validated = createJobSchema.safeParse(rawData);

    if (!validated.success) {
        const state: CreateJobActionState = { status: "error", error: { message: validated.error.issues[0].message } };
        return state;
    }

    const resolvedCoordinates = resolveLocationCoordinates(latitudeInput, longitudeInput);
    if (resolvedCoordinates.status === "invalid") {
        return { status: "error", error: { message: "Die Standortkoordinaten sind unvollständig oder ungültig." } };
    }

    const privateLatitude = resolvedCoordinates.status === "valid"
        ? resolvedCoordinates.privateLatitude
        : null;
    const privateLongitude = resolvedCoordinates.status === "valid"
        ? resolvedCoordinates.privateLongitude
        : null;

    const privateDetails = {
        address_full: validated.data.address_full || null,
        private_lat: privateLatitude,
        private_lng: privateLongitude,
        notes: null,
    };

    const jobStatus: Database["public"]["Enums"]["job_status"] = intent === "draft" ? "draft" : "open";

    const publicCoordinates = resolvedCoordinates.status === "valid"
        ? {
            lat: resolvedCoordinates.publicLatitude,
            lng: resolvedCoordinates.publicLongitude,
        }
        : RHEINBACH_CENTER_PUBLIC_COORDINATES;

    const res = await createJobDAL({
        job: {
            posted_by: user.id,
            market_id: marketId,
            title: validated.data.title,
            description: validated.data.description,
            wage_hourly: validated.data.wage,
            status: jobStatus,
            category: validated.data.category,
            payment_type: validated.data.payment_type,
            public_location_label: publicLocationLabel,
            public_lat: publicCoordinates.lat,
            public_lng: publicCoordinates.lng,
            address_reveal_policy: "after_accept",
            reach: validated.data.reach ?? "internal_rheinbach",
            job_kind: validated.data.job_kind,
            recurrence_rule: validated.data.job_kind === "recurring" ? validated.data.recurrence_rule ?? "flexible" : null,
            continuity_preferred: validated.data.job_kind === "recurring" && validated.data.continuity_preferred,
        },
        privateDetails,
    });

    if (!res.ok) {
        const state: CreateJobActionState = { status: "error", error: res.error };
        return state;
    }

    revalidatePath("/app-home/offers");
    revalidatePath("/app-home/jobs");
    redirect("/app-home/offers");
}
