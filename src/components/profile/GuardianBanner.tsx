"use client";

import { useState } from "react";
import { CheckCircle2, ShieldCheck, Users, X } from "lucide-react";
import type { GuardianStatus } from "@/lib/types";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import styles from "@/components/guardian/Guardian.module.css";

export function GuardianBanner({ guardianStatus, consentRequired = true }: { guardianStatus: GuardianStatus; consentRequired?: boolean }) {
    const [isDismissed, setIsDismissed] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const linked = guardianStatus === "linked";
    const pending = guardianStatus === "pending";
    if (linked && isDismissed) return null;
    const title = linked ? consentRequired ? "Elternfreigabe hinterlegt" : "Mit deiner Familie verbunden"
        : pending ? consentRequired ? "Elternfreigabe ausstehend" : "Einladung ausstehend"
        : consentRequired ? "Elternfreigabe ergänzen" : "Deine Familie verbinden";
    const description = linked ? consentRequired ? "Ein Elternteil hat deiner Nutzung von Workfare zugestimmt." : "Deine freiwillige Familienverknüpfung ist aktiv."
        : pending ? consentRequired ? "Die erforderliche Zustimmung steht noch aus. Dein Elternteil kann sie im Familienbereich bestätigen." : "Dein Einladungslink wartet auf die Bestätigung."
        : consentRequired ? "Für Bewerbungen mit 14 bis 17 Jahren brauchst du die Zustimmung deiner gesetzlichen Vertretung." : "Wenn du möchtest, kannst du ein Elternteil mit deinem Konto verbinden.";
    const Icon = linked ? CheckCircle2 : consentRequired ? ShieldCheck : Users;
    return <>
        <div className={`app-portal-surface ${styles.theme} ${styles.surface} ${styles.banner}`} data-status={linked ? "linked" : pending ? "pending" : consentRequired ? "required" : "optional"}>
            <Icon size={20} strokeWidth={1.7} className={styles.bannerIcon} aria-hidden="true" />
            <div className={styles.bannerBody}>
                <h3>{title}</h3><p>{description}</p>
                {!linked ? <button type="button" className={styles.quiet} onClick={() => setIsModalOpen(true)}>{pending && consentRequired ? "Zustimmung einholen" : pending ? "Link anzeigen" : "Einladung erstellen"}</button> : null}
            </div>
            {linked ? <button type="button" className={`${styles.iconButton} ${styles.bannerDismiss}`} onClick={() => setIsDismissed(true)} aria-label="Hinweis ausblenden"><X size={17} aria-hidden="true" /></button> : null}
        </div>
        <GuardianConsentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} guardianStatus={guardianStatus} consentRequired={consentRequired} />
    </>;
}
