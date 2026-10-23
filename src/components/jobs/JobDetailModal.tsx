"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, Transition } from "@headlessui/react";
import dynamic from "next/dynamic";
import { ArrowRight, CalendarDays, Coins, Lock, MapPin, Repeat2, ShieldCheck, X } from "lucide-react";
import { VerificationRequiredModal } from "@/components/auth/VerificationRequiredModal";
import { UserProfileModal, type VisibleProfile } from "@/components/profile/UserProfileModal";
import { JobApplicationModal } from "@/components/jobs/JobApplicationModal";
import type { JobsListItem } from "@/lib/types/platform";
import type { GuardianStatus } from "@/lib/types";
import { CategoryArtwork } from "./CategoryArtwork";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import { formatJobCompensation, formatJobDistance } from "./job-presentation";
import styles from "./JobDetail.module.css";
import { getActivityStatusMeta } from "@/lib/activity/chat";
import { getActivityConversationHref } from "@/lib/activity/navigation";

const JobLocationMap = dynamic(() => import("@/components/jobs/JobLocationMap"), {
    ssr: false,
    loading: () => <div className="workfare-map-loading flex h-full items-center justify-center" role="status">Karte wird geladen …</div>,
});

interface JobDetailModalProps {
    job: JobsListItem | null;
    isOpen: boolean;
    onClose: () => void;
    onClosed?: () => void;
    canApply: boolean;
    availableForApplication?: boolean;
    guardianStatus: string;
    previewImageUrl?: string | null;
}

export function JobDetailModal({ job, isOpen, onClose, onClosed, canApply, availableForApplication = true, guardianStatus, previewImageUrl }: JobDetailModalProps) {
    const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
    const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<VisibleProfile | null>(null);
    const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
    const hasApplication = Boolean(job?.is_applied || job?.application_id || job?.application_status);
    const isAvailable = Boolean(job?.status === "open" && availableForApplication && !hasApplication);

    useEffect(() => {
        if (!isAvailable || !isOpen) setIsApplicationModalOpen(false);
    }, [isAvailable, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const frame = requestAnimationFrame(() => endPerfMark("job-detail-open"));
        return () => cancelAnimationFrame(frame);
    }, [isOpen]);

    if (!job) return null;
    const compensation = formatJobCompensation(job.wage_hourly, job.payment_type);
    const distance = formatJobDistance(job.distance_km);
    const isActiveApplication = ["submitted", "negotiating", "accepted"].includes(job.application_status || "");
    const recurring = job.job_kind === "recurring";
    const recurrenceLabel = job.recurrence_rule === "weekly" ? "Wöchentlich" : job.recurrence_rule === "biweekly" ? "Alle zwei Wochen" : job.recurrence_rule === "monthly" ? "Monatlich" : "Regelmäßig nach Absprache";
    const hasCoordinates = job.public_lat != null && job.public_lng != null && Number.isFinite(job.public_lat) && Number.isFinite(job.public_lng) && Math.abs(job.public_lat) <= 90 && Math.abs(job.public_lng) <= 180;
    const locationLabel = job.public_location_label === "Privatadresse"
        ? job.market_name || "Ungefähre Umgebung"
        : job.public_location_label || job.market_name || "Ort wird im Gespräch geklärt";
    const providerName = job.creator?.company_name?.trim() || job.creator?.full_name?.trim() || "Auftraggeber";
    const conversationHref = getActivityConversationHref(job.application_id);
    const applicationLabel = job.application_status === "waitlisted" ? "Bewerbung nicht mehr aktiv" : getActivityStatusMeta(job.application_status || "submitted").label;
    const handleProfileClick = () => {
        if (!job.posted_by || !job.creator) return;
        setSelectedProfile({ id: job.creator.id || job.posted_by, full_name: job.creator.full_name, company_name: job.creator.company_name, account_type: job.creator.account_type, avatar_url: job.creator.avatar_url, bio: job.creator.bio ?? null, city: job.creator.city ?? null, country: job.creator.country ?? null, created_at: job.creator.created_at ?? null, provider_verification_status: job.creator.provider_verification_status as VisibleProfile["provider_verification_status"], is_staff: job.creator.is_staff });
        setIsProfileModalOpen(true);
    };

    return <>
        <Transition appear show={isOpen} as={Fragment} afterLeave={onClosed}>
            <Dialog as="div" className={styles.root + " app-portal-surface relative z-50"} onClose={onClose}>
                <div className={styles.backdrop} />
                <div className={styles.viewport}>
                    <Transition.Child as={Fragment} enter="transition-[opacity,transform] duration-220 motion-reduce:transition-none" enterFrom="opacity-0 translate-y-2 motion-reduce:translate-y-0" enterTo="opacity-100 translate-y-0" leave="transition-[opacity,transform] duration-150 motion-reduce:transition-none" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1 motion-reduce:translate-y-0">
                        <Dialog.Panel className={styles.sheet}>
                            <button type="button" className={styles.close} onClick={onClose} aria-label="Jobdetails schließen"><X size={21} aria-hidden="true" /></button>
                            <div className={styles.scroll}>
                                <header className={styles.detailHeader}>
                                    <CategoryArtwork categoryId={job.category} previewImageUrl={previewImageUrl} className={styles.detailArtwork} />
                                    <div className={styles.detailHeading}>
                                        <Dialog.Title as="h2" className={styles.title}>{job.title}</Dialog.Title>
                                    </div>
                                    <p className={styles.detailCompensation} data-missing={!compensation.amount || undefined}><span className={styles.amount}>{compensation.amount || "Vergütung offen"}</span>{compensation.amount && <span className={styles.unit}>{compensation.unit}</span>}</p>
                                </header>
                                <div className={styles.detailGrid}>
                                    <div className={styles.taskColumn}>
                                        <section className={styles.task} aria-labelledby="job-detail-task-title">
                                            <h3 id="job-detail-task-title">Die Aufgabe</h3>
                                            <p className={styles.description}>{job.description || "Die Details kannst du im Gespräch klären."}</p>
                                            <div className={styles.taskFacts}>
                                                <span>{recurring ? <Repeat2 size={18} aria-hidden="true" /> : <CalendarDays size={18} aria-hidden="true" />}{recurring ? recurrenceLabel : "Einmaliger Auftrag"}</span>
                                                {distance && <span><MapPin size={18} aria-hidden="true" />{distance} km entfernt</span>}
                                            </div>
                                        </section>
                                        {job.creator && <section className={styles.providerSection} aria-labelledby="job-detail-provider-title">
                                            <h3 id="job-detail-provider-title" className="sr-only">Anbieter</h3>
                                            <button type="button" className={styles.personCard} onClick={handleProfileClick} aria-label={`Profil von ${providerName} ansehen`}>
                                                <span className={styles.avatar} aria-hidden="true">{job.creator.avatar_url && failedAvatar !== job.creator.avatar_url ? <img src={job.creator.avatar_url} alt="" loading="lazy" decoding="async" onError={() => setFailedAvatar(job.creator?.avatar_url ?? null)} /> : providerName.charAt(0).toUpperCase()}</span>
                                                <span className={styles.providerCopy}>
                                                    <span className={styles.providerName}>{providerName}</span>
                                                    <small>{job.creator.is_staff ? <><ShieldCheck size={12} aria-hidden="true" /> Workfare Team</> : job.creator.provider_verification_status === "verified" ? <><ShieldCheck size={12} aria-hidden="true" /> Verifiziert{job.creator.city ? ` · ${job.creator.city}` : ""}</> : job.creator.city || "Auftraggeber"}</small>
                                                    {job.creator.bio?.trim() && <span className={styles.providerBio}>{job.creator.bio}</span>}
                                                </span>
                                                <ArrowRight size={18} className={styles.personArrow} aria-hidden="true" />
                                            </button>
                                        </section>}
                                    </div>
                                    <aside className={styles.locationPanel} aria-label="Ungefähre Lage des Jobs">
                                        {hasCoordinates ? <>
                                            <JobLocationMap latitude={job.public_lat!} longitude={job.public_lng!} />
                                            <div className={styles.locationCaption}><MapPin size={20} aria-hidden="true" /><div><strong>{locationLabel}</strong><span>Ungefähre Lage</span></div></div>
                                        </> : <div className={styles.locationEmpty}><MapPin size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{locationLabel}</strong><p>Den Treffpunkt klärt ihr direkt im Gespräch.</p></div>}
                                    </aside>
                                </div>
                            </div>
                            <footer className={styles.footer}>
                                {hasApplication ? <>
                                    <div className={styles.footerCopy}><strong>{applicationLabel}</strong>
                                        <p>{isActiveApplication ? "Gespräch, Termin und nächste Schritte findest du unter „Meine Jobs“." : "Den bisherigen Verlauf findest du im Archiv unter „Meine Jobs“."}</p>
                                    </div>
                                    <Link href={conversationHref} className={styles.action} prefetch={false}>{isActiveApplication ? "Gespräch öffnen" : "Verlauf ansehen"}<ArrowRight size={18} aria-hidden="true" /></Link>
                                </> : isAvailable ? <>
                                    <div className={styles.paymentSummary}><span className={styles.paymentIcon}><Coins size={21} strokeWidth={1.5} aria-hidden="true" /></span><div className={styles.footerCopy}><strong>Für dich reserviert, sobald du dich bewirbst</strong><p>Danach klärst du die Details direkt mit dem Anbieter.</p></div></div>
                                    <button type="button" className={styles.action} onClick={() => { if (!canApply) setIsVerificationModalOpen(true); else { startPerfMark("job-apply-open"); setIsApplicationModalOpen(true); } }}>{!canApply ? <><Lock size={17} aria-hidden="true" />Freischalten</> : <>Jetzt bewerben<ArrowRight size={18} aria-hidden="true" /></>}</button>
                                </> : <>
                                    <div className={styles.footerCopy}><strong>{job.status === "reserved" ? "Dieser Job ist bereits reserviert" : "Dieser Job ist nicht mehr verfügbar"}</strong><p>Du kannst dich auf ein anderes freies Angebot bewerben.</p></div>
                                    <Link href="/app-home/jobs" onClick={onClose} className={styles.action} prefetch={false}>Freie Jobs ansehen<ArrowRight size={18} aria-hidden="true" /></Link>
                                </>}
                            </footer>
                        </Dialog.Panel>
                    </Transition.Child>
                </div>
            </Dialog>
        </Transition>
        <JobApplicationModal isOpen={isApplicationModalOpen && isAvailable} onClose={() => setIsApplicationModalOpen(false)} jobTitle={job.title} jobId={job.id} canApply={canApply} guardianStatus={guardianStatus} />
        <VerificationRequiredModal isOpen={isVerificationModalOpen} onClose={() => setIsVerificationModalOpen(false)} guardianStatus={guardianStatus as GuardianStatus} />
        <UserProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} profile={selectedProfile} isStaff={Boolean(job.creator?.is_staff)} presentation="sheet" />
    </>;
}
