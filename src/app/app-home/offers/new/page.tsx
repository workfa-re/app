import { getAppHomeAccess, getAppHomeContext, getMarketSummary } from "@/lib/app-shell";
import { redirect } from "next/navigation";
import { CreateJobForm } from "@/components/jobs/CreateJobForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "@/components/jobs/JobForm.module.css";
import { getPaymentSettingsSnapshot } from "@/lib/payments/repository.server";

type DefaultLocation = {
    id: string;
    public_label: string | null;
    address_line1: string | null;
    postal_code: string | null;
    city: string | null;
};

export default async function NewOfferPage() {
    const context = await getAppHomeContext();
    const { profile, effectiveView } = context;

    // Server-side guard to avoid "kurz sichtbar, dann weg" client redirects.
    if (effectiveView.viewRole !== "job_provider") {
        redirect("/app-home/jobs");
    }

    // A complete address enables job preparation; identity stays separate.
    const access = await getAppHomeAccess(context);
    if (!access.canCreateJobs) {
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

    const [region, payment] = await Promise.all([
        getMarketSummary(profile.market_id),
        getPaymentSettingsSnapshot(profile.id),
    ]);
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
                <CreateJobForm defaultLocation={defaultLocation} marketName={marketName}
                    paymentRequired={payment.featureEnabled && !payment.buyerReady} />
            </div>
        </div>
    );
}
