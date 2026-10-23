"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, Transition } from "@headlessui/react";
import { X, Send, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import styles from "./JobApplicationModal.module.css";
import { applyToJob } from "@/app/app-home/jobs/actions";
import { GuardianConsentModal } from "@/components/GuardianConsentModal";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import type { GuardianStatus } from "@/lib/types";
import { getActivityConversationHref } from "@/lib/activity/navigation";

interface JobApplicationModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobTitle: string;
    jobId: string;
    canApply: boolean;
    guardianStatus: string;
}

export function JobApplicationModal({ isOpen, onClose, jobTitle, jobId, canApply, guardianStatus }: JobApplicationModalProps) {
    const router = useRouter();
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [showGuardianModal, setShowGuardianModal] = useState(false);
    const [submissionOutcome, setSubmissionOutcome] = useState<{ href: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (loading) return;
        onClose();
        setSubmissionOutcome(null);
        setMessage("");
        setError(null);
    };

    useEffect(() => {
        if (!isOpen) return;
        const frameId = requestAnimationFrame(() => {
            endPerfMark("job-apply-open");
        });
        return () => cancelAnimationFrame(frameId);
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!canApply) {
            setShowGuardianModal(true);
            return;
        }

        setLoading(true);
        setError(null);
        startPerfMark("job-apply-submit");

        const formData = new FormData();
        formData.append("message", message);
        formData.append("jobId", jobId);

        try {
            const result = await applyToJob(formData);
            endPerfMark("job-apply-submit");
            if (result.success) {
                const applicationId = result.application?.id;
                if (typeof applicationId !== "string" || !applicationId.trim()) {
                    setError("Das Gespräch konnte nicht geöffnet werden. Bitte lade deine Jobs erneut.");
                    return;
                }
                const href = getActivityConversationHref(applicationId);
                setSubmissionOutcome({ href });
                router.push(href);
            } else {
                setError(result.error || "Ein unbekannter Fehler ist aufgetreten.");
            }
        } catch {
            endPerfMark("job-apply-submit");
            setError("Die Bewerbung konnte nicht gespeichert werden. Bitte versuche es erneut.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Transition appear show={isOpen} as={Fragment}>
                <Dialog as="div" className={"app-portal-surface " + styles.root} onClose={handleClose}>
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-240 motion-reduce:duration-0"
                        enterFrom="opacity-0"
                        enterTo="opacity-100"
                        leave="ease-in duration-160 motion-reduce:duration-0"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <div className={styles.backdrop} />
                    </Transition.Child>

                    <div className={styles.viewport}>
                        <div className={styles.positioner}>
                            <Transition.Child
                                as={Fragment}
                                enter="ease-out duration-240 motion-reduce:duration-0"
                                enterFrom="opacity-0 translate-y-3"
                                enterTo="opacity-100 translate-y-0"
                                leave="ease-in duration-160 motion-reduce:duration-0"
                                leaveFrom="opacity-100 translate-y-0"
                                leaveTo="opacity-0 translate-y-2"
                            >
                                <Dialog.Panel className={styles.panel}>
                                    <div className={styles.closePosition}>
                                        <button
                                            type="button"
                                            onClick={handleClose}
                                            disabled={loading}
                                            aria-label="Bewerbungsfenster schließen"
                                            className={styles.close}
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>

                                    {submissionOutcome ? (
                                        <div className={styles.success} role="status" aria-live="polite">
                                            <div className={styles.successMark}>
                                                <CheckCircle2 size={32} aria-hidden="true" />
                                            </div>
                                            <Dialog.Title as="h2" className={styles.title}>
                                                Job für dich reserviert
                                            </Dialog.Title>
                                            <p className={styles.copy}>
                                                Deine Bewerbung ist gespeichert. Das Gespräch mit dem Anbieter öffnet sich jetzt.
                                            </p>
                                            <Link href={submissionOutcome.href} className={styles.submit}>Gespräch öffnen</Link>
                                        </div>
                                    ) : (
                                        <>
                                            <Dialog.Title
                                                as="h2"
                                                className={styles.title}
                                            >
                                                Auf diesen Job bewerben
                                            </Dialog.Title>
                                            <p className={styles.jobTitle}>
                                                {jobTitle}
                                            </p>

                                            {!canApply && (
                                                <div className={styles.notice}>
                                                    <AlertTriangle className={styles.noticeIcon} size={18} />
                                                    <div className="text-sm">
                                                        <h4 className={styles.noticeTitle}>Bestätigung & Jugendschutz</h4>
                                                        <p className={styles.copy}>
                                                            Du benötigst die Bestätigung eines Erziehungsberechtigten, bevor du dich bewerben kannst.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            <form onSubmit={handleSubmit} className={styles.form}>
                                                {canApply && (
                                                    <div>
                                                        <label htmlFor="message" className={styles.label}>
                                                            Deine Nachricht (optional)
                                                        </label>
                                                        <textarea
                                                            id="message"
                                                            rows={5}
                                                            className={styles.textarea}
                                                            placeholder="Hallo, ich würde gerne helfen …"
                                                            value={message}
                                                            onChange={(e) => setMessage(e.target.value)}
                                                        />
                                                    </div>
                                                )}

                                                {error && (
                                                    <p className={styles.error} role="alert">
                                                        {error}
                                                    </p>
                                                )}

                                                <div className="pt-2">
                                                    <button
                                                        type="submit"
                                                        disabled={loading}
                                                        className={styles.submit}
                                                        onClick={(e) => {
                                                            if (!canApply) {
                                                                e.preventDefault();
                                                                setShowGuardianModal(true);
                                                            }
                                                        }}
                                                    >
                                                        {loading ? "Wird gespeichert..." : (
                                                            <>
                                                                {canApply ? <Send size={16} className="mr-2" /> : <Lock size={16} className="mr-2" />}
                                                                {canApply ? "Bewerben und reservieren" : "Bestätigung starten"}
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </form>
                                        </>
                                    )}
                                </Dialog.Panel>
                            </Transition.Child>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <GuardianConsentModal
                isOpen={showGuardianModal}
                onClose={() => setShowGuardianModal(false)}
                guardianStatus={guardianStatus as GuardianStatus}
            />
        </>
    );
}
