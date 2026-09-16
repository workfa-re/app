"use client";

import {
    AlertCircle,
    BellRing,
    CheckCircle2,
    Loader2,
    Mail,
    RefreshCw,
    ShieldCheck,
} from "lucide-react";
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
    type BooleanNotificationPreference,
    type DigestFrequency,
    type NotificationPreferences,
    normalizeNotificationPreferences,
} from "@/components/notifications/notificationPreferences";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

type PreferenceOption = {
    key: BooleanNotificationPreference;
    label: string;
    description: string;
};

const IN_APP_OPTIONS: PreferenceOption[] = [
    {
        key: "in_app_application_updates",
        label: "Bewerbungen",
        description: "Neue Bewerbungen, Annahmen, Ablehnungen und Statusänderungen.",
    },
    {
        key: "in_app_messages",
        label: "Nachrichten",
        description: "Neue Nachrichten und Öffnungsanfragen in deinen Gesprächen.",
    },
    {
        key: "in_app_waitlist_updates",
        label: "Warteliste",
        description: "Neue Positionen und automatisches Nachrücken.",
    },
    {
        key: "in_app_appointments",
        label: "Termine",
        description: "Vereinbarte, geänderte oder abgesagte Termine.",
    },
];

const EMAIL_OPTIONS: PreferenceOption[] = [
    {
        key: "email_application_updates",
        label: "Bewerbungen",
        description: "Wichtige Änderungen an Bewerbungen und vergebenen Jobs.",
    },
    {
        key: "email_messages",
        label: "Nachrichten",
        description: "Hinweise auf neue Nachrichten in deinen Gesprächen.",
    },
    {
        key: "email_waitlist_updates",
        label: "Warteliste",
        description: "Änderungen an deiner Position und automatisches Nachrücken.",
    },
    {
        key: "email_appointments",
        label: "Termine",
        description: "Bestätigungen und Änderungen vereinbarter Termine.",
    },
    {
        key: "email_job_updates",
        label: "Passende Jobs",
        description: "Neue passende Jobs in deiner Nähe.",
    },
];

const FREQUENCIES: Array<{ value: DigestFrequency; label: string; description: string }> = [
    { value: "instant", label: "Sofort", description: "Direkt nach dem Ereignis" },
    { value: "daily", label: "Täglich", description: "Als tägliche Übersicht" },
    { value: "weekly", label: "Wöchentlich", description: "Als Wochenübersicht" },
];

export function NotificationSettingsForm({
    initialPrefs,
    currentUserId,
    initialLoadError,
}: {
    initialPrefs: NotificationPreferences;
    currentUserId: string;
    initialLoadError: boolean;
}) {
    const [prefs, setPrefs] = useState(initialPrefs);
    const [savedPrefs, setSavedPrefs] = useState(initialPrefs);
    const [loadError, setLoadError] = useState(initialLoadError);
    const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
    const [isSavePending, startSaveTransition] = useTransition();
    const [isReloadPending, startReloadTransition] = useTransition();
    const dirty = useMemo(
        () => Object.entries(prefs).some(([key, value]) => savedPrefs[key as keyof NotificationPreferences] !== value),
        [prefs, savedPrefs],
    );
    const controlsDisabled = loadError || isSavePending || isReloadPending;

    const setBooleanPreference = (key: BooleanNotificationPreference, checked: boolean) => {
        setPrefs((current) => ({ ...current, [key]: checked }));
        setFeedback(null);
    };

    const setFrequency = (value: DigestFrequency) => {
        setPrefs((current) => ({ ...current, digest_frequency: value }));
        setFeedback(null);
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!dirty || controlsDisabled) return;

        startSaveTransition(async () => {
            setFeedback(null);
            try {
                const { data, error } = await supabaseBrowser
                    .from("notification_preferences")
                    .upsert({
                        user_id: currentUserId,
                        ...prefs,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: "user_id" })
                    .select("*")
                    .single();

                if (error) {
                    setFeedback({
                        tone: "error",
                        message: "Die Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.",
                    });
                    return;
                }

                const persistedPrefs = normalizeNotificationPreferences(data);
                setPrefs(persistedPrefs);
                setSavedPrefs(persistedPrefs);
                setFeedback({ tone: "success", message: "Deine Einstellungen wurden gespeichert." });
            } catch {
                setFeedback({
                    tone: "error",
                    message: "Die Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.",
                });
            }
        });
    };

    const retryLoad = () => {
        if (isReloadPending) return;
        startReloadTransition(async () => {
            setFeedback(null);
            try {
                const { data, error } = await supabaseBrowser
                    .from("notification_preferences")
                    .select("*")
                    .eq("user_id", currentUserId)
                    .maybeSingle();

                if (error) {
                    setLoadError(true);
                    return;
                }

                const loadedPrefs = normalizeNotificationPreferences(data);
                setPrefs(loadedPrefs);
                setSavedPrefs(loadedPrefs);
                setLoadError(false);
                setFeedback({ tone: "success", message: "Deine Einstellungen wurden geladen." });
            } catch {
                setLoadError(true);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} aria-busy={isSavePending || isReloadPending} className="notification-settings-form space-y-5">
            {loadError ? (
                <div role="alert" className="grid gap-3 rounded-2xl bg-red-500/10 px-4 py-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--danger)_24%,transparent)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <p className="flex min-w-0 items-start gap-2 text-pretty text-sm leading-5 text-red-700 dark:text-red-300">
                        <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
                        Deine gespeicherten Einstellungen konnten nicht geladen werden. Bis das klappt, bleibt Speichern sicher gesperrt.
                    </p>
                    <button
                        type="button"
                        onClick={retryLoad}
                        disabled={isReloadPending}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-[var(--text-default)] shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[var(--surface-muted)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        {isReloadPending
                            ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={16} />
                            : <RefreshCw aria-hidden="true" size={16} />}
                        {isReloadPending ? "Wird geladen …" : "Erneut laden"}
                    </button>
                </div>
            ) : null}

            <ChannelSection
                icon={<BellRing aria-hidden="true" size={19} />}
                title="In der Plattform"
                description="Persönliche Hinweise im Benachrichtigungsbereich von Workfare."
                enabled={prefs.in_app_enabled}
                enabledKey="in_app_enabled"
                options={IN_APP_OPTIONS}
                prefs={prefs}
                pending={controlsDisabled}
                onToggle={setBooleanPreference}
            >
                <div className="mt-2 flex items-start gap-2.5 rounded-xl bg-[var(--surface-muted)] px-3.5 py-3 text-[var(--text-muted)] shadow-[0_0_0_1px_var(--border-subtle)]">
                    <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--brand)]" size={17} />
                    <p className="text-pretty text-xs leading-5">
                        Kritische System-, Konto- und Sicherheitshinweise bleiben unabhängig von dieser Auswahl aktiv.
                    </p>
                </div>
            </ChannelSection>

            <ChannelSection
                icon={<Mail aria-hidden="true" size={19} />}
                title="Per E-Mail"
                description="Deine Auswahl wird gespeichert. Der Versand wird mit dem E-Mail-Dienst freigeschaltet."
                enabled={prefs.email_enabled}
                enabledKey="email_enabled"
                options={EMAIL_OPTIONS}
                prefs={prefs}
                pending={controlsDisabled}
                onToggle={setBooleanPreference}
            >
                <fieldset disabled={!prefs.email_enabled || controlsDisabled} className="mt-5 border-t border-[var(--border-subtle)] pt-5 disabled:opacity-50">
                    <legend className="text-sm font-semibold text-[var(--text-strong)]">E-Mail-Häufigkeit</legend>
                    <p id="notification-frequency-description" className="mt-1 text-pretty text-sm leading-5 text-[var(--text-muted)]">
                        Lege schon jetzt fest, ob E-Mails später direkt oder gesammelt verschickt werden.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-describedby="notification-frequency-description">
                        {FREQUENCIES.map((frequency) => (
                            <label
                                key={frequency.value}
                                className={cn(
                                    "relative flex min-h-14 cursor-pointer flex-col justify-center rounded-xl px-3.5 py-2.5 shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100",
                                    prefs.digest_frequency === frequency.value
                                        ? "bg-[color-mix(in_srgb,var(--brand)_10%,var(--surface-solid))] shadow-[0_0_0_1px_var(--brand)]"
                                        : "bg-[var(--surface-solid)] hover:bg-[var(--surface-muted)]",
                                    (!prefs.email_enabled || controlsDisabled) && "cursor-not-allowed active:scale-100",
                                )}
                            >
                                <input
                                    type="radio"
                                    name="digest_frequency"
                                    value={frequency.value}
                                    checked={prefs.digest_frequency === frequency.value}
                                    onChange={() => setFrequency(frequency.value)}
                                    className="sr-only"
                                />
                                <span className="text-sm font-semibold text-[var(--text-strong)]">{frequency.label}</span>
                                <span className="mt-0.5 text-xs leading-4 text-[var(--text-muted)]">{frequency.description}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            </ChannelSection>

            <div className="rounded-2xl bg-[var(--surface-solid)] p-4 shadow-[0_0_0_1px_var(--border-subtle)] sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div className="min-h-6 min-w-0" aria-live="polite">
                    {feedback ? (
                        <p
                            role={feedback.tone === "error" ? "alert" : "status"}
                            className={cn(
                                "flex items-start gap-2 text-pretty text-sm",
                                feedback.tone === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300",
                            )}
                        >
                            {feedback.tone === "success" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0" size={16} /> : null}
                            {feedback.message}
                        </p>
                    ) : (
                        <p className="text-pretty text-xs leading-5 text-[var(--text-muted)]">
                            Änderungen gelten nur für dein eigenes Konto.
                        </p>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={!dirty || controlsDisabled}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--brand)_22%,transparent)] transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[var(--brand-strong)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 sm:mt-0 sm:w-auto"
                >
                    {isSavePending ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={17} /> : null}
                    {isSavePending ? "Wird gespeichert …" : "Einstellungen speichern"}
                </button>
            </div>
        </form>
    );
}

function ChannelSection({
    icon,
    title,
    description,
    enabled,
    enabledKey,
    options,
    prefs,
    pending,
    onToggle,
    children,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    enabled: boolean;
    enabledKey: BooleanNotificationPreference;
    options: PreferenceOption[];
    prefs: NotificationPreferences;
    pending: boolean;
    onToggle: (key: BooleanNotificationPreference, checked: boolean) => void;
    children?: ReactNode;
}) {
    const titleId = `notification-channel-${enabledKey}`;
    const descriptionId = `${titleId}-description`;

    return (
        <section className="rounded-2xl bg-[var(--surface-solid)] p-4 shadow-[0_0_0_1px_var(--border-subtle),0_10px_30px_rgba(15,23,42,0.04)] sm:p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--brand)]">
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-balance text-base font-semibold text-[var(--text-strong)]">{title}</h2>
                        <p id={descriptionId} className="mt-1 text-pretty text-sm leading-5 text-[var(--text-muted)]">{description}</p>
                    </div>
                </div>
                <PreferenceSwitch
                    checked={enabled}
                    disabled={pending}
                    labelledBy={titleId}
                    describedBy={descriptionId}
                    onChange={(checked) => onToggle(enabledKey, checked)}
                />
            </div>

            <fieldset disabled={!enabled || pending} className="mt-5 border-t border-[var(--border-subtle)] pt-2 disabled:opacity-50">
                <legend className="sr-only">{title} auswählen</legend>
                <div className="divide-y divide-[var(--border-subtle)]">
                    {options.map((option) => (
                        <PreferenceCheckbox
                            key={option.key}
                            option={option}
                            checked={prefs[option.key]}
                            disabled={!enabled || pending}
                            onChange={(checked) => onToggle(option.key, checked)}
                        />
                    ))}
                </div>
            </fieldset>
            {children}
        </section>
    );
}

function PreferenceSwitch({
    checked,
    disabled,
    labelledBy,
    describedBy,
    onChange,
}: {
    checked: boolean;
    disabled: boolean;
    labelledBy: string;
    describedBy: string;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl outline-none transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
            <span
                aria-hidden="true"
                className={cn(
                    "relative h-6 w-11 rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)] transition-[background-color,box-shadow] duration-150 ease-out",
                    checked ? "bg-[var(--brand)]" : "bg-[var(--surface-muted)]",
                )}
            >
                <span className={cn(
                    "absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
                    checked && "translate-x-5",
                )} />
            </span>
        </button>
    );
}

function PreferenceCheckbox({
    option,
    checked,
    disabled,
    onChange,
}: {
    option: PreferenceOption;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className={cn(
            "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] cursor-pointer items-center gap-4 py-3",
            disabled && "cursor-not-allowed",
        )}>
            <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--text-strong)]">{option.label}</span>
                <span className="mt-0.5 block text-pretty text-xs leading-5 text-[var(--text-muted)]">{option.description}</span>
            </span>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                className="size-5 shrink-0 cursor-pointer rounded border-[var(--border-subtle)] bg-[var(--surface-solid)] accent-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed"
            />
        </label>
    );
}
