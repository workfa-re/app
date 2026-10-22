"use client";

import { memo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Lock, MapPin, Repeat2 } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { JobsListItem } from "@/lib/types/platform";
import { CategoryArtwork } from "./CategoryArtwork";
import { warmJobsUI } from "@/lib/ui-warmup";
import { formatJobCompensation, formatJobDistance } from "./job-presentation";
import { getActivityStatusMeta } from "@/lib/activity/chat";
import { getActivityConversationHref } from "@/lib/activity/navigation";
import styles from "./JobCard.module.css";

interface JobCardProps {
    job: JobsListItem;
    isApplied?: boolean;
    isLocked?: boolean;
    hideStatusLabel?: boolean;
    providerStatus?: "draft" | "open" | "closed" | "reviewing" | "filled" | "reserved";
    providerStatusLabel?: string;
    isCrossRegionalBadge?: boolean;
    onSelect?: (job: JobsListItem) => void;
    href?: string;
    footer?: ReactNode;
    previewImageUrl?: string | null;
}

const providerStatusLabels = { draft: "Entwurf", open: "Aktiv", closed: "Geschlossen", reviewing: "In Prüfung", filled: "Vergeben", reserved: "Reserviert" } satisfies Record<NonNullable<JobCardProps["providerStatus"]>, string>;

export const JobCard = memo(function JobCard({ job, isApplied, isLocked, hideStatusLabel, providerStatus, providerStatusLabel, isCrossRegionalBadge, onSelect, href, footer, previewImageUrl }: JobCardProps) {
    const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
    const hasApplication = Boolean(isApplied || job.is_applied || job.application_id || job.application_status);
    const needsUnlock = Boolean(isLocked && !hasApplication);
    const applied = hasApplication;
    const isReservedJob = job.status === "reserved" && !providerStatus;
    const cardState = needsUnlock ? "locked" : applied ? "applied" : isReservedJob ? "reserved" : "open";
    const providerName = job.creator?.company_name?.trim() || job.creator?.full_name?.trim() || "Auftraggeber";
    const compensation = formatJobCompensation(job.wage_hourly, job.payment_type);
    const distance = formatJobDistance(job.distance_km);
    const regionalLabel = isCrossRegionalBadge && job.market_name && !applied && !isReservedJob ? "Aus " + job.market_name : null;
    const hasPublishedAt = Number.isFinite(new Date(job.created_at).getTime());
    const statusLabel = applied ? job.application_status === "waitlisted" ? "Nicht mehr aktiv" : getActivityStatusMeta(job.application_status || "submitted").label : isReservedJob ? "Reserviert" : needsUnlock ? "Verifizierung erforderlich" : !hideStatusLabel && providerStatus ? providerStatusLabel || providerStatusLabels[providerStatus] : null;
    const workspaceHref = !providerStatus && hasApplication && job.application_id
        ? getActivityConversationHref(job.application_id)
        : null;
    const targetHref = workspaceHref || href;
    const interactive = Boolean(targetHref || onSelect);
    const warmDetail = () => { if (!targetHref) void warmJobsUI(); };
    const handleSelect = () => { if (!targetHref) { warmDetail(); onSelect?.(job); } };

    return (
        <article data-card-state={cardState} data-interactive={interactive} onMouseEnter={warmDetail} onFocus={warmDetail} onPointerDown={warmDetail} className={styles.card}>
            {targetHref ? <Link href={targetHref} prefetch={false} aria-label={job.title + (workspaceHref ? " in Meine Jobs öffnen" : " ansehen")} className={styles.openTarget} />
                : onSelect ? <button type="button" aria-label={job.title + " ansehen"} onClick={handleSelect} className={styles.openTarget} /> : null}
            <div className={styles.content}>
                <CategoryArtwork categoryId={job.category} previewImageUrl={previewImageUrl} className={styles.artwork} />
                <div className={styles.main}>
                    {(job.job_kind === "recurring" || providerStatus && statusLabel) && <div className={styles.topline}>
                        {job.job_kind === "recurring" && <span className={styles.kind}><Repeat2 size={13} strokeWidth={1.6} aria-hidden="true" /> Regelmäßig</span>}
                        {providerStatus && statusLabel && <span className={styles.category}>{statusLabel}</span>}
                    </div>}
                    <h3 className={styles.title}>{job.title}</h3>
                    {job.description && <p className={styles.description}>{job.description}</p>}
                </div>
                <div className={styles.facts}>
                    <p className={styles.compensation}><span className={compensation.amount ? styles.amount : styles.agreed}>{compensation.amount || "Vergütung offen"}</span>{compensation.amount && <span className={styles.unit}>{compensation.unit}</span>}</p>
                    <div className={styles.location}>
                        {providerStatus ? <span className={styles.locationPrimary}><MapPin size={13} aria-hidden="true" /><span>{job.public_location_label || job.market_name || "Ort nicht angegeben"}</span></span>
                            : distance ? <span className={styles.locationPrimary}><MapPin size={13} aria-hidden="true" /><span>{distance} km entfernt</span></span>
                                : <Link href="/app-home/profile?focus=location" className={styles.locationLink} title="Wohnort hinzufügen für exakte Entfernungsangaben"><MapPin size={13} aria-hidden="true" />Wohnort angeben</Link>}
                        {regionalLabel && <span className={styles.region}>{regionalLabel}</span>}
                    </div>
                </div>
                <div className={styles.footer}>
                    {footer || <>
                        <div className={styles.provider}>
                            <span className={styles.avatar} aria-hidden="true">{job.creator?.avatar_url && failedAvatar !== job.creator.avatar_url ? <img src={job.creator.avatar_url} alt="" loading="lazy" decoding="async" onError={() => setFailedAvatar(job.creator?.avatar_url ?? null)} /> : providerName.charAt(0).toUpperCase()}</span>
                            <div className={styles.providerCopy}><span className={styles.providerName} title={providerName}>{providerName}</span>{hasPublishedAt && <time className={styles.timestamp} dateTime={job.created_at}>{timeAgo(job.created_at)}</time>}</div>
                        </div>
                        {statusLabel && <span className={styles.status}>{needsUnlock ? <Lock size={12} aria-hidden="true" /> : applied ? <Check size={13} aria-hidden="true" /> : null}{statusLabel}</span>}
                    </>}
                </div>
            </div>
        </article>
    );
});
