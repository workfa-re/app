"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
    ArrowRight,
    Briefcase,
    CalendarCheck2,
    CircleCheck,
    CircleDashed,
    CircleMinus,
    Clock3,
    Filter,
    MessageSquare,
    Search,
    User,
    X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import {
    type ActivityFilter,
    type ActivityComposerState,
    type ActivityFailedSend,
    type ActivityRole,
    ACTIVE_ACTIVITY_STATUSES,
    formatConversationTime,
    getActivityStatusMeta,
    getActivityStage,
    getConversationActivityTimestamp,
    getConversationPreviewTimestamp,
    matchesActivityFilter,
    normalizeMessagePreview,
    updateActivityComposerDraft,
    recordActivitySendFailure,
    recoverActivityFailedSend,
} from "@/lib/activity/chat";
import { cn } from "@/lib/utils";
import { profileInitials } from "@/components/profile/public-profile";
import styles from "./ActivityWorkspace.module.css";

const ApplicationChat = dynamic(
    () => import("@/components/activity/ApplicationChat").then((mod) => mod.ApplicationChat),
    { loading: () => <ChatSkeleton /> },
);

type ActivityCommandCenterProps = {
    applications: any[];
    role: ActivityRole;
    currentUserId: string;
    selectedJobId?: string | null;
    selectedJobTitle?: string | null;
    readOnly?: boolean;
    onSendMessage: (applicationId: string, message: string) => Promise<any>;
    onWithdraw?: (applicationId: string, reason: string) => Promise<void>;
    onReject?: (applicationId: string, reason: string) => Promise<void>;
    onSchedule?: (applicationId: string, scheduledFor: string, note?: string) => Promise<any>;
    onReopen?: (applicationId: string) => Promise<any>;
    onRequestReopen?: (applicationId: string, message: string) => Promise<any>;
    onRespondReopenRequest?: (requestId: string, accept: boolean, reason?: string) => Promise<any>;
    onComplete?: (applicationId: string, reason?: string) => Promise<any>;
    onReport?: (input: {
        applicationId: string;
        reasonCode: "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other";
        details?: string;
        reportedUserId?: string | null;
        messageId?: string | null;
        reopenRequestId?: string | null;
    }) => Promise<any>;
};

type ActivityAttentionSource = {
    status?: string | null;
    close_action?: string | null;
    conversation_state?: string | null;
    is_primary?: boolean | null;
    unread_count?: unknown;
    pending_reopen_count?: unknown;
};

type InboxFilter = Extract<ActivityFilter, "active" | "closed">;

export type ActivityAttentionSummary = {
    unreadCount: number;
    pendingReopenCount: number;
    totalCount: number;
    kind: "none" | "message" | "reopen" | "mixed";
};

function normalizeAttentionCount(value: unknown) {
    const count = Number(value ?? 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function getActivityAttentionSummary(
    source: ActivityAttentionSource,
): ActivityAttentionSummary {
    const unreadCount = normalizeAttentionCount(source.unread_count);
    const pendingReopenCount = (source.status === "waitlisted" || source.close_action === "waitlist_retired") ? 0 : normalizeAttentionCount(source.pending_reopen_count);
    const totalCount = unreadCount + pendingReopenCount;

    return {
        unreadCount,
        pendingReopenCount,
        totalCount,
        kind: unreadCount > 0 && pendingReopenCount > 0
            ? "mixed"
            : pendingReopenCount > 0
                ? "reopen"
                : unreadCount > 0
                    ? "message"
                    : "none",
    };
}

export function getGroupedActivityAttentionSummary(
    applications: readonly ActivityAttentionSource[],
): ActivityAttentionSummary {
    const totals = applications.reduce((current, application) => {
        const next = getActivityAttentionSummary(application);
        return {
            unreadCount: current.unreadCount + next.unreadCount,
            pendingReopenCount: current.pendingReopenCount + next.pendingReopenCount,
        };
    }, { unreadCount: 0, pendingReopenCount: 0 });

    return getActivityAttentionSummary({
        unread_count: totals.unreadCount,
        pending_reopen_count: totals.pendingReopenCount,
    });
}

export function getActivityAttentionLabel(summary: ActivityAttentionSummary) {
    const parts = [
        summary.unreadCount > 0
            ? `${summary.unreadCount} ${summary.unreadCount === 1 ? "ungelesene Nachricht" : "ungelesene Nachrichten"}`
            : null,
        summary.pendingReopenCount > 0
            ? `${summary.pendingReopenCount} ${summary.pendingReopenCount === 1 ? "offene Öffnungsanfrage" : "offene Öffnungsanfragen"}`
            : null,
    ].filter((part): part is string => Boolean(part));

    return parts.join(" und ") || "Keine neuen Hinweise";
}

export function getActivityWorkspaceSection(source: ActivityAttentionSource): InboxFilter {
    return source.conversation_state !== "closed" && source.is_primary !== false && ACTIVE_ACTIVITY_STATUSES.has(source.status ?? "")
        ? "active"
        : "closed";
}

export function matchesActivityCommandCenterFilter(
    application: ActivityAttentionSource,
    filter: ActivityFilter,
) {
    if (filter === "active" || filter === "closed") {
        return getActivityWorkspaceSection(application) === filter;
    }
    const attention = getActivityAttentionSummary(application);
    if (filter === "unread") return attention.totalCount > 0;
    return matchesActivityFilter(application.status, attention.unreadCount, filter);
}

export function getActivityWorkspaceSelection(
    requestedId: string | null | undefined,
    requestedView: string | null | undefined,
    applications: ReadonlyArray<ActivityAttentionSource & { id: string }>,
) {
    const selected = requestedId ? applications.find(application => application.id === requestedId) : null;
    return {
        selectedAppId: selected?.id ?? null,
        filter: selected ? getActivityWorkspaceSection(selected) : requestedView === "archive" ? "closed" as const : "active" as const,
    };
}

function getFilterAriaLabel(
    label: string,
    count: number,
    attention: ActivityAttentionSummary,
) {
    const noun = count === 1 ? "Gespräch" : "Gespräche";
    return `${label}, ${count} ${noun}${attention.totalCount ? `, ${getActivityAttentionLabel(attention)}` : ""}`;
}

function getPartner(app: any, role: ActivityRole) {
    if (role === "provider") {
        const applicant = app.applicant ?? {};
        return {
            name: applicant.full_name || "Bewerber",
            subtitle: app.job?.title || "Job-Angebot",
            meta: applicant.city || "Ort nicht angegeben",
            avatarUrl: applicant.avatar_url || null,
        };
    }

    const creator = app.job?.creator ?? {};
    return {
        name: creator.company_name || creator.full_name || "Auftraggeber",
        subtitle: app.job?.title || "Job-Angebot",
        meta: app.job?.public_location_label || creator.city || "Ort folgt",
        avatarUrl: creator.avatar_url || null,
    };
}

export function getActivityInboxPresentation(app: any, role: ActivityRole) {
    const status = getActivityStatusMeta(app.status, app.close_action);
    const stage = getActivityStage(app, role);
    return {
        partner: getPartner(app, role),
        stage,
        status: {
            ...status,
            label: stage.label,
            tone: stage.key === "closed" && ACTIVE_ACTIVITY_STATUSES.has(app.status) ? "neutral" as const : status.tone,
        },
        attention: getActivityAttentionSummary(app),
        preview: normalizeMessagePreview(app.last_message_preview, normalizeMessagePreview(app.message, "Noch keine Nachricht im Gespräch.")),
        previewTimestamp: getConversationPreviewTimestamp(app),
    };
}

function getSearchText(app: any, role: ActivityRole) {
    const { partner, status } = getActivityInboxPresentation(app, role);
    return [
        partner.name,
        partner.subtitle,
        partner.meta,
        status.label,
        app.message,
        app.last_message_preview,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

export function getActivityWorkspaceUrl(
    currentHref: string,
    applicationId: string | null,
    filter: InboxFilter,
) {
    const url = new URL(currentHref);
    if (applicationId) url.searchParams.set("conversation", applicationId);
    else url.searchParams.delete("conversation");
    if (filter === "closed") url.searchParams.set("view", "archive");
    else url.searchParams.delete("view");
    return `${url.pathname}${url.search}${url.hash}`;
}

function updateConversationUrl(applicationId: string | null, filter: InboxFilter) {
    const href = getActivityWorkspaceUrl(window.location.href, applicationId, filter);
    if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    // Native history updates are integrated with Next's useSearchParams without a server fetch.
    window.history.pushState(null, "", href);
}

/** Recover missed events without repeating the server snapshot on the first subscription. */
export function createActivitySnapshotRefresher(
    refresh: () => void,
    canRefresh: () => boolean,
) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let subscribed = false;
    let interrupted = false;

    const request = () => {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = null;
        if (!canRefresh()) return;
        // One lifecycle transition may emit several table events plus online/visible.
        timer = setTimeout(() => {
            timer = null;
            if (!disposed && canRefresh()) refresh();
        }, 150);
    };

    return {
        request,
        onStatus(status: string) {
            if (disposed) return;
            if (status === "SUBSCRIBED") {
                if (subscribed || interrupted) request();
                subscribed = true;
                interrupted = false;
            } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                interrupted = true;
            }
        },
        dispose() {
            disposed = true;
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

export function ActivityCommandCenter({
    applications,
    role,
    currentUserId,
    selectedJobId,
    selectedJobTitle,
    readOnly = false,
    onSendMessage,
    onWithdraw,
    onReject,
    onSchedule,
    onReopen,
    onRequestReopen,
    onRespondReopenRequest,
    onComplete,
    onReport,
}: ActivityCommandCenterProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [items, setItems] = useState(applications);
    const [conversationComposers, setConversationComposers] = useState<Record<string, ActivityComposerState>>({});
    const updateConversationDraft = useCallback((applicationId: string, value: string, onlyIfEmpty = false) => {
        setConversationComposers(current => ({
            ...current,
            [applicationId]: updateActivityComposerDraft(current[applicationId], value, onlyIfEmpty),
        }));
    }, []);
    const handleSendFailure = useCallback((applicationId: string, failure: ActivityFailedSend) => {
        setConversationComposers(current => ({
            ...current,
            [applicationId]: recordActivitySendFailure(current[applicationId], failure),
        }));
    }, []);
    const recoverFailedSend = useCallback((applicationId: string, failureId: string) => {
        setConversationComposers(current => {
            const recovered = recoverActivityFailedSend(current[applicationId], failureId);
            return recovered ? { ...current, [applicationId]: recovered } : current;
        });
    }, []);
    const { selectedAppId, filter } = getActivityWorkspaceSelection(
        searchParams.get("conversation"), searchParams.get("view"), items,
    );
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const reduceMotion = useReducedMotion();
    const searchInputId = useId();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchButtonRef = useRef<HTMLButtonElement>(null);
    const activeFilterButtonRef = useRef<HTMLButtonElement>(null);
    const chatStageRef = useRef<HTMLElement>(null);
    const conversationTriggerRef = useRef<{ applicationId: string; element: HTMLButtonElement } | null>(null);
    const previousSelectionRef = useRef(selectedAppId);
    const selectedAppIdRef = useRef(selectedAppId);

    const closeInboxSearch = useCallback(() => {
        setIsSearchOpen(false);
        setQuery("");
        requestAnimationFrame(() => searchButtonRef.current?.focus());
    }, []);

    useEffect(() => {
        if (!isSearchOpen) return;
        const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [isSearchOpen]);

    useEffect(() => {
        setItems(applications);
    }, [applications]);

    useEffect(() => {
        selectedAppIdRef.current = selectedAppId;
    }, [selectedAppId]);

    useEffect(() => {
        if (!selectedAppId || !window.matchMedia("(max-width: 1023px)").matches) return;
        const frame = requestAnimationFrame(() => chatStageRef.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [selectedAppId]);

    useEffect(() => {
        const previousSelection = previousSelectionRef.current;
        previousSelectionRef.current = selectedAppId;
        if (!previousSelection || selectedAppId) return;

        const frame = requestAnimationFrame(() => {
            const trigger = conversationTriggerRef.current;
            const previousButton = trigger?.applicationId === previousSelection ? trigger.element : null;
            const target = previousButton?.isConnected && previousButton.getClientRects().length > 0
                ? previousButton
                : activeFilterButtonRef.current;
            target?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [selectedAppId]);

    useEffect(() => {
        if (!currentUserId || readOnly) return;

        const snapshot = createActivitySnapshotRefresher(
            () => startTransition(() => router.refresh()),
            () => document.visibilityState === "visible" && navigator.onLine,
        );
        const refreshActivitySnapshot = snapshot.request;
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") refreshActivitySnapshot();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("online", refreshActivitySnapshot);

        const channel = supabaseBrowser
            .channel(`activity-center-${currentUserId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages" },
                (payload) => {
                    const nextMessage = payload.new as any;
                    setItems((current) => current.map((app) => {
                        if (app.id !== nextMessage.application_id) return app;
                        const isOpen = selectedAppIdRef.current === app.id;
                        const isOwnMessage = nextMessage.sender_id === currentUserId;
                        return {
                            ...app,
                            last_message_preview: nextMessage.content,
                            last_message_at: nextMessage.created_at,
                            unread_count: isOpen || isOwnMessage
                                ? 0
                                : Number(app.unread_count || 0) + 1,
                        };
                    }));
                },
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "messages" },
                (payload) => {
                    const updatedMessage = payload.new as any;
                    if (!updatedMessage.read_at || updatedMessage.sender_id === currentUserId) return;
                    setItems((current) => current.map((app) => (
                        app.id === updatedMessage.application_id
                            ? { ...app, unread_count: 0 }
                            : app
                    )));
                },
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "applications" },
                (payload) => {
                    const updatedApplication = payload.new as any;
                    setItems((current) => current.map((app) => (
                        app.id === updatedApplication.id
                            ? { ...app, ...updatedApplication }
                            : app
                    )));
                },
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "applications" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "conversation_reopen_requests" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "conversation_reopen_requests" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "job_engagements" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "job_engagements" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "job_appointments" },
                refreshActivitySnapshot,
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "job_appointments" },
                refreshActivitySnapshot,
            )
            .subscribe(snapshot.onStatus);

        return () => {
            snapshot.dispose();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("online", refreshActivitySnapshot);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, readOnly, router]);

    const selectedApp = useMemo(
        () => items.find((app) => app.id === selectedAppId) ?? null,
        [items, selectedAppId],
    );

    const filterOptions = useMemo(() => {
        const options: Array<{ key: InboxFilter; label: string }> = [
            { key: "active", label: "Laufend" },
            { key: "closed", label: "Archiv" },
        ];

        return options.map((option) => ({
            ...option,
            attention: getGroupedActivityAttentionSummary(items.filter(app => matchesActivityCommandCenterFilter(app, option.key))),
            count: items.filter((app) => matchesActivityCommandCenterFilter(app, option.key)).length,
        }));
    }, [items]);

    const visibleItems = useMemo(() => {
        const normalizedQuery = deferredQuery.trim().toLowerCase();
        return [...items]
            .filter((app) => matchesActivityCommandCenterFilter(app, filter))
            .filter((app) => !normalizedQuery || getSearchText(app, role).includes(normalizedQuery))
            .sort((a, b) => getConversationActivityTimestamp(b) - getConversationActivityTimestamp(a));
    }, [deferredQuery, filter, items, role]);

    const visibleInboxCount = visibleItems.length;

    const selectConversation = (applicationId: string, trigger: HTMLButtonElement) => {
        conversationTriggerRef.current = { applicationId, element: trigger };
        selectedAppIdRef.current = applicationId;
        setItems((current) => current.map((app) => (
            app.id === applicationId ? { ...app, unread_count: 0 } : app
        )));
        const application = items.find(app => app.id === applicationId);
        updateConversationUrl(applicationId, application ? getActivityWorkspaceSection(application) : filter);
    };

    const closeConversation = () => {
        selectedAppIdRef.current = null;
        updateConversationUrl(null, filter);
    };

    const updateSelectedStatus = async (reason: string, status: "withdrawn" | "rejected") => {
        if (!selectedAppId) return;
        const action = status === "withdrawn" ? onWithdraw : onReject;
        if (!action) return;
        await action(selectedAppId, reason);
        setItems((current) => current.map((app) => {
            if (app.id !== selectedAppId) return app;
            const wasAccepted = app.status === "accepted";
            return {
                ...app,
                status: wasAccepted ? "cancelled" : status,
                close_action: wasAccepted ? "engagement_cancelled" : status === "withdrawn" ? "seeker_withdrew" : "provider_rejected",
                conversation_state: "closed",
                is_primary: false,
                closed_by: currentUserId,
                closed_at: new Date().toISOString(),
                closed_reason: reason.trim() || (wasAccepted ? "Zusammenarbeit abgesagt." : role === "provider" ? "Vom Anbieter abgelehnt." : "Bewerbung zurückgezogen."),
                closure_version: Number(app.closure_version || 0) + 1,
                rejection_reason: reason.trim() || null,
                engagement: wasAccepted && app.engagement ? { ...app.engagement, status: "cancelled" } : app.engagement,
            };
        }));
    };

    const scheduleSelectedApplication = async (scheduledFor: string, note?: string) => {
        if (!selectedAppId || !onSchedule) return;
        const result = await onSchedule(selectedAppId, scheduledFor, note);
        if (result?.error) throw new Error(result.error);
        const schedule = result?.scheduled_for || scheduledFor;
        setItems((current) => current.map((app) => (
            app.id === selectedAppId
                ? {
                    ...app,
                    status: "accepted",
                    scheduled_for: schedule,
                    agreed_at: result?.agreed_at || new Date().toISOString(),
                    engagement: result?.engagement || app.engagement,
                    agreement: result?.appointment || app.agreement,
                    appointments: result?.appointment
                        ? [
                            result.appointment,
                            ...(app.appointments ?? []).filter((appointment: any) => appointment.id !== result.appointment.id),
                        ]
                        : app.appointments,
                }
                : app
        )));
        return result;
    };

    const completeSelectedApplication = async (reason?: string) => {
        if (!selectedAppId || !onComplete) return;
        const result = await onComplete(selectedAppId, reason);
        if (result?.error) throw new Error(result.error);
        setItems(current => current.map(app => app.id === selectedAppId
            ? { ...app, status: "completed", conversation_state: "closed", is_primary: false }
            : app));
        return result;
    };

    const handleConversationRead = useCallback(() => {
        const applicationId = selectedAppIdRef.current;
        if (!applicationId) return;
        setItems((current) => current.map((app) => (
            app.id === applicationId ? { ...app, unread_count: 0 } : app
        )));
    }, []);

    return (
        <MotionConfig reducedMotion="user">
            <div
                className={cn(styles.experience, "activities-command-center jobs-home-surface")}
                data-ui="conversations"
                data-role={role}
                data-empty={items.length === 0 ? "true" : "false"}
                data-chat-open={selectedApp ? "true" : "false"}
            >
                <div className="jobs-home-heading activity-home-heading">
                    <div>
                        <h1>Nachrichten</h1>
                    </div>

                    {selectedJobId && (
                        <div className="activity-job-filter">
                            <Filter size={15} />
                            <span>{selectedJobTitle || "Ausgewählter Job"}</span>
                            <Link href="/app-home/activities">Alle Gespräche</Link>
                        </div>
                    )}
                </div>

                <div className="activity-workspace">
                    <aside className={cn("activity-inbox-panel", selectedApp ? "hidden lg:flex" : "flex")} aria-label="Gespräche">
                        <div className="activity-panel-heading" data-search-open={isSearchOpen ? "true" : "false"}>
                            <div className="activity-panel-summary">
                                <div className="activity-filter-strip" role="group" aria-label="Gespräche anzeigen">
                                    {filterOptions.map((option) => (
                                        <button
                                            key={option.key}
                                            ref={filter === option.key ? activeFilterButtonRef : undefined}
                                            type="button"
                                            onClick={() => updateConversationUrl(null, option.key)}
                                            className={cn(filter === option.key && "is-active")}
                                            aria-pressed={filter === option.key}
                                            aria-label={getFilterAriaLabel(option.label, option.count, option.attention)}
                                        >
                                            {filter === option.key ? (
                                                <motion.span
                                                    className="activity-filter-selection"
                                                    layoutId={`activity-filter-${searchInputId}`}
                                                    transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                                                    aria-hidden="true"
                                                />
                                            ) : null}
                                            <span className="activity-filter-label">{option.label}</span>
                                            {option.attention.pendingReopenCount > 0 ? (
                                                <span className="activity-filter-request" aria-hidden="true" />
                                            ) : null}
                                            {option.attention.unreadCount > 0 ? (
                                                <span className="activity-filter-attention" aria-hidden="true">
                                                    {option.attention.unreadCount > 99 ? "99+" : option.attention.unreadCount}
                                                </span>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button
                                ref={searchButtonRef}
                                type="button"
                                className="activity-panel-search-toggle"
                                aria-label={isSearchOpen ? "Suche schließen" : "Gespräche durchsuchen"}
                                aria-expanded={isSearchOpen}
                                aria-controls={`${searchInputId}-tray`}
                                onClick={() => {
                                    if (isSearchOpen) closeInboxSearch();
                                    else setIsSearchOpen(true);
                                }}
                            >
                                <AnimatePresence initial={false} mode="wait">
                                    <motion.span
                                        key={isSearchOpen ? "close" : "search"}
                                        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                        transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                                        aria-hidden="true"
                                    >
                                        {isSearchOpen ? <X size={17} /> : <Search size={17} />}
                                    </motion.span>
                                </AnimatePresence>
                            </button>
                        </div>
                        <AnimatePresence initial={false}>
                            {isSearchOpen ? (
                                <motion.div
                                    key="search"
                                    id={`${searchInputId}-tray`}
                                    className="activity-search-tray"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                                >
                                    <div className="activity-search-tray-inner">
                                        <label className="activity-inbox-search">
                                            <span className="sr-only">Gespräche durchsuchen</span>
                                            <Search aria-hidden="true" size={16} />
                                            <input
                                                ref={searchInputRef}
                                                id={searchInputId}
                                                type="search"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={query}
                                                onChange={(event) => setQuery(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key !== "Escape") return;
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    closeInboxSearch();
                                                }}
                                                placeholder="Job oder Person suchen"
                                            />
                                        </label>
                                        <span className="sr-only" role="status" aria-live="polite">
                                            {visibleInboxCount} {visibleInboxCount === 1 ? "Gespräch gefunden" : "Gespräche gefunden"}
                                        </span>
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>

                        <div className="activity-inbox-list" data-provider={role === "provider" ? "true" : "false"}>
                            {visibleItems.map((app) => (
                                <ActivityInboxItem
                                    key={app.id}
                                    app={app}
                                    role={role}
                                    selected={selectedAppId === app.id}
                                    onSelect={(trigger) => selectConversation(app.id, trigger)}
                                />
                            ))}

                            {items.length === 0 ? (
                                <ActivityEmptyInbox
                                    role={role}
                                    selectedJobId={selectedJobId}
                                    selectedJobTitle={selectedJobTitle}
                                />
                            ) : visibleInboxCount === 0 ? (
                                <div className="activity-no-results">
                                    <Search size={20} />
                                    <strong>{query.trim() ? "Keine Treffer" : filter === "active" ? "Keine laufenden Gespräche" : "Dein Archiv ist leer"}</strong>
                                    <span>{query.trim()
                                        ? "Versuche einen anderen Namen oder Jobtitel."
                                        : filter === "active" ? "Gespräche zu beendeten Jobs findest du im Archiv." : "Beendete Gespräche bleiben hier mit ihrem Verlauf erhalten."}</span>
                                </div>
                            ) : null}
                        </div>
                    </aside>

                    <section
                        ref={chatStageRef}
                        className={cn("activity-chat-stage", selectedApp ? "flex" : "hidden lg:flex")}
                        tabIndex={-1}
                        aria-label={selectedApp ? `Gespräch zu ${selectedApp.job?.title || "deinem Job"}` : "Gespräch"}
                    >
                        {selectedApp ? (
                            <ApplicationChat
                                key={selectedApp.id}
                                application={selectedApp}
                                draftValue={conversationComposers[selectedApp.id]?.draft ?? ""}
                                failedSends={conversationComposers[selectedApp.id]?.failedSends}
                                onSendFailure={handleSendFailure}
                                onRecoverFailedSend={recoverFailedSend}
                                onDraftChange={updateConversationDraft}
                                currentUserRole={role}
                                currentUserId={currentUserId}
                                readOnly={readOnly}
                                onWithdraw={
                                    role === "seeker" && onWithdraw
                                        ? (reason: string) => updateSelectedStatus(reason, "withdrawn")
                                        : undefined
                                }
                                onReject={
                                    role === "provider" && onReject
                                        ? (reason: string) => updateSelectedStatus(reason, "rejected")
                                        : undefined
                                }
                                onSchedule={role === "provider" && onSchedule ? scheduleSelectedApplication : undefined}
                                onReopen={onReopen ? () => onReopen(selectedApp.id) : undefined}
                                onRequestReopen={onRequestReopen ? (message: string) => onRequestReopen(selectedApp.id, message) : undefined}
                                onRespondReopenRequest={onRespondReopenRequest}
                                onComplete={role === "provider" && onComplete ? completeSelectedApplication : undefined}
                                onReport={onReport}
                                onSendMessage={onSendMessage}
                                onClose={closeConversation}
                                onConversationRead={handleConversationRead}
                                embedded
                            />
                        ) : (
                            <ActivityDetailPlaceholder />
                        )}
                    </section>
                </div>
            </div>
        </MotionConfig>
    );
}

const INBOX_STAGE_ICONS = {
    open: CircleDashed,
    reserved: Clock3,
    agreed: CalendarCheck2,
    completed: CircleCheck,
    closed: CircleMinus,
};

function ActivityInboxItem({
    app,
    role,
    selected,
    onSelect,
}: {
    app: any;
    role: ActivityRole;
    selected: boolean;
    onSelect: (trigger: HTMLButtonElement) => void;
}) {
    const { partner, stage, status, attention, preview, previewTimestamp } = getActivityInboxPresentation(app, role);
    const activityTime = formatConversationTime(previewTimestamp);
    const StatusIcon = INBOX_STAGE_ICONS[stage.key];

    return (
        <button
            type="button"
            onClick={(event) => onSelect(event.currentTarget)}
            className="activity-inbox-item"
            data-selected={selected ? "true" : "false"}
            data-unread={attention.unreadCount > 0 ? "true" : "false"}
            data-attention={attention.kind}
            aria-pressed={selected}
        >
            <span className="sr-only">Gespräch öffnen: </span>
            <span className="activity-inbox-avatar" aria-hidden="true">
                <ConversationAvatar name={partner.name} avatarUrl={partner.avatarUrl} />
            </span>
            <span className="activity-inbox-body">
                <span className="activity-inbox-title-row">
                    <span className="activity-inbox-title">
                        <strong>{partner.subtitle}</strong>
                        <span className="activity-inbox-status" data-tone={status.tone} data-stage={stage.key}
                            role="img" aria-label={`Auftragsstatus: ${status.label}`} title={`Auftragsstatus: ${status.label}`}>
                            <StatusIcon size={14} strokeWidth={1.7} aria-hidden="true" />
                        </span>
                    </span>
                    <time className="activity-inbox-time" dateTime={previewTimestamp}>{activityTime}</time>
                </span>
                <span className="activity-inbox-context-row">
                    <span className="activity-inbox-job">{partner.name}</span>
                </span>
                <span className="activity-inbox-preview-row">
                    <span className="activity-inbox-preview">{preview}</span>
                    {attention.unreadCount > 0 ? (
                        <span className="activity-inbox-unread">
                            <span aria-hidden="true">{attention.unreadCount > 99 ? "99+" : attention.unreadCount}</span>
                            <span className="sr-only">
                                {attention.unreadCount} {attention.unreadCount === 1 ? "ungelesene Nachricht" : "ungelesene Nachrichten"}
                            </span>
                        </span>
                    ) : null}
                </span>
                {attention.pendingReopenCount > 0 ? (
                    <span className="activity-inbox-meta-row">
                        <span className="activity-inbox-request">
                            {attention.pendingReopenCount === 1
                                ? "Öffnungsanfrage offen"
                                : `${attention.pendingReopenCount} Öffnungsanfragen offen`}
                        </span>
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function ConversationAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    return avatarUrl && avatarUrl !== failedUrl
        ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : <>{profileInitials(name)}</>;
}

function ActivityDetailPlaceholder() {
    return (
        <div className="activity-detail-placeholder">
            <div className="activity-placeholder-icon">
                <MessageSquare size={24} />
            </div>
            <h2>Wähle ein Gespräch</h2>
            <p>Gespräch, Termin und Details findest du hier an einem Ort.</p>
        </div>
    );
}

function ActivityEmptyInbox({
    role,
    selectedJobId,
    selectedJobTitle,
}: {
    role: ActivityRole;
    selectedJobId?: string | null;
    selectedJobTitle?: string | null;
}) {
    return (
        <div className="activity-empty-inbox">
            <div className="activity-placeholder-icon">
                {role === "provider" ? <User size={26} /> : <Briefcase size={26} />}
            </div>
            <h2>{selectedJobId ? `Noch kein Gespräch zu ${selectedJobTitle || "diesem Job"}` : "Noch keine Gespräche"}</h2>
            <p>
                {role === "provider"
                    ? "Sobald sich jemand bewirbt, erscheint das Gespräch hier."
                    : "Bewirb dich auf einen Job. Hier klärst du anschließend den Termin mit dem Anbieter."}
            </p>
            <Link href={selectedJobId ? "/app-home/activities" : role === "provider" ? "/app-home/offers" : "/app-home/jobs"}>
                {selectedJobId ? "Alle Gespräche" : role === "provider" ? "Zu deinen Jobs" : "Jobs entdecken"}
                <ArrowRight size={16} />
            </Link>
        </div>
    );
}

function ChatSkeleton() {
    return (
        <div className="activity-chat-skeleton" aria-label="Gespräch wird geladen">
            <div />
            <div />
            <div />
        </div>
    );
}
