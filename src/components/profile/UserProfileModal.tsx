"use client";

import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { ArrowLeft, Building2, CalendarDays, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { Fragment, useId, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { toPublicProfile, type VisibleProfile } from "./public-profile";
import styles from "./UserProfileModal.module.css";
import { ProfileAvatar } from "./ProfileAvatar";

export type { VisibleProfile } from "./public-profile";

interface UserProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    profile: VisibleProfile | null;
    isStaff?: boolean;
    isDraft?: boolean;
    stats?: { jobsCompleted: number; rating: number };
}

export function UserProfileModal({ isOpen, onClose, profile, isStaff = false, isDraft = false }: UserProfileModalProps) {
    const sectionId = useId();
    if (!profile) return null;
    const visible = toPublicProfile(profile, isStaff);
    const isProvider = visible.role === "job_provider";
    const hasFacts = Boolean(visible.location || visible.memberSince || visible.ageYears !== null);
    const hasSections = Boolean(visible.bio || visible.skills.length || visible.interests.length);

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className={cn("app-portal-surface", styles.dialog)} onClose={onClose}>
                <TransitionChild as={Fragment}
                    enter={styles.enter} enterFrom={styles.enterFrom} enterTo={styles.enterTo}
                    leave={styles.leave} leaveFrom={styles.enterTo} leaveTo={styles.leaveTo}>
                    <DialogPanel className={styles.page} data-presentation="page">
                        <header className={styles.topbar}>
                            <span className={styles.pageLabel}>{isDraft ? "Profilvorschau · Ungespeicherter Entwurf" : "Profil"}</span>
                            <button type="button" className={styles.back} onClick={onClose} aria-label="Zurück – Profil schließen" data-autofocus>
                                <ArrowLeft size={19} strokeWidth={1.6} aria-hidden="true" />
                                <span>Zurück</span>
                            </button>
                        </header>

                        <div className={styles.content} data-has-sections={hasSections}>
                            <section className={styles.identity} aria-label="Profilübersicht">
                                <div className={styles.identityHeader}>
                                    <ProfileAvatar url={visible.avatarUrl} name={visible.displayName} className={styles.avatar} />
                                    <div className={styles.identityCopy}>
                                        <DialogTitle as="h1" className={styles.name}>{visible.displayName}</DialogTitle>
                                        {visible.personName && <p className={styles.personName}>{visible.personName}</p>}
                                        <div className={styles.badges}>
                                            <p className={styles.role}>
                                                {isProvider ? <Building2 size={17} aria-hidden="true" /> : <UserRound size={17} aria-hidden="true" />}
                                                {visible.roleLabel}
                                            </p>
                                            {visible.isStaff && <p className={styles.trust}><ShieldCheck size={16} aria-hidden="true" />Offizielles Workfare-Team</p>}
                                            {visible.isVerifiedProvider && <p className={styles.trust}><ShieldCheck size={16} aria-hidden="true" />Adresse geprüft</p>}
                                        </div>
                                    </div>
                                </div>
                                {hasFacts && <dl className={styles.identityFacts}>
                                    {visible.location && <div>
                                        <dt><MapPin size={17} strokeWidth={1.6} aria-hidden="true" /><span className={styles.srOnly}>Ort</span></dt>
                                        <dd>{visible.location}</dd>
                                    </div>}
                                    {visible.memberSince && <div>
                                        <dt><CalendarDays size={17} strokeWidth={1.6} aria-hidden="true" /><span className={styles.srOnly}>Mitglied seit</span></dt>
                                        <dd>Dabei seit {visible.memberSince}</dd>
                                    </div>}
                                    {visible.ageYears !== null && <div>
                                        <dt><UserRound size={17} strokeWidth={1.6} aria-hidden="true" /><span className={styles.srOnly}>Alter</span></dt>
                                        <dd>{visible.ageYears} Jahre</dd>
                                    </div>}
                                </dl>}
                            </section>

                            {hasSections && <div className={styles.sections}>
                                {visible.bio && <section className={styles.section} aria-labelledby={`${sectionId}-about`}>
                                    <h2 id={`${sectionId}-about`}>{isProvider ? "Über den Anbieter" : "Über mich"}</h2>
                                    <p className={styles.bio}>{visible.bio}</p>
                                </section>}
                                {(visible.skills.length > 0 || visible.interests.length > 0) && <div className={styles.tagSections}>
                                    {visible.skills.length > 0 && <ProfileTags title="Fähigkeiten" values={visible.skills} id={`${sectionId}-skills`} />}
                                    {visible.interests.length > 0 && <ProfileTags title="Interessen" values={visible.interests} id={`${sectionId}-interests`} />}
                                </div>}
                            </div>}
                        </div>
                    </DialogPanel>
                </TransitionChild>
            </Dialog>
        </Transition>
    );
}

function ProfileTags({ title, values, id }: { title: string; values: string[]; id: string }) {
    return <section className={styles.section} aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        <ul className={styles.tags}>{values.map((value) => <li key={value}>{value}</li>)}</ul>
    </section>;
}

interface UserProfileCardProps {
    profile: VisibleProfile | null | undefined;
    onClick?: (event?: MouseEvent) => void;
    compact?: boolean;
}

export function UserProfileCard({ profile, onClick, compact = false }: UserProfileCardProps) {
    if (!profile) return <div className={styles.cardSkeleton} role="status" aria-label="Profil wird geladen" />;
    const visible = toPublicProfile(profile);
    const body = <>
        <ProfileAvatar url={visible.avatarUrl} name={visible.displayName} className={cn(styles.cardAvatar, compact && styles.compactAvatar)} />
        <span className={styles.cardCopy}>
            <strong>{visible.displayName}</strong>
            {!compact && <span>{[visible.location, visible.ageYears !== null ? `${visible.ageYears} Jahre` : null].filter(Boolean).join(" · ") || "Profil ansehen"}</span>}
        </span>
    </>;
    return onClick
        ? <button type="button" onClick={onClick} className={styles.card} aria-label={`Profil von ${visible.displayName} öffnen`}>{body}</button>
        : <div className={styles.card}>{body}</div>;
}
