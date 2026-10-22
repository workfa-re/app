"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
    ArrowRight,
    Briefcase,
    ChevronDown,
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
    getConversationActivityTimestamp,
    getConversationPreviewTimestamp,
    getProfileInitials,
    groupProviderActivities,
    matchesActivityFilter,
    normalizeMessagePreview,
    updateActivityComposerDraft,
    recordActivitySendFailure,
    recoverActivityFailedSend,
    type ProviderActivityGroup,
} from "@/lib/activity/chat";
import { cn } from "@/lib/utils";
import styles from "./ActivityWorkspace.module.css";

const ApplicationChat = dynamic(
    () => import("@/components/activity/ApplicationChat").then((mod) => mod.ApplicationChat),
    { loading: () => <ChatSkeleton /> },
);

type ActivityCommandCenterProps = {
    applications: any[];
    role: ActivityRole;
    currentUserId: string;
    initialConversationId?: string | null;
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
    role: ActivityRole,
    attention: ActivityAttentionSummary,
) {
    const noun = role === "provider"
        ? count === 1 ? "Job" : "Jobs"
        : count === 1 ? "Bewerbung" : "Bewerbungen";
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

function getSearchText(app: any, role: ActivityRole) {
    const partner = getPartner(app, role);
    const status = getActivityStatusMeta(app.status, app.close_action);
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

function getApplicationJobId(app: any) {
    return app.job?.id || app.job_id || `missing-job:${app.id}`;
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

export function ActivityCommandCenter({
    applications,
    role,
    currentUserId,
    initialConversationId,
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
    const searchInputId = useId();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchButtonRef = useRef<HTMLButtonElement>(null);
    const [expandedProviderJobIds, setExpandedProviderJobIds] = useState<Set<string>>(() => {
        if (role !== "provider" || applications.length === 0) return new Set();
        const initialApplication = applications.find((app) => app.id === initialConversationId) ?? applications[0];
        return new Set([getApplicationJobId(initialApplication)]);
    });
    const [expandedProviderArchives, setExpandedProviderArchives] = useState<Set<string>>(() => new Set());
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
        if (!currentUserId || readOnly) return;

        const refreshActivitySnapshot = () => {
            startTransition(() => router.refresh());
        };

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
                () => {
                    startTransition(() => router.refresh());
                },
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
            .subscribe();

        return () => {
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, readOnly, router]);

    const selectedAppBase = useMemo(
        () => items.find((app) => app.id === selectedAppId) ?? null,
        [items, selectedAppId],
    );

    const providerGroups = useMemo(
        () => role === "provider" ? groupProviderActivities(items) : [],
        [items, role],
    );

    const selectedApp = selectedAppBase;

    useEffect(() => {
        if (role !== "provider" || providerGroups.length === 0) return;
        const selectedJobId = selectedApp ? getApplicationJobId(selectedApp) : null;
        if (selectedJobId && getActivityWorkspaceSection(selectedApp) === "closed") {
            setExpandedProviderArchives(current => current.has(selectedJobId) ? current : new Set(current).add(selectedJobId));
        }

        setExpandedProviderJobIds((current) => {
            const validIds = new Set(providerGroups.map((group) => group.jobId));
            const next = new Set([...current].filter((jobId) => validIds.has(jobId)));
            if (selectedJobId) next.add(selectedJobId);
            if (next.size === 0) next.add(providerGroups[0].jobId);

            if (next.size === current.size && [...next].every((jobId) => current.has(jobId))) return current;
            return next;
        });
    }, [providerGroups, role, selectedApp]);

    const filterOptions = useMemo(() => {
        const options: Array<{ key: InboxFilter; label: string }> = [
            { key: "active", label: "Laufend" },
            { key: "closed", label: "Archiv" },
        ];

        return options.map((option) => ({
            ...option,
            attention: getGroupedActivityAttentionSummary(items.filter(app => matchesActivityCommandCenterFilter(app, option.key))),
            count: role === "provider"
                ? providerGroups.filter((group) => group.applications.some((app) => (
                    matchesActivityCommandCenterFilter(app, option.key)
                ))).length
                : items.filter((app) => matchesActivityCommandCenterFilter(app, option.key)).length,
        }));
    }, [items, providerGroups, role]);

    const visibleItems = useMemo(() => {
        const normalizedQuery = deferredQuery.trim().toLowerCase();
        return [...items]
            .filter((app) => matchesActivityCommandCenterFilter(app, filter))
            .filter((app) => !normalizedQuery || getSearchText(app, role).includes(normalizedQuery))
            .sort((a, b) => getConversationActivityTimestamp(b) - getConversationActivityTimestamp(a));
    }, [deferredQuery, filter, items, role]);

    const visibleProviderGroups = useMemo(() => {
        if (role !== "provider") return [];
        const normalizedQuery = deferredQuery.trim().toLowerCase();

        return groupProviderActivities(items.filter(app => matchesActivityCommandCenterFilter(app, filter)))
            .filter((group) => {
                if (!normalizedQuery) return true;
                const jobText = [group.job?.title, group.job?.status].filter(Boolean).join(" ").toLowerCase();
                return jobText.includes(normalizedQuery)
                    || group.applications.some((app) => getSearchText(app, role).includes(normalizedQuery));
            });
    }, [deferredQuery, filter, items, role]);

    const visibleInboxCount = role === "provider" ? visibleProviderGroups.length : visibleItems.length;

    const selectConversation = (applicationId: string) => {
        selectedAppIdRef.current = applicationId;
        setItems((current) => current.map((app) => (
            app.id === applicationId ? { ...app, unread_count: 0 } : app
        )));
        if (role === "provider") {
            const application = items.find((app) => app.id === applicationId);
            if (application) {
                const jobId = getApplicationJobId(application);
                setExpandedProviderJobIds((current) => new Set(current).add(jobId));
            }
        }
        const application = items.find(app => app.id === applicationId);
        updateConversationUrl(applicationId, application ? getActivityWorkspaceSection(application) : filter);
    };

    const toggleProviderJob = (jobId: string) => {
        setExpandedProviderJobIds((current) => {
            const next = new Set(current);
            if (next.has(jobId)) next.delete(jobId);
            else next.add(jobId);
            return next;
        });
    };

    const toggleProviderArchive = (jobId: string) => {
        setExpandedProviderArchives((current) => {
            const next = new Set(current);
            if (next.has(jobId)) next.delete(jobId);
            else next.add(jobId);
            return next;
        });
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

    if (items.length === 0) {
        return (
            <MotionConfig reducedMotion="user">
                <ActivityEmptyState
                    role={role}
                    selectedJobId={selectedJobId}
                    selectedJobTitle={selectedJobTitle}
                />
            </MotionConfig>
        );
    }

    return (
        <MotionConfig reducedMotion="user">
        <div
            className={cn(styles.experience, "activities-command-center jobs-home-surface")}
            data-ui="conversations"
            data-role={role}
            data-chat-open={selectedApp ? "true" : "false"}
        >
            <div className="jobs-home-heading activity-home-heading">
                <div>
                    <h1>{role === "provider" ? "Bewerbungen" : "Meine Jobs"}</h1>
                </div>

                {selectedJobId && (
                    <div className="activity-job-filter">
                        <Filter size={15} />
                        <span>{selectedJobTitle || "Ausgewählter Job"}</span>
                        <Link href="/app-home/activities">Alle anzeigen</Link>
                    </div>
                )}
            </div>

            <div className="activity-workspace">
                <aside className={cn("activity-inbox-panel", selectedApp ? "hidden lg:flex" : "flex")} aria-label={role === "provider" ? "Bewerbungen" : "Meine Jobs"}>
                    <div className="activity-panel-heading" data-search-open={isSearchOpen ? "true" : "false"}>
                        <AnimatePresence initial={false} mode="popLayout">
                            {isSearchOpen ? (
                                <motion.label
                                    key="search"
                                    className="activity-inbox-search"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    transition={{ duration: 0.16, ease: "easeOut" }}
                                >
                                    <span className="sr-only">{role === "provider" ? "Bewerbungen durchsuchen" : "Meine Jobs durchsuchen"}</span>
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
                                        placeholder={role === "provider" ? "Jobs oder Bewerber suchen" : "Job oder Anbieter suchen"}
                                    />
                                    <span className="sr-only" role="status" aria-live="polite">
                                        {visibleInboxCount} {role === "provider"
                                            ? visibleInboxCount === 1 ? "Job gefunden" : "Jobs gefunden"
                                            : visibleInboxCount === 1 ? "Job gefunden" : "Jobs gefunden"}
                                    </span>
                                </motion.label>
                            ) : (
                                <motion.div
                                    key="summary"
                                    className="activity-panel-summary"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    transition={{ duration: 0.16, ease: "easeOut" }}
                                >
                                    <div
                                        className="activity-filter-strip"
                                        role="group"
                                        aria-label={role === "provider" ? "Bewerbungen anzeigen" : "Meine Jobs anzeigen"}
                                    >
                                        {filterOptions.map((option) => (
                                            <button
                                                key={option.key}
                                                type="button"
                                                onClick={() => updateConversationUrl(null, option.key)}
                                                className={cn(filter === option.key && "is-active")}
                                                aria-pressed={filter === option.key}
                                                aria-label={getFilterAriaLabel(option.label, option.count, role, option.attention)}
                                            >
                                                {option.label}
                                                {option.attention.totalCount > 0 && <span className="activity-filter-attention" aria-hidden="true">{option.attention.totalCount > 99 ? "99+" : option.attention.totalCount}</span>}
                                            </button>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <button
                            ref={searchButtonRef}
                            type="button"
                            className="activity-panel-search-toggle"
                            aria-label={isSearchOpen
                                ? "Suche schließen"
                                : role === "provider" ? "Bewerbungen durchsuchen" : "Meine Jobs durchsuchen"}
                            aria-expanded={isSearchOpen}
                            aria-controls={searchInputId}
                            onClick={() => {
                                if (isSearchOpen) closeInboxSearch();
                                else setIsSearchOpen(true);
                            }}
                        >
                            <AnimatePresence initial={false} mode="popLayout">
                                <motion.span
                                    key={isSearchOpen ? "close" : "search"}
                                    initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                                    aria-hidden="true"
                                >
                                    {isSearchOpen ? <X size={17} /> : <Search size={17} />}
                                </motion.span>
                            </AnimatePresence>
                        </button>
                    </div>

                    <div className="activity-inbox-list" data-provider={role === "provider" ? "true" : "false"}>
                        {role === "provider" ? (
                            visibleProviderGroups.map((group) => (
                                <ProviderJobGroup
                                    key={group.jobId}
                                    group={group}
                                    selectedAppId={selectedAppId}
                                    expanded={expandedProviderJobIds.has(group.jobId)}
                                    archiveExpanded={expandedProviderArchives.has(group.jobId)}
                                    onToggle={() => toggleProviderJob(group.jobId)}
                                    onToggleArchive={() => toggleProviderArchive(group.jobId)}
                                    onSelect={selectConversation}
                                />
                            ))
                        ) : (
                            <AnimatePresence initial={false}>
                                {visibleItems.map((app) => (
                                    <ActivityInboxItem
                                        key={app.id}
                                        app={app}
                                        role={role}
                                        selected={selectedAppId === app.id}
                                        onSelect={() => selectConversation(app.id)}
                                    />
                                ))}
                            </AnimatePresence>
                        )}

                        {visibleInboxCount === 0 && (
                            <div className="activity-no-results">
                                <Search size={20} />
                                <strong>{query.trim() ? "Keine Treffer" : filter === "active" ? "Keine laufenden Jobs" : "Archiv ist leer"}</strong>
                                <span>{query.trim()
                                    ? "Prüfe den Suchbegriff oder schließe die Suche."
                                    : filter === "active" ? "Beendete Bewerbungen und Jobs findest du im Archiv." : "Beendete Bewerbungen und Jobs bleiben hier mit ihrem Verlauf erhalten."}</span>
                            </div>
                        )}
                    </div>
                </aside>

                <section className={cn("activity-chat-stage", selectedApp ? "flex" : "hidden lg:flex")} aria-label="Gespräch">
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
                        <ActivityDetailPlaceholder role={role} />
                    )}
                </section>
            </div>
        </div>
        </MotionConfig>
    );
}

function ProviderJobGroup({
    group,
    selectedAppId,
    expanded,
    archiveExpanded,
    onToggle,
    onToggleArchive,
    onSelect,
}: {
    group: ProviderActivityGroup<any>;
    selectedAppId: string | null;
    expanded: boolean;
    archiveExpanded: boolean;
    onToggle: () => void;
    onToggleArchive: () => void;
    onSelect: (applicationId: string) => void;
}) {
    const title = group.job?.title || "Job-Angebot";
    const attention = getGroupedActivityAttentionSummary(group.applications);
    const pendingReopenApplications = group.archive.filter((application) => (
        getActivityAttentionSummary(application).pendingReopenCount > 0
    ));
    const archivedApplications = group.archive.filter((application) => (
        getActivityAttentionSummary(application).pendingReopenCount === 0
    ));
    const primaryLabel = group.primary
        ? group.primary.status === "accepted" ? "In Zusammenarbeit" : "Reserviert"
        : null;
    const summaryParts = [
        primaryLabel,
        attention.pendingReopenCount > 0
            ? `${attention.pendingReopenCount} ${attention.pendingReopenCount === 1 ? "Öffnungsanfrage" : "Öffnungsanfragen"}`
            : null,
        !group.primary && archivedApplications.length > 0
            ? `${archivedApplications.length} beendet`
            : null,
    ].filter(Boolean);
    const archiveOnly = !group.primary;
    const showArchive = archiveOnly || archiveExpanded;

    return (
        <article className="activity-provider-group" data-expanded={expanded ? "true" : "false"}>
            <button
                type="button"
                className="activity-provider-group-header"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={`provider-job-${group.jobId}`}
            >
                <span className="activity-provider-group-icon" aria-hidden="true">
                    <Briefcase size={16} />
                </span>
                <span className="activity-provider-group-copy">
                    <strong>{title}</strong>
                    <span>{summaryParts.join(" · ") || "Keine offenen Bewerbungen"}</span>
                </span>
                {attention.totalCount > 0 ? (
                    <span
                        className="activity-provider-group-unread"
                        data-kind={attention.kind}
                        aria-label={getActivityAttentionLabel(attention)}
                    >
                        {attention.totalCount > 99 ? "99+" : attention.totalCount}
                    </span>
                ) : null}
                <ChevronDown className="activity-provider-group-chevron" size={17} aria-hidden="true" />
            </button>

            {expanded ? (
                <div id={`provider-job-${group.jobId}`} className="activity-provider-group-body">
                    {group.primary ? (
                        <section className="activity-provider-section" aria-label="Aktuelles Gespräch">
                            <div className="activity-provider-section-heading">
                                <strong>{group.primary.status === "accepted" ? "In Zusammenarbeit" : "Reserviert"}</strong>
                                <span>{group.primary.status === "accepted" ? "Zusammenarbeit bestätigt" : "Eine Bewerbung · exklusiv reserviert"}</span>
                            </div>
                            <ProviderConversationRow
                                app={group.primary}
                                kind="primary"
                                selected={selectedAppId === group.primary.id}
                                onSelect={() => onSelect(group.primary!.id)}
                            />
                        </section>
                    ) : null}

                    {pendingReopenApplications.length > 0 ? (
                        <section className="activity-provider-section activity-provider-attention-section" aria-label="Offene Öffnungsanfragen">
                            <div className="activity-provider-section-heading">
                                <strong>{pendingReopenApplications.length === 1 ? "Öffnungsanfrage" : "Öffnungsanfragen"}</strong>
                                <span>Antwort ausstehend</span>
                            </div>
                            <div className="activity-provider-request-list">
                                {pendingReopenApplications.map((application: any) => (
                                    <ProviderConversationRow
                                        key={application.id}
                                        app={application}
                                        kind="archive"
                                        selected={selectedAppId === application.id}
                                        onSelect={() => onSelect(application.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}

                    {archivedApplications.length > 0 ? (
                        <section className="activity-provider-archive" aria-label="Beendete Gespräche">
                            {archiveOnly ? (
                                <div className="activity-provider-archive-label">
                                    <span>Beendet</span>
                                    <small>{archivedApplications.length}</small>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="activity-provider-archive-toggle"
                                    onClick={onToggleArchive}
                                    aria-expanded={showArchive}
                                >
                                    <span>Beendet</span>
                                    <small>{archivedApplications.length}</small>
                                    <ChevronDown size={15} aria-hidden="true" />
                                </button>
                            )}
                            {showArchive ? (
                                <div className="activity-provider-archive-list">
                                    {archivedApplications.map((application: any) => (
                                        <ProviderConversationRow
                                            key={application.id}
                                            app={application}
                                            kind="archive"
                                            selected={selectedAppId === application.id}
                                            onSelect={() => onSelect(application.id)}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </section>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}

function ProviderConversationRow({
    app,
    kind,
    selected,
    onSelect,
}: {
    app: any;
    kind: "primary" | "archive";
    selected: boolean;
    onSelect: () => void;
}) {
    const partner = getPartner(app, "provider");
    const status = getActivityStatusMeta(app.status, app.close_action);
    const attention = getActivityAttentionSummary(app);
    const preview = normalizeMessagePreview(
        app.last_message_preview,
        app.message || "Noch keine Nachricht im Gespräch.",
    );
    const previewTimestamp = getConversationPreviewTimestamp(app);
    const baseMetaLabel = kind === "primary"
        ? app.status === "accepted" ? "In Zusammenarbeit" : "Reserviert"
        : status.label;
    const metaLabel = attention.pendingReopenCount > 0
        ? `${baseMetaLabel} · ${attention.pendingReopenCount === 1 ? "Öffnungsanfrage offen" : `${attention.pendingReopenCount} Öffnungsanfragen offen`}`
        : baseMetaLabel;

    return (
        <button
            type="button"
            className="activity-provider-row"
            data-kind={kind}
            data-selected={selected ? "true" : "false"}
            data-unread={attention.unreadCount > 0 ? "true" : "false"}
            data-attention={attention.kind}
            onClick={onSelect}
            aria-pressed={selected}
        >
            <span className="activity-provider-row-avatar" aria-hidden="true">
                {partner.avatarUrl ? <img src={partner.avatarUrl} alt="" /> : getProfileInitials(partner.name)}
            </span>
            <span className="activity-provider-row-body">
                <span className="activity-provider-row-title">
                    <strong>{partner.name}</strong>
                    <time dateTime={previewTimestamp}>{formatConversationTime(previewTimestamp)}</time>
                </span>
                <span className="activity-provider-row-preview">{preview}</span>
                <span className="activity-provider-row-meta">{metaLabel}</span>
            </span>
            {attention.totalCount > 0 ? (
                <span
                    className="activity-provider-row-unread"
                    data-kind={attention.kind}
                    aria-label={getActivityAttentionLabel(attention)}
                >
                    {attention.totalCount > 9 ? "9+" : attention.totalCount}
                </span>
            ) : null}
        </button>
    );
}

function ActivityInboxItem({
    app,
    role,
    selected,
    onSelect,
}: {
    app: any;
    role: ActivityRole;
    selected: boolean;
    onSelect: () => void;
}) {
    const status = getActivityStatusMeta(app.status, app.close_action);
    const partner = getPartner(app, role);
    const attention = getActivityAttentionSummary(app);
    const preview = normalizeMessagePreview(
        app.last_message_preview,
        app.message || "Noch keine Nachricht im Gespräch.",
    );
    const previewTimestamp = getConversationPreviewTimestamp(app);
    const activityTime = formatConversationTime(previewTimestamp);

    return (
        <motion.button
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            type="button"
            onClick={onSelect}
            className="activity-inbox-item"
            data-selected={selected ? "true" : "false"}
            data-unread={attention.unreadCount > 0 ? "true" : "false"}
            data-attention={attention.kind}
            aria-pressed={selected}
        >
            <span className="activity-inbox-avatar" aria-hidden="true">
                {partner.avatarUrl ? <img src={partner.avatarUrl} alt="" /> : getProfileInitials(partner.name)}
            </span>
            <span className="activity-inbox-body">
                <span className="activity-inbox-title-row">
                    <strong>{partner.subtitle}</strong>
                    <time dateTime={previewTimestamp}>{activityTime}</time>
                </span>
                <span className="activity-inbox-context-row">
                    <span className="activity-inbox-job">{partner.name}</span>
                    {!["submitted", "negotiating"].includes(app.status) && <span className="activity-inbox-status" data-tone={status.tone}>
                        <span aria-hidden="true" />
                        {status.label}
                    </span>}
                </span>
                <span className="activity-inbox-preview">{preview}</span>
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
            {attention.totalCount > 0 ? (
                <span
                    className="activity-attention-dot"
                    data-kind={attention.kind}
                    aria-label={getActivityAttentionLabel(attention)}
                />
            ) : null}
        </motion.button>
    );
}

function ActivityDetailPlaceholder({ role }: { role: ActivityRole }) {
    return (
        <div className="activity-detail-placeholder">
            <div className="activity-placeholder-icon">
                <MessageSquare size={24} />
            </div>
            <h2>{role === "provider" ? "Wähle eine Bewerbung" : "Wähle einen Job"}</h2>
            <p>Gespräch, Termin und Details findest du hier an einem Ort.</p>
        </div>
    );
}

function ActivityEmptyState({
    role,
    selectedJobId,
    selectedJobTitle,
}: {
    role: ActivityRole;
    selectedJobId?: string | null;
    selectedJobTitle?: string | null;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(styles.experience, "activity-empty-command")}
            data-ui="conversations"
        >
            <div className="activity-placeholder-icon">
                {role === "provider" ? <User size={26} /> : <Briefcase size={26} />}
            </div>
            <h1>
                {selectedJobId
                    ? `Noch keine Bewerbungen für ${selectedJobTitle || "diesen Job"}`
                    : role === "provider"
                        ? "Noch keine Bewerbungen"
                        : "Noch keine Bewerbungen"}
            </h1>
            <p>
                {role === "provider"
                    ? "Sobald sich jemand bewirbt, erscheint das Gespräch hier."
                    : "Sobald du dich bewirbst, findest du Status und Nachrichten hier."}
            </p>
            <Link href={role === "provider" ? "/app-home/offers" : "/app-home/jobs"}>
                {role === "provider" ? "Zu deinen Jobs" : "Jobs entdecken"}
                <ArrowRight size={16} />
            </Link>
        </motion.div>
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
