import type { ReactNode } from "react";
import { requireCompleteProfile } from "@/lib/auth";
import { getJobByIdService } from "@/lib/services/jobs";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    Building2,
    Calendar,
    Clock,
    Euro,
    FileText,
    Globe2,
    MapPin,
    Repeat2,
} from "lucide-react";
import type { Database } from "@/lib/types/supabase";
import { fetchJobApplications } from "@/lib/dal/platform";
import { getCategoryById } from "@/lib/constants/jobCategories";
import {
    formatProviderApplicationSummary,
    formatProviderCompensation,
    getProviderJobStatusMeta,
    type ProviderJobStatusTone,
} from "../presentation";
import { cn } from "@/lib/utils";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

const STATUS_TONE_CLASSES: Record<ProviderJobStatusTone, string> = {
    positive: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    informative: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    caution: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    neutral: "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-[var(--text-muted)]",
};

const STATUS_DOT_CLASSES: Record<ProviderJobStatusTone, string> = {
    positive: "bg-emerald-500",
    informative: "bg-blue-500",
    caution: "bg-amber-500",
    neutral: "bg-[var(--text-soft)]",
};

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
    const applicationCount = applications.length;
    const applicationSummary = formatProviderApplicationSummary(applicationCount, applicationsResult.ok);
    const statusInfo = getProviderJobStatusMeta(job.status, applications.map((application) => application.status));
    const compensation = formatProviderCompensation(job.wage_hourly, job.payment_type);
    const category = getCategoryById(job.category);
    const CategoryIcon = category?.icon ?? Building2;
    const reachLabel = job.reach === "extended" ? "Überregional" : "Lokal";
    const jobKindLabel = job.job_kind === "recurring"
        ? formatRecurrence(job.recurrence_rule)
        : "Einmaliger Auftrag";

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
            <Link
                href="/app-home/offers"
                className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-medium text-[var(--text-muted)] outline-none transition-[color,transform] duration-150 ease-out hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
                <ArrowLeft size={16} />
                Zurück zu meinen Jobs
            </Link>

            <article className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-[var(--shadow-card)]">
                <header className="border-b border-[var(--border-subtle)] p-6 md:p-8">
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", STATUS_TONE_CLASSES[statusInfo.tone])}>
                                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT_CLASSES[statusInfo.tone])} aria-hidden="true" />
                                    {statusInfo.label}
                                </span>
                                {category ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                                        <CategoryIcon size={13} />
                                        {category.label}
                                    </span>
                                ) : null}
                            </div>
                            <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight text-[var(--text-strong)] md:text-4xl">
                                {job.title}
                            </h1>
                            <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                                <Calendar size={15} aria-hidden="true" />
                                Erstellt am {formatDate(job.created_at)}
                            </p>
                        </div>

                        <Link
                            href={`/app-home/offers/edit/${job.id}`}
                            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-5 text-sm font-semibold text-[var(--text-default)] outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:border-[var(--brand-border)] hover:bg-[var(--brand-soft)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] motion-reduce:transition-none motion-reduce:active:scale-100"
                        >
                            <FileText size={16} />
                            Bearbeiten
                        </Link>
                    </div>
                </header>

                <div className="p-6 md:p-8">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <FactCard icon={<Euro size={19} />} label={compensation.label} value={compensation.value} />
                        <FactCard icon={<MapPin size={19} />} label="Einsatzort" value={job.public_location_label || "Rheinbach"} />
                        <FactCard icon={<Globe2 size={19} />} label="Sichtbarkeit" value={reachLabel} />
                        <FactCard
                            icon={job.job_kind === "recurring" ? <Repeat2 size={19} /> : <Clock size={19} />}
                            label="Jobart"
                            value={jobKindLabel}
                        />
                    </div>

                    <section className="mt-8">
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-strong)]">
                            <FileText size={19} className="text-[var(--brand)]" />
                            Aufgabenbeschreibung
                        </h2>
                        <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-5 text-pretty text-sm leading-7 text-[var(--text-default)] md:p-6">
                            {job.description || "Keine Beschreibung hinterlegt."}
                        </div>
                    </section>
                </div>

                <footer className="flex flex-col gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-muted)] p-6 sm:flex-row sm:items-center sm:justify-between md:px-8">
                    <div>
                        <p className="text-sm font-semibold text-[var(--text-strong)]">Bewerbungen und Chats</p>
                        <p
                            className={cn(
                                "mt-1 text-sm",
                                applicationsResult.ok
                                    ? "text-[var(--text-muted)]"
                                    : "font-medium text-amber-800 dark:text-amber-200",
                            )}
                            role={applicationsResult.ok ? undefined : "status"}
                        >
                            {applicationSummary}
                        </p>
                    </div>
                    <Link
                        href={`/app-home/activities?jobId=${job.id}`}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-white outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-muted)] motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        Aktivitäten öffnen
                        <ArrowRight size={16} />
                    </Link>
                </footer>
            </article>
        </div>
    );
}

function FactCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                {icon}
            </div>
            <p className="text-xs font-medium text-[var(--text-soft)]">{label}</p>
            <p className="mt-1 truncate text-sm font-semibold tabular-nums text-[var(--text-strong)]" title={value}>
                {value}
            </p>
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
