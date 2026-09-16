"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowDown,
    ArrowLeft,
    BriefcaseBusiness,
    CalendarDays,
    CheckCircle2,
    Clock3,
    Euro,
    Flag,
    Info,
    ListOrdered,
    MapPin,
    MessageCircleWarning,
    Repeat2,
    RotateCcw,
    Send,
    ShieldCheck,
    Trash2,
    UserRound,
    Wifi,
    WifiOff,
    X,
    XCircle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { UserProfileModal, type VisibleProfile } from "@/components/profile/UserProfileModal";
import {
    type ActivityMessage,
    type ActivityRole,
    WRITABLE_ACTIVITY_STATUSES,
    buildActivityTimeline,
    formatChatDateLabel,
    formatClosureReason,
    getActivityStatusMeta,
    getProfileInitials,
    resolveReopenApplicationPatch,
} from "@/lib/activity/chat";
import { markApplicationMessagesRead } from "@/app/app-home/applications/actions";
import { cn } from "@/lib/utils";

type RealtimeState = "connecting" | "live" | "delayed";

type AuthorizedJobLocation = {
    address_full: string;
    private_lat: number | null;
    private_lng: number | null;
    notes: string | null;
};

interface ApplicationChatProps {
    application: any;
    currentUserRole?: ActivityRole;
    currentUserId?: string | null;
    onWithdraw?: (reason: string) => Promise<void>;
    onReject?: (reason: string) => Promise<void>;
    onSchedule?: (scheduledFor: string, note?: string) => Promise<any>;
    onReopen?: () => Promise<any>;
    onRequestReopen?: (message: string) => Promise<any>;
    onRespondReopenRequest?: (requestId: string, accept: boolean, reason?: string) => Promise<any>;
    onPromote?: (reason: string) => Promise<any>;
    onComplete?: (reason?: string) => Promise<any>;
    onReport?: (input: {
        applicationId: string;
        reasonCode: "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other";
        details?: string;
        reportedUserId?: string | null;
        messageId?: string | null;
        reopenRequestId?: string | null;
    }) => Promise<any>;
    onSendMessage: (applicationId: string, message: string) => Promise<any>;
    onConversationRead?: () => void;
    onClose?: () => void;
    embedded?: boolean;
    contextPanel?: boolean;
    premiumComposer?: boolean;
    readOnly?: boolean;
}

type TimelineMessage = ActivityMessage & { isApplicationMessage?: boolean; isSystemMessage?: boolean };

type ReopenRequest = {
    id: string;
    application_id: string;
    closure_version: number;
    requested_by: string;
    recipient_id: string;
    message: string;
    status: "pending" | "accepted" | "declined" | "expired";
    response_reason?: string | null;
    created_at: string;
    resolved_at?: string | null;
};

type ReportTarget = {
    reportedUserId?: string | null;
    messageId?: string | null;
    reopenRequestId?: string | null;
    reportedPersonName: string;
    context: {
        kind: "message" | "reopen_request" | "conversation";
        label: string;
        content: string;
        createdAt?: string | null;
    };
};

function mergeMessages(current: ActivityMessage[], incoming: ActivityMessage[]) {
    const byId = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, { ...byId.get(message.id), ...message });
    return Array.from(byId.values()).sort((a, b) => {
        const timeDifference = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        return timeDifference || a.id.localeCompare(b.id);
    });
}

function mergeReopenRequests(current: ReopenRequest[], incoming: ReopenRequest[]) {
    const byId = new Map(current.map((request) => [request.id, request]));
    for (const request of incoming) byId.set(request.id, { ...byId.get(request.id), ...request });
    return Array.from(byId.values()).sort((a, b) => (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));
}

function formatMessageTime(value: string | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function toDateTimeLocalValue(value?: string | null) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function formatSchedule(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatRecurrence(value?: string | null) {
    const labels: Record<string, string> = {
        weekly: "Wöchentlich",
        biweekly: "Alle zwei Wochen",
        monthly: "Monatlich",
        flexible: "Nach Absprache",
    };
    return labels[value ?? ""] ?? "Nach Absprache";
}

export function ApplicationChat({
    application,
    currentUserRole = "seeker",
    currentUserId: knownCurrentUserId,
    onWithdraw,
    onReject,
    onSchedule,
    onReopen,
    onRequestReopen,
    onRespondReopenRequest,
    onPromote,
    onComplete,
    onReport,
    onSendMessage,
    onConversationRead,
    onClose,
    embedded = false,
    contextPanel: _contextPanel = true,
    premiumComposer: _premiumComposer = false,
    readOnly = false,
}: ApplicationChatProps) {
    void _contextPanel;
    void _premiumComposer;

    const [draft, setDraft] = useState("");
    const [currentUserId, setCurrentUserId] = useState<string | null>(knownCurrentUserId ?? null);
    const [messages, setMessages] = useState<ActivityMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionReason, setActionReason] = useState("");
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleValue, setScheduleValue] = useState(() => toDateTimeLocalValue(application?.scheduled_for));
    const [scheduleNote, setScheduleNote] = useState(application?.agreement?.note ?? "");
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [schedulePending, setSchedulePending] = useState(false);
    const [liveApplication, setLiveApplication] = useState(application);
    const [reopenRequests, setReopenRequests] = useState<ReopenRequest[]>(application?.reopen_requests ?? []);
    const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
    const [reopenMessage, setReopenMessage] = useState("");
    const [reopenPending, setReopenPending] = useState(false);
    const [reopenError, setReopenError] = useState<string | null>(null);
    const [directReopenPending, setDirectReopenPending] = useState(false);
    const [requestResponsePending, setRequestResponsePending] = useState<string | null>(null);
    const [requestResponseError, setRequestResponseError] = useState<string | null>(null);
    const [declineRequest, setDeclineRequest] = useState<ReopenRequest | null>(null);
    const [declineReason, setDeclineReason] = useState("");
    const [promoteOpen, setPromoteOpen] = useState(false);
    const [promoteReason, setPromoteReason] = useState("");
    const [promotePending, setPromotePending] = useState(false);
    const [promoteError, setPromoteError] = useState<string | null>(null);
    const [completeOpen, setCompleteOpen] = useState(false);
    const [completeReason, setCompleteReason] = useState("");
    const [completePending, setCompletePending] = useState(false);
    const [completeError, setCompleteError] = useState<string | null>(null);
    const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
    const [reportReason, setReportReason] = useState<"harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other">("inappropriate");
    const [reportDetails, setReportDetails] = useState("");
    const [reportPending, setReportPending] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);
    const [reportSuccess, setReportSuccess] = useState(false);
    const [showNewMessages, setShowNewMessages] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [hasOlderMessages, setHasOlderMessages] = useState(false);
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
    const [authorizedJobLocation, setAuthorizedJobLocation] = useState<AuthorizedJobLocation | null>(null);

    const messagesViewportRef = useRef<HTMLDivElement>(null);
    const typingChannelRef = useRef<ReturnType<typeof supabaseBrowser.channel> | null>(null);
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingSentRef = useRef(false);
    const lastTypingSentAtRef = useRef(0);
    const nearBottomRef = useRef(true);
    const initialScrollDoneRef = useRef(false);
    const requestGenerationRef = useRef(0);

    useEffect(() => {
        if (!detailsOpen) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (
                event.key !== "Escape"
                || profileOpen
                || actionOpen
                || scheduleOpen
                || reopenDialogOpen
                || declineRequest
                || promoteOpen
                || completeOpen
                || reportTarget
            ) return;

            setDetailsOpen(false);
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [
        actionOpen,
        completeOpen,
        detailsOpen,
        profileOpen,
        promoteOpen,
        declineRequest,
        reopenDialogOpen,
        reportTarget,
        scheduleOpen,
    ]);

    useEffect(() => {
        const jobId = liveApplication?.job?.id ?? liveApplication?.job_id;
        if (!detailsOpen || !jobId) return;

        let cancelled = false;
        void supabaseBrowser
            .rpc("get_authorized_job_location", { p_job_id: jobId })
            .then(({ data, error }) => {
                if (cancelled) return;
                if (error) {
                    console.warn("Authorized job location could not be loaded:", error.message);
                    setAuthorizedJobLocation(null);
                    return;
                }

                const row = Array.isArray(data) ? data[0] : null;
                setAuthorizedJobLocation(row?.address_full ? row as AuthorizedJobLocation : null);
            });

        return () => {
            cancelled = true;
        };
    }, [detailsOpen, liveApplication?.job?.id, liveApplication?.job_id, liveApplication?.status]);

    useEffect(() => {
        setLiveApplication((current: any) => ({
            ...current,
            ...application,
            agreement: application?.agreement ?? current?.agreement ?? null,
            scheduled_for: application?.scheduled_for ?? current?.scheduled_for ?? null,
            agreed_at: application?.agreed_at ?? current?.agreed_at ?? null,
        }));
        setReopenRequests(application?.reopen_requests ?? []);
        setScheduleValue(toDateTimeLocalValue(application?.scheduled_for));
        setScheduleNote(application?.agreement?.note ?? "");
    }, [application]);

    useEffect(() => {
        setDraft("");
        setSendError(null);
        setDetailsOpen(false);
        setActionOpen(false);
        setScheduleOpen(false);
        setActionReason("");
        setActionError(null);
        setScheduleError(null);
        setReopenDialogOpen(false);
        setReopenMessage("");
        setReopenError(null);
        setRequestResponseError(null);
        setDeclineRequest(null);
        setDeclineReason("");
        setPromoteOpen(false);
        setPromoteReason("");
        setPromoteError(null);
        setCompleteOpen(false);
        setCompleteReason("");
        setCompleteError(null);
        setReportTarget(null);
        setReportDetails("");
        setReportError(null);
        setReportSuccess(false);
        setPartnerTyping(false);
        setAuthorizedJobLocation(null);
    }, [application?.id]);

    useEffect(() => {
        if (knownCurrentUserId) {
            setCurrentUserId(knownCurrentUserId);
            return;
        }

        let active = true;
        void supabaseBrowser.auth.getUser().then(({ data }) => {
            if (active) setCurrentUserId(data.user?.id ?? null);
        });
        return () => {
            active = false;
        };
    }, [knownCurrentUserId]);

    const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
        const viewport = messagesViewportRef.current;
        if (!viewport) return;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        nearBottomRef.current = true;
        setShowNewMessages(false);
    }, []);

    const markRead = useCallback(async () => {
        if (readOnly) return;
        const result = await markApplicationMessagesRead(liveApplication.id);
        if ("error" in result && result.error) return;
        const readAt = new Date().toISOString();
        setMessages((current) => current.map((message) => (
            message.sender_id !== currentUserId && !message.read_at
                ? { ...message, read_at: readAt }
                : message
        )));
        onConversationRead?.();
    }, [currentUserId, liveApplication.id, onConversationRead, readOnly]);

    useEffect(() => {
        const generation = ++requestGenerationRef.current;
        let active = true;
        initialScrollDoneRef.current = false;
        setMessages([]);
        setLoadError(null);
        setLoadingMessages(true);
        setRealtimeState("connecting");
        setHasOlderMessages(false);

        if (readOnly) {
            setLoadingMessages(false);
            setRealtimeState("delayed");
            return;
        }

        const mergeReopenPayload = (payload: { new?: unknown }) => {
            const request = payload.new as ReopenRequest;
            if (!request?.id) return;
            setReopenRequests((current) => mergeReopenRequests(current, [request]));
        };

        const channel = supabaseBrowser
            .channel(`application-chat-${liveApplication.id}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages",
                    filter: `application_id=eq.${liveApplication.id}`,
                },
                (payload) => {
                    const incoming = payload.new as ActivityMessage;
                    setMessages((current) => mergeMessages(current, [incoming]));
                    if (incoming.sender_id !== currentUserId) void markRead();
                    if (nearBottomRef.current || incoming.sender_id === currentUserId) {
                        requestAnimationFrame(() => scrollToEnd("smooth"));
                    } else {
                        setShowNewMessages(true);
                    }
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "messages",
                    filter: `application_id=eq.${liveApplication.id}`,
                },
                (payload) => {
                    setMessages((current) => mergeMessages(current, [payload.new as ActivityMessage]));
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "applications",
                    filter: `id=eq.${liveApplication.id}`,
                },
                (payload) => {
                    setLiveApplication((current: any) => ({ ...current, ...(payload.new as any) }));
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "conversation_reopen_requests",
                    filter: `application_id=eq.${liveApplication.id}`,
                },
                mergeReopenPayload,
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "conversation_reopen_requests",
                    filter: `application_id=eq.${liveApplication.id}`,
                },
                mergeReopenPayload,
            )
            .subscribe((status) => {
                if (!active) return;
                if (status === "SUBSCRIBED") setRealtimeState("live");
                if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setRealtimeState("delayed");
            });

        const loadMessages = async () => {
            const { data, error } = await supabaseBrowser
                .from("messages")
                .select("id, application_id, sender_id, content, created_at, read_at, kind")
                .eq("application_id", liveApplication.id)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(120);

            if (!active || generation !== requestGenerationRef.current) return;
            if (error) {
                setLoadError("Der Verlauf konnte nicht geladen werden.");
            } else {
                const ordered = [...(data ?? [])].reverse() as unknown as ActivityMessage[];
                setHasOlderMessages((data?.length ?? 0) === 120);
                setMessages((current) => mergeMessages(ordered, current));
                if (ordered.some((message) => message.sender_id !== currentUserId && !message.read_at)) {
                    void markRead();
                }
            }
            setLoadingMessages(false);
        };

        void loadMessages();

        return () => {
            active = false;
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, liveApplication.id, markRead, readOnly, scrollToEnd]);

    useEffect(() => {
        if (loadingMessages || initialScrollDoneRef.current) return;
        initialScrollDoneRef.current = true;
        requestAnimationFrame(() => scrollToEnd("auto"));
    }, [loadingMessages, messages.length, scrollToEnd]);

    const headerProfile = currentUserRole === "seeker"
        ? liveApplication?.job?.creator
        : liveApplication?.applicant;
    const headerName = currentUserRole === "seeker"
        ? headerProfile?.company_name || headerProfile?.full_name || "Auftraggeber"
        : headerProfile?.full_name || "Bewerber";
    const jobTitle = liveApplication?.job?.title || "Job-Angebot";
    const status = liveApplication?.status;
    const statusMeta = getActivityStatusMeta(status);
    const conversationState = liveApplication?.conversation_state ?? "open";
    const isPrimary = Boolean(liveApplication?.is_primary);
    const isWritable = !readOnly
        && conversationState === "open"
        && isPrimary
        && WRITABLE_ACTIVITY_STATUSES.has(status);
    const canCloseApplication = !readOnly
        && conversationState === "open"
        && ["submitted", "negotiating", "waitlisted", "accepted"].includes(status)
        && (currentUserRole === "seeker" ? Boolean(onWithdraw) : Boolean(onReject));
    const canSchedule = currentUserRole === "provider"
        && !readOnly
        && Boolean(onSchedule)
        && conversationState === "open"
        && isPrimary
        && ["submitted", "negotiating", "accepted"].includes(status);
    const canPromote = currentUserRole === "provider"
        && !readOnly
        && Boolean(onPromote)
        && conversationState === "open"
        && status === "waitlisted";
    const canComplete = currentUserRole === "provider"
        && !readOnly
        && Boolean(onComplete)
        && conversationState === "open"
        && status === "accepted"
        && liveApplication?.engagement?.status === "active";
    const canDirectReopen = !readOnly
        && conversationState === "closed"
        && liveApplication?.closed_by === currentUserId
        && Boolean(onReopen);
    const manualClosure = ["provider_rejected", "seeker_withdrew", "engagement_completed", "engagement_cancelled"]
        .includes(liveApplication?.close_action);
    const currentClosureRequest = reopenRequests.find((request) => (
        request.closure_version === liveApplication?.closure_version
        && request.requested_by === currentUserId
    ));
    const canRequestReopen = !readOnly
        && conversationState === "closed"
        && manualClosure
        && Boolean(liveApplication?.closed_by)
        && liveApplication?.closed_by !== currentUserId
        && !currentClosureRequest
        && Boolean(onRequestReopen);
    const appointments = (liveApplication?.appointments ?? liveApplication?.engagement?.appointments ?? []) as any[];
    const scheduleLabel = formatSchedule(liveApplication?.scheduled_for || liveApplication?.agreement?.starts_at);
    const waitlistPosition = Number(liveApplication?.my_waitlist_position);
    const waitlistPositionLabel = Number.isFinite(waitlistPosition) && waitlistPosition > 0
        ? ` · Position ${waitlistPosition}`
        : "";

    const broadcastTyping = useCallback((isTyping: boolean) => {
        const channel = typingChannelRef.current;
        if (!channel || !currentUserId || readOnly) return;

        const now = Date.now();
        if (isTyping && typingSentRef.current && now - lastTypingSentAtRef.current < 700) return;

        typingSentRef.current = isTyping;
        lastTypingSentAtRef.current = now;
        void channel.send({
            type: "broadcast",
            event: "typing",
            payload: {
                application_id: liveApplication.id,
                user_id: currentUserId,
                is_typing: isTyping,
            },
        });
    }, [currentUserId, liveApplication.id, readOnly]);

    const stopTyping = useCallback(() => {
        if (typingIdleTimerRef.current) {
            clearTimeout(typingIdleTimerRef.current);
            typingIdleTimerRef.current = null;
        }
        if (typingSentRef.current) broadcastTyping(false);
    }, [broadcastTyping]);

    const handleDraftChange = useCallback((value: string) => {
        setDraft(value);
        if (!value.trim()) {
            stopTyping();
            return;
        }

        broadcastTyping(true);
        if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = setTimeout(() => {
            broadcastTyping(false);
            typingIdleTimerRef.current = null;
        }, 1_800);
    }, [broadcastTyping, stopTyping]);

    useEffect(() => {
        setPartnerTyping(false);
        typingSentRef.current = false;
        if (!currentUserId || readOnly) return;

        const channel = supabaseBrowser
            .channel(`activity:${liveApplication.id}`, {
                config: {
                    private: true,
                    broadcast: { self: false, ack: false },
                },
            })
            .on("broadcast", { event: "typing" }, ({ payload }) => {
                if (
                    payload?.application_id !== liveApplication.id
                    || payload?.user_id === currentUserId
                ) return;

                const isTyping = payload?.is_typing === true;
                setPartnerTyping(isTyping);
                if (typingExpiryTimerRef.current) clearTimeout(typingExpiryTimerRef.current);
                typingExpiryTimerRef.current = isTyping
                    ? setTimeout(() => {
                        setPartnerTyping(false);
                        typingExpiryTimerRef.current = null;
                    }, 4_000)
                    : null;
            })
            .subscribe();

        typingChannelRef.current = channel;

        return () => {
            if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
            if (typingExpiryTimerRef.current) clearTimeout(typingExpiryTimerRef.current);
            if (typingSentRef.current) {
                void channel.send({
                    type: "broadcast",
                    event: "typing",
                    payload: {
                        application_id: liveApplication.id,
                        user_id: currentUserId,
                        is_typing: false,
                    },
                });
            }
            typingChannelRef.current = null;
            typingSentRef.current = false;
            setPartnerTyping(false);
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, liveApplication.id, readOnly]);

    useEffect(() => {
        if (isWritable) return;
        stopTyping();
    }, [isWritable, stopTyping]);

    const conversationTimeline = useMemo(() => buildActivityTimeline<TimelineMessage, ReopenRequest>(
        messages.map((message) => ({
            ...message,
            isApplicationMessage: message.kind === "application",
            isSystemMessage: message.kind === "system",
        })),
        reopenRequests,
    ), [messages, reopenRequests]);

    const handleSend = async () => {
        const content = draft.trim();
        if (!content || sending || !isWritable || !currentUserId) return;

        stopTyping();

        const tempId = `temp-${crypto.randomUUID()}`;
        const tempMessage: ActivityMessage = {
            id: tempId,
            application_id: liveApplication.id,
            sender_id: currentUserId,
            content,
            created_at: new Date().toISOString(),
            read_at: null,
            kind: "chat",
            is_temp: true,
        };

        setSendError(null);
        setSending(true);
        setDraft("");
        setMessages((current) => mergeMessages(current, [tempMessage]));
        requestAnimationFrame(() => scrollToEnd("smooth"));

        try {
            const result = await onSendMessage(liveApplication.id, content);
            if (result?.error) throw new Error(result.error);
            if (!result?.message?.id) throw new Error("Die Nachricht wurde nicht bestätigt.");
            setMessages((current) => mergeMessages(
                current.filter((message) => message.id !== tempId),
                [result.message as ActivityMessage],
            ));
        } catch (error) {
            setMessages((current) => current.filter((message) => message.id !== tempId));
            setDraft(content);
            setSendError(error instanceof Error ? error.message : "Nachricht konnte nicht gesendet werden.");
        } finally {
            setSending(false);
        }
    };

    const loadOlderMessages = async () => {
        const oldestMessage = messages[0];
        if (!oldestMessage?.created_at || loadingOlderMessages) return;
        setLoadingOlderMessages(true);
        const viewport = messagesViewportRef.current;
        const previousHeight = viewport?.scrollHeight ?? 0;

        const { data, error } = await supabaseBrowser
            .from("messages")
            .select("id, application_id, sender_id, content, created_at, read_at, kind")
            .eq("application_id", liveApplication.id)
            .or(`created_at.lt.${oldestMessage.created_at},and(created_at.eq.${oldestMessage.created_at},id.lt.${oldestMessage.id})`)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(120);

        if (!error) {
            const older = [...(data ?? [])].reverse() as unknown as ActivityMessage[];
            setMessages((current) => mergeMessages(older, current));
            setHasOlderMessages((data?.length ?? 0) === 120);
            requestAnimationFrame(() => {
                if (viewport) viewport.scrollTop = viewport.scrollHeight - previousHeight;
            });
        } else {
            setLoadError("Ältere Nachrichten konnten nicht geladen werden.");
        }
        setLoadingOlderMessages(false);
    };

    const handleDestructiveAction = async () => {
        if (currentUserRole === "provider" && !actionReason.trim()) {
            setActionError("Bitte gib einen kurzen Grund an.");
            return;
        }
        setActionPending(true);
        setActionError(null);
        try {
            if (currentUserRole === "seeker" && onWithdraw) await onWithdraw(actionReason.trim());
            if (currentUserRole === "provider" && onReject) await onReject(actionReason.trim());
            setLiveApplication((current: any) => ({
                ...current,
                status: currentUserRole === "seeker" ? "withdrawn" : "rejected",
                conversation_state: "closed",
                closed_by: currentUserId,
                closed_at: new Date().toISOString(),
                closed_reason: actionReason.trim() || "Kein Interesse mehr",
                close_action: currentUserRole === "seeker" ? "seeker_withdrew" : "provider_rejected",
                closure_version: Number(current.closure_version || 0) + 1,
                is_primary: false,
            }));
            setActionOpen(false);
            setDetailsOpen(false);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Die Aktion konnte nicht abgeschlossen werden.");
        } finally {
            setActionPending(false);
        }
    };

    const handleSchedule = async () => {
        if (!onSchedule || !scheduleValue) {
            setScheduleError("Bitte wähle Datum und Uhrzeit aus.");
            return;
        }
        const scheduledFor = new Date(scheduleValue);
        if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() - 60_000) {
            setScheduleError("Der Termin muss in der Zukunft liegen.");
            return;
        }

        setSchedulePending(true);
        setScheduleError(null);
        try {
            const result = await onSchedule(scheduledFor.toISOString(), scheduleNote.trim() || undefined);
            if (result?.error) throw new Error(result.error);
            setLiveApplication((current: any) => ({
                ...current,
                status: "accepted",
                scheduled_for: result?.scheduled_for || scheduledFor.toISOString(),
                agreed_at: result?.agreed_at || new Date().toISOString(),
                agreement: result?.agreement || current.agreement,
                engagement: result?.engagement || current.engagement,
                appointments: result?.appointment
                    ? [result.appointment, ...(current.appointments ?? []).filter((appointment: any) => appointment.id !== result.appointment.id)]
                    : current.appointments,
            }));
            setScheduleOpen(false);
        } catch (error) {
            setScheduleError(error instanceof Error ? error.message : "Der Termin konnte nicht gespeichert werden.");
        } finally {
            setSchedulePending(false);
        }
    };

    const handleDirectReopen = async () => {
        if (!onReopen || directReopenPending) return;
        setDirectReopenPending(true);
        setReopenError(null);
        try {
            const result = await onReopen();
            if (result?.error) throw new Error(result.error);
            const patch = resolveReopenApplicationPatch(result);
            if (patch) {
                setLiveApplication((current: any) => ({
                    ...current,
                    ...patch,
                    reopened_at: patch.reopened_at ?? new Date().toISOString(),
                }));
            }
        } catch (error) {
            setReopenError(error instanceof Error ? error.message : "Das Gespräch konnte nicht geöffnet werden.");
        } finally {
            setDirectReopenPending(false);
        }
    };

    const handleReopenRequest = async () => {
        if (!onRequestReopen || reopenPending) return;
        const message = reopenMessage.trim();
        if (message.length < 10) {
            setReopenError("Bitte beschreibe deine Anfrage in mindestens 10 Zeichen.");
            return;
        }
        setReopenPending(true);
        setReopenError(null);
        try {
            const result = await onRequestReopen(message);
            if (result?.error) throw new Error(result.error);
            if (result?.request) {
                setReopenRequests((current) => mergeReopenRequests(current, [result.request as ReopenRequest]));
            }
            setReopenDialogOpen(false);
            setReopenMessage("");
        } catch (error) {
            setReopenError(error instanceof Error ? error.message : "Die Anfrage konnte nicht gesendet werden.");
        } finally {
            setReopenPending(false);
        }
    };

    const handleReopenResponse = async (request: ReopenRequest, accept: boolean, reason = "") => {
        if (!onRespondReopenRequest || requestResponsePending) return;
        setRequestResponsePending(request.id);
        setRequestResponseError(null);
        try {
            const result = await onRespondReopenRequest(request.id, accept, reason.trim() || undefined);
            if (result?.error) throw new Error(result.error);
            setReopenRequests((current) => mergeReopenRequests(current, [{
                ...request,
                status: accept ? "accepted" : "declined",
                resolved_at: new Date().toISOString(),
            }]));
            if (accept) {
                const patch = resolveReopenApplicationPatch(result);
                if (patch) setLiveApplication((current: any) => ({ ...current, ...patch }));
            } else {
                setDeclineRequest(null);
                setDeclineReason("");
            }
        } catch (error) {
            setRequestResponseError(error instanceof Error ? error.message : "Die Anfrage konnte nicht beantwortet werden.");
        } finally {
            setRequestResponsePending(null);
        }
    };

    const handlePromote = async () => {
        if (!onPromote || promotePending) return;
        const reason = promoteReason.trim();
        if (reason.length < 20) {
            setPromoteError("Bitte begründe die Ausnahme in mindestens 20 Zeichen.");
            return;
        }
        setPromotePending(true);
        setPromoteError(null);
        try {
            const result = await onPromote(reason);
            if (result?.error) throw new Error(result.error);
            setLiveApplication((current: any) => ({
                ...current,
                status: "negotiating",
                is_primary: true,
                promoted_at: new Date().toISOString(),
                promotion_reason: reason,
            }));
            setPromoteOpen(false);
            setPromoteReason("");
        } catch (error) {
            setPromoteError(error instanceof Error ? error.message : "Die Bewerbung konnte nicht vorgezogen werden.");
        } finally {
            setPromotePending(false);
        }
    };

    const handleComplete = async () => {
        if (!onComplete || completePending) return;
        setCompletePending(true);
        setCompleteError(null);
        try {
            const result = await onComplete(completeReason.trim() || undefined);
            if (result?.error) throw new Error(result.error);
            setLiveApplication((current: any) => ({
                ...current,
                status: "completed",
                conversation_state: "closed",
                closed_by: currentUserId,
                close_action: "engagement_completed",
                closed_reason: completeReason.trim() || "Zusammenarbeit abgeschlossen.",
                is_primary: false,
                engagement: current.engagement ? { ...current.engagement, status: "completed" } : current.engagement,
            }));
            setCompleteOpen(false);
            setCompleteReason("");
        } catch (error) {
            setCompleteError(error instanceof Error ? error.message : "Die Zusammenarbeit konnte nicht abgeschlossen werden.");
        } finally {
            setCompletePending(false);
        }
    };

    const handleReport = async () => {
        if (!onReport || !reportTarget || reportPending) return;
        setReportPending(true);
        setReportError(null);
        try {
            const { reportedUserId, messageId, reopenRequestId } = reportTarget;
            const result = await onReport({
                applicationId: liveApplication.id,
                reasonCode: reportReason,
                details: reportDetails.trim() || undefined,
                reportedUserId,
                messageId,
                reopenRequestId,
            });
            if (result?.error) throw new Error(result.error);
            setReportSuccess(true);
        } catch (error) {
            setReportError(error instanceof Error ? error.message : "Die Meldung konnte nicht gesendet werden.");
        } finally {
            setReportPending(false);
        }
    };

    if (!application) return null;

    return (
        <div className={cn("application-chat activity-modern-chat", embedded ? "" : "activity-modern-chat-modal")}>
            <UserProfileModal
                isOpen={profileOpen}
                onClose={() => setProfileOpen(false)}
                profile={(headerProfile ?? null) as VisibleProfile | null}
                isStaff={Boolean(headerProfile?.is_staff)}
            />

            <header className="activity-chat-header">
                {onClose ? (
                    <button type="button" onClick={onClose} className="activity-chat-back" aria-label={embedded ? "Zur Gesprächsübersicht" : "Chat schließen"}>
                        {embedded ? <ArrowLeft size={20} /> : <X size={20} />}
                    </button>
                ) : null}

                <button
                    type="button"
                    className="activity-chat-person"
                    onClick={() => setProfileOpen(true)}
                    aria-label={`Profil von ${headerName} öffnen`}
                    disabled={!headerProfile?.id}
                >
                    <span className="activity-chat-avatar" aria-hidden="true">
                        {headerProfile?.avatar_url ? <img src={headerProfile.avatar_url} alt="" /> : getProfileInitials(headerName)}
                    </span>
                    <span>
                        <strong>{headerName}</strong>
                        <small>{jobTitle}</small>
                    </span>
                </button>

                <div className="activity-chat-header-meta">
                    <span className="activity-chat-status" data-tone={statusMeta.tone}>
                        <span aria-hidden="true" />
                        {statusMeta.label}
                    </span>
                    <span
                        className="activity-realtime-state"
                        data-state={readOnly ? "preview" : realtimeState}
                        title={readOnly ? "Vorschau ohne Live-Aktionen" : realtimeState === "live" ? "Live verbunden" : realtimeState === "connecting" ? "Verbindung wird hergestellt" : "Verbindung verzögert"}
                    >
                        {!readOnly && realtimeState === "live" ? <Wifi size={13} /> : <WifiOff size={13} />}
                        <span>{readOnly ? "Vorschau" : realtimeState === "live" ? "Live" : realtimeState === "connecting" ? "Verbinden" : "Verzögert"}</span>
                    </span>
                </div>

                <div className="activity-chat-actions">
                    {canSchedule ? (
                        <button
                            type="button"
                            className="activity-schedule-button"
                            onClick={() => {
                                setScheduleError(null);
                                const addingRecurringAppointment = liveApplication?.job?.job_kind === "recurring" && status === "accepted";
                                setScheduleValue(addingRecurringAppointment ? "" : toDateTimeLocalValue(liveApplication?.scheduled_for));
                                setScheduleNote(addingRecurringAppointment ? "" : liveApplication?.agreement?.note ?? "");
                                setScheduleOpen(true);
                            }}
                        >
                            <CalendarDays size={17} />
                            <span>
                                {liveApplication?.job?.job_kind === "recurring" && status === "accepted"
                                    ? "Weiteren Termin"
                                    : status === "accepted"
                                        ? "Termin ändern"
                                        : "Termin festlegen"}
                            </span>
                        </button>
                    ) : null}
                    <button type="button" className="activity-icon-button" onClick={() => setDetailsOpen(true)} aria-label="Details zum Gespräch öffnen">
                        <Info size={19} />
                    </button>
                </div>
            </header>

            {isPrimary && ["submitted", "negotiating"].includes(status) ? (
                <div className="activity-chat-notice" data-tone="primary">
                    <ListOrdered size={18} />
                    <div>
                        <strong>{currentUserRole === "seeker" ? "Ihr seid im Gespräch" : `${headerName} ist im Gespräch`}</strong>
                        <span>
                            {currentUserRole === "seeker"
                                ? "Ihr könnt euch hier direkt abstimmen."
                                : "Dieser Austausch ist aktuell geöffnet."}
                        </span>
                    </div>
                </div>
            ) : null}

            {status === "waitlisted" ? (
                <div className="activity-chat-notice" data-tone="warning">
                    <Clock3 size={18} />
                    <div>
                        <strong>
                            {currentUserRole === "seeker"
                                ? `Auf der Warteliste${waitlistPositionLabel}`
                                : `Warteliste${waitlistPositionLabel}`}
                        </strong>
                        <span>
                            {currentUserRole === "seeker"
                                ? "Du erhältst automatisch Bescheid, sobald das Gespräch für dich geöffnet wird."
                                : "Der Chat wird automatisch geöffnet, sobald diese Bewerbung nachrückt."}
                        </span>
                    </div>
                    {canPromote ? (
                        <button type="button" onClick={() => setPromoteOpen(true)}>Ausnahmsweise vorziehen</button>
                    ) : null}
                </div>
            ) : null}

            {conversationState === "closed" ? (
                <div className="activity-chat-notice" data-tone="closed">
                    <MessageCircleWarning size={18} />
                    <div>
                        <strong>Gespräch geschlossen</strong>
                        <span>{formatClosureReason(liveApplication.closed_reason)}</span>
                    </div>
                </div>
            ) : null}

            {status === "accepted" && scheduleLabel ? (
                <div className="activity-chat-notice" data-tone="success">
                    <CheckCircle2 size={18} />
                    <div>
                        <strong>{liveApplication?.job?.job_kind === "recurring" ? "Zusammenarbeit aktiv" : "Termin verbindlich vereinbart"}</strong>
                        <time dateTime={liveApplication.scheduled_for || liveApplication.agreement?.starts_at}>{scheduleLabel}</time>
                    </div>
                </div>
            ) : null}

            <div
                ref={messagesViewportRef}
                className="application-chat-messages activity-message-viewport"
                role="log"
                aria-live="polite"
                aria-label={`Nachrichten zu ${jobTitle}`}
                onScroll={(event) => {
                    const element = event.currentTarget;
                    nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
                    if (nearBottomRef.current) setShowNewMessages(false);
                }}
            >
                <div className="activity-message-column">
                    {loadingMessages ? <MessageLoadingState /> : null}
                    {loadError ? <div className="activity-chat-inline-error">{loadError}</div> : null}
                    {hasOlderMessages ? (
                        <button type="button" className="activity-load-older" onClick={() => void loadOlderMessages()} disabled={loadingOlderMessages}>
                            {loadingOlderMessages ? "Wird geladen …" : "Ältere Nachrichten laden"}
                        </button>
                    ) : null}

                    {conversationTimeline.map((timelineEntry) => {
                        const dateSeparator = timelineEntry.showDateSeparator ? (
                            <div className="activity-date-separator">
                                <span>{formatChatDateLabel(timelineEntry.createdAt)}</span>
                            </div>
                        ) : null;

                        if (timelineEntry.type === "message") {
                            const timelineMessage = timelineEntry.item;
                            const isOwnMessage = timelineMessage.sender_id === currentUserId;

                            return (
                                <div key={timelineEntry.key} className="activity-message-entry">
                                    {dateSeparator}
                                    {timelineMessage.isSystemMessage ? (
                                        <div className="activity-system-message">
                                            <CheckCircle2 size={14} />
                                            <span>{timelineMessage.content}</span>
                                            <time dateTime={timelineMessage.created_at || undefined}>{formatMessageTime(timelineMessage.created_at)}</time>
                                        </div>
                                    ) : (
                                        <div className={cn("activity-message-row", isOwnMessage ? "is-own" : "is-other")}>
                                            <div className="activity-message-wrap">
                                                <div className="activity-message-bubble">
                                                    {timelineMessage.content}
                                                </div>
                                                <div className="activity-message-meta">
                                                    {timelineMessage.isApplicationMessage ? <span>Bewerbung</span> : null}
                                                    <time dateTime={timelineMessage.created_at || undefined}>{formatMessageTime(timelineMessage.created_at)}</time>
                                                    {timelineMessage.is_temp ? <span>Wird gesendet</span> : null}
                                                    {!timelineMessage.is_temp && isOwnMessage && timelineMessage.read_at ? <span>Gelesen</span> : null}
                                                    {!timelineMessage.is_temp && !isOwnMessage && onReport ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReportTarget({
                                                                    messageId: timelineMessage.id,
                                                                    reportedUserId: timelineMessage.sender_id,
                                                                    reportedPersonName: headerName,
                                                                    context: {
                                                                        kind: "message",
                                                                        label: timelineMessage.isApplicationMessage
                                                                            ? "Ausgewählte Bewerbungsnachricht"
                                                                            : "Ausgewählte Nachricht",
                                                                        content: timelineMessage.content,
                                                                        createdAt: timelineMessage.created_at,
                                                                    },
                                                                });
                                                                setReportReason("inappropriate");
                                                                setReportDetails("");
                                                                setReportSuccess(false);
                                                                setReportError(null);
                                                            }}
                                                        >
                                                            Melden
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        const request = timelineEntry.item;
                        const isRecipient = request.recipient_id === currentUserId;
                        const isRequester = request.requested_by === currentUserId;
                        return (
                            <div key={timelineEntry.key} className="activity-message-entry">
                                {dateSeparator}
                                <div className="activity-reopen-request-card" data-status={request.status}>
                                    <div className="activity-reopen-request-label">
                                        <MessageCircleWarning size={15} />
                                        <strong>Öffnungsanfrage</strong>
                                        <span>keine Chatnachricht</span>
                                        <time dateTime={request.created_at}>{formatMessageTime(request.created_at)}</time>
                                    </div>
                                    <p>{request.message}</p>
                                    <div className="activity-reopen-request-footer">
                                        <span>
                                            {request.status === "pending"
                                                ? isRequester ? "Antwort ausstehend" : "Bitte prüfen"
                                                : request.status === "accepted"
                                                    ? "Angenommen"
                                                    : request.status === "declined"
                                                        ? "Abgelehnt"
                                                        : "Abgelaufen"}
                                        </span>
                                        {request.status === "pending" && isRecipient && onRespondReopenRequest ? (
                                            <div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRequestResponseError(null);
                                                        setDeclineReason("");
                                                        setDeclineRequest(request);
                                                    }}
                                                    disabled={requestResponsePending === request.id}
                                                >
                                                    Ablehnen
                                                </button>
                                                <button
                                                    type="button"
                                                    className="is-primary"
                                                    onClick={() => void handleReopenResponse(request, true)}
                                                    disabled={requestResponsePending === request.id}
                                                >
                                                    Wieder öffnen
                                                </button>
                                            </div>
                                        ) : null}
                                        {!isRequester && onReport ? (
                                            <button
                                                type="button"
                                                className="activity-inline-report"
                                                onClick={() => {
                                                    setReportTarget({
                                                        reopenRequestId: request.id,
                                                        reportedUserId: request.requested_by,
                                                        reportedPersonName: headerName,
                                                        context: {
                                                            kind: "reopen_request",
                                                            label: "Ausgewählte Öffnungsanfrage",
                                                            content: request.message,
                                                            createdAt: request.created_at,
                                                        },
                                                    });
                                                    setReportReason("inappropriate");
                                                    setReportDetails("");
                                                    setReportSuccess(false);
                                                    setReportError(null);
                                                }}
                                            >
                                                <Flag size={13} /> Melden
                                            </button>
                                        ) : null}
                                    </div>
                                    {requestResponseError && requestResponsePending === null ? (
                                        <div className="activity-chat-inline-error">{requestResponseError}</div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <AnimatePresence initial={false}>
                {showNewMessages ? (
                    <motion.button
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        type="button"
                        className="activity-new-messages"
                        onClick={() => scrollToEnd("smooth")}
                    >
                        <ArrowDown size={15} /> Neue Nachricht
                    </motion.button>
                ) : null}
            </AnimatePresence>

            {isWritable ? (
                <footer className="application-chat-inputbar activity-chat-composer">
                    {sendError ? <div className="activity-composer-error" role="alert">{sendError}</div> : null}
                    <div className="activity-composer-box">
                        <textarea
                            value={draft}
                            maxLength={1200}
                            rows={1}
                            aria-label="Nachricht schreiben"
                            onChange={(event) => handleDraftChange(event.target.value)}
                            onBlur={stopTyping}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    void handleSend();
                                }
                            }}
                            placeholder="Nachricht schreiben …"
                            disabled={sending}
                            onInput={(event) => {
                                const element = event.currentTarget;
                                element.style.height = "auto";
                                element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
                            }}
                        />
                        {draft.length >= 1000 ? <span className="activity-character-count">{draft.length}/1200</span> : null}
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={!draft.trim() || sending}
                            className="activity-send-button"
                            aria-label="Nachricht senden"
                        >
                            {sending ? <span className="activity-send-spinner" /> : <Send size={19} />}
                        </button>
                    </div>
                    <div className="activity-composer-presence" aria-live="polite" aria-atomic="true">
                        {partnerTyping ? (
                            <span>
                                <span className="activity-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                                {headerName} tippt …
                            </span>
                        ) : null}
                    </div>
                    <div className="activity-composer-hint">Enter zum Senden · Shift + Enter für eine neue Zeile</div>
                </footer>
            ) : (
                <footer className="application-chat-inputbar activity-chat-composer activity-locked-composer">
                    <div>
                        <span className="activity-locked-icon">
                            {status === "waitlisted" ? <Clock3 size={18} /> : <MessageCircleWarning size={18} />}
                        </span>
                        <div>
                            <strong>
                                {readOnly
                                    ? "Vorschau ohne Aktionen"
                                    : status === "waitlisted"
                                        ? "Chat auf der Warteliste pausiert"
                                        : "Keine normalen Nachrichten möglich"}
                            </strong>
                            <span>
                                {status === "waitlisted"
                                    ? "Deine Bewerbung ist angekommen. Der Chat öffnet sich automatisch, sobald du nachrückst."
                                    : currentClosureRequest?.status === "pending"
                                        ? "Deine einmalige Öffnungsanfrage wurde gesendet."
                                        : liveApplication?.close_action === "job_assigned"
                                            ? "Der Job wurde verbindlich anderweitig vergeben."
                                            : "Nur die schließende Partei kann den Chat direkt wieder öffnen."}
                            </span>
                        </div>
                    </div>
                    <div className="activity-locked-actions">
                        {canDirectReopen ? (
                            <button type="button" className="is-primary" onClick={() => void handleDirectReopen()} disabled={directReopenPending}>
                                <RotateCcw size={15} /> {directReopenPending ? "Wird geöffnet …" : "Gespräch wieder öffnen"}
                            </button>
                        ) : null}
                        {canRequestReopen ? (
                            <button type="button" onClick={() => {
                                setReopenError(null);
                                setReopenDialogOpen(true);
                            }}>
                                <MessageCircleWarning size={15} /> Einmalige Öffnungsanfrage
                            </button>
                        ) : null}
                        {canPromote ? (
                            <button type="button" onClick={() => setPromoteOpen(true)}>
                                <ListOrdered size={15} /> Ausnahmsweise vorziehen
                            </button>
                        ) : null}
                    </div>
                    {reopenError ? <div className="activity-composer-error" role="alert">{reopenError}</div> : null}
                </footer>
            )}

            <AnimatePresence initial={false}>
                {detailsOpen ? (
                    <>
                        <motion.button
                            type="button"
                            className="activity-drawer-backdrop"
                            aria-label="Details schließen"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDetailsOpen(false)}
                        />
                        <motion.aside
                            className="activity-details-drawer"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Gesprächsdetails"
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 12 }}
                            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        >
                            <div className="activity-drawer-header">
                                <div>
                                    <strong>Details</strong>
                                    <span>{jobTitle}</span>
                                </div>
                                <button type="button" onClick={() => setDetailsOpen(false)} aria-label="Details schließen"><X size={19} /></button>
                            </div>

                            <button type="button" className="activity-drawer-profile" onClick={() => setProfileOpen(true)}>
                                <span className="activity-chat-avatar" aria-hidden="true">
                                    {headerProfile?.avatar_url ? <img src={headerProfile.avatar_url} alt="" /> : getProfileInitials(headerName)}
                                </span>
                                <span><strong>{headerName}</strong><small>Profil ansehen</small></span>
                                <UserRound size={18} />
                            </button>

                            <div className="activity-detail-section">
                                <h3>Auftrag</h3>
                                <DetailRow icon={<BriefcaseBusiness size={17} />} label="Job" value={jobTitle} />
                                <DetailRow
                                    icon={liveApplication.job?.job_kind === "recurring" ? <Repeat2 size={17} /> : <CalendarDays size={17} />}
                                    label="Jobart"
                                    value={liveApplication.job?.job_kind === "recurring"
                                        ? `Regelmäßig · ${formatRecurrence(liveApplication.job?.recurrence_rule)}`
                                        : "Einmaliger Auftrag"}
                                />
                                {liveApplication.job?.wage_hourly ? <DetailRow icon={<Euro size={17} />} label="Vergütung" value={`${liveApplication.job.wage_hourly} € / Std.`} /> : null}
                                {liveApplication.job?.public_location_label ? <DetailRow icon={<MapPin size={17} />} label="Ort" value={liveApplication.job.public_location_label} /> : null}
                                {authorizedJobLocation?.address_full ? (
                                    <DetailRow icon={<ShieldCheck size={17} />} label="Treffpunkt" value={authorizedJobLocation.address_full} />
                                ) : null}
                                {scheduleLabel ? <DetailRow icon={<CalendarDays size={17} />} label="Termin" value={scheduleLabel} /> : null}
                            </div>

                            {appointments.length > 0 ? (
                                <div className="activity-detail-section activity-appointment-list">
                                    <h3>{liveApplication.job?.job_kind === "recurring" ? "Termine der Zusammenarbeit" : "Termin"}</h3>
                                    {appointments.map((appointment) => (
                                        <div key={appointment.id} className="activity-appointment-item" data-status={appointment.status}>
                                            <CalendarDays size={16} />
                                            <div>
                                                <strong>{formatSchedule(appointment.starts_at)}</strong>
                                                <span>
                                                    {appointment.status === "scheduled" ? "Geplant" : appointment.status === "completed" ? "Erledigt" : "Abgesagt"}
                                                    {appointment.note ? ` · ${appointment.note}` : ""}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <div className="activity-pay-placeholder">
                                <span><ShieldCheck size={18} /></span>
                                <div><strong>Workfare Pay</strong><small>Sichere Bezahlung direkt über Workfare</small></div>
                                <em>In Entwicklung</em>
                            </div>

                            <div className="activity-detail-actions">
                                {canComplete ? (
                                    <button type="button" onClick={() => {
                                        setCompleteError(null);
                                        setCompleteOpen(true);
                                    }}>
                                        <CheckCircle2 size={17} /> Zusammenarbeit abschließen
                                    </button>
                                ) : null}
                                {canDirectReopen ? (
                                    <button type="button" onClick={() => void handleDirectReopen()} disabled={directReopenPending}>
                                        <RotateCcw size={17} /> Gespräch wieder öffnen
                                    </button>
                                ) : null}
                                {onReport && headerProfile?.id ? (
                                    <button type="button" className="is-muted" onClick={() => {
                                        setReportTarget({
                                            reportedUserId: headerProfile.id,
                                            reportedPersonName: headerName,
                                            context: {
                                                kind: "conversation",
                                                label: "Gesamter Chat als Kontext",
                                                content: `Der vollständige Gesprächsverlauf zu „${jobTitle}“ wird bei der Prüfung berücksichtigt.`,
                                            },
                                        });
                                        setReportReason("inappropriate");
                                        setReportDetails("");
                                        setReportSuccess(false);
                                        setReportError(null);
                                    }}>
                                        <Flag size={17} /> Person melden
                                    </button>
                                ) : null}
                            </div>

                            {canCloseApplication ? (
                                <div className="activity-detail-danger-zone">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setActionReason("");
                                            setActionError(null);
                                            setActionOpen(true);
                                        }}
                                    >
                                        {currentUserRole === "seeker" ? <Trash2 size={17} /> : <XCircle size={17} />}
                                        {currentUserRole === "seeker"
                                            ? status === "accepted"
                                                ? "Zusammenarbeit absagen"
                                                : status === "waitlisted" ? "Warteliste verlassen" : "Bewerbung zurückziehen"
                                            : status === "accepted" ? "Zusammenarbeit absagen" : "Bewerbung ablehnen"}
                                    </button>
                                </div>
                            ) : null}
                        </motion.aside>
                    </>
                ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
                {actionOpen ? (
                    <ActionDialog
                        role={currentUserRole}
                        status={status}
                        reason={actionReason}
                        setReason={setActionReason}
                        pending={actionPending}
                        error={actionError}
                        onCancel={() => setActionOpen(false)}
                        onConfirm={() => void handleDestructiveAction()}
                    />
                ) : null}
                {scheduleOpen ? (
                    <ScheduleDialog
                        value={scheduleValue}
                        setValue={setScheduleValue}
                        note={scheduleNote}
                        setNote={setScheduleNote}
                        pending={schedulePending}
                        error={scheduleError}
                        isEditing={status === "accepted"}
                        isRecurring={liveApplication?.job?.job_kind === "recurring"}
                        onCancel={() => setScheduleOpen(false)}
                        onConfirm={() => void handleSchedule()}
                    />
                ) : null}
                {reopenDialogOpen ? (
                    <TextActionDialog
                        icon={<MessageCircleWarning size={21} />}
                        title="Einmalige Öffnungsanfrage"
                        description="Das ist keine Chatnachricht. Die andere Person erhält genau eine Anfrage für diese Schließung und entscheidet, ob sie den Chat wieder öffnet."
                        label="Kurze, sachliche Nachricht"
                        value={reopenMessage}
                        setValue={setReopenMessage}
                        minLength={10}
                        pending={reopenPending}
                        error={reopenError}
                        confirmLabel="Anfrage senden"
                        onCancel={() => setReopenDialogOpen(false)}
                        onConfirm={() => void handleReopenRequest()}
                    />
                ) : null}
                {declineRequest ? (
                    <TextActionDialog
                        icon={<XCircle size={21} />}
                        title="Öffnungsanfrage ablehnen?"
                        description="Diese Anfrage kann für die aktuelle Schließung nur einmal gestellt werden. Prüfe sie deshalb bewusst, bevor du endgültig ablehnst."
                        label="Kurzer Grund (optional)"
                        value={declineReason}
                        setValue={setDeclineReason}
                        minLength={0}
                        pending={requestResponsePending === declineRequest.id}
                        error={requestResponseError}
                        confirmLabel="Anfrage ablehnen"
                        tone="warning"
                        onCancel={() => {
                            setDeclineRequest(null);
                            setDeclineReason("");
                            setRequestResponseError(null);
                        }}
                        onConfirm={() => void handleReopenResponse(declineRequest, false, declineReason)}
                    />
                ) : null}
                {promoteOpen ? (
                    <TextActionDialog
                        icon={<ListOrdered size={21} />}
                        title="Wartelisten-Bewerbung vorziehen?"
                        description="Die aktuell offene Bewerbung hat grundsätzlich Vorrang. Nutze diese Ausnahme nur mit einem konkreten, fairen Grund. Die betroffene Person wird über die Abweichung informiert."
                        label="Begründung der Ausnahme"
                        value={promoteReason}
                        setValue={setPromoteReason}
                        minLength={20}
                        pending={promotePending}
                        error={promoteError}
                        confirmLabel="Begründet vorziehen"
                        tone="warning"
                        onCancel={() => setPromoteOpen(false)}
                        onConfirm={() => void handlePromote()}
                    />
                ) : null}
                {completeOpen ? (
                    <TextActionDialog
                        icon={<CheckCircle2 size={21} />}
                        title="Zusammenarbeit abschließen?"
                        description={liveApplication?.job?.job_kind === "recurring"
                            ? "Damit endet der langfristige Auftrag und der Chat wird geschlossen. Du kannst ihn bei Bedarf später wieder öffnen."
                            : "Der Auftrag wird als abgeschlossen markiert und der Chat geschlossen."}
                        label="Abschlussnotiz (optional)"
                        value={completeReason}
                        setValue={setCompleteReason}
                        minLength={0}
                        pending={completePending}
                        error={completeError}
                        confirmLabel="Als abgeschlossen markieren"
                        onCancel={() => setCompleteOpen(false)}
                        onConfirm={() => void handleComplete()}
                    />
                ) : null}
                {reportTarget ? (
                    <ReportDialog
                        target={reportTarget}
                        reason={reportReason}
                        setReason={setReportReason}
                        details={reportDetails}
                        setDetails={setReportDetails}
                        pending={reportPending}
                        error={reportError}
                        success={reportSuccess}
                        onCancel={() => setReportTarget(null)}
                        onConfirm={() => void handleReport()}
                    />
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="activity-detail-row">
            <span>{icon}</span>
            <div><small>{label}</small><strong>{value}</strong></div>
        </div>
    );
}

function ActionDialog({
    role,
    status,
    reason,
    setReason,
    pending,
    error,
    onCancel,
    onConfirm,
}: {
    role: ActivityRole;
    status: string;
    reason: string;
    setReason: (value: string) => void;
    pending: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const isProvider = role === "provider";
    const isAccepted = status === "accepted";
    const isWaitlisted = status === "waitlisted";
    const title = isAccepted
        ? "Zusammenarbeit absagen?"
        : isProvider
            ? "Bewerbung ablehnen?"
            : isWaitlisted
                ? "Warteliste verlassen?"
                : "Bewerbung zurückziehen?";
    const description = isAccepted
        ? "Der vereinbarte Auftrag und alle geplanten Termine werden abgesagt. Falls Personen warten, rückt die nächste Bewerbung nach. Das Gespräch wird geschlossen."
        : isProvider
            ? "Die Person wird informiert und das Gespräch geschlossen. Du kannst es später wieder öffnen."
            : isWaitlisted
                ? "Dein Eintrag wird von der Warteliste entfernt. Solange der Job nicht vergeben ist, kannst du das Gespräch später wieder öffnen."
                : "Das Gespräch wird geschlossen. Solange der Job nicht vergeben ist, kannst du es später wieder öffnen.";
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="activity-action-title"
                className="activity-action-dialog"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
            >
                <span className="activity-dialog-icon is-danger">{isProvider ? <XCircle size={21} /> : <Trash2 size={21} />}</span>
                <h2 id="activity-action-title">{title}</h2>
                <p>{description}</p>
                <label>
                    <span>{isProvider ? "Kurzer Grund" : "Grund (optional)"}</span>
                    <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} />
                </label>
                {error ? <div className="activity-dialog-error" role="alert">{error}</div> : null}
                <div className="activity-dialog-actions">
                    <button type="button" onClick={onCancel} disabled={pending}>Abbrechen</button>
                    <button type="button" className="is-danger" onClick={onConfirm} disabled={pending || (isProvider && !reason.trim())}>
                        {pending ? "Wird verarbeitet …" : "Bestätigen"}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function ScheduleDialog({
    value,
    setValue,
    note,
    setNote,
    pending,
    error,
    isEditing,
    isRecurring,
    onCancel,
    onConfirm,
}: {
    value: string;
    setValue: (value: string) => void;
    note: string;
    setNote: (value: string) => void;
    pending: boolean;
    error: string | null;
    isEditing: boolean;
    isRecurring: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="activity-schedule-title"
                className="activity-action-dialog activity-schedule-dialog"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
            >
                <span className="activity-dialog-icon"><CalendarDays size={21} /></span>
                <h2 id="activity-schedule-title">
                    {isRecurring && isEditing ? "Weiteren Termin hinzufügen" : isEditing ? "Termin ändern" : "Termin verbindlich festlegen"}
                </h2>
                <p>
                    {isRecurring
                        ? "Der Termin wird Teil der langfristigen Zusammenarbeit. Der Auftrag bleibt vergeben, bis du die Zusammenarbeit abschließt."
                        : "Danach gilt der Auftrag als vereinbart und wird nicht mehr öffentlich angeboten."}
                </p>
                <label>
                    <span>Datum und Uhrzeit</span>
                    <input autoFocus type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
                </label>
                <label>
                    <span>Notiz (optional)</span>
                    <input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="z. B. Treffpunkt oder kurze Absprache" />
                </label>
                <div className="activity-schedule-trust">
                    <ShieldCheck size={17} />
                    <span>Die Vereinbarung wird für beide Seiten nachvollziehbar gespeichert.</span>
                </div>
                {error ? <div className="activity-dialog-error" role="alert">{error}</div> : null}
                <div className="activity-dialog-actions">
                    <button type="button" onClick={onCancel} disabled={pending}>Abbrechen</button>
                    <button type="button" className="is-primary" onClick={onConfirm} disabled={pending || !value}>
                        {pending
                            ? "Wird gespeichert …"
                            : isRecurring && isEditing
                                ? "Termin hinzufügen"
                                : isEditing
                                    ? "Änderung speichern"
                                    : "Termin festlegen"}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function TextActionDialog({
    icon,
    title,
    description,
    label,
    value,
    setValue,
    minLength,
    pending,
    error,
    confirmLabel,
    tone = "default",
    onCancel,
    onConfirm,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    label: string;
    value: string;
    setValue: (value: string) => void;
    minLength: number;
    pending: boolean;
    error: string | null;
    confirmLabel: string;
    tone?: "default" | "warning";
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="activity-action-dialog"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
            >
                <span className={cn("activity-dialog-icon", tone === "warning" && "is-warning")}>{icon}</span>
                <h2>{title}</h2>
                <p>{description}</p>
                <label>
                    <span>{label}</span>
                    <textarea
                        autoFocus
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        maxLength={500}
                        rows={4}
                    />
                </label>
                {minLength > 0 ? <small className="activity-dialog-counter">Mindestens {minLength} Zeichen · {value.trim().length}/500</small> : null}
                {error ? <div className="activity-dialog-error" role="alert">{error}</div> : null}
                <div className="activity-dialog-actions">
                    <button type="button" onClick={onCancel} disabled={pending}>Abbrechen</button>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={onConfirm}
                        disabled={pending || value.trim().length < minLength}
                    >
                        {pending ? "Wird verarbeitet …" : confirmLabel}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function ReportDialog({
    target,
    reason,
    setReason,
    details,
    setDetails,
    pending,
    error,
    success,
    onCancel,
    onConfirm,
}: {
    target: ReportTarget;
    reason: "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other";
    setReason: (value: "harassment" | "fraud" | "safety" | "inappropriate" | "spam" | "other") => void;
    details: string;
    setDetails: (value: string) => void;
    pending: boolean;
    error: string | null;
    success: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="activity-report-title"
                className="activity-action-dialog"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
            >
                {success ? (
                    <>
                        <span className="activity-dialog-icon"><CheckCircle2 size={21} /></span>
                        <h2 id="activity-report-title">Meldung gesendet</h2>
                        <p>Die Meldung wurde sicher gespeichert und kann vom zuständigen Team geprüft werden.</p>
                        <div className="activity-dialog-actions">
                            <button type="button" className="is-primary" onClick={onCancel}>Schließen</button>
                        </div>
                    </>
                ) : (
                    <>
                        <span className="activity-dialog-icon is-danger"><Flag size={21} /></span>
                        <h2 id="activity-report-title">Person melden</h2>
                        <p>
                            Du meldest <strong>{target.reportedPersonName}</strong>. Die gemeldete Person erhält keine Benachrichtigung über diese Meldung.
                        </p>
                        <section
                            aria-labelledby="activity-report-context-label"
                            className="rounded-xl bg-[var(--surface-muted)] p-3.5 text-left shadow-[0_0_0_1px_var(--border-subtle)]"
                        >
                            <div className="flex items-center gap-2 text-sm text-[var(--text-strong)]">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-solid)] text-[var(--brand)]">
                                    <UserRound aria-hidden="true" size={16} />
                                </span>
                                <span className="min-w-0">
                                    <small className="block text-xs text-[var(--text-muted)]">Gemeldete Person</small>
                                    <strong className="block truncate">{target.reportedPersonName}</strong>
                                </span>
                            </div>
                            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                                <small id="activity-report-context-label" className="block text-xs font-semibold text-[var(--text-muted)]">
                                    {target.context.label}
                                </small>
                                <blockquote className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-pretty text-sm leading-5 text-[var(--text-strong)]">
                                    {target.context.content}
                                </blockquote>
                                {target.context.createdAt ? (
                                    <time dateTime={target.context.createdAt} className="mt-2 block text-xs tabular-nums text-[var(--text-muted)]">
                                        {formatChatDateLabel(target.context.createdAt)} · {formatMessageTime(target.context.createdAt)} Uhr
                                    </time>
                                ) : null}
                            </div>
                        </section>
                        <label>
                            <span>Grund</span>
                            <select autoFocus className="min-h-11" value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
                                <option value="inappropriate">Unangemessener Inhalt</option>
                                <option value="harassment">Belästigung oder Druck</option>
                                <option value="fraud">Betrugsverdacht</option>
                                <option value="safety">Sicherheitsbedenken</option>
                                <option value="spam">Spam</option>
                                <option value="other">Anderer Grund</option>
                            </select>
                        </label>
                        <label>
                            <span>Beschreibung (optional)</span>
                            <textarea className="min-h-24" value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1500} rows={4} />
                        </label>
                        {error ? <div className="activity-dialog-error" role="alert">{error}</div> : null}
                        <div className="activity-dialog-actions">
                            <button type="button" className="min-h-11" onClick={onCancel} disabled={pending}>Abbrechen</button>
                            <button type="button" className="is-danger min-h-11" onClick={onConfirm} disabled={pending}>
                                {pending ? "Wird gesendet …" : "Vertraulich melden"}
                            </button>
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
}

function MessageLoadingState() {
    return (
        <div className="activity-message-loading" aria-label="Nachrichten werden geladen">
            <span />
            <span />
            <span />
        </div>
    );
}
