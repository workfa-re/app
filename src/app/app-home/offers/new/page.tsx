import { requireCompleteProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CreateJobForm } from "@/components/jobs/CreateJobForm";
import { supabaseServer } from "@/lib/supabaseServer";
import { getEffectiveView } from "@/lib/dal/platform";

type DefaultLocation = {
    id: string;
    public_label: string | null;
    address_line1: string | null;
    postal_code: string | null;
    city: string | null;
};

export default async function NewOfferPage() {
    const { profile } = await requireCompleteProfile();

    const viewRes = await getEffectiveView({ userId: profile.id, baseAccountType: profile.account_type });
    const viewRole = viewRes.ok ? viewRes.data.viewRole : (profile.account_type ?? "job_seeker");

    // Server-side guard to avoid "kurz sichtbar, dann weg" client redirects.
    if (viewRole !== "job_provider") {
        redirect("/app-home/jobs");
    }

    // Provider Verification Guard
    const isVerified = profile.provider_verification_status === 'verified' || Boolean(profile.provider_verified_at);
    if (!isVerified) {
        redirect("/app-home/profile?focus=provider-verification&from=create-job");
    }

    const profileStreet = profile.street?.trim();
    const profileCity = profile.city?.trim();
    const profilePostalCode = profile.zip?.trim();
    const profileAddressLine = [profileStreet, profile.house_number?.trim()].filter(Boolean).join(" ");
    const defaultLocation: DefaultLocation | null = profileStreet && profileCity && profilePostalCode
        ? {
            id: "profile-default",
            public_label: "Privatadresse",
            address_line1: profileAddressLine,
            postal_code: profilePostalCode,
            city: profileCity,
        }
        : null;

    // Fetch market_name to dynamically display reach text
    const supabase = await supabaseServer();
    const { data: region } = await supabase.from("regions_live")
        .select("display_name")
        .eq("id", profile.market_id as string)
        .single();
    const marketName = region?.display_name || "deiner Stadt";

    return (
        <div className="container mx-auto max-w-3xl px-4 py-8 md:px-6">
            <div className="mb-8">
                <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-strong)] md:text-5xl">Neuen Job erstellen</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--text-muted)]">
                    Suche nach Unterstützung in {marketName}.
                </p>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)] sm:p-7 md:p-8">
                <CreateJobForm defaultLocation={defaultLocation} marketName={marketName} />
            </div>
        </div>
    );
}
