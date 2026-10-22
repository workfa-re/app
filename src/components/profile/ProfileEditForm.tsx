"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, Eye, Loader2, MapPin, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { LocationAutocomplete, type LocationDetails } from "@/components/ui/LocationAutocomplete";
import { UserProfileModal } from "./UserProfileModal";
import { StaffBadge } from "@/components/ui/StaffBadge";
import { ProviderVerificationModal } from "./ProviderVerificationModal";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import { getGuardians, getWards } from "@/app/actions/guardian";
import { buildProfileUpdate, createProfileDraft, type ProfileDraft } from "./profile-form";
import styles from "./ProfileEditForm.module.css";

type GuardianDisplay = { id: string; full_name: string | null; email: string | null };
type ProfileEditFormProps = {
    profile: Profile;
    className?: string;
    isStaff?: boolean;
    guardians?: GuardianDisplay[];
    lastLogin?: { created_at: string } | null;
};

const profileDateFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const profileSignInFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function formatDate(value: string | null | undefined, includeTime = false) {
    if (!value) return "Nicht hinterlegt";
    const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    if (!Number.isFinite(date.getTime())) return "Nicht hinterlegt";
    return (includeTime ? profileSignInFormatter : profileDateFormatter).format(date);
}

function isMinor(birthdate: string | null) {
    if (!birthdate) return false;
    const date = new Date(`${birthdate.slice(0, 10)}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return false;
    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) age--;
    return age >= 0 && age < 18;
}

export function ProfileEditForm({ profile, className, isStaff = false, guardians = [], lastLogin = null }: ProfileEditFormProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isProvider = profile.account_type === "job_provider";
    const isCompany = isProvider && profile.provider_kind === "company";
    const isVerified = profile.provider_verification_status === "verified" || Boolean(profile.provider_verified_at);
    const verificationPending = profile.provider_verification_status === "pending";
    const guardianRequired = !isProvider && isMinor(profile.birthdate) && profile.guardian_status !== "linked";
    const name = (isCompany ? profile.company_name : profile.full_name)?.trim() || "Dein Konto";
    const role = isCompany ? "Unternehmen" : isProvider ? "Privater Jobanbieter" : "Jobsuchend";
    const [draft, setDraft] = useState(() => createProfileDraft(profile));
    const [savedPayload, setSavedPayload] = useState(() => JSON.stringify(buildProfileUpdate(createProfileDraft(profile), isProvider)));
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saveState, setSaveState] = useState<{ type: "ok" | "error"; message: string } | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [showVerification, setShowVerification] = useState(false);
    const [showGuardian, setShowGuardian] = useState(false);
    const [guardiansList, setGuardiansList] = useState(guardians);
    const [wards, setWards] = useState<GuardianDisplay[]>([]);
    const [relationshipError, setRelationshipError] = useState<string | null>(null);
    const payload = useMemo(() => buildProfileUpdate(draft, isProvider), [draft, isProvider]);
    const isDirty = JSON.stringify(payload) !== savedPayload;

    useEffect(() => {
        let cancelled = false;
        void getWards().then(result => {
            if (!cancelled && result.wards) setWards(result.wards);
        }).catch(() => {
            if (!cancelled) setRelationshipError("Verknüpfte Konten konnten gerade nicht geladen werden.");
        });
        return () => { cancelled = true; };
    }, []);

    const focusTarget = searchParams.get("focus");
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

    function selectLocation(location: LocationDetails) {
        setDraft(current => ({
            ...current,
            street: location.address_line1,
            houseNumber: location.house_number ?? "",
            city: location.city || current.city,
            zip: location.postcode || location.postal_code || current.zip,
            lat: location.lat ?? null,
            lng: location.lon ?? location.lng ?? null,
        }));
        setSaveState(null);
    }

    async function save(event?: FormEvent) {
        event?.preventDefault();
        if (savingRef.current || !isDirty) return;
        savingRef.current = true;
        setSaving(true);
        setSaveState(null);
        const submittedPayload = JSON.stringify(payload);
        try {
            const { data, error } = await supabaseBrowser.from("profiles").update(payload).eq("id", profile.id).select("id").single();
            if (error) throw error;
            if (data?.id !== profile.id) throw new Error("Dein Profil konnte nicht gespeichert werden. Bitte versuche es erneut.");
            setSavedPayload(submittedPayload);
            setSaveState({ type: "ok", message: "Deine Änderungen sind gespeichert." });
        } catch (error) {
            setSaveState({ type: "error", message: error instanceof Error ? error.message : "Speichern gerade nicht möglich. Bitte versuche es erneut." });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    async function refreshGuardians() {
        try {
            const result = await getGuardians();
            if (result.guardians) setGuardiansList(result.guardians);
        } catch {
            setRelationshipError("Die Elternfreigaben konnten gerade nicht aktualisiert werden.");
        }
    }

    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    const saveLabel = saving ? "Wird gespeichert …" : "Speichern";
    const saveButton = <button type="submit" form="profile-edit-form" disabled={saving || !isDirty} className={cn(styles.button, styles.primary)}>
        {saving ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <Check aria-hidden="true" />}{saveLabel}
    </button>;

    return <section className={cn(styles.page, className)}>
        <header className={styles.header}>
            <h1>{isCompany ? "Firmenprofil" : "Dein Profil"}</h1>
            <div className={styles.actions}>
                <button type="button" className={styles.button} onClick={() => setShowPreview(true)}><Eye aria-hidden="true" />Vorschau</button>
                {saveButton}
            </div>
        </header>
        <div className={styles.identity}>
            <div className={styles.avatar} aria-hidden="true">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials}</div>
            <div className={styles.identityCopy}>
                <h2 className={styles.name}>{name}{isStaff && <StaffBadge />}</h2>
                <div className={styles.identityMeta}>
                    <span>{role}</span>{profile.city && <span><MapPin size={14} aria-hidden="true" />{profile.city}</span>}
                    {isProvider && isVerified && <span><ShieldCheck size={14} aria-hidden="true" />Adresse geprüft</span>}
                    {!isProvider && profile.guardian_status === "linked" && <span><ShieldCheck size={14} aria-hidden="true" />Elternfreigabe aktiv</span>}
                </div>
            </div>
        </div>

        {isProvider && !isVerified && <div id="provider-verification-section" tabIndex={-1} className={styles.notice}>
            {verificationPending ? <Clock aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            <div className={styles.noticeCopy}><strong>{verificationPending ? "Deine Adresse wird geprüft" : "Adresse prüfen lassen"}</strong>
                <p>{verificationPending ? "Deine Angaben sind eingegangen. Nach der Freigabe kannst du Jobs veröffentlichen." : "Lass deine Adresse bestätigen, bevor du deinen ersten Job veröffentlichst."}</p>
            </div>
            {!verificationPending && <button type="button" className={styles.button} onClick={() => setShowVerification(true)}>Adresse angeben</button>}
        </div>}
        {guardianRequired && <div className={styles.notice}>
            <Users aria-hidden="true" /><div className={styles.noticeCopy}>
                <strong>{profile.guardian_status === "pending" ? "Elternfreigabe ausstehend" : "Elternfreigabe ergänzen"}</strong>
                <p>{profile.guardian_status === "pending" ? "Dein Einladungslink wartet auf die Bestätigung." : "Vor deiner ersten Bewerbung brauchst du die Bestätigung eines Elternteils."}</p>
            </div><button type="button" className={styles.button} onClick={() => setShowGuardian(true)}>{profile.guardian_status === "pending" ? "Link anzeigen" : "Einladung erstellen"}</button>
        </div>}

        <div className={styles.layout}>
            <nav className={styles.navigation} aria-label="Profilabschnitte">
                <a href="#public-profile"><UserRound aria-hidden="true" />Öffentliches Profil</a>
                <a href="#location-section"><MapPin aria-hidden="true" />Wohnort</a>
                <a href="#account-details"><ShieldCheck aria-hidden="true" />Kontodaten</a>
                {(!isProvider || wards.length > 0) && <a href="#linked-people"><Users aria-hidden="true" />Verknüpfte Konten</a>}
            </nav>
            <form id="profile-edit-form" className={styles.form} onSubmit={save}>
                <fieldset disabled={saving} className={styles.fields}>
                    <section id="public-profile" className={styles.section} tabIndex={-1}>
                        <div className={styles.sectionHeading}><div><h2>Öffentliches Profil</h2><p>So lernen dich andere auf Workfare kennen.</p></div></div>
                        <div className={styles.formGrid}>
                            <div className={styles.field}><label htmlFor="bio">{isCompany ? "Über das Unternehmen" : "Über mich"}</label>
                                <textarea id="bio" rows={4} className={styles.input} value={draft.bio} onChange={event => change("bio", event.target.value)} placeholder={isProvider ? "Wer du bist und welche Unterstützung du suchst." : "Was du gerne machst und wobei du helfen kannst."} />
                            </div>
                            {!isProvider && <div className={styles.twoColumns}>
                                <div className={styles.field}><label htmlFor="skills">Fähigkeiten</label><input id="skills" className={styles.input} value={draft.skills} onChange={event => change("skills", event.target.value)} placeholder="Zum Beispiel Mathe, Gartenarbeit" /></div>
                                <div className={styles.field}><label htmlFor="interests">Interessen</label><input id="interests" className={styles.input} value={draft.interests} onChange={event => change("interests", event.target.value)} placeholder="Zum Beispiel Sport, Technik" /></div>
                            </div>}
                            <div className={styles.field}><label htmlFor="availabilityNote">Verfügbarkeit</label><input id="availabilityNote" className={styles.input} value={draft.availabilityNote} onChange={event => change("availabilityNote", event.target.value)} placeholder="Zum Beispiel nachmittags und am Wochenende" /></div>
                        </div>
                    </section>
                    <section id="location-section" className={styles.section} tabIndex={-1}>
                        <div className={styles.sectionHeading}><div><h2>Wohnort</h2><p>{isProvider ? "Deine hinterlegte Adresse bleibt privat." : "Deine Adresse hilft bei der Entfernungsberechnung. Sie erscheint nicht in deinem öffentlichen Profil."}</p></div></div>
                        {isProvider ? <dl className={styles.dataList}>
                            <div className={styles.wide}><dt>Adresse</dt><dd>{[profile.street, profile.house_number].filter(Boolean).join(" ") || "Noch nicht hinterlegt"}<br />{[profile.zip, profile.city].filter(Boolean).join(" ")}</dd></div>
                            <div><dt>Adressprüfung</dt><dd>{isVerified ? "Bestätigt" : verificationPending ? "In Prüfung" : profile.provider_verification_status === "rejected" ? "Erneute Prüfung erforderlich" : "Noch nicht bestätigt"}</dd></div>
                        </dl> : <div className={styles.formGrid}>
                            <div className={styles.field}><label htmlFor="profile-location-search">Adresse suchen</label><div className={styles.search}><LocationAutocomplete inputId="profile-location-search" onSelect={selectLocation} placeholder="Straße und Ort suchen" /></div></div>
                            <div className={styles.street}>
                                <div className={styles.field}><label htmlFor="street">Straße</label><input id="street" name="street" autoComplete="address-line1" className={styles.input} value={draft.street} onChange={event => { setDraft(current => ({ ...current, street: event.target.value, lat: null, lng: null })); setSaveState(null); }} /></div>
                                <div className={styles.field}><label htmlFor="houseNumber">Nr.</label><input id="houseNumber" name="houseNumber" autoComplete="address-line2" className={styles.input} value={draft.houseNumber} onChange={event => { setDraft(current => ({ ...current, houseNumber: event.target.value, lat: null, lng: null })); setSaveState(null); }} /></div>
                            </div>
                            <div className={styles.addressSummary}><MapPin size={15} aria-hidden="true" />{[draft.zip, draft.city].filter(Boolean).join(" ") || "Noch kein Ort hinterlegt"}</div>
                            {draft.street && draft.lat === null && <p className={styles.fieldHint}>Wähle deine Adresse aus den Suchvorschlägen, um Entfernungen zu berechnen.</p>}
                        </div>}
                    </section>
                    <section id="account-details" className={styles.section} tabIndex={-1}>
                        <div className={styles.sectionHeading}><div><h2>Kontodaten</h2><p>Die Angaben aus deiner Registrierung.</p></div></div>
                        <dl className={styles.dataList}>
                            <div><dt>Vollständiger Name</dt><dd>{profile.full_name || "Nicht hinterlegt"}</dd></div>
                            <div><dt>E-Mail</dt><dd>{profile.email || "Nicht hinterlegt"}</dd></div>
                            <div><dt>Geburtsdatum</dt><dd>{formatDate(profile.birthdate)}</dd></div>
                            <div><dt>E-Mail-Bestätigung</dt><dd>{profile.email_verified_at ? "Bestätigt" : "Ausstehend"}</dd></div>
                            {isCompany && <><div><dt>Unternehmen</dt><dd>{profile.company_name || "Nicht hinterlegt"}</dd></div><div><dt>Kontakt-E-Mail</dt><dd>{profile.company_contact_email || "Nicht hinterlegt"}</dd></div></>}
                            <div><dt>Land</dt><dd>{profile.country === "DE" ? "Deutschland" : profile.country || "Nicht hinterlegt"}</dd></div>
                            <div><dt>Mitglied seit</dt><dd>{formatDate(profile.created_at)}</dd></div>
                            {lastLogin && <div className={styles.wide}><dt>Letzte Anmeldung</dt><dd>{formatDate(lastLogin.created_at, true)}</dd></div>}
                            {isCompany && profile.company_message && <div className={styles.wide}><dt>Nachricht aus der Registrierung</dt><dd>{profile.company_message}</dd></div>}
                        </dl>
                    </section>
                </fieldset>
                {(!isProvider || wards.length > 0) && <section id="linked-people" className={styles.section} tabIndex={-1}>
                    <div className={styles.sectionHeading}><div><h2>{wards.length > 0 && isProvider ? "Verknüpfte Kinder" : "Elternfreigaben"}</h2><p>Die mit deinem Konto verbundenen Personen.</p></div>
                        {!isProvider && <button type="button" className={styles.button} onClick={() => setShowGuardian(true)}><Plus aria-hidden="true" />Hinzufügen</button>}
                    </div>
                    <div className={styles.people}>{[...guardiansList, ...wards].map(person => <div key={person.id} className={styles.person}>
                        <span aria-hidden="true">{(person.full_name || "K").charAt(0).toUpperCase()}</span><div><strong>{person.full_name || "Verknüpftes Konto"}</strong>{person.email && <small>{person.email}</small>}</div>
                    </div>)}</div>
                    {guardiansList.length === 0 && wards.length === 0 && <p>Noch keine Person verknüpft.</p>}
                    {relationshipError && <p role="alert">{relationshipError}</p>}
                </section>}
                <div className={styles.footer}>
                    <span className={styles.feedback} role={saveState?.type === "error" ? "alert" : "status"} data-state={saveState?.type}>
                        {saveState?.message || (isDirty ? "Noch nicht gespeichert" : "Alle Änderungen gespeichert")}
                    </span>{saveButton}
                </div>
            </form>
        </div>
        <UserProfileModal isOpen={showPreview} onClose={() => setShowPreview(false)} isStaff={isStaff} profile={{ ...profile, bio: draft.bio, availability_note: draft.availabilityNote, interests: isProvider ? null : draft.interests, skills: isProvider ? null : draft.skills }} />
        <GuardianConsentModal isOpen={showGuardian} onClose={() => { setShowGuardian(false); void refreshGuardians(); }} variant={profile.guardian_status === "linked" || guardiansList.length > 0 ? "add" : "initial"} guardianStatus={profile.guardian_status || "none"} />
        <ProviderVerificationModal isOpen={showVerification} onClose={() => setShowVerification(false)} onSubmitted={() => { setShowVerification(false); router.refresh(); }} />
    </section>;
}
