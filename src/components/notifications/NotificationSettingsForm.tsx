"use client";

import {
    AlertCircle,
    BellRing,
    CheckCircle2,
    Loader2,
    Mail,
    MessageSquare,
    RefreshCw,
    ShieldCheck,
    Smartphone,
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
        label: "Zusammenarbeit",
        description: "Bewerbungen und Änderungen an deinen Aufträgen.",
    },
    {
        key: "in_app_messages",
        label: "Nachrichten",
        description: "Neue Nachrichten in deinen Gesprächen.",
    },
    {
        key: "in_app_appointments",
        label: "Termine",
        description: "Anfragen, Bestätigungen und Änderungen.",
    },
];

const EMAIL_OPTIONS: PreferenceOption[] = [
    {
        key: "email_application_updates",
        label: "Zusammenarbeit",
        description: "Bewerbungen und Änderungen an deinen Aufträgen.",
    },
    {
        key: "email_messages",
        label: "Nachrichten",
        description: "Neue Nachrichten in deinen Gesprächen.",
    },
    {
        key: "email_appointments",
        label: "Termine",
        description: "Anfragen, Bestätigungen und Änderungen.",
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
                        Deine Einstellungen konnten nicht geladen werden. Bitte lade sie vor dem Bearbeiten erneut.
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
                title="In Workfare"
                description="Hinweise im Benachrichtigungszentrum und in der geöffneten App."
                enabled={prefs.in_app_enabled}
                enabledKey="in_app_enabled"
                options={IN_APP_OPTIONS}
                prefs={prefs}
                pending={controlsDisabled}
                onToggle={setBooleanPreference}
            >
                <div className="mt-4 flex items-start gap-2.5 rounded-2xl [background:var(--app-glass-selected)] px-3.5 py-3 text-[var(--text-muted)]">
                    <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--brand)]" size={17} />
                    <p className="text-pretty text-xs leading-5">
                        Wichtige Konto- und Sicherheitshinweise bleiben aktiv.
                    </p>
                </div>
            </ChannelSection>

            <ChannelSection
                icon={<Mail aria-hidden="true" size={19} />}
                title="Per E-Mail"
                description="Deine Auswahl wird gespeichert. Der E-Mail-Versand ist noch nicht freigeschaltet."
                preparation
                enabled={prefs.email_enabled}
                enabledKey="email_enabled"
                options={EMAIL_OPTIONS}
                prefs={prefs}
                pending={controlsDisabled}
                onToggle={setBooleanPreference}
            >
                <fieldset disabled={!prefs.email_enabled || controlsDisabled} className="mt-5 disabled:opacity-50">
                    <legend className="text-sm font-semibold text-[var(--text-strong)]">E-Mail-Häufigkeit</legend>
                    <p id="notification-frequency-description" className="mt-1 text-pretty text-sm leading-5 text-[var(--text-muted)]">
                        Wie möchtest du E-Mails später erhalten?
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3" aria-describedby="notification-frequency-description">
                        {FREQUENCIES.map((frequency) => (
                            <label
                                key={frequency.value}
                                className={cn(
                                    "relative flex min-h-11 cursor-pointer flex-col justify-center rounded-xl px-2.5 py-2.5 shadow-[0_0_0_1px_var(--border-subtle)] transition-[background-color,box-shadow] duration-150 ease-out focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--brand)] motion-reduce:transition-none sm:min-h-14",
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
                                <span className="text-xs font-semibold text-[var(--text-strong)] sm:text-sm">{frequency.label}</span>
                                <span className="mt-0.5 hidden text-xs leading-4 text-[var(--text-muted)] sm:block">{frequency.description}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            </ChannelSection>

            <section aria-labelledby="notification-future-channels">
                <div className="flex items-center gap-3">
                    <span className="app-glass-control flex size-10 shrink-0 items-center justify-center rounded-2xl text-[var(--text-muted)]">
                        <Smartphone size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h2 id="notification-future-channels" className="text-base font-medium text-[var(--text-strong)]">Push & SMS</h2>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Noch nicht verfügbar</p>
                    </div>
                    <MessageSquare size={18} aria-hidden="true" className="ml-auto shrink-0 text-[var(--text-muted)] opacity-60" />
                </div>
                <p className="mt-4 text-pretty text-sm leading-6 text-[var(--text-muted)]">
                    Für diese Kanäle gibt es später eigene Einstellungen. Aktuell werden keine Push-Nachrichten oder SMS versendet.
                </p>
            </section>

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
                            {dirty ? "Du hast ungespeicherte Änderungen." : "Keine ungespeicherten Änderungen."}
                        </p>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={!dirty || controlsDisabled}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--brand)_22%,transparent)] transition-[background-color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none motion-reduce:transition-none sm:mt-0 sm:w-auto"
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
    preparation = false,
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
    preparation?: boolean;
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
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <h2 id={titleId} className="text-balance text-base font-semibold text-[var(--text-strong)]">{title}</h2>
                            {preparation ? <span className="rounded-full [background:var(--app-glass-selected)] px-2 py-0.5 text-[10px] font-medium leading-4 text-[var(--text-muted)]">Vorbereitung</span> : null}
                        </div>
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

            <fieldset disabled={!enabled || pending} className="mt-4 disabled:opacity-50">
                <legend className="sr-only">{title} auswählen</legend>
                <div className="grid gap-1">
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
