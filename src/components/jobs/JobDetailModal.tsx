"use client";

import { Fragment, useState, useEffect } from "react";
import Link from "next/link";
import { Dialog, Transition } from "@headlessui/react";
import { X, MapPin, Euro, ShieldCheck, Clock, Briefcase, ArrowRight, CheckCircle2, Repeat2 } from "lucide-react";
import type { Database } from "@/lib/types/supabase";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { VerificationRequiredModal } from "@/components/auth/VerificationRequiredModal";
import { Lock } from "lucide-react";
import { WithdrawButton } from "@/components/jobs/WithdrawButton";
import dynamic from "next/dynamic";
import { JobsListItem } from "@/lib/types/platform";
import { JOB_CATEGORIES } from "@/lib/constants/jobCategories";
import { UserProfileModal, type VisibleProfile } from "@/components/profile/UserProfileModal";
import { JobApplicationModal } from "@/components/jobs/JobApplicationModal";
import { StaffBadge } from "@/components/ui/StaffBadge";
import { cn } from "@/lib/utils";
import type { GuardianStatus } from "@/lib/types";
import { endPerfMark, startPerfMark } from "@/lib/perf";

const LeafletMap = dynamic(() => import("@/components/ui/LeafletMap"), {
    ssr: false,
    loading: () => (
        <div className="workfare-map-loading flex h-full w-full animate-pulse items-center justify-center">
            <MapPin size={24} />
        </div>
    ),
});


interface JobDetailModalProps {
    job: JobsListItem | null;
    isOpen: boolean;
    onClose: () => void;
    onClosed?: () => void;
    canApply: boolean;
    guardianStatus: string;
    context?: 'feed' | 'activity';
}
export function JobDetailModal({ job, isOpen, onClose, onClosed, canApply, guardianStatus, context = 'feed' }: JobDetailModalProps) {
    const isUserWaitlisted = job?.application_status === "waitlisted";
    const isAppliedConversation = Boolean(job?.is_applied && job.application_status && !isUserWaitlisted);
    const isWaitlistMode = job?.status === 'reserved' && !isAppliedConversation;
    const waitlistCount = Math.max(0, job?.waitlist_count ?? 0);
    const ownWaitlistPosition = job?.my_waitlist_position && job.my_waitlist_position > 0
        ? job.my_waitlist_position
        : null;
    const recurrenceLabel = job?.recurrence_rule === "weekly"
        ? "Wöchentlich"
        : job?.recurrence_rule === "biweekly"
            ? "Alle zwei Wochen"
            : job?.recurrence_rule === "monthly"
                ? "Monatlich"
                : "Nach Absprache";
    // ... component implementation ...
    const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
    const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

    // Profile Preview State
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<VisibleProfile | null>(null);
    const isSelectedProfileStaff = Boolean(job?.creator?.is_staff);

    const handleProfileClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!job?.posted_by || !job.creator) return;

        setSelectedProfile({
            id: job.creator.id || job.posted_by,
            full_name: job.creator.full_name,
            company_name: job.creator.company_name,
            account_type: job.creator.account_type,
            avatar_url: job.creator.avatar_url,
            bio: job.creator.bio ?? null,
            city: job.creator.city ?? null,
            country: job.creator.country ?? null,
            created_at: job.creator.created_at ?? null,
            provider_verification_status: job.creator.provider_verification_status as VisibleProfile["provider_verification_status"],
            is_staff: job.creator.is_staff,
        });
        setIsProfileModalOpen(true);
    };

    // Failsafe: Ensure overflow is cleaned up if Headless UI gets stuck
    //... (existing effects)

    // Delayed Unmount for Map to prevent "Close Freeze"
    const [shouldRenderMap, setShouldRenderMap] = useState(false);
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        if (isOpen) {
            setShouldRenderMap(true);
            const frameId = requestAnimationFrame(() => {
                endPerfMark("job-detail-open");
            });
            return () => cancelAnimationFrame(frameId);
        } else {
            // Wait for close animation + user scroll start before destroying map (500ms)
            timeout = setTimeout(() => {
                setShouldRenderMap(false);
            }, 500);
        }
        return () => clearTimeout(timeout);
    }, [isOpen]);

    // If no job is selected and we are not open, don't render.
    if (!job) return null;

    return (
        <>
            <Transition appear show={isOpen} as={Fragment} afterLeave={onClosed}>
                <Dialog as="div" className="relative z-50" onClose={onClose}>
                    {/* ... existing dialog content ... */}
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-300"
                        enterFrom="opacity-0"
                        enterTo="opacity-100"
                        leave="ease-in duration-200"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <div className="job-detail-backdrop fixed inset-0 bg-black/90 backdrop-blur-sm" />
                    </Transition.Child>

                    <div className="fixed inset-0 overflow-y-auto">
                        <div className="flex min-h-full items-center justify-center p-4 text-center">
                            <Transition.Child
                                as={Fragment}
                                enter="ease-out duration-300"
                                enterFrom="opacity-0 scale-95 translate-y-4"
                                enterTo="opacity-100 scale-100 translate-y-0"
                                leave="ease-in duration-200"
                                leaveFrom="opacity-100 scale-100 translate-y-0"
                                leaveTo="opacity-0 scale-95 translate-y-4"
                            >
                                <Dialog.Panel className="job-detail-modal w-full max-w-3xl transform overflow-hidden rounded-3xl border text-left align-middle shadow-2xl transition-all">
                                    {/* Detailed Header with Background Pattern */}
                                    <div className="job-detail-hero relative overflow-hidden border-b px-8 py-10">
                                        <div className="absolute top-0 right-0 p-6 z-20">
                                            <button
                                                type="button"
                                                className="job-detail-close rounded-full p-2 transition-colors backdrop-blur-md"
                                                onClick={onClose}
                                                aria-label="Jobdetails schließen"
                                            >
                                                <X className="h-6 w-6" />
                                            </button>
                                        </div>

                                        {/* Background Decoration */}
                                        <div className="job-detail-grid absolute inset-0 bg-[url('/grid.svg')]" />
                                        <div className="relative z-10 flex flex-col gap-6">
                                            <div className="flex gap-3">
                                                {job.is_applied && !isUserWaitlisted && (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                                                        <CheckCircle2 size={12} /> Bereits beworben
                                                    </span>
                                                )}
                                                {isUserWaitlisted && (
                                                    <span className="job-detail-waitlist-badge inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                                                        <Clock size={12} />
                                                        {ownWaitlistPosition ? `Wartelistenplatz ${ownWaitlistPosition}` : "Warteliste"}
                                                    </span>
                                                )}
                                                {(() => {
                                                    const categoryData = job.category ? JOB_CATEGORIES.find(c => c.id === job.category) : undefined;
                                                    const CategoryIcon = categoryData?.icon;
                                                    const categoryLabel = categoryData?.label || job.category;
                                                    const categoryTone = isWaitlistMode
                                                        ? "bg-slate-500/10 text-slate-300 border border-slate-500/20"
                                                        : job.is_applied
                                                            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                                            : "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20";
                                                    const iconTone = isWaitlistMode
                                                        ? "text-indigo-400"
                                                        : job.is_applied
                                                            ? "text-emerald-400"
                                                            : "text-indigo-400";
                                                    return job.category ? (
                                                        <span className={cn(
                                                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide transition-all duration-300",
                                                            categoryTone
                                                        )}>
                                                            {CategoryIcon && <CategoryIcon size={14} className={cn(iconTone)} />}
                                                            {categoryLabel}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>

                                            <Dialog.Title as="h3" className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
                                                {job.title}
                                            </Dialog.Title>

                                            {isWaitlistMode && (
                                                <div className="job-detail-waitlist-callout mt-6 mb-2 rounded-xl border p-4 flex gap-3">
                                                    <div className="mt-0.5 shrink-0">
                                                        {isUserWaitlisted ? (
                                                            <CheckCircle2 size={20} className="job-detail-waitlist-icon" />
                                                        ) : (
                                                            <Clock size={20} className="job-detail-waitlist-icon" />
                                                        )}
                                                    </div>
                                                    <div className="job-detail-waitlist-copy text-sm leading-relaxed">
                                                        <strong className="job-detail-waitlist-title block mb-1">
                                                            {isUserWaitlisted
                                                                ? ownWaitlistPosition
                                                                    ? `Dein Wartelistenplatz: ${ownWaitlistPosition}${waitlistCount > 0 ? ` von ${waitlistCount}` : ""}`
                                                                    : "Du bist auf der Warteliste"
                                                                : "Gespräch läuft · Warteliste offen"}
                                                        </strong>
                                                        <p>
                                                            {isUserWaitlisted
                                                                ? "Du rückst automatisch nach, sobald das laufende Gespräch ohne Einigung endet."
                                                                : "Du kannst dich weiterhin bewerben. Deine Bewerbung wird sofort gespeichert; der Chat öffnet sich, sobald du nachrückst."}
                                                        </p>
                                                        {waitlistCount > 0 && (
                                                            <p className="job-detail-waitlist-count mt-1.5 text-xs">
                                                                {waitlistCount} {waitlistCount === 1 ? "Person wartet" : "Personen warten"} aktuell.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="job-detail-meta-row grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-3 sm:gap-6 text-slate-300 font-medium w-full sm:w-auto mt-6">
                                                <div className="job-detail-meta-item flex items-center justify-center sm:justify-start gap-2 p-3 sm:p-0 rounded-xl sm:rounded-none">
                                                    <div className="job-detail-meta-icon shrink-0">
                                                        <Euro size={18} />
                                                    </div>
                                                    <span className="job-detail-meta-value text-lg text-white">
                                                        {job.wage_hourly} € <span className="job-detail-meta-muted text-slate-500 text-sm">
                                                            {job.payment_type === 'fixed' ? 'pauschal' : '/ Std.'}
                                                        </span>
                                                    </span>
                                                </div>

                                                <div className="job-detail-meta-divider w-px h-8 hidden sm:block" />

                                                <div className="job-detail-meta-item flex items-center justify-center sm:justify-start gap-2 p-3 sm:p-0 rounded-xl sm:rounded-none">
                                                    <div className="job-detail-meta-icon shrink-0">
                                                        <MapPin size={18} />
                                                    </div>
                                                    {/* Context Check: Since we don't have direct provider checking here, if it's the provider viewing it, 
                                                    they would be in the offers context. In the youth view, we never show exact street names. */}
                                                    <span className="job-detail-meta-value truncate max-w-[120px] sm:max-w-none">
                                                        {context === 'activity' ? (job.public_location_label || job.market_name || "Privatadresse") : (job.market_name || "Ungefährer Standort")}
                                                    </span>
                                                </div>

                                                {job.job_kind === "recurring" ? (
                                                    <>
                                                        <div className="job-detail-meta-divider w-px h-8 hidden sm:block" />
                                                        <div className="job-detail-meta-item flex items-center justify-center sm:justify-start gap-2 p-3 sm:p-0 rounded-xl sm:rounded-none">
                                                            <div className="job-detail-meta-icon shrink-0">
                                                                <Repeat2 size={18} />
                                                            </div>
                                                            <span className="job-detail-meta-value">{recurrenceLabel}</span>
                                                        </div>
                                                    </>
                                                ) : null}

                                                {job.distance_km != null && context !== 'activity' && (
                                                    <>
                                                        <div className="job-detail-meta-divider w-px h-8 hidden sm:block" />
                                                        <div className="job-detail-meta-distance col-span-2 sm:col-span-1 flex items-center justify-center sm:justify-start gap-2 text-slate-300 mt-1 sm:mt-0">
                                                            <Clock size={16} />
                                                            <span className="job-detail-meta-value">{`${(Math.round(job.distance_km * 10) / 10).toFixed(1).replace('.', ',')} km entfernt`}</span>
                                                        </div>
                                                    </>
                                                )}

                                                {job.creator && (
                                                    <>
                                                        <div className="job-detail-meta-divider w-px h-8 hidden sm:block" />
                                                        <button
                                                            onClick={handleProfileClick}
                                                            className="job-detail-creator-button col-span-2 sm:col-span-1 flex items-center justify-center sm:justify-start gap-2 group p-1 rounded-lg transition-colors mt-2 sm:mt-0 text-left"
                                                        >
                                                            <div className="job-detail-creator-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ring-2 transition-all overflow-hidden">
                                                                {job.creator.avatar_url ? (
                                                                    <img src={job.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    (job.creator.company_name || job.creator.full_name || "?")[0].toUpperCase()
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col items-start">
                                                                <span className="job-detail-creator-label text-xs text-slate-500 uppercase tracking-wider font-bold">Erstellt von</span>
                                                                <span className="job-detail-creator-name text-sm text-white transition-colors">{job.creator.company_name || job.creator.full_name || "Unbekannt"}</span>
                                                            </div>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Main Content Area */}
                                    <div className="job-detail-content px-8 py-10 space-y-10">

                                        {/* Description */}
                                        <section>
                                            <h4 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                                                <Briefcase size={16} /> Aufgabe
                                            </h4>
                                            <div className="prose prose-invert prose-lg max-w-none text-slate-300 leading-relaxed whitespace-pre-line font-light">
                                                {job.description}
                                            </div>
                                        </section>

                                        <div className="h-px bg-white/5" />

                                        {/* Grid Layout for Details & Trust */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">

                                            {/* Trust Section */}
                                            <div className="space-y-4 flex flex-col">
                                                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                                    <ShieldCheck size={16} /> Sicherheit
                                                </h4>
                                                <div className="job-detail-info-card rounded-2xl border p-6 flex-1 flex flex-col justify-center">
                                                    {isSelectedProfileStaff ? (
                                                        <div className="flex flex-col items-start gap-4">
                                                            <div>
                                                                <div className="flex items-center gap-3">
                                                                    <h5 className="font-semibold text-white text-lg">Workfare Mitarbeiter</h5>
                                                                    <StaffBadge />
                                                                </div>
                                                                <p className="text-slate-400 mt-1 leading-relaxed text-sm">
                                                                    Dieser Job wurde direkt von einem offiziellen Workfare Team-Mitglied veröffentlicht.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-start gap-4">
                                                            <div className="mt-1 shrink-0 rounded-full bg-blue-500/10 p-2 text-blue-400">
                                                                <ShieldCheck size={20} />
                                                            </div>
                                                            <div>
                                                                <h5 className="text-lg font-semibold text-white">Sicher über Workfare</h5>
                                                                <p className="text-slate-400 mt-1 leading-relaxed text-sm">
                                                                    Bewerbung, Nachrichten und Vereinbarungen bleiben in der Plattform nachvollziehbar. Teile sensible Angaben erst, wenn sie für den Auftrag erforderlich sind.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Location / Map Placeholder */}
                                            <div className="space-y-4 flex flex-col">
                                                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                                    <MapPin size={16} /> Standort
                                                </h4>
                                                <div className="job-detail-map-frame rounded-2xl border p-1 flex-1 min-h-[180px] relative flex items-center justify-center overflow-hidden group">
                                                    {shouldRenderMap && (
                                                        <LeafletMap
                                                            center={[job?.public_lat ?? 50.6256, job?.public_lng ?? 6.9493]}
                                                            zoom={14}
                                                            className={`rounded-xl transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                                                        />
                                                    )}

                                                    <div className="job-detail-map-note absolute left-2 top-2 z-[400] rounded-full border backdrop-blur-md">
                                                        <span>Ungefähre Lage</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Footer */}
                                    <div className="job-detail-footer px-8 py-6 border-t flex flex-col md:flex-row items-center justify-between gap-6">
                                        {job.is_applied ? (
                                            isUserWaitlisted ? (
                                                <div className="w-full flex flex-col items-end gap-2">
                                                    <div className="job-detail-waitlist-footer-card flex w-full flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between">
                                                        <div className="min-w-0">
                                                            <p className="job-detail-waitlist-footer-title font-semibold">
                                                                Warteliste aktiv
                                                            </p>
                                                            <p className="job-detail-waitlist-footer-copy mt-1 text-sm">
                                                                {ownWaitlistPosition
                                                                    ? `Du stehst auf Platz ${ownWaitlistPosition}${waitlistCount > 0 ? ` von ${waitlistCount}` : ""} und rückst automatisch nach.`
                                                                    : "Du rückst automatisch nach, sobald der Platz wieder frei wird."}
                                                            </p>
                                                        </div>
                                                        <Link
                                                            href={job.application_id
                                                                ? `/app-home/activities?conversation=${encodeURIComponent(job.application_id)}`
                                                                : "/app-home/activities"}
                                                            prefetch
                                                            className="job-detail-secondary-action inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                                        >
                                                            Warteliste ansehen <ArrowRight size={17} aria-hidden="true" />
                                                        </Link>
                                                    </div>
                                                    {context !== 'feed' && job.application_id && (
                                                        <div className="text-right w-full">
                                                            <WithdrawButton applicationId={job.application_id} />
                                                        </div>
                                                    )}
                                                </div>
                                            ) : ['submitted', 'negotiating', 'accepted'].includes(job.application_status || '') ? (
                                                <div className="w-full flex flex-col items-end gap-2">
                                                    <Link
                                                        href={job.application_id
                                                            ? `/app-home/activities?conversation=${encodeURIComponent(job.application_id)}`
                                                            : "/app-home/activities"}
                                                        prefetch
                                                        className="job-detail-dashboard-link flex min-h-20 w-full items-center justify-between gap-4 rounded-2xl border p-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                                    >
                                                        <span className="flex min-w-0 flex-col">
                                                            <span className="job-detail-dashboard-title text-lg font-bold">Zum Gespräch</span>
                                                            <span className="job-detail-dashboard-copy text-xs">Chat, Status und Details öffnen</span>
                                                        </span>
                                                        <span className="job-detail-dashboard-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                                                            <ArrowRight size={20} aria-hidden="true" />
                                                        </span>
                                                    </Link>
                                                    {context !== 'feed' && job.application_id && (
                                                        <div className="text-right w-full">
                                                            <WithdrawButton applicationId={job.application_id} />
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="w-full px-6 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-medium flex items-center justify-center gap-2">
                                                    <Briefcase size={20} />
                                                    {job.application_status === 'withdrawn' ? "Zurückgezogen" : "Abgeschlossen"}
                                                </div>
                                            )
                                        ) : (
                                            <>
                                                <div className="text-center md:text-left">
                                                    <p className="text-sm text-slate-400">
                                                        {isWaitlistMode ? "Noch Interesse?" : "Interesse geweckt?"}
                                                    </p>
                                                    <p className="text-xs text-slate-600 mt-0.5">
                                                        Mit der Bewerbung akzeptierst du die Nutzungsbedingungen.
                                                    </p>
                                                </div>
                                                {/* Button Logic for Non-Applied Jobs */}
                                                {!canApply ? (
                                                    <ButtonPrimary
                                                        onClick={() => setIsVerificationModalOpen(true)}
                                                        className="w-full px-10 py-4 text-lg !shadow-none hover:!shadow-none hover:!scale-100 md:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border-white/10"
                                                    >
                                                        <span className="flex items-center gap-3 font-bold">
                                                            <Lock size={20} /> Freischalten
                                                        </span>
                                                    </ButtonPrimary>
                                                ) : (
                                                    <ButtonPrimary
                                                        onClick={() => {
                                                            startPerfMark("job-apply-open");
                                                            setIsApplicationModalOpen(true);
                                                        }}
                                                        className="w-full px-10 py-4 text-lg !shadow-none hover:!shadow-none hover:!scale-100 md:w-auto"
                                                    >
                                                        <span className="flex items-center gap-3 font-bold">
                                                            {isWaitlistMode ? "Auf Warteliste" : "Jetzt bewerben"} <ArrowRight size={20} />
                                                        </span>
                                                    </ButtonPrimary>
                                                )}
                                            </>
                                        )}
                                    </div>


                                </Dialog.Panel>
                            </Transition.Child>
                        </div>
                    </div>
                </Dialog>
            </Transition >

            <JobApplicationModal
                isOpen={isApplicationModalOpen}
                onClose={() => setIsApplicationModalOpen(false)}
                jobTitle={job.title}
                jobId={job.id}
                canApply={canApply}
                guardianStatus={guardianStatus}
                isWaitlistMode={isWaitlistMode}
            />

            <VerificationRequiredModal
                isOpen={isVerificationModalOpen}
                onClose={() => setIsVerificationModalOpen(false)}
                guardianStatus={guardianStatus as GuardianStatus}
            />

            <UserProfileModal
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
                profile={selectedProfile}
                isStaff={isSelectedProfileStaff}
            />
        </>
    );
}
