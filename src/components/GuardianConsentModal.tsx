"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import { ShieldCheck, Users, X } from "lucide-react";
import type { GuardianStatus } from "@/lib/types";
import type { FamilyInvitationDirection } from "@/lib/guardian/types";
import { FamilyInvitation } from "@/components/guardian/FamilyInvitation";
import styles from "@/components/guardian/Guardian.module.css";

interface GuardianConsentModalProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: "initial" | "add";
    guardianStatus?: GuardianStatus | null;
    consentRequired?: boolean;
    direction?: FamilyInvitationDirection;
}

export function guardianInvitationCopy(consentRequired: boolean, direction: FamilyInvitationDirection, additional = false) {
    if (direction === "guardian_to_child") return {
        title: "Dein Kind einladen",
        description: "Dein Kind nimmt die Einladung im eigenen Workfare-Konto an. Ist es unter 18, bestätigst du anschließend hier die Elternfreigabe.",
    };
    if (!consentRequired) return {
        title: additional ? "Familie erweitern" : "Mit deiner Familie verbinden",
        description: "Du bist volljährig. Die Familienverknüpfung ist freiwillig und für Bewerbungen nicht erforderlich.",
    };
    return {
        title: additional ? "Weiteren Elternteil einladen" : "Elternfreigabe einholen",
        description: "Für Bewerbungen mit 14 bis 17 Jahren brauchst du die Zustimmung eines Elternteils oder deiner gesetzlichen Vertretung.",
    };
}

export function GuardianConsentModal({ isOpen, onClose, variant = "initial", guardianStatus = null, consentRequired = true, direction = "child_to_guardian" }: GuardianConsentModalProps) {
    const copy = guardianInvitationCopy(consentRequired, direction, variant === "add");
    return <Dialog open={isOpen} onClose={onClose} className={`app-portal-surface ${styles.theme} ${styles.modalRoot}`}>
        <DialogBackdrop transition className={styles.backdrop} />
        <div className={styles.modalScroll}><div className={styles.modalAlign}>
            <DialogPanel transition className={`${styles.surface} ${styles.dialog}`}>
                <button type="button" className={`${styles.iconButton} ${styles.close}`} onClick={onClose} aria-label="Einladung schließen"><X size={20} aria-hidden="true" /></button>
                <span className={`${styles.dialogIcon} ${styles.glass}`}>{consentRequired ? <ShieldCheck size={23} strokeWidth={1.6} aria-hidden="true" /> : <Users size={23} strokeWidth={1.6} aria-hidden="true" />}</span>
                <DialogTitle as="h2">{copy.title}</DialogTitle>
                <Description className={styles.intro}>{copy.description}</Description>
                {consentRequired && guardianStatus === "pending" ? <p className={styles.fieldHint}>Seid ihr bereits verbunden? Dein Elternteil bestätigt die Zustimmung nach der Anmeldung im Familienbereich. Die Verbindung allein ersetzt diese Zustimmung nicht.</p> : null}
                {isOpen ? <FamilyInvitation key={direction} direction={direction} existing={guardianStatus === "pending"} /> : null}
            </DialogPanel>
        </div></div>
    </Dialog>;
}
