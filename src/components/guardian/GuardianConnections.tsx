"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { GuardianConnection, GuardianConsentInput } from "@/lib/guardian/types";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { GuardianConsentReview } from "./GuardianForms";
import { GuardianPayoutAction } from "./GuardianPayouts";
import { GuardianChildOverview } from "./GuardianChildOverview";
import styles from "./Guardian.module.css";

export function guardianConnectionLabel(connection: GuardianConnection) {
    if (connection.status === "revoked") return "Verbindung gelöst";
    if (connection.status === "pending" || (connection.consentRequired && !connection.consented)) return connection.actorRole === "guardian" ? "Deine Zustimmung fehlt noch" : "Zustimmung deines Elternteils ausstehend";
    return connection.consentRequired ? "Elternfreigabe hinterlegt" : "Freiwillig verbunden";
}

function Connection({ connection, ownerId, busy, onApprove, onRevoke }: {
    connection: GuardianConnection;
    ownerId?: string;
    busy: boolean;
    onApprove: (childId: string, input: GuardianConsentInput) => void;
    onRevoke: (id: string) => void;
}) {
    const [review, setReview] = useState(false);
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const [payoutOpen, setPayoutOpen] = useState(false);
    const [childAccess, setChildAccess] = useState<"minor_jobs" | "profile_only" | "unavailable" | null>(null);
    const canApprove = connection.actorRole === "guardian" && connection.status !== "revoked" && connection.consentRequired && !connection.consented;
    const approvedMinor = connection.actorRole === "guardian" && connection.status === "active" && connection.consentRequired && connection.consented;
    const childOverview = connection.actorRole === "guardian" && connection.status === "active" && (!connection.consentRequired || connection.consented);
    const name = connection.name || (connection.actorRole === "guardian" ? "Dein Kind" : "Dein Elternteil");
    return <li className={`${styles.relationship} ${styles.surface} ${styles.childCard}`}>
        {childOverview ? <GuardianChildOverview key={`${ownerId}:${connection.childId}`} ownerId={ownerId} childId={connection.childId} name={name} onAccess={setChildAccess} />
            : <div className={styles.childHeading}><ProfileAvatar url={null} name={name} className={`${styles.childAvatar} ${styles.glass}`} /><div><h2>{name}</h2>{connection.status === "pending" || connection.consentRequired && !connection.consented ? <p>{guardianConnectionLabel(connection)}</p> : null}</div></div>}
        {canApprove && !review ? <button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => setReview(true)} disabled={busy}>Zustimmung prüfen<ChevronRight size={16} aria-hidden="true" /></button> : null}
        {canApprove && review ? <div className={styles.stack}>
            <GuardianConsentReview busy={busy} invitation={{ direction: "child_to_guardian", minorRequired: true, childName: name, inviterName: null }} onConfirm={input => onApprove(connection.childId, input)} />
            <button type="button" className={styles.quiet} disabled={busy} onClick={() => setReview(false)}>Später entscheiden</button>
        </div> : null}
        {approvedMinor && childAccess !== "profile_only" && childAccess !== "unavailable" && <>
            <details className={`${styles.details} ${styles.payoutDetails}`} onToggle={event => setPayoutOpen(event.currentTarget.open)}>
                <summary><span>Workfare Pay</span><ChevronRight size={15} aria-hidden="true" /></summary>
                {payoutOpen && <div className={styles.stack}>
                    <GuardianPayoutAction childId={connection.childId} />
                </div>}
            </details>
        </>}
        {connection.actorRole === "child" && connection.status === "active" && connection.consentRequired && connection.consented && <p className={styles.permissionNote}>Dein Elternteil kann deine Zahlungsübersicht und die letzten Ziffern deiner Bankverbindung ansehen. Deine privaten Chats bleiben privat.</p>}
        <details className={styles.details}>
            <summary><span>Verbindung verwalten</span><ChevronRight size={15} aria-hidden="true" /></summary>
            {confirmRevoke ? <div className={styles.stack}>
                <p>Die Familienverbindung und eine damit erteilte Zustimmung werden aufgehoben. Bestehende Aufträge werden dadurch nicht automatisch beendet.</p>
                <div className={styles.actions}>
                    <button type="button" className={`${styles.action} ${styles.glass}`} disabled={busy} onClick={() => onRevoke(connection.id)}>{busy ? <Loader2 size={16} className={styles.spinner} aria-hidden="true" /> : null}{busy ? "Wird gelöst …" : "Verbindung lösen"}</button>
                    <button type="button" className={styles.quiet} disabled={busy} onClick={() => setConfirmRevoke(false)}>Behalten</button>
                </div>
            </div> : <button type="button" className={styles.quiet} disabled={busy} onClick={() => setConfirmRevoke(true)}>Verbindung lösen</button>}
        </details>
    </li>;
}

export function GuardianConnections({ relationships, ownerId, busy, onApprove, onRevoke }: {
    relationships: GuardianConnection[];
    ownerId?: string;
    busy: boolean;
    onApprove: (childId: string, input: GuardianConsentInput) => void;
    onRevoke: (id: string) => void;
}) {
    const visible = relationships.filter(connection => connection.status !== "revoked");
    return visible.length ? <ul className={styles.relationships}>{visible.map(connection => <Connection key={`${connection.id}:${connection.status}:${connection.consented}`} connection={connection} ownerId={ownerId} busy={busy} onApprove={onApprove} onRevoke={onRevoke} />)}</ul>
        : <div className={`${styles.surface} ${styles.familyEmpty}`}><h2>Deine Familie verbinden</h2><p>Hier siehst du die Jobs und Kontaktpersonen deines Kindes, sobald ihr verbunden seid.</p></div>;
}
