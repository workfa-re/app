"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Clock, Eye, Loader2, LockKeyhole, MapPin, Pencil, Plus, ShieldCheck, Users, X } from "lucide-react";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { LocationAutocomplete, type LocationDetails } from "@/components/ui/LocationAutocomplete";
import { UserProfileModal } from "./UserProfileModal";
import { ProfileAvatar } from "./ProfileAvatar";
import { StaffBadge } from "@/components/ui/StaffBadge";
import { ProviderVerificationModal } from "./ProviderVerificationModal";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import { getGuardians, getWards, type LinkedAccount } from "@/app/actions/guardian";
import { buildProfileUpdate, createProfileDraft, type ProfileDraft } from "./profile-form";
import styles from "./ProfileEditForm.module.css";

type ProfileEditFormProps = {
    profile: Profile;
    className?: string;
    isStaff?: boolean;
    guardians?: LinkedAccount[];
    wards?: LinkedAccount[];
    guardianLoadError?: string | null;
    wardsLoadError?: string | null;
    emailConfirmed?: boolean;
    lastLogin?: { created_at: string } | null;
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const signInFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
function formatDate(value: string | null | undefined, includeTime = false) {
    if (!value) return "Nicht hinterlegt";
    const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    return Number.isFinite(date.getTime()) ? (includeTime ? signInFormatter : dateFormatter).format(date) : "Nicht hinterlegt";
}
function tags(value: string) {
    return [...new Set(value.split(",").map(part => part.trim()).filter(Boolean))];
}

export function ProfileEditForm({ profile, className, isStaff = false, guardians = [], wards = [], guardianLoadError = null, wardsLoadError = null, emailConfirmed = false, lastLogin = null }: ProfileEditFormProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isProvider = profile.account_type === "job_provider";
    const isCompany = isProvider && profile.provider_kind === "company";
    const isVerified = profile.provider_verification_status === "verified";
    const verificationPending = profile.provider_verification_status === "pending";
    const name = (isCompany ? profile.company_name : profile.full_name)?.trim() || "Dein Konto";
    const role = isCompany ? "Unternehmen" : isProvider ? "Privater Jobanbieter" : "Jobsuchend";
    const focusTarget = searchParams.get("focus");
    const [editing, setEditing] = useState(() => focusTarget === "location" && !isProvider);
    const [draft, setDraft] = useState(() => createProfileDraft(profile));
    const [savedDraft, setSavedDraft] = useState(() => createProfileDraft(profile));
    const [saving, setSaving] = useState(false);
    const [handledFocus, setHandledFocus] = useState(focusTarget);
    if (handledFocus !== focusTarget) {
        setHandledFocus(focusTarget);
        if (focusTarget === "location" && !isProvider) setEditing(true);
    }
    const savingRef = useRef(false);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const bioRef = useRef<HTMLTextAreaElement>(null);
    const [saveState, setSaveState] = useState<{ type: "ok" | "error"; message: string } | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [showVerification, setShowVerification] = useState(false);
    const [showGuardian, setShowGuardian] = useState(false);
    const [guardianResult, setGuardianResult] = useState<{ people: LinkedAccount[]; error: string | null } | null>(null);
    const [wardsResult, setWardsResult] = useState<{ people: LinkedAccount[]; error: string | null } | null>(null);
    const [reloading, setReloading] = useState(false);
    const guardiansList = guardianResult?.people ?? guardians;
    const wardsList = wardsResult?.people ?? wards;
    const guardianError = guardianResult ? guardianResult.error : guardianLoadError;
    const wardsError = wardsResult ? wardsResult.error : wardsLoadError;
    const guardianRequired = !isProvider && !guardianError && guardiansList.length === 0;
    const hasLinkedAccounts = guardiansList.length > 0 || wardsList.length > 0 || Boolean(guardianError || wardsError);
    const payload = useMemo(() => buildProfileUpdate(draft, isProvider), [draft, isProvider]);
    const isDirty = JSON.stringify(payload) !== JSON.stringify(buildProfileUpdate(savedDraft, isProvider));
    const visibleCity = isProvider ? profile.city : draft.city;
    const street = isProvider ? profile.street : draft.street;
    const houseNumber = isProvider ? profile.house_number : draft.houseNumber;
    const location = [isProvider ? profile.zip : draft.zip, visibleCity].filter(Boolean).join(" ");

    useEffect(() => {
        const id = focusTarget === "location" ? "location-section"
            : focusTarget === "provider-verification" && isProvider && !isVerified ? "provider-verification-section" : null;
        if (!id) return;
        const frame = requestAnimationFrame(() => {
            const section = document.getElementById(id);
            section?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
            section?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [focusTarget, isProvider, isVerified]);

    function change<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
        setDraft(current => ({ ...current, [key]: value }));
        setSaveState(null);
    }
    function selectLocation(selected: LocationDetails) {
        setDraft(current => ({ ...current, street: selected.address_line1, houseNumber: selected.house_number ?? "", city: selected.city || current.city, zip: selected.postcode || selected.postal_code || current.zip, lat: selected.lat ?? null, lng: selected.lon ?? selected.lng ?? null }));
        setSaveState(null);
    }
    function finishEditing() {
        setEditing(false);
        requestAnimationFrame(() => editButtonRef.current?.focus());
    }
    function cancel() {
        if (savingRef.current) return;
        setDraft(savedDraft);
        setSaveState(null);
        finishEditing();
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        if (savingRef.current || !isDirty) return;
        savingRef.current = true;
        setSaving(true);
        setSaveState(null);
        const submittedDraft = { ...draft };
        try {
            const { data, error } = await supabaseBrowser.from("profiles").update(payload).eq("id", profile.id).select("id").single();
            if (error) throw error;
            if (data?.id !== profile.id) throw new Error("Dein Profil konnte nicht gespeichert werden. Bitte versuche es erneut.");
            setSavedDraft(submittedDraft);
            setSaveState({ type: "ok", message: "Deine Änderungen sind gespeichert." });
            finishEditing();
            router.refresh();
        } catch (error) {
            setSaveState({ type: "error", message: error instanceof Error ? error.message : "Speichern gerade nicht möglich. Bitte versuche es erneut." });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }
    async function refreshRelationships() {
        setReloading(true);
        await Promise.all([
            getGuardians().then(result => setGuardianResult({ people: result.guardians ?? [], error: result.error ?? null })).catch(() => setGuardianResult({ people: [], error: "Die Elternfreigaben konnten gerade nicht geladen werden." })),
            getWards().then(result => setWardsResult({ people: result.wards ?? [], error: result.error ?? null })).catch(() => setWardsResult({ people: [], error: "Die verknüpften Kinder konnten gerade nicht geladen werden." })),
        ]);
        setReloading(false);
    }

    return <section className={cn(styles.page, className)}>
        <header className={styles.header}>
            <h1>{isCompany ? "Firmenprofil" : "Dein Profil"}</h1>
            {!editing && <button ref={editButtonRef} type="button" className={styles.button} onClick={() => { setEditing(true); setSaveState(null); requestAnimationFrame(() => bioRef.current?.focus({ preventScroll: true })); }}><Pencil aria-hidden="true" />Bearbeiten</button>}
            {editing && <span className={styles.editLabel}>Profil bearbeiten</span>}
        </header>
        <div className={styles.layout}>
            <aside className={cn(styles.panel, styles.identity)} aria-label="Dein Konto">
                <div className={styles.identityMain}>
                    <ProfileAvatar url={profile.avatar_url ?? null} name={name} className={styles.avatar} />
                    <div className={styles.identityCopy}>
                        <h2 className={styles.name}>{name}</h2>
                        <div className={styles.identitySubline}>
                            <p className={styles.role}>{role}</p>
                            {isStaff && <StaffBadge className={styles.staffBadge} />}
                        </div>
                        <div className={styles.identityFacts}>
                            {visibleCity && <p className={styles.identityMeta}><MapPin aria-hidden="true" /><span>{visibleCity}</span></p>}
                            {isProvider && isVerified && <p className={styles.identityTrust}><ShieldCheck aria-hidden="true" /><span>Adresse geprüft</span></p>}
                            {!isProvider && guardiansList.length > 0 && <p className={styles.identityTrust}><ShieldCheck aria-hidden="true" /><span>Elternfreigabe aktiv</span></p>}
                        </div>
                    </div>
                </div>
                <button type="button" className={cn(styles.button, styles.preview)} onClick={() => setShowPreview(true)}><Eye aria-hidden="true" />Öffentliche Vorschau</button>
            </aside>
            <form className={styles.form} onSubmit={save} aria-label="Dein Profil bearbeiten">
                <fieldset disabled={saving} className={styles.fields}>
                    <section className={styles.panel} aria-labelledby="public-profile-heading">
                        <div className={styles.sectionHeading}><h2 id="public-profile-heading">Öffentliches Profil</h2><span className={styles.visibility}><Eye aria-hidden="true" />Für andere sichtbar</span></div>
                        {editing ? <div className={styles.formGrid}>
                            <div className={styles.field}><label htmlFor="bio">{isCompany ? "Über das Unternehmen" : "Über mich"}</label><textarea ref={bioRef} id="bio" rows={4} className={styles.input} value={draft.bio} onChange={event => change("bio", event.target.value)} placeholder={isProvider ? "Wer du bist und welche Unterstützung du suchst." : "Was du gerne machst und wobei du helfen kannst."} /></div>
                            {!isProvider && <div className={styles.twoColumns}>
                                <div className={styles.field}><label htmlFor="skills">Fähigkeiten</label><input id="skills" className={styles.input} value={draft.skills} onChange={event => change("skills", event.target.value)} placeholder="Zum Beispiel Mathe, Gartenarbeit" /><span className={styles.fieldHint}>Mit Komma trennen</span></div>
                                <div className={styles.field}><label htmlFor="interests">Interessen</label><input id="interests" className={styles.input} value={draft.interests} onChange={event => change("interests", event.target.value)} placeholder="Zum Beispiel Sport, Technik" /><span className={styles.fieldHint}>Mit Komma trennen</span></div>
                            </div>}
                        </div> : <div className={styles.publicSummary}>
                            {draft.bio.trim() ? <p className={styles.bio}>{draft.bio.trim()}</p> : <p className={styles.empty}>Erzähle kurz, {isProvider ? "wer du bist und welche Unterstützung du suchst." : "was du gerne machst und wobei du helfen kannst."}</p>}
                            {!isProvider && <div className={styles.tagGroups}>
                                <ProfileTags title="Fähigkeiten" values={tags(draft.skills)} />
                                <ProfileTags title="Interessen" values={tags(draft.interests)} />
                            </div>}
                        </div>}
                    </section>
                    <section className={styles.panel} aria-labelledby="private-profile-heading">
                        <div className={styles.sectionHeading}><h2 id="private-profile-heading">Private Angaben</h2><span className={styles.visibility}><LockKeyhole aria-hidden="true" />Nur für dich sichtbar</span></div>
                        {isProvider && !isVerified && <div id="provider-verification-section" tabIndex={-1} className={styles.notice}>
                            {verificationPending ? <Clock aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                            <div className={styles.noticeCopy}><strong>{verificationPending ? "Deine Adresse wird geprüft" : profile.provider_verification_status === "rejected" ? "Adresse erneut prüfen lassen" : "Adresse prüfen lassen"}</strong><p>{verificationPending ? "Nach der Freigabe kannst du Jobs veröffentlichen." : "Bestätige deine Adresse, um Jobs zu veröffentlichen."}</p></div>
                            {!verificationPending && <button type="button" className={styles.button} onClick={() => setShowVerification(true)}>{profile.provider_verification_status === "rejected" ? "Erneut prüfen" : "Adresse angeben"}</button>}
                        </div>}
                        {guardianRequired && <div className={styles.notice}>
                            <Users aria-hidden="true" /><div className={styles.noticeCopy}><strong>{profile.guardian_status === "pending" ? "Elternfreigabe ausstehend" : "Elternfreigabe ergänzen"}</strong><p>{profile.guardian_status === "pending" ? "Dein Einladungslink wartet auf die Bestätigung." : "Für Bewerbungen benötigst du eine Elternfreigabe."}</p></div>
                            <button type="button" className={styles.button} onClick={() => setShowGuardian(true)}>{profile.guardian_status === "pending" ? "Link anzeigen" : "Einladung erstellen"}</button>
                        </div>}
                        <div className={styles.privateGrid}>
                            <div id="location-section" className={styles.privateGroup} tabIndex={-1}>
                                <h3><MapPin aria-hidden="true" />Wohnort</h3>
                                {editing && !isProvider ? <div className={styles.formGrid}>
                                    <div className={styles.field}><label htmlFor="profile-location-search">Adresse suchen</label><div className={styles.search}><LocationAutocomplete inputId="profile-location-search" onSelect={selectLocation} placeholder="Straße und Ort suchen" /></div></div>
                                    <div className={styles.street}>
                                        <div className={styles.field}><label htmlFor="street">Straße</label><input id="street" name="street" autoComplete="address-line1" className={styles.input} value={draft.street} onChange={event => { setDraft(current => ({ ...current, street: event.target.value, lat: null, lng: null })); setSaveState(null); }} /></div>
                                        <div className={styles.field}><label htmlFor="houseNumber">Nr.</label><input id="houseNumber" name="houseNumber" autoComplete="address-line2" className={styles.input} value={draft.houseNumber} onChange={event => { setDraft(current => ({ ...current, houseNumber: event.target.value, lat: null, lng: null })); setSaveState(null); }} /></div>
                                    </div>
                                    <p className={styles.fieldHint}>{location || "Noch kein Ort hinterlegt"}{draft.street && draft.lat === null && ". Wähle einen Suchvorschlag, um Entfernungen zu berechnen."}</p>
                                </div> : <><p className={styles.address}>{[street, houseNumber].filter(Boolean).join(" ") || "Keine Straße hinterlegt"}<br />{location || "Kein Ort hinterlegt"}</p>
                                    {isProvider && <p className={styles.detailNote}>{isVerified ? <><ShieldCheck aria-hidden="true" />Adresse bestätigt</> : verificationPending ? "Prüfung läuft" : "Noch nicht bestätigt"}</p>}</>}
                                <div className={styles.availability}>
                                    {editing ? <div className={styles.field}><label htmlFor="availabilityNote">Verfügbarkeit</label><input id="availabilityNote" className={styles.input} value={draft.availabilityNote} onChange={event => change("availabilityNote", event.target.value)} placeholder="Zum Beispiel nachmittags und am Wochenende" /></div> : <><h3><Clock aria-hidden="true" />Verfügbarkeit</h3><p className={draft.availabilityNote.trim() ? styles.value : styles.empty}>{draft.availabilityNote.trim() || "Noch nicht hinterlegt"}</p></>}
                                </div>
                            </div>
                            <div className={styles.privateGroup}><h3><LockKeyhole aria-hidden="true" />Kontakt</h3><dl className={styles.contactList}>
                                <div><dt>{isCompany ? "Ansprechperson" : "Vollständiger Name"}</dt><dd>{profile.full_name || "Nicht hinterlegt"}</dd></div>
                                <div><dt>E-Mail</dt><dd>{profile.email || "Nicht hinterlegt"}</dd></div>
                                <div><dt className={styles.srOnly}>E-Mail-Bestätigung</dt><dd className={styles.detailNote}>{emailConfirmed ? <><Check aria-hidden="true" />E-Mail bestätigt</> : <><Clock aria-hidden="true" />E-Mail-Bestätigung ausstehend</>}</dd></div>
                                {isCompany && <div><dt>Kontakt-E-Mail des Unternehmens</dt><dd>{profile.company_contact_email || "Nicht hinterlegt"}</dd></div>}
                            </dl></div>
                        </div>
                        <details className={styles.disclosure}><summary>Weitere Kontodaten<ChevronDown aria-hidden="true" /></summary><dl className={styles.dataList}>
                            <div><dt>Geburtsdatum</dt><dd>{formatDate(profile.birthdate)}</dd></div>
                            <div><dt>Land</dt><dd>{profile.country === "DE" ? "Deutschland" : profile.country || "Nicht hinterlegt"}</dd></div>
                            <div><dt>Mitglied seit</dt><dd>{formatDate(profile.created_at)}</dd></div>
                            {lastLogin && <div><dt>Letzte Anmeldung</dt><dd>{formatDate(lastLogin.created_at, true)}</dd></div>}
                            {isCompany && <div><dt>Unternehmen</dt><dd>{profile.company_name || "Nicht hinterlegt"}</dd></div>}
                            {isCompany && profile.company_message && <div className={styles.wide}><dt>Nachricht aus der Registrierung</dt><dd>{profile.company_message}</dd></div>}
                        </dl></details>
                    </section>
                    {hasLinkedAccounts && <section className={styles.panel} aria-labelledby="linked-accounts-heading">
                        <div className={styles.sectionHeading}><h2 id="linked-accounts-heading">Verknüpfte Konten</h2><span className={styles.visibility}><LockKeyhole aria-hidden="true" />Nur für dich sichtbar</span></div>
                        {(guardiansList.length > 0 || guardianError) && <div className={styles.relationshipGroup}>
                            <div className={styles.groupHeading}><h3>Deine Elternfreigaben</h3>{!isProvider && guardiansList.length > 0 && <button type="button" className={cn(styles.button, styles.smallButton)} onClick={() => setShowGuardian(true)} aria-label="Weitere Elternfreigabe hinzufügen"><Plus aria-hidden="true" />Hinzufügen</button>}</div>
                            <LinkedPeople people={guardiansList} />
                            {guardianError && <p role="alert" className={styles.loadError}>{guardianError}</p>}
                        </div>}
                        {(wardsList.length > 0 || wardsError) && <div className={styles.relationshipGroup}><h3>Deine Kinder</h3><LinkedPeople people={wardsList} />{wardsError && <p role="alert" className={styles.loadError}>{wardsError}</p>}</div>}
                        {(guardianError || wardsError) && <button type="button" className={styles.button} disabled={reloading} onClick={() => void refreshRelationships()}>{reloading && <Loader2 className={styles.spinner} aria-hidden="true" />}{reloading ? "Wird geladen …" : "Erneut laden"}</button>}
                    </section>}
                </fieldset>
                {editing && <div className={styles.saveBar}>
                    <span className={styles.feedback} role={saveState?.type === "error" ? "alert" : "status"} data-state={saveState?.type}>{saveState?.message || (saving ? "Änderungen werden gespeichert …" : isDirty ? "Ungespeicherte Änderungen" : "Noch keine Änderungen")}</span>
                    <div className={styles.saveActions}><button type="button" disabled={saving} className={styles.button} onClick={cancel}><X aria-hidden="true" />Abbrechen</button><button type="submit" disabled={saving || !isDirty} className={cn(styles.button, styles.primary)}>{saving ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <Check aria-hidden="true" />}{saving ? "Wird gespeichert …" : "Speichern"}</button></div>
                </div>}
                {!editing && saveState && <p className={styles.feedback} role="status">{saveState.message}</p>}
            </form>
        </div>
        <UserProfileModal isOpen={showPreview} onClose={() => setShowPreview(false)} isStaff={isStaff} isDraft={isDirty} profile={{ ...profile, city: visibleCity, bio: draft.bio, interests: isProvider ? null : draft.interests, skills: isProvider ? null : draft.skills }} />
        <GuardianConsentModal isOpen={showGuardian} onClose={() => { setShowGuardian(false); void refreshRelationships(); }} variant={guardiansList.length > 0 ? "add" : "initial"} guardianStatus={guardiansList.length > 0 ? "linked" : profile.guardian_status === "pending" ? "pending" : "none"} />
        <ProviderVerificationModal isOpen={showVerification} onClose={() => setShowVerification(false)} onSubmitted={() => { setShowVerification(false); router.refresh(); }} />
    </section>;
}

function ProfileTags({ title, values }: { title: string; values: string[] }) {
    if (!values.length) return null;
    return <div><h3>{title}</h3><ul className={styles.tags}>{values.map(value => <li key={value}>{value}</li>)}</ul></div>;
}
function LinkedPeople({ people }: { people: LinkedAccount[] }) {
    return <ul className={styles.people}>{people.map(person => <li key={person.id} className={styles.person}>
        <ProfileAvatar url={null} name={person.full_name || "Verknüpftes Konto"} className={styles.personAvatar} />
        <div className={styles.personCopy}><strong>{person.full_name || "Verknüpftes Konto"}</strong><span><ShieldCheck aria-hidden="true" />Freigabe aktiv</span>
            {(person.email || person.linked_at) && <details className={styles.personDetails}><summary>Kontaktdetails<ChevronDown aria-hidden="true" /></summary>{person.email && <p>{person.email}</p>}{person.linked_at && <p>Verknüpft seit {formatDate(person.linked_at)}</p>}</details>}
        </div>
    </li>)}</ul>;
}
