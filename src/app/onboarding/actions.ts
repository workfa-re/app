"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";
import { getOnboardingCompanyError, getOnboardingProfileError, getProviderOnboardingAddressError, type ProviderOnboardingAddress } from "@/lib/onboarding-validation";

export type OnboardingData = {
    full_name: string;
    birthdate: string;
    city: string;
    market_id: string | null;
    role: "youth" | "adult" | "company";
    company_name?: string;
    company_email?: string;
    company_message?: string;
    address?: ProviderOnboardingAddress;
};

export async function completeOnboarding(data: OnboardingData) {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Keine aktive Session gefunden." };
    }

    if (!data || typeof data !== "object" || ![data.full_name, data.birthdate, data.city].every(value => typeof value === "string")) return { error: "Bitte prüfe deine Profilangaben." };
    if (!["youth", "adult", "company"].includes(data.role)) return { error: "Bitte wähle eine Rolle aus." };
    const profileError = getOnboardingProfileError({ fullName: data.full_name, birthdate: data.birthdate, role: data.role });
    if (profileError) return { error: profileError };
    if (data.role !== "youth") {
        const addressError = getProviderOnboardingAddressError(data.address);
        if (addressError) return { error: addressError };
    }
    if (data.role === "company") {
        if (![data.company_name, data.company_email, data.company_message].every(value => typeof value === "string")) return { error: "Bitte ergänze die Angaben deiner Organisation." };
        const companyError = getOnboardingCompanyError({ companyName: data.company_name ?? "", companyEmail: data.company_email ?? "", companyMessage: data.company_message ?? "" });
        if (companyError) return { error: companyError };
    }

    // Authoritative account fields are written atomically by the database.
    let accountType: "job_seeker" | "job_provider" = "job_seeker";
    let providerKind: "private" | "company" | null = null;

    if (data.role === "company") {
        accountType = "job_provider";
        providerKind = "company";
    } else if (data.role === "adult") {
        accountType = "job_provider";
        providerKind = "private";
    }

    const common = {
        p_full_name: data.full_name,
        p_birthdate: data.birthdate,
        p_city: data.city,
        p_market_id: data.market_id,
        p_provider_kind: providerKind,
        p_company_name: data.role === "company" ? data.company_name ?? null : null,
        p_company_contact_email: data.role === "company" ? data.company_email ?? null : null,
        p_company_message: data.role === "company" ? data.company_message ?? null : null,
    };
    const { data: result, error } = accountType === "job_provider" && data.address
        ? await supabase.rpc("complete_provider_onboarding", { ...common,
            p_provider_kind: providerKind!,
            p_street: data.address.street.trim(), p_house_number: data.address.houseNumber.trim(),
            p_address_city: data.address.city.trim(), p_zip: data.address.zip.trim(),
            p_lat: data.address.latitude!, p_lng: data.address.longitude!,
        })
        : await supabase.rpc("complete_profile_onboarding", { ...common, p_account_type: accountType });

    if (error) {
        console.error("Onboarding Error:", error);
        return { error: "Fehler beim Speichern des Profils." };
    }

    const response = result && typeof result === "object" && !Array.isArray(result)
        ? result as { ok?: boolean; error?: string }
        : null;

    if (!response?.ok) {
        const messages: Record<string, string> = {
            profile_already_complete: "Dein Profil wurde bereits eingerichtet.",
            seeker_age_out_of_range: "Ein Jobsuchenden-Konto ist für Jugendliche von 14 bis 20 Jahren vorgesehen.",
            provider_must_be_adult: "Ein Anbieter-Konto ist erst ab 18 Jahren möglich.",
            invalid_birthdate: "Bitte prüfe dein Geburtsdatum.",
            invalid_market: "Bitte wähle einen gültigen Standort.",
            company_name_required: "Bitte gib den Namen des Unternehmens an.",
            invalid_company_email: "Bitte prüfe die Kontakt-E-Mail des Unternehmens.",
            invalid_address: "Bitte wähle deine vollständige Adresse mit Hausnummer aus.",
            invalid_coordinates: "Bitte wähle deine Adresse aus den Suchvorschlägen.",
            provider_address_required: "Bitte ergänze deine Adresse.",
        };

        return {
            error: messages[response?.error ?? ""] ?? "Das Profil konnte nicht eingerichtet werden.",
        };
    }

    // Force cache revalidation to ensure the layout updates
    revalidatePath("/", "layout");
    revalidatePath("/app-home", "layout");

    return { success: true };
}
