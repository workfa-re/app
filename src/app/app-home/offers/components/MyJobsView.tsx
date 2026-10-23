"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { JobCard } from "@/components/jobs/JobCard";
import cardStyles from "@/components/jobs/JobCard.module.css";
import styles from "./MyJobsView.module.css";
import { GlassTabs } from "@/components/ui/GlassTabs";
import {
    ArrowRight,
    BriefcaseBusiness,
    CircleAlert,
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
        <section className={styles.view}>
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
                <div className={styles.notice} role="status">
                    <CircleAlert size={18} aria-hidden="true" />
                    <p>Gespräche konnten gerade nicht geladen werden. Deine Jobdaten bleiben sichtbar.</p>
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
        <section className={styles.state}>
            <div className={styles.stateIcon} aria-hidden="true">
                <ShieldCheck size={24} />
            </div>
            <div className={styles.stateCopy}>
                <h2>Verifizierung erforderlich</h2>
                <p>
                    Bestätige einmalig deine Anbieterangaben. Danach kannst du Jobs veröffentlichen und Bewerbungen erhalten.
                </p>
                <Link
                    href="/app-home/profile?focus=provider-verification&from=provider-home"
                    className={`app-primary-action app-glass-control ${styles.stateAction}`}
                >
                    Zur Verifizierung
                    <ArrowRight size={16} aria-hidden="true" />
                </Link>
            </div>
        </section>
    );
}

function FirstJobState({ marketName }: { marketName: string }) {
    return (
        <section className={styles.state}>
            <div className={styles.stateIcon} aria-hidden="true">
                <BriefcaseBusiness size={24} />
            </div>
            <div className={styles.stateCopy}>
                <h2>Erstelle deinen ersten Job</h2>
                <p>
                    Beschreibe die Aufgabe und entscheide, ob sie lokal in {marketName} oder überregional sichtbar sein soll.
                </p>
                <Link
                    href="/app-home/offers/new"
                    className={`app-primary-action app-glass-control ${styles.stateAction}`}
                >
                    <Plus size={16} aria-hidden="true" />
                    Job erstellen
                </Link>
            </div>
        </section>
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
        <div className={`${styles.state} ${styles.empty}`}>
            <div className={styles.stateIcon} aria-hidden="true">
                <FileText size={24} />
            </div>
            <div className={styles.stateCopy}>
                <h2>{tab === "active" ? "Keine aktiven Jobs" : "Noch keine abgeschlossenen Jobs"}</h2>
                <p>
                    {tab === "active" ? "Mit „Neuer Job“ veröffentlichst du eine Aufgabe." : "Abgeschlossene Jobs bleiben hier für dich erhalten."}
                </p>
            </div>
        </div>
    );
}
