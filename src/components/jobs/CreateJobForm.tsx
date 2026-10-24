"use client";

import { createJob, type CreateJobActionState } from "@/app/app-home/offers/actions";
import { AlertTriangle, CheckCircle2, CreditCard, FileEdit, Loader2, MapPin, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useActionState, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { LocationAutocomplete, LocationDetails } from "@/components/ui/LocationAutocomplete";
import { hasMeaningfulJobDraft, useJobFormPersistence, type JobDraftData } from "@/hooks/use-job-persistence";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { JOB_CATEGORIES, PaymentType } from "@/lib/constants/jobCategories";
import { getPaymentSettingsHref } from "@/lib/payments/return-path";
import styles from "./JobForm.module.css";

function SubmitButtons({ paymentRequired, onPreparePayment }: { paymentRequired: boolean; onPreparePayment: () => boolean }) {
    const { pending } = useFormStatus();
    const [activeIntent, setActiveIntent] = useState<"draft" | "create" | null>(null);

    useEffect(() => {
        if (!pending) setActiveIntent(null);
    }, [pending]);

    const draftPending = pending && activeIntent === "draft";
    const publishPending = pending && activeIntent === "create";

    return (
        <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:min-w-[430px] sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.25fr)]">
            <button
                type="submit"
                name="intent"
                value="draft"
                disabled={pending}
                onClick={() => setActiveIntent("draft")}
                className={cn("app-glass-control", styles.action)}
            >
                {draftPending ? <Loader2 size={17} className="animate-spin" /> : <FileEdit size={17} />}
                <span>Entwurf</span>
            </button>
            {paymentRequired ? <Link
                href={getPaymentSettingsHref("/app-home/offers/new?resume=payment")}
                prefetch={false}
                aria-disabled={pending || undefined}
                onClick={event => { if (pending || !onPreparePayment()) event.preventDefault(); }}
                className={cn("app-primary-action app-glass-control", styles.action)}
            ><CreditCard size={17} aria-hidden="true" /><span>Zahlungsmittel hinterlegen</span></Link> : <button
                type="submit"
                name="intent"
                value="create"
                disabled={pending}
                onClick={() => setActiveIntent("create")}
                className={cn("app-primary-action app-glass-control", styles.action)}
            >
                {publishPending ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                <span>Veröffentlichen</span>
            </button>}
        </div>
    );
}

type DefaultLocation = {
    id: string;
    public_label: string | null;
    address_line1: string | null;
    city: string | null;
    postal_code: string | null;
};

const inputClass = styles.input;
const fieldLabelClass = styles.label;
const sectionClass = styles.section;

export function CreateJobForm({ defaultLocation, marketName, paymentRequired = false }: { defaultLocation?: DefaultLocation | null, marketName: string; paymentRequired?: boolean }) {
    const [state, formAction, actionPending] = useActionState<CreateJobActionState, FormData>(createJob, null);
    const router = useRouter();
    const reduceMotion = useReducedMotion();

    // Persistence Hook
    const { draft, hasRestoredDraft, isLoaded, saveDraft, clearDraft, completeDraft } = useJobFormPersistence();
    const hasDraft = draft !== null;
    const hasDefaultLocation = Boolean(defaultLocation);

    // Local State (Controlled Inputs)
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [wage, setWage] = useState("");
    const [categoryId, setCategoryId] = useState<string>("");
    const [paymentType, setPaymentType] = useState<PaymentType>("hourly");
    const [useCustomLocation, setUseCustomLocation] = useState(!defaultLocation);
    const [location, setLocation] = useState<LocationDetails | null>(null);
    const [reach, setReach] = useState<"internal_rheinbach" | "extended">("internal_rheinbach");
    const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
    const succeeded = state?.status === "success";
    const needsPayment = paymentRequired || (state?.status === "error" && state.error.code === "buyer_payment_required");
    const submittingRef = useRef(false);
    const navigatedRef = useRef(false);

    // Cinematic Scroll Reference
    const titleRef = useRef<HTMLDivElement>(null);
    const hasAppliedInitialDraftRef = useRef(false);

    const finishSavedJob = useCallback(() => {
        if (navigatedRef.current) return;
        if (!completeDraft()) {
            setDraftSaveError("Dein Job ist gespeichert. Der lokale Entwurf konnte noch nicht entfernt werden. Bitte versuche es erneut; veröffentliche den Job nicht noch einmal.");
            return;
        }
        navigatedRef.current = true;
        router.push("/app-home/offers");
        router.refresh();
    }, [completeDraft, router]);

    useEffect(() => {
        if (!succeeded) return;
        let active = true;
        queueMicrotask(() => { if (active) finishSavedJob(); });
        return () => { active = false; };
    }, [succeeded, finishSavedJob]);
    useEffect(() => {
        if (!actionPending && !succeeded) submittingRef.current = false;
    }, [actionPending, succeeded]);

    // Load from Draft on Mount
    useEffect(() => {
        if (!isLoaded || hasAppliedInitialDraftRef.current) return;
        hasAppliedInitialDraftRef.current = true;
        if (draft) {
            if (draft.title) setTitle(draft.title);
            if (draft.description) setDescription(draft.description);
            if (draft.wage) setWage(draft.wage);
            if (draft.category) setCategoryId(draft.category);
            if (draft.paymentType) setPaymentType(draft.paymentType as "hourly" | "fixed");
            if (draft.reach === "extended") setReach("extended");
            if (typeof draft.isDefaultLocation === "boolean") setUseCustomLocation(!draft.isDefaultLocation);

            if (draft.location && draft.isDefaultLocation !== true) {
                setUseCustomLocation(true);
                setLocation({
                    address_line1: draft.location.address,
                    lat: draft.location.lat ?? 0,
                    lng: draft.location.lng ?? 0,
                    city: draft.location.city || "",
                    postal_code: draft.location.zip || "",
                    public_label: draft.location.label || ""
                });
            }
        }
    }, [isLoaded, draft]);

    const currentDraft = useMemo<JobDraftData>(() => ({
            title,
            description,
            wage,
            category: categoryId,
            paymentType,
            jobKind: "one_time",
            location: useCustomLocation && location ? {
                address: location.address_line1,
                lat: location.lat,
                lng: location.lng,
                city: location.city,
                zip: location.postal_code,
                label: location.public_label,
                isDefault: !useCustomLocation,
            } : undefined,
            isDefaultLocation: !useCustomLocation,
            reach,
        }), [title, description, wage, categoryId, paymentType, location, useCustomLocation, reach]);

    // Keep the normal debounce; leaving for payment explicitly flushes it below.
    useEffect(() => {
        if (!isLoaded || succeeded) return;
        if (!hasDraft && !hasMeaningfulJobDraft(currentDraft, hasDefaultLocation)) return;
        const timer = setTimeout(() => saveDraft(currentDraft), 800);
        return () => clearTimeout(timer);
    }, [currentDraft, isLoaded, saveDraft, hasDraft, hasDefaultLocation, succeeded]);

    const preparePayment = () => {
        const saved = isLoaded && saveDraft(currentDraft);
        setDraftSaveError(saved ? null : "Dein Entwurf konnte auf diesem Gerät nicht gesichert werden. Bitte bleib hier und versuche es erneut.");
        return saved;
    };

    if (succeeded) return <section className={styles.form} aria-label="Job gespeichert">
        <p role="status">Dein Job ist gespeichert.</p>
        {draftSaveError && <><p className={styles.saveError} role="alert">{draftSaveError}</p><button autoFocus type="button" className={cn("app-glass-control", styles.action)} onClick={finishSavedJob}>Entwurf entfernen und weiter</button></>}
    </section>;

    return (
        <form action={formAction} className={cn(styles.form, "space-y-7")} aria-busy={actionPending}
            onSubmit={event => {
                if (submittingRef.current || actionPending) { event.preventDefault(); return; }
                submittingRef.current = true;
            }}>
            <input type="hidden" name="use_default_location" value={(!useCustomLocation && defaultLocation) ? "true" : "false"} />
            <input type="hidden" name="category" value={categoryId} />
            <input type="hidden" name="payment_type" value={paymentType} />
            <input type="hidden" name="job_kind" value="one_time" />
            <input type="hidden" name="recurrence_rule" value="" />
            <input type="hidden" name="continuity_preferred" value="false" />
            {/* Hidden inputs for Location Data (to be picked up by Server Action) */}
            {useCustomLocation && location && (
                <>
                    <input type="hidden" name="public_lat" value={location.lat} />
                    <input type="hidden" name="public_lng" value={location.lng} />
                    <input type="hidden" name="address_full" value={location.public_label} />
                    {/* Fallback address string if needed */}
                </>
            )}

            <div className="space-y-7">
                {isLoaded && hasRestoredDraft && draft && (
                    <div className={styles.draftNotice}>
                        <span className="flex items-center gap-2 font-semibold">
                            <Save size={13} />
                            Entwurf automatisch wiederhergestellt
                        </span>
                        <button
                            type="button"
                            onClick={() => { clearDraft(); setTitle(""); setDescription(""); setWage(""); setCategoryId(""); setPaymentType("hourly"); setLocation(null); setUseCustomLocation(!defaultLocation); setReach("internal_rheinbach"); setDraftSaveError(null); }}
                            className={styles.discard}
                        >
                            <Trash2 size={12} />
                            Verwerfen
                        </button>
                    </div>
                )}

                {/* Category Selection */}
                <div>
                    <label className="mb-3 block text-sm font-semibold text-[var(--text-default)]">Welche Art von Hilfe suchst du? *</label>
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
                                        if (!draft || !draft.paymentType) {
                                            setPaymentType(category.defaultPaymentType);
                                        }
                                    }}
                                    className={cn("app-glass-control", styles.option, styles.category)}
                                >
                                    {isSelected && (
                                        <span className={styles.categoryCheck}>
                                            <CheckCircle2 size={13} />
                                        </span>
                                    )}
                                    <span className={styles.categoryIcon}>
                                        <Icon
                                            size={28}
                                            strokeWidth={1.5}
                                            className={cn(
                                                "transition-colors duration-150",
                                                isSelected ? "text-[var(--brand)]" : "text-[var(--text-muted)]"
                                            )}
                                        />
                                    </span>
                                    <span className={cn(
                                        "text-xs font-medium text-center transition-colors duration-150",
                                        isSelected ? "text-[var(--brand)]" : "text-[var(--text-default)]"
                                    )}>
                                        {category.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div ref={titleRef} className={cn(sectionClass, "scroll-mt-8")}>
                    <label htmlFor="title" className={fieldLabelClass}>Titel des Jobs *</label>
                    <input
                        type="text"
                        id="title"
                        name="title"
                        required
                        minLength={5}
                        maxLength={120}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="z.B. Rasenmähen am Wochenende"
                        className={cn(inputClass, "h-12")}
                    />
                </div>

                <div>
                    <label htmlFor="description" className={fieldLabelClass}>Beschreibung *</label>
                    <textarea
                        id="description"
                        name="description"
                        required
                        minLength={10}
                        maxLength={5000}
                        rows={5}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Beschreibe, was zu tun ist..."
                        className={cn(inputClass, "resize-y py-3 leading-relaxed")}
                    />
                </div>

                {/* Location Section */}
                <div className={cn(sectionClass, "space-y-3")}>
                    <p className={fieldLabelClass}>Einsatzort *</p>

                    {defaultLocation && (
                        <button
                            type="button"
                            aria-pressed={!useCustomLocation}
                            onClick={() => { setUseCustomLocation(false); setLocation(null); }}
                            className={cn("app-glass-control", styles.option)}
                        >
                            <div className={cn(
                                "flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 transition-colors",
                                !useCustomLocation ? "border-[var(--brand)] bg-[var(--brand)]" : "border-[var(--border-strong)]"
                            )}>
                                {!useCustomLocation && <div className="mb-px h-1.5 w-1.5 rounded-full bg-white" />}
                            </div>

                            <div className="flex-1">
                                <h4 className={cn("text-sm font-semibold", !useCustomLocation ? "text-[var(--brand)]" : "text-[var(--text-default)]")}>
                                    Standard-Adresse (Privat)
                                </h4>
                                <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                                    {defaultLocation.public_label || "Mein Ort"} <br />
                                    <span className="opacity-70">{defaultLocation.address_line1}, {defaultLocation.city}</span>
                                </p>
                            </div>
                            <MapPin className="ml-auto shrink-0 text-[var(--text-faint)]" size={22} />
                        </button>
                    )}

                    <div
                        className={cn(styles.inset, "space-y-3")}
                    >
                        <button
                            type="button"
                            aria-pressed={useCustomLocation}
                            onClick={() => setUseCustomLocation(true)}
                            className={styles.locationToggle}
                        >
                            <div className={cn(
                                "flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 transition-colors",
                                useCustomLocation ? "border-[var(--brand)] bg-[var(--brand)]" : "border-[var(--border-strong)]"
                            )}>
                                {useCustomLocation && <div className="mb-px h-1.5 w-1.5 rounded-full bg-white" />}
                            </div>
                            <div className="flex-1">
                                <h4 className={cn("mb-1 text-sm font-semibold", useCustomLocation ? "text-[var(--brand)]" : "text-[var(--text-default)]")}>
                                    Anderer Einsatzort
                                </h4>
                            </div>
                        </button>

                        {useCustomLocation ? (
                            <div>
                                <LocationAutocomplete
                                    inputId="job-location-search"
                                    onSelect={setLocation}
                                    onInputChange={() => setLocation(null)}
                                    defaultValue={location?.public_label}
                                    placeholder="Adresse suchen (z. B. Stadtpark Rheinbach)"
                                    className="job-create-location-search mt-2"
                                />
                                {location ? (
                                    <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]">
                                        <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                                        Die genaue Adresse sehen nur berechtigte Beteiligte nach einer verbindlichen Zusage.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className={cn(sectionClass, "space-y-4")}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className={fieldLabelClass}>Bezahlung</label>
                            <div className={styles.segment}>
                                <button
                                    type="button"
                                    onClick={() => setPaymentType("hourly")}
                                    aria-pressed={paymentType === "hourly"}
                                    className={cn("app-glass-control", styles.segmentButton)}
                                >
                                    Stundenlohn
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentType("fixed")}
                                    aria-pressed={paymentType === "fixed"}
                                    className={cn("app-glass-control", styles.segmentButton)}
                                >
                                    Pauschale
                                </button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="wage" className={fieldLabelClass}>
                                {paymentType === "hourly" ? "Stundenlohn (€)" : "Pauschale (€)"} *
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    id="wage"
                                    name="wage"
                                    required
                                    min="0.5"
                                    max="100000"
                                    step="0.50"
                                    value={wage}
                                    onChange={(e) => setWage(e.target.value)}
                                    placeholder={paymentType === "hourly" ? "15.00" : "50.00"}
                                    className={cn(inputClass, styles.amount)}
                                />
                                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--text-muted)]">
                                    € {paymentType === "hourly" && <span className="text-xs">/h</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Compensation Suggestion (Animated) moved below inputs */}
                    <AnimatePresence initial={false}>
                        {categoryId && (
                            <motion.div
                                initial={reduceMotion ? false : { opacity: 0, height: 0, marginTop: 0 }}
                                animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
                                className="overflow-hidden"
                            >
                                <div className={styles.inset}>
                                    {(() => {
                                        const selectedCat = JOB_CATEGORIES.find(c => c.id === categoryId);
                                        if (!selectedCat) return null;

                                        const avg = ((selectedCat.recommendedWage.min + selectedCat.recommendedWage.max) / 2).toFixed(2);

                                        return (
                                            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <h4 className="mb-0.5 text-sm font-semibold text-[var(--text-strong)]">
                                                        Orientierung für eine faire Vergütung
                                                    </h4>
                                                    <p className="m-0 text-xs leading-relaxed text-[var(--text-muted)]">
                                                        {selectedCat.hint} Üblich sind <strong className="font-semibold text-[var(--text-strong)]">{selectedCat.recommendedWage.min}–{selectedCat.recommendedWage.max} €</strong>.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setWage(avg);
                                                        setPaymentType(selectedCat.defaultPaymentType);
                                                    }}
                                                    className={cn("app-glass-control", styles.action)}
                                                >
                                                    {avg} € {selectedCat.defaultPaymentType === 'hourly' ? '/ Std' : 'pau.'} übernehmen
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <div className={cn(sectionClass, "space-y-3")}>
                <label className={fieldLabelClass}>Reichweite</label>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className={styles.reach}>
                        <input type="radio" name="reach" value="internal_rheinbach" checked={reach === "internal_rheinbach"} onChange={() => setReach("internal_rheinbach")} className="peer sr-only" />
                        <div className={cn("app-glass-control", styles.choice)}>
                            <h4 className="text-sm font-semibold text-[var(--text-strong)]">Lokal in {marketName}</h4>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Nur für Nutzer aus {marketName} sichtbar. Perfekt für Nachbarschaftshilfe.</p>
                        </div>
                    </label>
                    <label className={styles.reach}>
                        <input type="radio" name="reach" value="extended" checked={reach === "extended"} onChange={() => setReach("extended")} className="peer sr-only" />
                        <div className={cn("app-glass-control", styles.choice)}>
                            <h4 className="text-sm font-semibold text-[var(--text-strong)]">Überregional</h4>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Auch für Nutzer aus umliegenden Städten sichtbar.</p>
                        </div>
                    </label>
                </div>
            </div>

            {
                state?.status === "error" && state.error.code !== "buyer_payment_required" && (
                    <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
                        <div className="font-semibold flex items-center gap-2">
                            <AlertTriangle size={14} />
                            Fehler
                        </div>
                        <div className="mt-1 font-mono text-xs break-words pl-6">
                            {state.error.code ? `${state.error.code}: ` : ""}{state.error.message}
                        </div>
                    </div>
                )
            }

            {needsPayment && <div className={cn(styles.inset, styles.paymentNotice)}>
                <CreditCard size={19} aria-hidden="true" />
                <div><strong>Zahlungsmittel vor Veröffentlichung</strong><p>Hinterlege ein Zahlungsmittel und kehre danach zu deinem Entwurf zurück. Es wird jetzt nichts bezahlt.</p></div>
            </div>}
            {draftSaveError && <p className={styles.saveError} role="alert">{draftSaveError}</p>}

            <div className={styles.actions}>
                <p className="max-w-xs text-xs leading-5 text-[var(--text-muted)]">
                    {`Nach dem Veröffentlichen ist der Job für passende Jobsuchende in ${marketName} sichtbar.`}
                </p>
                <SubmitButtons paymentRequired={needsPayment} onPreparePayment={preparePayment} />
            </div>
        </form >
    );
}
