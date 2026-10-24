"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/jobs/JobForm.module.css";
import type { Database } from "@/lib/types/supabase";
import { submitJobEdit } from "./jobEditSubmission";
import { AlertTriangle, CalendarDays, CreditCard, Loader2, Lock, MapPin, Repeat2 } from "lucide-react";
import { JOB_CATEGORIES } from "@/lib/constants/jobCategories";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getProviderJobStatusMeta, isProtectedJobStatus } from "../../../presentation";
import type { EditableJobStatus } from "./jobEditValidation";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const STATUS_LABELS: Record<EditableJobStatus, string> = {
    draft: "Entwurf",
    open: "Aktiv und sichtbar",
    closed: "Archiviert",
};

export function EditJobForm({ job, marketName, paymentRequired = false, resumePublication = false }: {
    job: Job; marketName: string; paymentRequired?: boolean; resumePublication?: boolean;
}) {
    const router = useRouter();
    const reduceMotion = useReducedMotion();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paymentBlocked, setPaymentBlocked] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState(resumePublication && !paymentRequired && ["draft", "closed"].includes(job.status) ? "open" : job.status);
    const [categoryId, setCategoryId] = useState(job.category || "");
    const [paymentType, setPaymentType] = useState<"hourly" | "fixed">(
        job.payment_type === "fixed" ? "fixed" : "hourly",
    );
    const initialWage = job.wage_hourly == null ? "" : String(job.wage_hourly);
    const [wage, setWage] = useState(initialWage);
    const [jobKind, setJobKind] = useState<"one_time" | "recurring">(
        job.job_kind === "recurring" ? "recurring" : "one_time",
    );
    const [recurrenceRule, setRecurrenceRule] = useState<"weekly" | "biweekly" | "monthly" | "flexible">(
        ["weekly", "biweekly", "monthly", "flexible"].includes(job.recurrence_rule || "")
            ? job.recurrence_rule as "weekly" | "biweekly" | "monthly" | "flexible"
            : "weekly",
    );
    const [continuityPreferred, setContinuityPreferred] = useState(Boolean(job.continuity_preferred));
    const titleRef = useRef<HTMLDivElement>(null);
    const statusInfo = getProviderJobStatusMeta(job.status);
    const statusIsProtected = isProtectedJobStatus(job.status) || Boolean(job.completed_at) || (job.status === "closed" && Boolean(job.filled_by));
    const editableStatuses = getEditableStatuses(job.status);
    const needsPayment = (paymentRequired || paymentBlocked) && selectedStatus === "open" && job.status !== "open";

    if (statusIsProtected) {
        return (
            <section className={cn(styles.form, styles.inset)}>
                <div className="flex items-start gap-4">
                    <span className={styles.protectedIcon}>
                        <Lock size={20} />
                    </span>
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{statusInfo.label}</p>
                        <h2 className="mt-1 text-xl font-semibold text-[var(--text-strong)]">Auftragsangaben sind geschützt</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                            Sobald ein Bewerbungsablauf läuft, bleiben Beschreibung, Vergütung und Jobart unverändert. So können sich beide Seiten auf dieselben vereinbarten Angaben verlassen.
                        </p>
                    </div>
                </div>
                <div className={cn(styles.actions, "mt-6")}>
                    <button type="button" className={cn("app-glass-control", styles.action)} onClick={() => router.push("/app-home/offers")}>Zu meinen Jobs</button>
                    <button type="button" className={cn("app-primary-action app-glass-control", styles.action)} onClick={() => router.push(`/app-home/offers/${job.id}`)}>Auftrag ansehen</button>
                </div>
            </section>
        );
    }

    async function handleSubmit(formData: FormData) {
        if (isLoading) return;
        setIsLoading(true);
        setError(null);
        formData.set("category", categoryId);
        formData.set("payment_type", paymentType);
        formData.set("job_kind", jobKind);
        formData.set("recurrence_rule", jobKind === "recurring" ? recurrenceRule : "");
        formData.set("continuity_preferred", jobKind === "recurring" && continuityPreferred ? "true" : "false");

        try {
            const result = await submitJobEdit({ jobId: job.id, currentStatus: job.status, formData, preparePayment: needsPayment });
            if (result.success) {
                router.push(result.nextHref);
                router.refresh();
            } else {
                if ("code" in result && result.code === "buyer_payment_required") setPaymentBlocked(true);
                setError(result.error || "Fehler beim Speichern");
            }
        } catch {
            setError("Ein unerwarteter Fehler ist aufgetreten.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <form onSubmit={event => { event.preventDefault(); void handleSubmit(new FormData(event.currentTarget)); }} className={styles.form} aria-busy={isLoading}>
            <fieldset disabled={isLoading} className="min-w-0 space-y-7">
            {error ? (
                <div className="flex items-start gap-3 rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]" role="alert">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            <fieldset>
                <legend className={styles.label}>Kategorie *</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {JOB_CATEGORIES.map((category) => {
                        const Icon = category.icon;
                        const isSelected = categoryId === category.id;

                        return (
                            <button
                                key={category.id}
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => {
                                    setCategoryId(category.id);
                                    if (job.category !== category.id && wage === initialWage) {
                                        setPaymentType(category.defaultPaymentType);
                                    }
                                }}
                                className={cn("app-glass-control", styles.option, styles.category)}
                            >
                                <Icon size={28} strokeWidth={1.5} />
                                <span className="text-center text-xs font-semibold">{category.label}</span>
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            <div ref={titleRef} className="space-y-2 scroll-mt-8">
                <label htmlFor="title" className={styles.label}>Titel *</label>
                <input
                    type="text"
                    id="title"
                    name="title"
                    defaultValue={job.title || ""}
                    required
                    minLength={5}
                    maxLength={120}
                    className={styles.input}
                />
            </div>

            <div className="space-y-2">
                <label htmlFor="description" className={styles.label}>Beschreibung *</label>
                <textarea
                    id="description"
                    name="description"
                    defaultValue={job.description || ""}
                    required
                    minLength={10}
                    maxLength={5000}
                    rows={6}
                    className={styles.input}
                />
            </div>

            <fieldset>
                <legend className={styles.label}>Jobart</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                    <JobKindOption
                        icon={<CalendarDays size={19} />}
                        title="Einmaliger Auftrag"
                        description="Ein Termin, danach ist der Auftrag abgeschlossen."
                        selected={jobKind === "one_time"}
                        disabled={statusIsProtected}
                        onSelect={() => setJobKind("one_time")}
                    />
                    <JobKindOption
                        icon={<Repeat2 size={19} />}
                        title="Regelmäßige Hilfe"
                        description="Mehrere Termine mit möglichst derselben Person."
                        selected={jobKind === "recurring"}
                        disabled={statusIsProtected}
                        onSelect={() => setJobKind("recurring")}
                    />
                </div>
                {statusIsProtected ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Lock size={12} /> Die Jobart bleibt während eines laufenden Bewerbungsablaufs unverändert.
                    </p>
                ) : null}
            </fieldset>

            <AnimatePresence initial={false}>
                {jobKind === "recurring" ? (
                    <motion.div
                        initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
                        className="overflow-hidden"
                    >
                        <div className={cn(styles.inset, "grid gap-4 sm:grid-cols-2")}>
                            <div className="space-y-2">
                                <label htmlFor="recurrence_rule" className={styles.label}>
                                    Wie häufig?
                                </label>
                                <select
                                    id="recurrence_rule"
                                    value={recurrenceRule}
                                    onChange={(event) => setRecurrenceRule(event.target.value as typeof recurrenceRule)}
                                    className={styles.input}
                                >
                                    <option value="weekly">Wöchentlich</option>
                                    <option value="biweekly">Alle zwei Wochen</option>
                                    <option value="monthly">Monatlich</option>
                                    <option value="flexible">Nach Absprache</option>
                                </select>
                            </div>
                            <label className={styles.checkOption}>
                                <input
                                    type="checkbox"
                                    checked={continuityPreferred}
                                    onChange={(event) => setContinuityPreferred(event.target.checked)}
                                    className="mt-0.5 size-4 accent-[var(--brand)]"
                                />
                                <span>
                                    <strong className="block text-sm font-semibold text-[var(--text-strong)]">Dieselbe Person bevorzugt</strong>
                                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">Der Chat bleibt für weitere Termine bestehen.</span>
                                </span>
                            </label>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--text-default)]">Einsatzort</p>
                <div className={cn(styles.inset, "flex items-center gap-3")}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--app-muted)]">
                        <MapPin size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-default)]">
                            {job.public_location_label || "Standard-Adresse"}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                            <Lock size={11} />
                            Adresse kann nachträglich nicht geändert werden
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <fieldset>
                    <legend className={styles.label}>Bezahlung</legend>
                    <div className={styles.segment}>
                        <PaymentTypeButton active={paymentType === "hourly"} onClick={() => setPaymentType("hourly")}>
                            Stundenlohn
                        </PaymentTypeButton>
                        <PaymentTypeButton active={paymentType === "fixed"} onClick={() => setPaymentType("fixed")}>
                            Pauschale
                        </PaymentTypeButton>
                    </div>
                </fieldset>

                <div className="space-y-2">
                    <label htmlFor="wage_hourly" className={styles.label}>
                        {paymentType === "hourly" ? "Stundenlohn (€)" : "Pauschale (€)"} *
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="decimal"
                            id="wage_hourly"
                            name="wage_hourly"
                            value={wage}
                            onChange={(event) => setWage(event.target.value)}
                            required
                            min="0.5"
                            max="100000"
                            step="0.50"
                            className={cn(styles.input, styles.amount)}
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--text-muted)]">
                            €{paymentType === "hourly" ? "/Std." : ""}
                        </span>
                    </div>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {categoryId ? (
                    <motion.div
                        initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
                        className="overflow-hidden"
                    >
                        <CompensationRecommendation
                            categoryId={categoryId}
                            onApply={(value, type) => {
                                setWage(value);
                                setPaymentType(type);
                            }}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className="grid grid-cols-1 gap-6 pt-1 md:grid-cols-2">
                <fieldset>
                    <legend className={styles.label}>Reichweite</legend>
                    <div className="grid grid-cols-1 gap-3">
                        <ReachOption
                            value="internal_rheinbach"
                            defaultChecked={job.reach === "internal_rheinbach" || !job.reach}
                            title={`Lokal in ${marketName}`}
                            description={`Nur für Nutzer aus ${marketName} sichtbar.`}
                        />
                        <ReachOption
                            value="extended"
                            defaultChecked={job.reach === "extended"}
                            title="Überregional"
                            description="Auch für Nutzer aus umliegenden Städten sichtbar."
                        />
                    </div>
                </fieldset>

                <div className="space-y-2">
                    <label htmlFor={statusIsProtected ? undefined : "status"} className={styles.label}>
                        Status
                    </label>
                    {statusIsProtected ? (
                        <div className={styles.inset}>
                            <p className="text-sm font-semibold text-[var(--text-strong)]">{statusInfo.label}</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                                Dieser Status wird sicher über den Bewerbungsablauf verwaltet und bleibt beim Speichern unverändert.
                            </p>
                        </div>
                    ) : (
                        <select
                            id="status"
                            name="status"
                            value={selectedStatus}
                            onChange={event => setSelectedStatus(event.target.value as Job["status"])}
                            required
                            className={styles.input}
                        >
                            {editableStatuses.map((status) => (
                                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            {needsPayment && <div className={cn(styles.inset, styles.paymentNotice)}>
                <CreditCard size={19} aria-hidden="true" /><div><strong>Vor dem Veröffentlichen</strong><p>Deine Änderungen werden zuerst gespeichert. Danach hinterlegst du ein Zahlungsmittel und kehrst zu diesem Job zurück. Der Job bleibt bis dahin unveröffentlicht.</p></div>
            </div>}

            <div className={styles.actions}>
                <button type="button" className={cn("app-glass-control", styles.action)} onClick={() => router.back()} disabled={isLoading}>
                    Abbrechen
                </button>
                <button type="submit" disabled={isLoading || !categoryId} className={cn("app-primary-action app-glass-control", styles.action)}>
                    {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Speichern
                        </>
                    ) : (
                        needsPayment ? "Speichern und Zahlungsmittel hinterlegen" : "Änderungen speichern"
                    )}
                </button>
            </div>
            </fieldset>
        </form>
    );
}

function JobKindOption({
    icon,
    title,
    description,
    selected,
    disabled,
    onSelect,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    selected: boolean;
    disabled: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={disabled}
            aria-pressed={selected}
            className={cn("app-glass-control", styles.option)}
        >
            <span className={cn(
                "inline-grid size-9 shrink-0 place-items-center",
                selected ? "text-[var(--app-accent-ink)]" : "text-[var(--app-muted)]",
            )}>
                {icon}
            </span>
            <span>
                <strong className="block text-sm font-semibold text-[var(--text-strong)]">{title}</strong>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{description}</span>
            </span>
        </button>
    );
}

function PaymentTypeButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn("app-glass-control", styles.segmentButton)}
        >
            {children}
        </button>
    );
}

function CompensationRecommendation({
    categoryId,
    onApply,
}: {
    categoryId: string;
    onApply: (value: string, type: "hourly" | "fixed") => void;
}) {
    const selectedCategory = JOB_CATEGORIES.find((category) => category.id === categoryId);
    if (!selectedCategory) return null;

    const average = ((selectedCategory.recommendedWage.min + selectedCategory.recommendedWage.max) / 2).toFixed(2);

    return (
        <div className={cn(styles.inset, "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between")}>
            <div>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Orientierung für eine faire Vergütung</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    {selectedCategory.hint} Üblich sind etwa{" "}
                    <strong className="font-semibold tabular-nums text-[var(--text-strong)]">
                        {selectedCategory.recommendedWage.min}–{selectedCategory.recommendedWage.max} €
                    </strong>.
                </p>
            </div>
            <button
                type="button"
                onClick={() => onApply(average, selectedCategory.defaultPaymentType)}
                className={cn("app-glass-control", styles.action)}
            >
                {average} € übernehmen
            </button>
        </div>
    );
}

function ReachOption({
    value,
    defaultChecked,
    title,
    description,
}: {
    value: "internal_rheinbach" | "extended";
    defaultChecked: boolean;
    title: string;
    description: string;
}) {
    return (
        <label className={styles.reach}>
            <input
                type="radio"
                name="reach"
                value={value}
                defaultChecked={defaultChecked}
                required
                className="peer sr-only"
            />
            <span className={cn("app-glass-control", styles.choice)}>
                <span className="block text-sm font-semibold text-[var(--text-strong)]">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{description}</span>
            </span>
        </label>
    );
}

function getEditableStatuses(status: Job["status"]): EditableJobStatus[] {
    if (status === "draft") return ["draft", "open", "closed"];
    if (status === "closed") return ["closed", "open"];
    if (status === "open") return ["open", "closed"];
    return [];
}
