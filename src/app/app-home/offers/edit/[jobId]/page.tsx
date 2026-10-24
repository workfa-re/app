import { requireCompleteProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { notFound } from "next/navigation";
import { EditJobForm } from "./components/EditJobForm";
import styles from "@/components/jobs/JobForm.module.css";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function EditJobPage({
    params
}: {
    params: Promise<{ jobId: string }>
}) {
    const { jobId } = await params;
    const { profile } = await requireCompleteProfile();

    const supabase = await supabaseServer();
    const { data: job, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", jobId)
        .single();

    if (error || !job) {
        notFound();
    }

    if (job.posted_by !== profile.id) {
        return (
            <div className={`${styles.page} text-center`}>
                <div className={styles.panel}>
                    <h1 className="text-2xl font-semibold text-[var(--danger)]">Zugriff verweigert</h1>
                    <p className="mt-2 text-[var(--text-muted)]">Du kannst nur deine eigenen Jobs bearbeiten.</p>
                    <Link href="/app-home/offers" className={`app-glass-control ${styles.back} mt-7`}>Zurück</Link>
                </div>
            </div>
        );
    }

    const { data: region } = await supabase.from("regions_live")
        .select("display_name")
        .eq("id", profile.market_id as string)
        .single();
    const marketName = region?.display_name || "deiner Stadt";

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1>Job bearbeiten</h1>
                    <p>Passe die Angaben an. Bestehende Bewerbungen bleiben erhalten.</p>
                </div>
                <Link href="/app-home/offers" className={`app-glass-control ${styles.back}`}>
                    <ArrowLeft size={16} aria-hidden="true" />
                    <span>Zurück</span>
                </Link>
            </div>

            <div className={styles.panel}>
                <EditJobForm job={job} marketName={marketName} />
            </div>
        </div>
    );
}
