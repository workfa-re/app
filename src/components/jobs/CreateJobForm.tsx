"use client";

import { createJob } from "@/app/app-home/offers/actions";
import { AlertTriangle, CalendarDays, CheckCircle2, FileEdit, Loader2, MapPin, Repeat2, Save, Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { useActionState, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ErrorInfo } from "@/lib/types/platform";
import { LocationAutocomplete, LocationDetails } from "@/components/ui/LocationAutocomplete";
import { useJobFormPersistence } from "@/hooks/use-job-persistence";
import { motion, AnimatePresence } from "framer-motion";
import { JOB_CATEGORIES, PaymentType } from "@/lib/constants/jobCategories";

function SubmitButtons() {
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
                className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-4 text-sm font-semibold text-[var(--text-default)] transition-[background-color,border-color,color,transform] hover:border-[var(--brand-border)] hover:bg-[var(--surface-solid)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)] disabled:cursor-not-allowed disabled:opacity-55"
            >
                {draftPending ? <Loader2 size={17} className="animate-spin" /> : <FileEdit size={17} className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-strong)]" />}
                <span>Entwurf</span>
            </button>
            <button
                type="submit"
                name="intent"
                value="create"
                disabled={pending}
                onClick={() => setActiveIntent("create")}
                className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-[var(--brand-strong)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)] disabled:cursor-not-allowed disabled:opacity-60"
            >
                {publishPending ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} className="transition-transform group-hover:scale-105" />}
                <span>Veröffentlichen</span>
            </button>
        </div>
    );
}

type CreateJobFormState =
    | null
    | { status: "error"; error: ErrorInfo; debug?: Record<string, unknown> };

type DefaultLocation = {
    id: string;
    public_label: string | null;
    address_line1: string | null;
    city: string | null;
    postal_code: string | null;
};

const inputClass = "w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] px-4 text-sm font-medium text-[var(--text-strong)] transition-[border-color,background-color,box-shadow] placeholder:text-[var(--text-faint)] focus:border-[var(--brand-border)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)]";
const fieldLabelClass = "mb-2 block text-sm font-semibold text-[var(--text-default)]";
const sectionClass = "border-t border-[var(--border-subtle)] pt-6";

export function CreateJobForm({ defaultLocation, marketName }: { defaultLocation?: DefaultLocation | null, marketName: string }) {
    const [state, formAction] = useActionState<CreateJobFormState, FormData>(createJob, null);

    // Persistence Hook
    const { draft, isLoaded, saveDraft, clearDraft } = useJobFormPersistence();

    // Local State (Controlled Inputs)
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [wage, setWage] = useState("");
    const [categoryId, setCategoryId] = useState<string>("");
    const [paymentType, setPaymentType] = useState<PaymentType>("hourly");
    const [jobKind, setJobKind] = useState<"one_time" | "recurring">("one_time");
    const [recurrenceRule, setRecurrenceRule] = useState<"weekly" | "biweekly" | "monthly" | "flexible">("weekly");
    const [continuityPreferred, setContinuityPreferred] = useState(true);
    const [useCustomLocation, setUseCustomLocation] = useState(!defaultLocation);
    const [location, setLocation] = useState<LocationDetails | null>(null);

    // Cinematic Scroll Reference
    const titleRef = useRef<HTMLDivElement>(null);

    // Load from Draft on Mount
    useEffect(() => {
        if (isLoaded && draft) {
            if (draft.title) setTitle(draft.title);
            if (draft.description) setDescription(draft.description);
            if (draft.wage) setWage(draft.wage);
            if (draft.category) setCategoryId(draft.category);
            if (draft.paymentType) setPaymentType(draft.paymentType as "hourly" | "fixed");
            if (draft.jobKind === "recurring") setJobKind("recurring");
            if (draft.recurrenceRule) setRecurrenceRule(draft.recurrenceRule);
            if (typeof draft.continuityPreferred === "boolean") setContinuityPreferred(draft.continuityPreferred);

            // Logic: If draft has a specific location stored, we use custom mode.
            // If draft explicitly says "using default" (we'd need to store that boolean), currently we infer.
            if (draft.location) {
                setUseCustomLocation(true);
                setLocation({
                    address_line1: draft.location.address,
                    lat: draft.location.lat ?? 0,
                    lng: draft.location.lng ?? 0,
                    city: draft.location.city || "",
                    postal_code: draft.location.zip || "",
                    public_label: draft.location.label || ""
                });
            } else if (draft.isDefaultLocation === false) {
                // If we tracked this flag. For now, if location is missing but draft exists, maybe they cleared it?
                // Let's stick to: if location present -> custom.
            }
        }
    }, [isLoaded]); // Run once when loaded

    // Save to Draft on Change (Debounced)
    useEffect(() => {
        if (!isLoaded) return;
        const timer = setTimeout(() => {
            saveDraft({
                title,
                description,
                wage,
                category: categoryId,
                paymentType: paymentType,
                jobKind,
                recurrenceRule,
                continuityPreferred,
                location: location ? {
                    address: location.address_line1,
                    lat: location.lat,
                    lng: location.lng,
                    city: location.city,
                    zip: location.postal_code,
                    label: location.public_label,
                    isDefault: !useCustomLocation // Persist specific location flag if needed inside location object
                } : undefined,
                isDefaultLocation: !useCustomLocation // Persist top-level preference
            });
        }, 800);
        return () => clearTimeout(timer);
    }, [title, description, wage, categoryId, paymentType, jobKind, recurrenceRule, continuityPreferred, location, useCustomLocation, isLoaded, saveDraft]);

    return (
        <form action={formAction} className="space-y-7">
            <input type="hidden" name="use_default_location" value={(!useCustomLocation && defaultLocation) ? "true" : "false"} />
            <input type="hidden" name="category" value={categoryId} />
            <input type="hidden" name="payment_type" value={paymentType} />
            <input type="hidden" name="job_kind" value={jobKind} />
            <input type="hidden" name="recurrence_rule" value={jobKind === "recurring" ? recurrenceRule : ""} />
            <input type="hidden" name="continuity_preferred" value={jobKind === "recurring" && continuityPreferred ? "true" : "false"} />
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
                {isLoaded && draft && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-3 py-2 text-xs text-[var(--brand)]">
                        <span className="flex items-center gap-2 font-semibold">
                            <Save size={13} />
                            Entwurf automatisch wiederhergestellt
                        </span>
                        <button
                            type="button"
                            onClick={() => { clearDraft(); setTitle(""); setDescription(""); setWage(""); setCategoryId(""); setPaymentType("hourly"); setJobKind("one_time"); setRecurrenceRule("weekly"); setContinuityPreferred(true); setLocation(null); setUseCustomLocation(!defaultLocation); }}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
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
                                    className={cn(
                                        "group relative flex min-h-[104px] flex-col items-center justify-center rounded-xl border p-4 transition-[background-color,border-color,transform] duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)]",
                                        isSelected
                                            ? "border-[var(--brand-border)] bg-[var(--brand-soft)]"
                                            : "border-[var(--border-subtle)] bg-[var(--surface-muted)] hover:border-[var(--brand-border)] hover:bg-[var(--surface-solid)]"
                                    )}
                                >
                                    {isSelected && (
                                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand)] text-white">
                                            <CheckCircle2 size={13} />
                                        </span>
                                    )}
                                    <motion.div
                                        animate={{
                                            scale: isSelected ? 1.1 : 1,
                                            y: isSelected ? -2 : 0
                                        }}
                                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                    >
                                        <Icon
                                            size={28}
                                            strokeWidth={1.5}
                                            className={cn(
                                                "mb-3 transition-colors duration-300",
                                                isSelected ? "text-[var(--brand)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-default)]"
                                            )}
                                        />
                                    </motion.div>
                                    <span className={cn(
                                        "text-xs font-semibold text-center transition-colors duration-300",
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

                <div className={cn(sectionClass, "space-y-3")}>
                    <div>
                        <label className={fieldLabelClass}>Wie oft wird die Hilfe gebraucht?</label>
                        <p className="-mt-1 text-xs leading-5 text-[var(--text-muted)]">Das bestimmt, ob später ein einzelner oder mehrere Termine vereinbart werden können.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setJobKind("one_time")}
                            className={cn(
                                "flex min-h-[86px] items-start gap-3 rounded-xl border p-4 text-left transition-[background-color,border-color]",
                                jobKind === "one_time"
                                    ? "border-[var(--brand-border)] bg-[var(--brand-soft)]"
                                    : "border-[var(--border-subtle)] bg-[var(--surface-muted)] hover:border-[var(--brand-border)]",
                            )}
                            aria-pressed={jobKind === "one_time"}
                        >
                            <CalendarDays size={20} className={jobKind === "one_time" ? "text-[var(--brand)]" : "text-[var(--text-muted)]"} />
                            <span>
                                <strong className="block text-sm text-[var(--text-strong)]">Einmaliger Auftrag</strong>
                                <small className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">Ein Termin, danach kann der Job abgeschlossen werden.</small>
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setJobKind("recurring")}
                            className={cn(
                                "flex min-h-[86px] items-start gap-3 rounded-xl border p-4 text-left transition-[background-color,border-color]",
                                jobKind === "recurring"
                                    ? "border-[var(--brand-border)] bg-[var(--brand-soft)]"
                                    : "border-[var(--border-subtle)] bg-[var(--surface-muted)] hover:border-[var(--brand-border)]",
                            )}
                            aria-pressed={jobKind === "recurring"}
                        >
                            <Repeat2 size={20} className={jobKind === "recurring" ? "text-[var(--brand)]" : "text-[var(--text-muted)]"} />
                            <span>
                                <strong className="block text-sm text-[var(--text-strong)]">Regelmäßige Hilfe</strong>
                                <small className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">Dieselbe Zusammenarbeit mit mehreren Terminen.</small>
                            </span>
                        </button>
                    </div>

                    <AnimatePresence initial={false}>
                        {jobKind === "recurring" ? (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-4 sm:grid-cols-2">
                                    <label>
                                        <span className={fieldLabelClass}>Ungefähre Häufigkeit</span>
                                        <select
                                            value={recurrenceRule}
                                            onChange={(event) => setRecurrenceRule(event.target.value as typeof recurrenceRule)}
                                            className={cn(inputClass, "h-12")}
                                        >
                                            <option value="weekly">Wöchentlich</option>
                                            <option value="biweekly">Alle zwei Wochen</option>
                                            <option value="monthly">Monatlich</option>
                                            <option value="flexible">Nach Absprache</option>
                                        </select>
                                    </label>
                                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-3">
                                        <input
                                            type="checkbox"
                                            checked={continuityPreferred}
                                            onChange={(event) => setContinuityPreferred(event.target.checked)}
                                            className="mt-1 h-4 w-4 accent-[var(--brand)]"
                                        />
                                        <span>
                                            <strong className="block text-sm text-[var(--text-strong)]">Möglichst dieselbe Person</strong>
                                            <small className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">Die Zusammenarbeit bleibt offen, bis du sie ausdrücklich abschließt.</small>
                                        </span>
                                    </label>
                                </div>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>

                {/* Location Section */}
                <div className={cn(sectionClass, "space-y-3")}>
                    <p className={fieldLabelClass}>Einsatzort *</p>

                    {defaultLocation && (
                        <button
                            type="button"
                            aria-pressed={!useCustomLocation}
                            onClick={() => { setUseCustomLocation(false); setLocation(null); }}
                            className={cn(
                                "group relative flex w-full items-start gap-3 rounded-xl border p-4 text-left outline-none transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-[var(--focus-halo)]",
                                !useCustomLocation
                                    ? "border-[var(--brand-border)] bg-[var(--brand-soft)]"
                                    : "border-[var(--border-subtle)] bg-[var(--surface-muted)] hover:border-[var(--brand-border)]"
                            )}
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
                        className={cn(
                            "space-y-3 rounded-xl border p-4 transition-[background-color,border-color]",
                            useCustomLocation
                                ? "border-[var(--brand-border)] bg-[var(--brand-soft)]"
                                : "border-[var(--border-subtle)] bg-[var(--surface-muted)] hover:border-[var(--brand-border)]"
                        )}
                    >
                        <button
                            type="button"
                            aria-pressed={useCustomLocation}
                            onClick={() => setUseCustomLocation(true)}
                            className="flex w-full items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-halo)]"
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
                            <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-1">
                                <button
                                    type="button"
                                    onClick={() => setPaymentType("hourly")}
                                    className={cn(
                                        "flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)]",
                                        paymentType === "hourly" ? "bg-[var(--surface-solid)] text-[var(--text-strong)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-default)]"
                                    )}
                                >
                                    Stundenlohn
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentType("fixed")}
                                    className={cn(
                                        "flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--focus-halo)]",
                                        paymentType === "fixed" ? "bg-[var(--surface-solid)] text-[var(--text-strong)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-default)]"
                                    )}
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
                                    className={cn(inputClass, "h-[46px] pr-12")}
                                />
                                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--text-muted)]">
                                    € {paymentType === "hourly" && <span className="text-xs">/h</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Compensation Suggestion (Animated) moved below inputs */}
                    <AnimatePresence>
                        {categoryId && (
                            <motion.div
                                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                className="overflow-hidden"
                            >
                                <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] p-4">
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
                                                    className="min-h-10 shrink-0 rounded-lg border border-[var(--brand-border)] bg-[var(--surface-solid)] px-4 py-2 text-center text-xs font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--surface-raised)]"
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
                    <label className="cursor-pointer">
                        <input type="radio" name="reach" value="internal_rheinbach" defaultChecked className="peer sr-only" />
                        <div className="h-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-4 transition-all hover:border-[var(--brand-border)] peer-checked:border-[var(--brand-border)] peer-checked:bg-[var(--brand-soft)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus-halo)]">
                            <h4 className="text-sm font-semibold text-[var(--text-strong)]">Lokal in {marketName}</h4>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Nur für Nutzer aus {marketName} sichtbar. Perfekt für Nachbarschaftshilfe.</p>
                        </div>
                    </label>
                    <label className="cursor-pointer">
                        <input type="radio" name="reach" value="extended" className="peer sr-only" />
                        <div className="h-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-4 transition-all hover:border-[var(--brand-border)] peer-checked:border-[var(--brand-border)] peer-checked:bg-[var(--brand-soft)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus-halo)]">
                            <h4 className="text-sm font-semibold text-[var(--text-strong)]">Überregional</h4>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Auch für Nutzer aus umliegenden Städten sichtbar.</p>
                        </div>
                    </label>
                </div>
            </div>

            {
                state?.status === "error" && (
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

            <div className="mt-6 flex flex-col justify-between gap-4 border-t border-[var(--border-subtle)] pt-5 sm:flex-row sm:items-center">
                <p className="max-w-xs text-xs leading-5 text-[var(--text-muted)]">
                    {`Nach dem Veröffentlichen ist der Job für passende Jobsuchende in ${marketName} sichtbar.`}
                </p>
                <SubmitButtons />
            </div>
        </form >
    );
}
