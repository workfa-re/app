"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    CalendarDays,
    CalendarClock,
    CheckCircle2,
    Clock3,
    Flag,
    Info,
    MessageCircleWarning,
    RotateCcw,
    Send,
    ShieldCheck,
    Trash2,
    WifiOff,
    X,
    XCircle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import {
    type ActivityMessage,
    type ActivityFailedSend,
    type ActivityRole,
    WRITABLE_ACTIVITY_STATUSES,
    buildActivityTimeline,
    formatChatDateLabel,
    formatClosureReason,
    getActivityStage,
    getProfileInitials,
    resolveReopenApplicationPatch,
} from "@/lib/activity/chat";
import { getAppointmentRequestForMessage, markApplicationMessagesRead } from "@/app/app-home/applications/actions";
import { getAppointmentSystemMessageKind, isPendingAppointmentMessage, type AppointmentRequest } from "@/lib/activity/appointments";
import { cn } from "@/lib/utils";
import { UserProfileModal } from "@/components/profile/UserProfileModal";
import styles from "./ActivityWorkspace.module.css";
import { useActivityDialogFocus } from "./useActivityDialogFocus";
import { ChatDetails, HighlightedChatText } from "./ChatDetails";
import { ChatAppointments } from "./ChatAppointments";
import { useAppointmentRequests } from "./useAppointmentRequests";
import detailsStyles from "./ChatDetails.module.css";
import { ReportDialog } from "./ReportDialog";
import { getReportableContent, type ActivityReportInput } from "@/lib/activity/reporting";

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
    onComplete?: (reason?: string) => Promise<any>;
    onReport?: (input: ActivityReportInput) => Promise<any>;
    onSendMessage: (applicationId: string, message: string) => Promise<any>;
    draftValue?: string;
    failedSends?: readonly ActivityFailedSend[];
    onSendFailure?: (applicationId: string, failure: ActivityFailedSend) => void;
    onRecoverFailedSend?: (applicationId: string, failureId: string) => void;
    onDraftChange?: (applicationId: string, value: string, onlyIfEmpty?: boolean) => void;
    onConversationRead?: () => void;
    onClose?: () => void;
    embedded?: boolean;
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
    onComplete,
    onReport,
    onSendMessage,
    draftValue,
    failedSends,
    onSendFailure,
    onRecoverFailedSend,
    onDraftChange,
    onConversationRead,
    onClose,
    embedded = false,
    premiumComposer: _premiumComposer = false,
    readOnly = false,
}: ApplicationChatProps) {
    void _premiumComposer;

    const [localDraft, setLocalDraft] = useState("");
    const draft = draftValue ?? localDraft;
    const setDraft = useCallback((value: string, onlyIfEmpty = false) => {
        setLocalDraft(current => onlyIfEmpty && current ? current : value);
        onDraftChange?.(application.id, value, onlyIfEmpty);
    }, [application.id, onDraftChange]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(knownCurrentUserId ?? null);
    const [messages, setMessages] = useState<ActivityMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [messageReloadKey, setMessageReloadKey] = useState(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [compactDetails, setCompactDetails] = useState(true);
    const [searchOpen, setSearchOpen] = useState(false);
    const [appointmentFocusKey, setAppointmentFocusKey] = useState(0);
    const [focusedAppointmentRequest, setFocusedAppointmentRequest] = useState<AppointmentRequest | null | undefined>();
    const [appointmentTargetLoading, setAppointmentTargetLoading] = useState(false);
    const [appointmentTargetError, setAppointmentTargetError] = useState<string | null>(null);
    const [appointmentMessageId, setAppointmentMessageId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [messageHighlight, setMessageHighlight] = useState<{ id: string; query: string } | null>(null);
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
    const [completeOpen, setCompleteOpen] = useState(false);
    const [completeReason, setCompleteReason] = useState("");
    const [completePending, setCompletePending] = useState(false);
    const [completeError, setCompleteError] = useState<string | null>(null);
    const [reportOpen, setReportOpen] = useState(false);
    const [showNewMessages, setShowNewMessages] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [hasOlderMessages, setHasOlderMessages] = useState(false);
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
    const [authorizedJobLocation, setAuthorizedJobLocation] = useState<AuthorizedJobLocation | null>(null);

    const detailsDialogRef = useActivityDialogFocus<HTMLElement>(detailsOpen, compactDetails);
    const detailsTriggerRef = useRef<HTMLButtonElement>(null);
    const reportTriggerRef = useRef<HTMLButtonElement>(null);
    const returnToReportRef = useRef(false);
    const olderLoadingRef = useRef(false);
    const messagesViewportRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
    const typingChannelRef = useRef<ReturnType<typeof supabaseBrowser.channel> | null>(null);
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingSentRef = useRef(false);
    const lastTypingSentAtRef = useRef(0);
    const nearBottomRef = useRef(true);
    const initialScrollDoneRef = useRef(false);
    const requestGenerationRef = useRef(0);
    const appointmentTargetGenerationRef = useRef(0);

    useEffect(() => {
        const media = window.matchMedia("(min-width: 1280px)");
        const update = () => setCompactDetails(!media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (!reportOpen && (!detailsOpen || !compactDetails)) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = previous; };
    }, [compactDetails, detailsOpen, reportOpen]);

    useEffect(() => {
        if (!detailsOpen) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (
                event.key !== "Escape"
                || event.defaultPrevented
                || profileOpen
                || actionOpen
                || scheduleOpen
                || reopenDialogOpen
                || declineRequest
                || completeOpen
                || reportOpen
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
        declineRequest,
        reopenDialogOpen,
        reportOpen,
        scheduleOpen,
    ]);

    useEffect(() => {
        const jobId = liveApplication?.job?.id ?? liveApplication?.job_id;
        if (!detailsOpen || !jobId || readOnly) return;

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
    }, [detailsOpen, liveApplication?.job?.id, liveApplication?.job_id, liveApplication?.status, readOnly]);

    useEffect(() => {
        setLiveApplication((current: any) => ({
            ...current,
            ...application,
            agreement: application?.agreement !== undefined ? application.agreement : current?.agreement ?? null,
            scheduled_for: application?.scheduled_for !== undefined ? application.scheduled_for : current?.scheduled_for ?? null,
            agreed_at: application?.agreed_at !== undefined ? application.agreed_at : current?.agreed_at ?? null,
        }));
        setReopenRequests(application?.reopen_requests ?? []);
        setScheduleValue(toDateTimeLocalValue(application?.scheduled_for));
        setScheduleNote(application?.agreement?.note ?? "");
    }, [application]);

    useEffect(() => {
        setLocalDraft("");
        setSendError(null);
        setDetailsOpen(false);
        setProfileOpen(false);
        setSearchOpen(false);
        setAppointmentFocusKey(0);
        setFocusedAppointmentRequest(undefined);
        setAppointmentTargetLoading(false);
        setAppointmentTargetError(null);
        setAppointmentMessageId(null);
        appointmentTargetGenerationRef.current++;
        setSearchQuery("");
        setMessageHighlight(null);
        messageElementsRef.current.clear();
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
        setCompleteOpen(false);
        setCompleteReason("");
        setCompleteError(null);
        setReportOpen(false);
        returnToReportRef.current = false;
        olderLoadingRef.current = false;
        setPartnerTyping(false);
        setAuthorizedJobLocation(null);
        return () => { appointmentTargetGenerationRef.current++; };
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

    useEffect(() => {
        if (compactDetails || !nearBottomRef.current) return;
        const frame = requestAnimationFrame(() => scrollToEnd("auto"));
        return () => cancelAnimationFrame(frame);
    }, [compactDetails, detailsOpen, scrollToEnd]);

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
        olderLoadingRef.current = false;
        setLoadingOlderMessages(false);

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
                .select("id, application_id, sender_id, content, created_at, read_at, kind, deleted_at")
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

        void loadMessages().catch(() => {
            if (active && generation === requestGenerationRef.current) {
                setLoadError("Der Verlauf konnte nicht geladen werden.");
                setLoadingMessages(false);
            }
        });

        return () => {
            active = false;
            requestGenerationRef.current++;
            void supabaseBrowser.removeChannel(channel);
        };
    }, [currentUserId, liveApplication.id, markRead, messageReloadKey, readOnly, scrollToEnd]);

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
    const reportPersonId = currentUserRole === "provider" ? liveApplication?.user_id ?? headerProfile?.id : liveApplication?.job?.posted_by ?? headerProfile?.id;
    const canReport = !readOnly && Boolean(onReport) && typeof reportPersonId === "string" && Boolean(reportPersonId.trim()) && reportPersonId !== currentUserId;
    const reportItems = useMemo(() => reportPersonId ? getReportableContent(messages, reopenRequests, reportPersonId) : [], [messages, reopenRequests, reportPersonId]);
    const status = liveApplication?.status;
    const historicalRequest = status === "waitlisted" || liveApplication?.close_action === "waitlist_retired";
    const conversationState = historicalRequest ? "closed" : liveApplication?.conversation_state ?? "open";
    const stage = getActivityStage({ ...liveApplication, conversation_state: conversationState }, currentUserRole);
    const isPrimary = Boolean(liveApplication?.is_primary);
    const isWritable = !readOnly
        && conversationState === "open"
        && isPrimary
        && WRITABLE_ACTIVITY_STATUSES.has(status);
    const canCloseApplication = !readOnly
        && conversationState === "open"
        && isPrimary
        && ["submitted", "negotiating", "accepted"].includes(status)
        && (currentUserRole === "seeker" ? Boolean(onWithdraw) : Boolean(onReject));
    const canSchedule = currentUserRole === "provider"
        && !readOnly
        && Boolean(onSchedule)
        && conversationState === "open"
        && isPrimary
        && ["submitted", "negotiating", "accepted"].includes(status);
    const canComplete = currentUserRole === "provider"
        && !readOnly
        && Boolean(onComplete)
        && conversationState === "open"
        && isPrimary
        && status === "accepted"
        && liveApplication?.engagement?.status === "active";
    const headerAction = canComplete ? "complete" : canSchedule && status !== "accepted" ? "schedule" : null;
    const canManageAppointments = !readOnly && Boolean(currentUserId) && status === "accepted"
        && conversationState === "open" && isPrimary && liveApplication?.engagement?.status === "active";
    const appointmentRequests = useAppointmentRequests(liveApplication.id, canManageAppointments);
    const pendingAppointmentRequest = canManageAppointments ? appointmentRequests.requests[0] : undefined;
    const canDirectReopen = !readOnly
        && !historicalRequest
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
        && !historicalRequest
        && conversationState === "closed"
        && manualClosure
        && Boolean(liveApplication?.closed_by)
        && liveApplication?.closed_by !== currentUserId
        && !currentClosureRequest
        && Boolean(onRequestReopen);
    const appointments = (liveApplication?.appointments ?? liveApplication?.engagement?.appointments ?? []) as any[];
    const scheduleLabel = formatSchedule(liveApplication?.scheduled_for || liveApplication?.agreement?.starts_at);
    const ended = stage.key === "closed" || stage.key === "completed";
    const stateTitle = stage.key === "agreed" && scheduleLabel
        ? liveApplication?.job?.job_kind === "recurring" ? "Zusammenarbeit aktiv" : "Termin vereinbart"
        : stage.label;
    const closureReason = liveApplication.closed_reason?.trim();
    const hasClosureReason = closureReason && closureReason.length >= 3 && !/^\d+$/.test(closureReason);
    const stateNote = ended
        ? historicalRequest ? stage.hint : hasClosureReason ? formatClosureReason(closureReason) : null
        : stage.key === "reserved" ? "Termin abstimmen" : null;
    const StateIcon = ended
        ? stage.key === "completed" ? CheckCircle2 : MessageCircleWarning
        : stage.key === "agreed" ? CalendarDays : stage.key === "reserved" ? Clock3 : Info;
    const closeDetailsForTool = () => {
        if (compactDetails) setDetailsOpen(false);
    };

    const openScheduleDialog = () => {
        closeDetailsForTool();
        setScheduleError(null);
        const addingRecurringAppointment = liveApplication?.job?.job_kind === "recurring" && status === "accepted";
        setScheduleValue(addingRecurringAppointment ? "" : toDateTimeLocalValue(liveApplication?.scheduled_for));
        setScheduleNote(addingRecurringAppointment ? "" : liveApplication?.agreement?.note ?? "");
        setScheduleOpen(true);
    };

    const openCompleteDialog = () => {
        closeDetailsForTool();
        setCompleteReason("");
        setCompleteError(null);
        setCompleteOpen(true);
    };

    const openAppointmentRequests = () => {
        appointmentTargetGenerationRef.current++;
        setFocusedAppointmentRequest(undefined);
        setAppointmentTargetLoading(false);
        setAppointmentTargetError(null);
        setAppointmentMessageId(null);
        setAppointmentFocusKey(key => key + 1);
        setSearchOpen(false);
        setDetailsOpen(true);
    };

    const openAppointmentMessage = async (messageId: string) => {
        const generation = ++appointmentTargetGenerationRef.current;
        setFocusedAppointmentRequest(null);
        setAppointmentTargetLoading(true);
        setAppointmentTargetError(null);
        setAppointmentMessageId(messageId);
        setAppointmentFocusKey(key => key + 1);
        setSearchOpen(false);
        setDetailsOpen(true);
        try {
            const result = await getAppointmentRequestForMessage(liveApplication.id, messageId);
            if (generation !== appointmentTargetGenerationRef.current) return;
            if (!result.available) {
                setAppointmentTargetError("Die Terminanfrage konnte nicht geladen werden. Bitte versuche es erneut.");
                return;
            }
            setFocusedAppointmentRequest(result.request);
        } catch {
            if (generation === appointmentTargetGenerationRef.current) setAppointmentTargetError("Die Terminanfrage konnte nicht geladen werden. Bitte versuche es erneut.");
        } finally {
            if (generation === appointmentTargetGenerationRef.current) setAppointmentTargetLoading(false);
        }
    };

    useEffect(() => {
        if (!detailsOpen || appointmentFocusKey === 0 || !appointmentMessageId || focusedAppointmentRequest?.status !== "pending") return;
        if (canManageAppointments && (appointmentRequests.available !== true
            || appointmentRequests.requests.some(request => request.id === focusedAppointmentRequest.id))) return;
        let active = true;
        const generation = ++appointmentTargetGenerationRef.current;
        void getAppointmentRequestForMessage(liveApplication.id, appointmentMessageId).then(result => {
            if (!active || generation !== appointmentTargetGenerationRef.current) return;
            if (result.available) {
                setFocusedAppointmentRequest(result.request);
                setAppointmentTargetError(null);
            } else setAppointmentTargetError("Die Terminanfrage konnte nicht aktualisiert werden. Bitte lade sie erneut.");
        }).catch(() => {
            if (active && generation === appointmentTargetGenerationRef.current) setAppointmentTargetError("Die Terminanfrage konnte nicht aktualisiert werden. Bitte lade sie erneut.");
        });
        return () => { active = false; };
    }, [appointmentRequests.available, appointmentRequests.requests, appointmentMessageId, appointmentFocusKey, canManageAppointments, detailsOpen, focusedAppointmentRequest?.id, focusedAppointmentRequest?.status, liveApplication.id]);

    const jumpToMessage = (id: string, query: string) => {
        setMessageHighlight({ id, query: query.trim() });
        closeDetailsForTool();
        requestAnimationFrame(() => {
            const element = messageElementsRef.current.get(id);
            const viewport = messagesViewportRef.current;
            if (!element || !viewport) return;
            const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
            const destination = Math.max(0, top - viewport.clientHeight / 3);
            const longJump = Math.abs(viewport.scrollTop - destination) > viewport.clientHeight * 2;
            viewport.scrollTo({ top: destination, behavior: longJump || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            nearBottomRef.current = false;
            element.focus({ preventScroll: true });
        });
    };

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
    }, [broadcastTyping, setDraft, stopTyping]);

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
        if (content.length > 1200) {
            setSendError("Kürze den Entwurf auf höchstens 1.200 Zeichen.");
            return;
        }

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
            const errorMessage = error instanceof Error ? error.message : "Nachricht konnte nicht gesendet werden.";
            if (onSendFailure) {
                onSendFailure(liveApplication.id, { id: tempId, content, error: errorMessage });
            } else {
                setDraft(content, true);
                setSendError(errorMessage);
            }
        } finally {
            setSending(false);
        }
    };

    const loadOlderMessages = async () => {
        const oldestMessage = messages[0];
        if (!oldestMessage?.created_at || olderLoadingRef.current) return;
        olderLoadingRef.current = true;
        setLoadingOlderMessages(true);
        setLoadError(null);
        const generation = requestGenerationRef.current;
        const viewport = messagesViewportRef.current;
        const previousHeight = viewport?.scrollHeight ?? 0;
        const previousTop = viewport?.scrollTop ?? 0;
        try {
            const { data, error } = await supabaseBrowser
                .from("messages")
                .select("id, application_id, sender_id, content, created_at, read_at, kind, deleted_at")
                .eq("application_id", liveApplication.id)
                .or(`created_at.lt.${oldestMessage.created_at},and(created_at.eq.${oldestMessage.created_at},id.lt.${oldestMessage.id})`)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(120);
            if (generation !== requestGenerationRef.current) return;
            if (error) throw error;
            const older = [...(data ?? [])].reverse() as unknown as ActivityMessage[];
            setMessages(current => mergeMessages(older, current));
            setHasOlderMessages((data?.length ?? 0) === 120);
            requestAnimationFrame(() => {
                if (generation === requestGenerationRef.current && viewport) viewport.scrollTop = previousTop + viewport.scrollHeight - previousHeight;
            });
        } catch {
            if (generation === requestGenerationRef.current) setLoadError("Ältere Nachrichten konnten nicht geladen werden. Bitte versuche es erneut.");
        } finally {
            if (generation === requestGenerationRef.current) {
                olderLoadingRef.current = false;
                setLoadingOlderMessages(false);
            }
        }
    };

    const handleDestructiveAction = async () => {
        setActionPending(true);
        setActionError(null);
        try {
            if (currentUserRole === "seeker" && onWithdraw) await onWithdraw(actionReason.trim());
            if (currentUserRole === "provider" && onReject) await onReject(actionReason.trim());
            setLiveApplication((current: any) => ({
                ...current,
                status: status === "accepted" ? "cancelled" : currentUserRole === "seeker" ? "withdrawn" : "rejected",
                conversation_state: "closed",
                closed_by: currentUserId,
                closed_at: new Date().toISOString(),
                closed_reason: actionReason.trim() || (status === "accepted" ? "Zusammenarbeit abgesagt." : currentUserRole === "provider" ? "Vom Anbieter abgelehnt." : "Bewerbung zurückgezogen."),
                close_action: status === "accepted" ? "engagement_cancelled" : currentUserRole === "seeker" ? "seeker_withdrew" : "provider_rejected",
                engagement: status === "accepted" && current.engagement ? { ...current.engagement, status: "cancelled" } : current.engagement,
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
        if (readOnly) return;
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


    if (!application) return null;

    return (
        <MotionConfig reducedMotion="user">
        <div className={cn(styles.chat, detailsStyles.workspace, "application-chat activity-modern-chat", embedded ? "" : "activity-modern-chat-modal")} data-ui="conversation" data-chat-tools data-details-open={detailsOpen}
            onKeyDown={event => {
                if (!profileOpen && !reportOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                    event.preventDefault();
                    setAppointmentFocusKey(0);
                    setSearchOpen(true);
                    setDetailsOpen(true);
                }
            }}>

            <div className={detailsStyles.conversation} inert={compactDetails && detailsOpen}>
            <header className="activity-chat-header" data-has-primary-action={Boolean(headerAction || pendingAppointmentRequest)} data-compact-actions={Boolean(headerAction && pendingAppointmentRequest)}>
                {onClose ? (
                    <button type="button" onClick={onClose} className="activity-chat-back" aria-label={embedded ? "Zur Nachrichtenübersicht" : "Chat schließen"}>
                        {embedded ? <ArrowLeft size={20} /> : <X size={20} />}
                    </button>
                ) : null}

                <div className="activity-chat-person">
                    <span className="activity-chat-avatar" aria-hidden="true">
                        {headerProfile?.avatar_url ? <img src={headerProfile.avatar_url} alt="" /> : getProfileInitials(headerName)}
                    </span>
                    <span>
                        <strong>{jobTitle}</strong>
                        <small>{headerName}</small>
                    </span>
                </div>

                {!readOnly && realtimeState === "delayed" ? (
                    <span
                        className="activity-realtime-state"
                        data-state="delayed"
                        aria-label="Live-Verbindung verzögert"
                        title="Live-Verbindung verzögert"
                    >
                        <WifiOff size={13} aria-hidden="true" />
                        <span>Verzögert</span>
                    </span>
                ) : null}

                <div className="activity-chat-actions">
                    {headerAction ? (
                        <button
                            type="button"
                            className="activity-schedule-button"
                            aria-label={headerAction === "complete" ? "Zusammenarbeit abschließen" : "Termin vereinbaren"}
                            title={headerAction === "complete" ? "Zusammenarbeit abschließen" : "Termin vereinbaren"}
                            disabled={schedulePending || completePending}
                            onClick={headerAction === "complete" ? openCompleteDialog : openScheduleDialog}
                        >
                            {headerAction === "complete" ? <CheckCircle2 size={17} aria-hidden="true" /> : <CalendarDays size={17} aria-hidden="true" />}
                            <span>{headerAction === "complete" ? "Abschließen" : "Termin vereinbaren"}</span>
                        </button>
                    ) : null}
                    {pendingAppointmentRequest ? <button type="button" className="activity-appointment-shortcut"
                        aria-label={currentUserRole === "provider" ? "Offene Terminanfrage prüfen" : "Deinen Terminvorschlag ansehen"}
                        title={currentUserRole === "provider" ? "Offene Terminanfrage prüfen" : "Deinen Terminvorschlag ansehen"}
                        aria-haspopup="dialog" aria-expanded={detailsOpen && appointmentFocusKey > 0} onClick={openAppointmentRequests}>
                        <CalendarClock size={17} aria-hidden="true" /><span>{currentUserRole === "provider" ? "Anfrage prüfen" : "Dein Vorschlag"}</span>
                    </button> : null}
                    <button ref={detailsTriggerRef} type="button" className="activity-details-button" onClick={() => { appointmentTargetGenerationRef.current++; setAppointmentFocusKey(0); setSearchOpen(false); setDetailsOpen(true); }} aria-expanded={detailsOpen} aria-label="Jobdetails und Aktionen öffnen" title="Jobdetails und Aktionen">
                        <Info size={18} aria-hidden="true" /><span>Details</span>
                    </button>
                </div>
            </header>

            <section className="activity-chat-statebar" aria-label="Auftragsstatus" data-tone={ended ? "closed" : stage.key === "agreed" ? "success" : stage.key === "reserved" ? "brand" : "muted"}>
                <StateIcon className="activity-chat-state-icon" size={17} aria-hidden="true" />
                <div className="activity-chat-state-copy" role="status">
                    <strong>{stateTitle}</strong>
                    {!ended && stage.key === "agreed" && scheduleLabel ? (
                        <time dateTime={liveApplication.scheduled_for || liveApplication.agreement?.starts_at}>{scheduleLabel}</time>
                    ) : stateNote ? <span>{stateNote}</span> : null}
                </div>
                {canCloseApplication && stage.key === "reserved" ? (
                    <button type="button" className="activity-chat-state-action" aria-label={currentUserRole === "provider" ? "Bewerbung ablehnen und Job freigeben" : "Bewerbung zurückziehen"} onClick={() => { setActionReason(""); setActionError(null); setActionOpen(true); }}>{currentUserRole === "provider" ? "Job freigeben" : "Zurückziehen"}</button>
                ) : null}
            </section>

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
                            const appointmentMessageKind = getAppointmentSystemMessageKind(timelineMessage);
                            const actionableAppointment = !readOnly && appointmentRequests.available === true
                                && isPendingAppointmentMessage(timelineMessage, appointmentRequests.requests);

                            return (
                                <div key={timelineEntry.key} className={cn("activity-message-entry", detailsStyles.messageTarget)}
                                    ref={element => { if (element) messageElementsRef.current.set(timelineMessage.id, element); else messageElementsRef.current.delete(timelineMessage.id); }}
                                    tabIndex={-1} data-message-id={timelineMessage.id} data-search-selected={messageHighlight?.id === timelineMessage.id}>
                                    {dateSeparator}
                                    {timelineMessage.isSystemMessage ? (
                                        actionableAppointment ? <button type="button" className="activity-system-message activity-system-message-link"
                                            onClick={() => void openAppointmentMessage(timelineMessage.id)} aria-haspopup="dialog"
                                            aria-label={`${timelineMessage.content} Terminanfrage in Details ansehen`}>
                                            <CalendarClock size={16} aria-hidden="true" />
                                            <span><HighlightedChatText text={timelineMessage.content} query={messageHighlight?.id === timelineMessage.id ? messageHighlight.query : ""} /></span>
                                            <time dateTime={timelineMessage.created_at || undefined}>{formatMessageTime(timelineMessage.created_at)}</time>
                                            <ArrowRight size={15} aria-hidden="true" />
                                        </button> : <div className="activity-system-message activity-system-message-notice">
                                            {appointmentMessageKind ? <CalendarDays size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                                            <span><HighlightedChatText text={timelineMessage.content} query={messageHighlight?.id === timelineMessage.id ? messageHighlight.query : ""} /></span>
                                            <time dateTime={timelineMessage.created_at || undefined}>{formatMessageTime(timelineMessage.created_at)}</time>
                                        </div>
                                    ) : (
                                        <div className={cn("activity-message-row", isOwnMessage ? "is-own" : "is-other")}>
                                            <div className="activity-message-wrap">
                                                <div className="activity-message-bubble">
                                                    <HighlightedChatText text={timelineMessage.content} query={messageHighlight?.id === timelineMessage.id ? messageHighlight.query : ""} />
                                                </div>
                                                <div className="activity-message-meta">
                                                    {timelineMessage.isApplicationMessage ? <span>Bewerbung</span> : null}
                                                    <time dateTime={timelineMessage.created_at || undefined}>{formatMessageTime(timelineMessage.created_at)}</time>
                                                    {timelineMessage.is_temp ? <span>Wird gesendet</span> : null}
                                                    {!timelineMessage.is_temp && isOwnMessage && timelineMessage.read_at ? <span>Gelesen</span> : null}

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
                                        {!readOnly && !historicalRequest && request.status === "pending" && isRecipient && onRespondReopenRequest ? (
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

            {Boolean(failedSends?.length) && (
                <aside className="activity-send-failures" aria-label="Nicht gesendete Nachrichten">
                    {failedSends?.map(failure => {
                        const alreadyRestored = draft === failure.content;
                        return <div className="activity-send-failure" key={failure.id} role="status">
                            <strong>Nachricht nicht gesendet</strong>
                            <p>{failure.error}</p>
                            {alreadyRestored
                                ? <p>Der Text steht wieder in deinem Entwurf.</p>
                                : <blockquote>{failure.content}</blockquote>}
                            {isWritable && onRecoverFailedSend && <button type="button" onClick={() => {
                                onRecoverFailedSend(liveApplication.id, failure.id);
                                requestAnimationFrame(() => composerRef.current?.focus());
                            }}>
                                {alreadyRestored ? "Hinweis schließen" : draft ? "Zum Entwurf hinzufügen" : "In Entwurf übernehmen"}
                            </button>}
                        </div>;
                    })}
                </aside>
            )}

            {isWritable ? (
                <footer className="application-chat-inputbar activity-chat-composer">
                    {sendError ? <div className="activity-composer-error" role="alert">{sendError}</div> : null}
                    <div className="activity-composer-box">
                        <textarea
                            ref={composerRef}
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
                            disabled={!draft.trim() || draft.trim().length > 1200 || sending}
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
                </footer>
            ) : (
                <footer className="application-chat-inputbar activity-chat-composer activity-locked-composer">
                    <div>
                        <span className="activity-locked-icon">
                            <MessageCircleWarning size={18} />
                        </span>
                        <div>
                            <strong>
                                {readOnly
                                    ? "Vorschau ohne Aktionen"
                                    : historicalRequest
                                        ? "Beendete Anfrage"
                                        : stage.label}
                            </strong>
                            <span>
                                {readOnly
                                    ? "Nachrichten und Details werden hier nur angezeigt."
                                    : historicalRequest
                                    ? stage.hint
                                    : currentClosureRequest?.status === "pending"
                                        ? "Deine einmalige Öffnungsanfrage wurde gesendet."
                                        : status === "completed"
                                            ? "Der Job ist abgeschlossen. Du kannst den Verlauf weiterlesen."
                                        : liveApplication?.close_action === "job_assigned"
                                            ? "Der Job wurde verbindlich anderweitig vergeben."
                                            : "Der Chat ist geschlossen. Dein Verlauf bleibt erhalten."}
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

                    </div>
                    {reopenError ? <div className="activity-composer-error" role="alert">{reopenError}</div> : null}
                </footer>
            )}

            </div>
            <AnimatePresence initial={false} onExitComplete={() => {
                if (detailsOpen || profileOpen || actionOpen || scheduleOpen || reopenDialogOpen || declineRequest || completeOpen || reportOpen) return;
                requestAnimationFrame(() => {
                    const active = document.activeElement;
                    if (active === document.body || (active && detailsDialogRef.current?.contains(active))) {
                        detailsTriggerRef.current?.focus({ preventScroll: true });
                    }
                });
            }}>
                {detailsOpen && <>
                    <motion.button type="button" className={detailsStyles.backdrop} aria-label="Details schließen" tabIndex={-1}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDetailsOpen(false)} />
                    <ChatDetails dialogRef={detailsDialogRef} compact={compactDetails} onClose={() => setDetailsOpen(false)}
                        appointmentFocusKey={appointmentFocusKey} appointmentFocusReady={!appointmentTargetLoading}
                        name={headerName} profile={headerProfile ?? null} partnerRole={currentUserRole === "seeker" ? "Auftraggeber" : "Bewerber"}
                        onOpenProfile={() => setProfileOpen(true)}
                        job={liveApplication.job ?? {}} jobTitle={jobTitle}
                        jobKind={liveApplication.job?.job_kind === "recurring" ? formatRecurrence(liveApplication.job?.recurrence_rule) : "Einmalig"}
                        statusLabel={stage.label} stage={stage}
                        closureReason={conversationState === "closed" && liveApplication.closed_reason ? formatClosureReason(liveApplication.closed_reason) : null}
                        authorizedAddress={authorizedJobLocation?.address_full}
                        appointments={appointments} scheduledFor={liveApplication.scheduled_for || liveApplication.agreement?.starts_at} scheduleNote={liveApplication.agreement?.note}
                        appointmentActions={!readOnly && currentUserId && (canManageAppointments || appointmentFocusKey > 0) ? <ChatAppointments
                            key={liveApplication.id} applicationId={liveApplication.id} currentUserId={currentUserId}
                            isProvider={currentUserRole === "provider"} recurring={liveApplication.job?.job_kind === "recurring"}
                            appointments={appointments} formatSchedule={formatSchedule} onLegacySchedule={canSchedule ? openScheduleDialog : undefined}
                            requests={appointmentRequests.requests} available={appointmentRequests.available} onReload={appointmentRequests.refresh}
                            canManage={canManageAppointments}
                            focusedRequest={appointmentFocusKey > 0 ? focusedAppointmentRequest : undefined}
                            focusedLoading={appointmentFocusKey > 0 && appointmentTargetLoading} focusedError={appointmentFocusKey > 0 ? appointmentTargetError : null}
                            onReloadFocused={appointmentMessageId ? () => void openAppointmentMessage(appointmentMessageId) : undefined}
                            onRequestChanged={request => setFocusedAppointmentRequest(current => current?.id === request.id ? request : current)}
                            onChanged={appointment => {
                                if (!appointment || typeof appointment.id !== "string") return;
                                setLiveApplication((current: any) => {
                                    const updated = [appointment, ...(current.appointments ?? current.engagement?.appointments ?? []).filter((item: any) => item.id !== appointment.id)];
                                    const scheduled = updated.filter((item: any) => item.status === "scheduled").sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
                                    const next = scheduled.find((item: any) => new Date(item.starts_at).getTime() >= Date.now() - 60_000) ?? scheduled.at(-1);
                                    return { ...current, appointments: updated, scheduled_for: next?.starts_at ?? null, agreement: next ? { ...current.agreement, starts_at: next.starts_at, note: next.note } : null };
                                });
                            }} /> : null}
                        formatSchedule={formatSchedule} searchOpen={searchOpen} onSearchOpen={open => { if (open) setAppointmentFocusKey(0); setSearchOpen(open); }} query={searchQuery} onQuery={setSearchQuery}
                        messages={messages} loading={loadingMessages} hasOlder={hasOlderMessages} loadingOlder={loadingOlderMessages} loadError={loadError}
                        onLoadOlder={() => void loadOlderMessages()} onJump={jumpToMessage}
                        actions={canSchedule || canComplete || canDirectReopen || canRequestReopen || canReport ? <>
                            {canSchedule && status !== "accepted" && <button type="button" onClick={openScheduleDialog}><CalendarDays aria-hidden="true" />Termin vereinbaren</button>}
                            {canComplete && <button type="button" onClick={openCompleteDialog}><CheckCircle2 aria-hidden="true" />Zusammenarbeit abschließen</button>}
                            {canDirectReopen && <button type="button" onClick={() => void handleDirectReopen()} disabled={directReopenPending}><RotateCcw aria-hidden="true" />Gespräch wieder öffnen</button>}
                            {canRequestReopen && <button type="button" onClick={() => { closeDetailsForTool(); setReopenError(null); setReopenMessage(""); setReopenDialogOpen(true); }}><RotateCcw aria-hidden="true" />Öffnung anfragen</button>}
                            {canReport && <button ref={reportTriggerRef} type="button" onClick={() => {
                                closeDetailsForTool();
                                setReportOpen(true);
                            }}><Flag aria-hidden="true" />Person melden</button>}
                        </> : null}
                        dangerAction={canCloseApplication ? <button type="button" onClick={() => { closeDetailsForTool(); setActionReason(""); setActionError(null); setActionOpen(true); }}>
                            {currentUserRole === "seeker" ? <Trash2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
                            {currentUserRole === "seeker" ? status === "accepted" ? "Zusammenarbeit absagen" : "Bewerbung zurückziehen" : status === "accepted" ? "Zusammenarbeit absagen" : "Ablehnen & Job freigeben"}
                        </button> : null} />
                </>}
            </AnimatePresence>

            <AnimatePresence initial={false} onExitComplete={() => {
                if (!returnToReportRef.current || reportOpen) return;
                returnToReportRef.current = false;
                requestAnimationFrame(() => {
                    reportTriggerRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
                    reportTriggerRef.current?.focus({ preventScroll: true });
                });
            }}>
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
                {reportOpen && canReport && onReport ? <ReportDialog key={liveApplication.id}
                    applicationId={liveApplication.id} personId={reportPersonId} personName={headerName} jobTitle={jobTitle}
                    items={reportItems} loading={loadingMessages} hasOlder={hasOlderMessages} loadingOlder={loadingOlderMessages} loadError={loadError}
                    onLoadOlder={() => void loadOlderMessages()} onReload={() => setMessageReloadKey(key => key + 1)}
                    onSubmit={onReport} onClose={() => { returnToReportRef.current = true; setReportOpen(false); setSearchOpen(false); setDetailsOpen(true); }} /> : null}
            </AnimatePresence>
        </div>
        <UserProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} profile={headerProfile ?? null} />
        </MotionConfig>
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
    const title = isAccepted ? "Zusammenarbeit absagen?" : isProvider ? "Bewerbung ablehnen und Job freigeben?" : "Bewerbung zurückziehen?";
    const description = isAccepted
        ? "Der vereinbarte Auftrag und alle geplanten Termine werden abgesagt. Das Gespräch wird geschlossen und der Job wieder freigegeben."
        : "Das Gespräch wird geschlossen. Der Job ist danach wieder für eine neue Bewerbung offen.";
    const dialogRef = useActivityDialogFocus<HTMLDivElement>();
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && !pending && onCancel()}>
            <motion.div
                ref={dialogRef}
                tabIndex={-1}
                aria-busy={pending}
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
                    <span>Grund (optional)</span>
                    <textarea disabled={pending} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} />
                </label>
                {error ? <div className="activity-dialog-error" role="alert">{error}</div> : null}
                <div className="activity-dialog-actions">
                    <button type="button" onClick={onCancel} disabled={pending}>Abbrechen</button>
                    <button type="button" className="is-danger" onClick={onConfirm} disabled={pending}>
                        {pending ? "Wird verarbeitet …" : isAccepted ? "Zusammenarbeit absagen" : isProvider ? "Ablehnen & freigeben" : "Bewerbung zurückziehen"}
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
    const dialogRef = useActivityDialogFocus<HTMLDivElement>();
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && !pending && onCancel()}>
            <motion.div
                ref={dialogRef}
                tabIndex={-1}
                aria-busy={pending}
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
                    <input disabled={pending} type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
                </label>
                <label>
                    <span>Notiz (optional)</span>
                    <input disabled={pending} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="z. B. Treffpunkt oder kurze Absprache" />
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
    const dialogRef = useActivityDialogFocus<HTMLDivElement>();
    return (
        <div className="activity-dialog-layer" onKeyDown={(event) => event.key === "Escape" && !pending && onCancel()}>
            <motion.div
                ref={dialogRef}
                tabIndex={-1}
                aria-busy={pending}
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
                        disabled={pending}
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

function MessageLoadingState() {
    return (
        <div className="activity-message-loading" aria-label="Nachrichten werden geladen">
            <span />
            <span />
            <span />
        </div>
    );
}
