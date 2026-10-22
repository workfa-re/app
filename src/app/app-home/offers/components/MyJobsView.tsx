"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { JobCard } from "@/components/jobs/JobCard";
import cardStyles from "@/components/jobs/JobCard.module.css";
import { GlassTabs } from "@/components/ui/GlassTabs";
import {
    ArrowRight,
    BriefcaseBusiness,
    Edit3,
    FileText,
    MessageSquare,
    Plus,
    ShieldCheck,
} from "lucide-react";
import type { JobsListItem } from "@/lib/types/platform";
import { timeAgo } from "@/lib/utils";
import {
    getProviderJobPrimaryAction,
    getProviderConversationLabel,
    getProviderJobStatusMeta,
    type ProviderJobApplicationSummary,
} from "../presentation";

type ProviderTab = "active" | "archive";

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
    const tabId = useId();
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
            <div className="jobs-home-toolbar">
                <GlassTabs<ProviderTab> id={tabId} label="Joblisten" value={activeTab} onChange={setActiveTab}
                    items={[
                        { value: "active", label: "Aktiv", count: activeJobs.length },
                        { value: "archive", label: "Archiv", count: archivedJobs.length },
                    ]} />
                <Link href="/app-home/offers/new" className="app-primary-action app-glass-control" prefetch={false}>
                    <Plus size={17} aria-hidden="true" /> Neuer Job
                </Link>
            </div>

            {!applicationSummaries ? (
                <div className="rounded-2xl border border-amber-600/20 bg-amber-500/10 px-5 py-4 text-sm font-medium text-amber-800 dark:text-amber-200" role="status">
                    Gespräche konnten gerade nicht geladen werden. Deine Jobdaten bleiben sichtbar.
                </div>
            ) : null}

            <div id={`${tabId}-${activeTab}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeTab}-tab`} tabIndex={0}>
            {visibleJobs.length === 0 ? (
                <EmptyListState tab={activeTab} />
            ) : (
                <div className={cardStyles.list}>
                    {visibleJobs.map((job) => (
                        <ProviderJobCard
                            key={job.id}
                            job={job}
                            marketName={marketName}
                            summary={applicationSummaries?.[job.id]}
                        />
                    ))}
                </div>
            )}
            </div>
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
                    <VerificationBenefit>Details im Gespräch klären</VerificationBenefit>
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
}: {
    job: JobsListItem;
    marketName: string;
    summary?: ProviderJobApplicationSummary;
}) {
    const primaryAction = getProviderJobPrimaryAction(job.status, job.id, summary?.conversationId);
    const PrimaryIcon = primaryAction.kind === "edit" ? Edit3 : primaryAction.kind === "conversation" ? MessageSquare : ArrowRight;
    const reachLabel = job.reach === "extended" ? "Überregional" : "Lokal in " + marketName;
    const publishedAt = Number.isFinite(new Date(job.created_at).getTime());

    return <JobCard job={job} providerStatus={job.status} providerStatusLabel={summary ? getProviderConversationLabel(summary.status) : getProviderJobStatusMeta(job.status).label} href={primaryAction.href} footer={
        <div className={cardStyles.providerFooter}>
            <div className={cardStyles.providerSummary}>
                <span>{reachLabel}</span>
                {publishedAt && <time dateTime={job.created_at}>{timeAgo(job.created_at)}</time>}
            </div>
            <div className={cardStyles.providerActions}>
                <Link href={primaryAction.href}>{primaryAction.label}<PrimaryIcon size={14} aria-hidden="true" /></Link>
            </div>
        </div>
    } />;
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
