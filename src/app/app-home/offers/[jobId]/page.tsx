import { requireCompleteProfile } from "@/lib/auth";
import { getJobByIdService } from "@/lib/services/jobs";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    Calendar,
    Clock,
    FileText,
    Globe2,
    MapPin,
} from "lucide-react";
import type { Database } from "@/lib/types/supabase";
import { fetchJobApplications } from "@/lib/dal/platform";
import { getCategoryById } from "@/lib/constants/jobCategories";
import {
    formatProviderApplicationSummary,
    getProviderJobStatusMeta,
    summarizeProviderApplications,
} from "../presentation";
import styles from "@/components/jobs/JobDetail.module.css";
import { formatJobCompensation } from "@/components/jobs/job-presentation";
import { getActivityConversationHref } from "@/lib/activity/navigation";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
    const { jobId } = await params;
    const { profile } = await requireCompleteProfile();

    if (profile.account_type !== "job_provider") {
        redirect("/app-home/jobs");
    }

    const { data, error } = await getJobByIdService(jobId);

    if (error || !data) {
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-16 text-center md:py-20">
                <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-8 shadow-[var(--shadow-card)]">
                    <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
                        <FileText size={23} />
                    </div>
                    <h1 className="text-balance text-2xl font-semibold text-[var(--text-strong)]">Job nicht gefunden</h1>
                    <p className="mt-2 text-pretty text-sm leading-6 text-[var(--text-muted)]">
                        Dieser Job existiert nicht oder du hast keine Berechtigung, ihn zu öffnen.
                    </p>
                    <Link
                        href="/app-home/offers"
                        className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-5 text-sm font-semibold text-[var(--text-default)] outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:border-[var(--brand-border)] hover:bg-[var(--brand-soft)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        <ArrowLeft size={16} />
                        Zur Übersicht
                    </Link>
                </div>
            </div>
        );
    }

    const job = data as unknown as JobRow;

    if (job.posted_by !== profile.id) {
        redirect("/app-home/offers");
    }

    const applicationsResult = await fetchJobApplications(jobId, profile.id);
    const applications = applicationsResult.ok ? applicationsResult.data : [];
    const activeConversation = summarizeProviderApplications(applications)[job.id];
    const history = applications.find(application => application.status !== "waitlisted");
    const conversationId = activeConversation?.conversationId || history?.id;
    const applicationSummary = formatProviderApplicationSummary(activeConversation?.status ?? null, applicationsResult.ok, job.status);
    const statusInfo = getProviderJobStatusMeta(job.status, applications.map((application) => application.status));
    const compensation = formatJobCompensation(job.wage_hourly, job.payment_type);
    const category = getCategoryById(job.category);
    const reachLabel = job.reach === "extended" ? "Überregional" : "Lokal";
    const jobKindLabel = job.job_kind === "recurring"
        ? formatRecurrence(job.recurrence_rule)
        : "Einmaliger Auftrag";

    return (
        <div className={styles.page}>
            <Link href="/app-home/offers" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Zurück zu meinen Jobs</Link>
            <article>
                <div className={styles.scroll}>
                <header className={styles.header}>
                    <div className={styles.eyebrow}><span>{category?.label || "Sonstiges"}</span><span>{statusInfo.label}</span></div>
                    <div className={styles.titleRow}><h1 className={styles.title}>{job.title}</h1><p className={styles.compensation}><span className={styles.amount}>{compensation.amount || "Vergütung offen"}</span>{compensation.amount && <span className={styles.unit}>{compensation.unit}</span>}</p></div>
                    <div className={styles.facts}><span><Clock size={16} aria-hidden="true" />{jobKindLabel}</span><span><MapPin size={16} aria-hidden="true" />{job.public_location_label || "Ort nicht angegeben"}</span><span><Globe2 size={16} aria-hidden="true" />{reachLabel}</span>{Number.isFinite(new Date(job.created_at).getTime()) && <span><Calendar size={16} aria-hidden="true" />Erstellt am {formatDate(job.created_at)}</span>}</div>
                </header>
                <div className={styles.body}>
                    <section className={styles.section} aria-labelledby="offer-description-title"><h2 id="offer-description-title">Über die Aufgabe</h2><p className={styles.description}>{job.description || "Keine Beschreibung hinterlegt."}</p></section>
                </div>
                </div>
                <footer className={styles.footer}>
                    <div className={styles.footerCopy}><strong>{activeConversation ? "Euer Gespräch" : job.status === "open" ? "Bereit für eine Bewerbung" : "Dein Job"}</strong><p role={applicationsResult.ok ? undefined : "status"}>{applicationSummary}</p></div>
                    <div className={styles.pageActions}><Link href={"/app-home/offers/edit/" + job.id} className={styles.action}><FileText size={16} aria-hidden="true" />Bearbeiten</Link>{conversationId && <Link href={getActivityConversationHref(conversationId)} className={styles.action}>{activeConversation ? "Gespräch öffnen" : "Verlauf ansehen"}<ArrowRight size={16} aria-hidden="true" /></Link>}</div>
                </footer>
            </article>
        </div>
    );
}

function formatDate(date: string) {
    return new Intl.DateTimeFormat("de-DE", {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(new Date(date));
}

function formatRecurrence(rule: string | null) {
    if (rule === "weekly") return "Wöchentlich";
    if (rule === "biweekly") return "Alle zwei Wochen";
    if (rule === "monthly") return "Monatlich";
    return "Regelmäßig nach Absprache";
}
