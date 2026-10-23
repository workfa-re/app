import { requireCompleteProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CreateJobForm } from "@/components/jobs/CreateJobForm";
import { supabaseServer } from "@/lib/supabaseServer";
import { getEffectiveView } from "@/lib/dal/platform";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "@/components/jobs/JobForm.module.css";

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
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1>Neuen Job erstellen</h1>
                    <p>Suche nach Unterstützung in {marketName}.</p>
                </div>
                <Link href="/app-home/offers" className={`app-glass-control ${styles.back}`}>
                    <ArrowLeft size={16} aria-hidden="true" />Zurück
                </Link>
            </div>

            <div className={styles.panel}>
                <CreateJobForm defaultLocation={defaultLocation} marketName={marketName} />
            </div>
        </div>
    );
}
