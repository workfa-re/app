"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, ChevronRight, LockKeyhole, Loader2 } from "lucide-react";
import { FAMILY_DECLARATION_TEXT, GUARDIAN_DECLARATION_TEXT, GUARDIAN_DECLARATION_VERSION, type GuardianConsentInput, type GuardianInvitationPreview, type GuardianRelationshipType } from "@/lib/guardian/types";
import { guardianInitials } from "./guardian-client";
import styles from "./Guardian.module.css";

const relationLabels: Record<GuardianRelationshipType, string> = { mother: "Mutter", father: "Vater", legal_guardian: "Gesetzliche Vertretung" };

function Submit({ children, busy, disabled = false }: { children: React.ReactNode; busy: boolean; disabled?: boolean }) {
    return <button type="submit" className={`${styles.action} ${styles.primary} ${styles.glass}`} disabled={busy || disabled}>
        {busy ? <Loader2 size={17} className={styles.spinner} aria-hidden="true" /> : null}{children}
    </button>;
}

export function GuardianPrivacy({ children }: { children?: React.ReactNode }) {
    return <p className={styles.privacy}><LockKeyhole size={13} aria-hidden="true" /><span>{children || <>Dein Zugang bleibt privat. <Link href="/legal/datenschutz" prefetch={false}>Datenschutz</Link></>}</span></p>;
}

export function GuardianEmailForm({ email, codeSent, busy, resendAllowed = true, fixedEmail = false, onRequest, onVerify, onChangeEmail }: {
    email: string;
    codeSent: boolean;
    busy: boolean;
    resendAllowed?: boolean;
    fixedEmail?: boolean;
    onRequest: (email: string) => void;
    onVerify: (email: string, code: string) => void;
    onChangeEmail: () => void;
}) {
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (codeSent) onVerify(email, String(form.get("code") || "").trim());
        else onRequest(String(form.get("email") || "").trim());
    }
    return <>
        <h2>{codeSent ? "Schau in dein Postfach" : "Mit E-Mail fortfahren"}</h2>
        <p className={styles.intro}>{codeSent ? <>Öffne den Anmeldelink oder gib den Code aus der E-Mail an <strong>{email}</strong> ein.</> : fixedEmail ? "Bestätige deinen Zugang erneut per E-Mail." : "Bestätige deinen bestehenden Zugang per E-Mail."}</p>
        <form className={styles.form} onSubmit={submit}>
            {codeSent ? <label className={styles.field}>Anmeldecode
                <input key="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} className={styles.code} placeholder="Code aus der E-Mail" required disabled={busy} />
            </label> : <label className={styles.field}>Deine E-Mail-Adresse
                <input key="email" name="email" type="email" autoComplete="email" defaultValue={email} placeholder="name@beispiel.de" required maxLength={254} readOnly={fixedEmail} disabled={busy} />
            </label>}
            <Submit busy={busy}>{busy ? codeSent ? "Code wird geprüft …" : "Code wird gesendet …" : codeSent ? "Code bestätigen" : "Anmeldecode senden"}</Submit>
        </form>
        {codeSent ? <div className={styles.actions}>
            {!fixedEmail ? <button type="button" className={styles.quiet} disabled={busy} onClick={onChangeEmail}>E-Mail ändern</button> : null}
            <button type="button" className={styles.quiet} disabled={busy || !resendAllowed} onClick={() => onRequest(email)}>{resendAllowed ? "Code erneut senden" : "Code versendet"}</button>
        </div> : null}
    </>;
}

export function GuardianProfileForm({ fullName, birthdate, busy, onComplete }: {
    fullName: string | null;
    birthdate: string | null;
    busy: boolean;
    onComplete: (data: { fullName: string; birthdate: string; adultConfirmed: true }) => void;
}) {
    const [confirmed, setConfirmed] = useState(false);
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!confirmed || busy) return;
        const form = new FormData(event.currentTarget);
        onComplete({ fullName: String(form.get("fullName") || "").trim(), birthdate: String(form.get("birthdate") || ""), adultConfirmed: true });
    }
    return <>
        <h2>Deine Angaben</h2>
        <p className={styles.intro}>Dein Name und dein Geburtsdatum reichen für dein Elternkonto.</p>
        <form className={styles.form} onSubmit={submit}>
            <label className={styles.field}>Vollständiger Name<input name="fullName" autoComplete="name" defaultValue={fullName || ""} placeholder="Vor- und Nachname" minLength={3} maxLength={120} required disabled={busy} /></label>
            <label className={styles.field}>Geburtsdatum<input name="birthdate" type="date" autoComplete="bday" defaultValue={birthdate || ""} required disabled={busy} /></label>
            <label className={styles.consent}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy} /><span>Ich bin volljährig und nutze diesen Zugang als Elternteil oder gesetzliche Vertretung.</span></label>
            <Submit busy={busy} disabled={!confirmed}>{busy ? "Elternkonto wird eingerichtet …" : "Elternkonto einrichten"}</Submit>
        </form>
        <p className={styles.fieldHint}>Eine Adresse und ein Anbieterprofil sind für den Elternzugang nicht erforderlich. Diese Angaben sind keine Ausweisprüfung.</p>
    </>;
}

export function guardianReviewCopy(invitation: Pick<GuardianInvitationPreview, "direction" | "minorRequired" | "childName" | "inviterName">) {
    const childAccepts = invitation.direction === "guardian_to_child";
    const required = invitation.minorRequired === true;
    if (childAccepts && required) return {
        title: "Mit deinem Elternteil verbinden",
        name: invitation.inviterName || "Dein Elternteil",
        subline: "Anschließend bestätigt dein Elternteil die Freigabe.",
        declaration: "Ich möchte mein Workfare-Konto mit dieser Person verbinden. Die erforderliche Elternfreigabe wird anschließend von meinem Elternteil bestätigt.",
        checkbox: "Ich möchte mein Workfare-Konto mit dieser Person verbinden.",
        scope: "Dein Elternteil bestätigt die erforderliche Freigabe anschließend im eigenen Zugang.",
        button: "Verbindung anfragen",
    };
    if (!required) return {
        title: "Familienverknüpfung",
        name: childAccepts ? invitation.inviterName || "Dein Elternteil" : invitation.childName || "Dein Kind",
        subline: "Freiwillig · Für Bewerbungen nicht erforderlich",
        declaration: FAMILY_DECLARATION_TEXT,
        checkbox: "Ich möchte diese freiwillige Familienverknüpfung herstellen.",
        scope: "Für Bewerbungen nicht erforderlich. Private Chats und Zahlungsdaten bleiben getrennt.",
        button: "Familie verbinden",
    };
    return {
        title: "Deine Zustimmung",
        name: invitation.childName || "Dein Kind",
        subline: "Elternfreigabe für Workfare",
        declaration: GUARDIAN_DECLARATION_TEXT,
        checkbox: `Ich bin gesetzlich vertretungsberechtigt und erteile ${invitation.childName || "meinem Kind"} die beschriebene Elternfreigabe.`,
        scope: "Für altersgerechte, zulässige Tätigkeiten. Keine Zahlungsfreigabe bei Stripe und kein vollständiger Zugriff auf private Chats. Gesetzliche Grenzen und weitere erforderliche Einwilligungen gelten weiterhin.",
        button: "Freigabe erteilen",
    };
}

export type GuardianReviewProfile = { fullName: string; birthdate: string; adultConfirmed: true };
export function GuardianConsentReview({ invitation, busy, profile, onConfirm }: { invitation: Pick<GuardianInvitationPreview, "direction" | "minorRequired" | "childName" | "inviterName">; busy: boolean; profile?: { fullName: string | null; birthdate: string | null; adultEligible: boolean }; onConfirm: (input: GuardianConsentInput, profile?: GuardianReviewProfile) => void }) {
    const [accepted, setAccepted] = useState(false);
    const [relationshipType, setRelationshipType] = useState<GuardianRelationshipType | "">("");
    const scopeId = useId();
    const copy = guardianReviewCopy(invitation);
    const completeProfile = invitation.direction === "child_to_guardian" && profile && (!profile.fullName || !profile.birthdate || !profile.adultEligible);
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!accepted || !relationshipType || busy) return;
        const fields = new FormData(event.currentTarget);
        onConfirm({ accepted: true, declarationVersion: GUARDIAN_DECLARATION_VERSION, relationshipType }, completeProfile ? { fullName: String(fields.get("fullName") || "").trim(), birthdate: String(fields.get("birthdate") || ""), adultConfirmed: true } : undefined);
    }
    return <>
        <h2>{copy.title}</h2>
        <form className={styles.form} onSubmit={submit}>
            <div className={styles.summary}><span className={styles.avatar} aria-hidden="true">{guardianInitials(copy.name)}</span><div><strong>{copy.name}</strong><span>{copy.subline}</span></div></div>
            {completeProfile ? <>
                <label className={styles.field}>Dein vollständiger Name<input name="fullName" autoComplete="name" defaultValue={profile.fullName || ""} minLength={3} maxLength={120} required disabled={busy} /></label>
                <label className={styles.field}>Dein Geburtsdatum<input name="birthdate" type="date" autoComplete="bday" defaultValue={profile.birthdate || ""} required disabled={busy} /></label>
            </> : null}
            <label className={styles.field}>{invitation.direction === "guardian_to_child" ? "Die einladende Person ist" : "Deine Beziehung"}
                <select value={relationshipType} onChange={event => setRelationshipType(event.target.value as GuardianRelationshipType)} required disabled={busy}>
                    <option value="" disabled>Bitte auswählen</option>
                    {Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </label>
            <div className={styles.consentGroup}>
                <label className={styles.consent}><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} required disabled={busy} aria-describedby={scopeId} /><span>{completeProfile ? "Ich bin volljährig. " : ""}{copy.checkbox}</span></label>
                <p id={scopeId} className={styles.fieldHint}>{copy.scope}</p>
                <details className={styles.details}><summary><ChevronRight size={15} aria-hidden="true" />{invitation.minorRequired && invitation.direction === "child_to_guardian" ? "Vollständige Erklärung lesen" : "Erklärung zur Verbindung lesen"}</summary><p>{copy.declaration}</p></details>
            </div>
            <Submit busy={busy} disabled={!accepted || !relationshipType}>{busy ? "Wird bestätigt …" : copy.button}</Submit>
        </form>
    </>;
}

export function GuardianSuccess({ pending, consentRequired, receiptUrl, receiptSent = false, receiptUnavailable = false, onContinue }: { pending: boolean; consentRequired: boolean; receiptUrl?: string | null; receiptSent?: boolean; receiptUnavailable?: boolean; onContinue: () => void }) {
    return <div className={styles.success} role="status">
        <CheckCircle2 size={27} strokeWidth={1.5} aria-hidden="true" />
        <h2>{pending ? "Verbindung angefragt" : consentRequired ? "Zustimmung hinterlegt" : "Ihr seid verbunden"}</h2>
        <p>{pending ? "Dein Elternteil bestätigt die Freigabe im eigenen Konto." : consentRequired ? "Deine Elternfreigabe ist gespeichert. Du kannst sie jederzeit in deinem Familienkonto widerrufen." : "Die freiwillige Familienverknüpfung ist aktiv. Deine privaten Chats und Zahlungsdaten bleiben geschützt."}</p>
        {receiptUrl ? <><p className={styles.fieldHint}>{receiptSent ? "Die Bestätigung mit deinem persönlichen Widerrufslink wurde per E-Mail versendet." : "Dein persönlicher Beleg ist verfügbar. Die Zustellung per E-Mail konnte noch nicht bestätigt werden."}</p><Link href={receiptUrl} prefetch={false} className={styles.quiet}>Freigabe und Widerrufslink ansehen<ChevronRight size={15} aria-hidden="true" /></Link></> : null}
        {receiptUnavailable ? <p className={styles.fieldHint}>Die Bestätigung per E-Mail ist gerade nicht verfügbar. Deine Freigabe ist gespeichert und bleibt über dein Familienkonto widerrufbar.</p> : null}
        <button type="button" className={`${styles.action} ${styles.glass}`} onClick={onContinue}>Zur Familienübersicht<ArrowRight size={16} aria-hidden="true" /></button>
    </div>;
}
