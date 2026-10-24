"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import styles from "@/components/guardian/Guardian.module.css";

export function AddGuardianButton({ consentRequired = true }: { consentRequired?: boolean }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    return <>
        <span className={`app-portal-surface ${styles.theme}`}>
            <button type="button" onClick={() => setIsModalOpen(true)} className={`${styles.action} ${styles.addButton} ${styles.glass}`}
                aria-label={consentRequired ? "Weiteren Elternteil einladen" : "Familienmitglied einladen"}>
                <Plus size={16} aria-hidden="true" />Hinzufügen
            </button>
        </span>
        <GuardianConsentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} variant="add" consentRequired={consentRequired} />
    </>;
}
