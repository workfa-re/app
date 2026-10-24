"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { GuardianConnection, GuardianConsentInput } from "@/lib/guardian/types";
import { GuardianConsentReview } from "./GuardianForms";
import { GuardianPayoutAction } from "./GuardianPayouts";
import { guardianInitials } from "./guardian-client";
import styles from "./Guardian.module.css";

export function guardianConnectionLabel(connection: GuardianConnection) {
    if (connection.status === "revoked") return "Verbindung gelöst";
    if (connection.status === "pending" || (connection.consentRequired && !connection.consented)) return connection.actorRole === "guardian" ? "Deine Zustimmung fehlt noch" : "Zustimmung deines Elternteils ausstehend";
    return connection.consentRequired ? "Elternfreigabe hinterlegt" : "Freiwillig verbunden";
}

function Connection({ connection, busy, onApprove, onRevoke }: {
    connection: GuardianConnection;
    busy: boolean;
    onApprove: (childId: string, input: GuardianConsentInput) => void;
    onRevoke: (id: string) => void;
}) {
    const [review, setReview] = useState(false);
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const canApprove = connection.actorRole === "guardian" && connection.status !== "revoked" && connection.consentRequired && !connection.consented;
    const name = connection.name || (connection.actorRole === "guardian" ? "Dein Kind" : "Dein Elternteil");
    return <li className={styles.relationship}>
        <div className={styles.summary}><span className={styles.avatar} aria-hidden="true">{guardianInitials(name)}</span><div><strong>{name}</strong><span>{guardianConnectionLabel(connection)}</span></div></div>
        {canApprove && !review ? <button type="button" className={`${styles.action} ${styles.glass}`} onClick={() => setReview(true)} disabled={busy}>Zustimmung prüfen<ChevronRight size={16} aria-hidden="true" /></button> : null}
        {canApprove && review ? <div className={styles.stack}>
            <GuardianConsentReview busy={busy} invitation={{ direction: "child_to_guardian", minorRequired: true, childName: name, inviterName: null }} onConfirm={input => onApprove(connection.childId, input)} />
            <button type="button" className={styles.quiet} disabled={busy} onClick={() => setReview(false)}>Später entscheiden</button>
        </div> : null}
        {connection.actorRole === "guardian" && connection.status === "active" && connection.consentRequired && connection.consented ? <GuardianPayoutAction childId={connection.childId} /> : null}
        <details className={styles.details}>
            <summary><ChevronRight size={15} aria-hidden="true" />Verbindung verwalten</summary>
            <p>Private Chats und Zahlungsdaten bleiben getrennt. Eine erforderliche Elternfreigabe gilt nur für die Nutzung von Workfare.</p>
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

export function GuardianConnections({ relationships, busy, onApprove, onRevoke }: {
    relationships: GuardianConnection[];
    busy: boolean;
    onApprove: (childId: string, input: GuardianConsentInput) => void;
    onRevoke: (id: string) => void;
}) {
    const visible = relationships.filter(connection => connection.status !== "revoked");
    return visible.length ? <ul className={styles.relationships}>{visible.map(connection => <Connection key={`${connection.id}:${connection.status}:${connection.consented}`} connection={connection} busy={busy} onApprove={onApprove} onRevoke={onRevoke} />)}</ul>
        : <p className={styles.intro}>Es ist noch kein Familienkonto verbunden. Erstelle eine Einladung, um die Verbindung anzufragen.</p>;
}
