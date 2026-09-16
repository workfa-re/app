"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
    ArrowRight,
    BriefcaseBusiness,
    Clock,
    Edit3,
    Euro,
    FileText,
    Globe2,
    MapPin,
    MessageSquare,
    Plus,
    Repeat2,
    ShieldCheck,
} from "lucide-react";
import type { JobsListItem } from "@/lib/types/platform";
import { cn, timeAgo } from "@/lib/utils";
import { JOB_CATEGORIES } from "@/lib/constants/jobCategories";
import {
    formatProviderCompensation,
    getProviderJobPrimaryAction,
    getProviderJobStatusMeta,
    type ProviderJobStatusMeta,
    type ProviderJobStatusTone,
} from "../presentation";

export type ProviderJobApplicationSummary = {
    total: number;
    attention: number;
    submitted: number;
    latestAt: string | null;
};

type ProviderTab = "active" | "archive";

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

export function MyJobsView({
    jobs,
    marketName,
    isVerified,
    applicationSummaries,
}: {
    jobs: JobsListItem[];
    marketName: string;
    isVerified: boolean;
    applicationSummaries: Record<string, ProviderJobApplicationSummary> | null;
}) {
    const [activeTab, setActiveTab] = useState<ProviderTab>("active");
    const activeJobs = useMemo(() => jobs.filter((job) => job.status !== "closed"), [jobs]);
    const archivedJobs = useMemo(() => jobs.filter((job) => job.status === "closed"), [jobs]);
    const visibleJobs = activeTab === "active" ? activeJobs : archivedJobs;

    if (!isVerified) {
        return <VerificationGate />;
    }

    if (jobs.length === 0) {
        return <FirstJobState marketName={marketName} />;
    }

    return (
        <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                    className="flex w-fit rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-1 text-sm font-semibold"
                    aria-label="Joblisten"
                >
                    <TabButton active={activeTab === "active"} onClick={() => setActiveTab("active")}>
                        Aktiv <span className="tabular-nums">{activeJobs.length}</span>
                    </TabButton>
                    <TabButton active={activeTab === "archive"} onClick={() => setActiveTab("archive")}>
                        Archiv <span className="tabular-nums">{archivedJobs.length}</span>
                    </TabButton>
                </div>

                <Link
                    href="/app-home/offers/new"
                    className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-white outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                    <Plus size={16} />
                    Neuer Job
                </Link>
            </div>

            {!applicationSummaries ? (
                <div className="rounded-2xl border border-amber-600/20 bg-amber-500/10 px-5 py-4 text-sm font-medium text-amber-800 dark:text-amber-200" role="status">
                    Bewerbungen konnten gerade nicht geladen werden. Deine Jobdaten bleiben sichtbar.
                </div>
            ) : null}

            {visibleJobs.length === 0 ? (
                <EmptyListState tab={activeTab} />
            ) : (
                <div className={cn("grid gap-5", visibleJobs.length > 1 && "xl:grid-cols-2")}>
                    {visibleJobs.map((job) => (
                        <ProviderJobCard
                            key={job.id}
                            job={job}
                            marketName={marketName}
                            summary={applicationSummaries?.[job.id]}
                            hasApplicationData={Boolean(applicationSummaries)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function VerificationGate() {
    return (
        <section className="grid overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-[var(--shadow-card)] lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col justify-center p-7 md:p-10">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] text-[var(--brand)]">
                    <ShieldCheck size={23} />
                </div>
                <h2 className="max-w-xl text-balance text-3xl font-semibold leading-tight tracking-tight text-[var(--text-strong)] md:text-4xl">
                    Verifizierung erforderlich
                </h2>
                <p className="mt-4 max-w-xl text-pretty text-base leading-7 text-[var(--text-muted)]">
                    Bestätige einmalig deine Anbieterangaben. Danach kannst du Jobs veröffentlichen und Bewerbungen erhalten.
                </p>
                <Link
                    href="/app-home/profile?focus=provider-verification&from=provider-home"
                    className="mt-7 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-white outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                    Zur Verifizierung
                    <ArrowRight size={16} />
                </Link>
            </div>

            <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-muted)] p-7 lg:border-l lg:border-t-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)]">Danach verfügbar</p>
                <ul className="mt-5 space-y-4 text-sm text-[var(--text-default)]">
                    <VerificationBenefit>Jobs sicher veröffentlichen</VerificationBenefit>
                    <VerificationBenefit>Bewerbungen zentral verwalten</VerificationBenefit>
                    <VerificationBenefit>Direkt mit Interessierten schreiben</VerificationBenefit>
                </ul>
            </div>
        </section>
    );
}

function VerificationBenefit({ children }: { children: ReactNode }) {
    return (
        <li className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                <ShieldCheck size={14} />
            </span>
            <span>{children}</span>
        </li>
    );
}

function FirstJobState({ marketName }: { marketName: string }) {
    return (
        <section className="grid overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-[var(--shadow-card)] lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="p-7 md:p-10">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] text-[var(--brand)]">
                    <BriefcaseBusiness size={23} />
                </div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight text-[var(--text-strong)] md:text-4xl">
                    Erstelle dein erstes Angebot
                </h2>
                <p className="mt-4 max-w-xl text-pretty text-base leading-7 text-[var(--text-muted)]">
                    Beschreibe die Aufgabe und entscheide, ob sie lokal in {marketName} oder überregional sichtbar sein soll.
                </p>
                <Link
                    href="/app-home/offers/new"
                    className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-white outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                    <Plus size={16} />
                    Job erstellen
                </Link>
            </div>

            <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-muted)] p-7 lg:border-l lg:border-t-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)]">In drei Schritten</p>
                <ol className="mt-5 space-y-4 text-sm text-[var(--text-default)]">
                    <Step number="1">Aufgabe beschreiben</Step>
                    <Step number="2">Vergütung festlegen</Step>
                    <Step number="3">Sichtbarkeit wählen</Step>
                </ol>
            </div>
        </section>
    );
}

function Step({ number, children }: { number: string; children: ReactNode }) {
    return (
        <li className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--brand-border)] bg-[var(--brand-soft)] text-xs font-semibold tabular-nums text-[var(--brand)]">
                {number}
            </span>
            <span>{children}</span>
        </li>
    );
}

function ProviderJobCard({
    job,
    marketName,
    summary,
    hasApplicationData,
}: {
    job: JobsListItem;
    marketName: string;
    summary?: ProviderJobApplicationSummary;
    hasApplicationData: boolean;
}) {
    const status = getProviderJobStatusMeta(job.status);
    const category = JOB_CATEGORIES.find((item) => item.id === job.category);
    const CategoryIcon = category?.icon;
    const hasApplications = Boolean(summary?.total);
    const hasAttention = Boolean(summary?.attention);
    const primaryAction = getProviderJobPrimaryAction(job.status, job.id);
    const PrimaryIcon = primaryAction.kind === "edit" ? Edit3 : ArrowRight;
    const reachLabel = job.reach === "extended" ? "Überregional" : `Lokal in ${marketName}`;
    const ReachIcon = job.reach === "extended" ? Globe2 : MapPin;
    const applicationLabel = getApplicationLabel(summary, hasApplicationData);
    const compensation = formatProviderCompensation(job.wage_hourly, job.payment_type);

    return (
        <article className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-200 ease-out hover:border-[var(--brand-border)] sm:p-6">
            <div className="flex min-h-[220px] flex-col gap-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <StatusPill status={status} />
                            {category ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                                    {CategoryIcon ? <CategoryIcon size={13} /> : null}
                                    {category.label}
                                </span>
                            ) : null}
                        </div>
                        <h3 className="text-balance text-2xl font-semibold leading-tight tracking-tight text-[var(--text-strong)]">
                            {job.title}
                        </h3>
                        {job.description ? (
                            <p className="mt-3 line-clamp-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--text-muted)]">
                                {job.description}
                            </p>
                        ) : null}
                    </div>

                    <div
                        className={cn(
                            "flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
                            hasAttention
                                ? "border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand)]"
                                : "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-[var(--text-muted)]",
                        )}
                    >
                        <MessageSquare size={13} />
                        <span className="tabular-nums">{applicationLabel}</span>
                    </div>
                </div>

                <div className="mt-auto flex flex-col gap-4 border-t border-[var(--border-subtle)] pt-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
                        <InlineFact icon={<Euro size={15} />} value={compensation.value} strong />
                        <InlineFact icon={<ReachIcon size={15} />} value={reachLabel} />
                        {job.job_kind === "recurring" ? (
                            <InlineFact icon={<Repeat2 size={15} />} value="Wiederkehrend" />
                        ) : null}
                        <InlineFact icon={<Clock size={15} />} value={timeAgo(job.created_at)} />
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Link
                            href={primaryAction.href}
                            className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-white outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] motion-reduce:transition-none motion-reduce:active:scale-100"
                        >
                            {primaryAction.label}
                            <PrimaryIcon size={15} />
                        </Link>

                        {hasApplications ? (
                            <Link
                                href={`/app-home/activities?jobId=${job.id}`}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-5 text-sm font-semibold text-[var(--text-default)] outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:border-[var(--brand-border)] hover:bg-[var(--brand-soft)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] motion-reduce:transition-none motion-reduce:active:scale-100"
                            >
                                Bewerbungen
                                {summary?.submitted ? (
                                    <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                                        {summary.submitted}
                                    </span>
                                ) : (
                                    <ArrowRight size={15} />
                                )}
                            </Link>
                        ) : null}
                    </div>
                </div>
            </div>
        </article>
    );
}

function InlineFact({ icon, value, strong = false }: { icon: ReactNode; value: string; strong?: boolean }) {
    return (
        <div className="flex min-w-0 items-center gap-2 text-[var(--text-soft)]">
            {icon}
            <span className={cn("truncate tabular-nums", strong ? "font-semibold text-[var(--text-strong)]" : "font-medium text-[var(--text-muted)]")}>
                {value}
            </span>
        </div>
    );
}

function getApplicationLabel(summary: ProviderJobApplicationSummary | undefined, hasData: boolean) {
    if (!hasData) return "Nicht geladen";
    if (!summary || summary.total === 0) return "Keine Bewerbungen";
    if (summary.submitted > 0) return `${summary.submitted} neu`;
    return summary.total === 1 ? "1 Bewerbung" : `${summary.total} Bewerbungen`;
}

function StatusPill({ status }: { status: ProviderJobStatusMeta }) {
    return (
        <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", STATUS_TONE_CLASSES[status.tone])}>
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT_CLASSES[status.tone])} aria-hidden="true" />
            {status.label}
        </span>
    );
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "flex min-h-11 min-w-[5rem] items-center justify-center gap-1.5 rounded-full px-3 outline-none transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100 sm:min-w-24 sm:gap-2 sm:px-4",
                active
                    ? "bg-[var(--surface-solid)] text-[var(--text-strong)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-strong)]",
            )}
        >
            {children}
        </button>
    );
}

function EmptyListState({ tab }: { tab: ProviderTab }) {
    return (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-6 py-14 text-center shadow-[var(--shadow-card)]">
            <FileText size={28} className="mx-auto mb-4 text-[var(--text-soft)]" />
            <h3 className="text-lg font-semibold text-[var(--text-strong)]">
                {tab === "active" ? "Keine aktiven Jobs" : "Noch kein Archiv"}
            </h3>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--text-muted)]">
                {tab === "active" ? "Neue Jobs erstellst du oben rechts." : "Abgeschlossene Jobs erscheinen hier automatisch."}
            </p>
        </div>
    );
}
