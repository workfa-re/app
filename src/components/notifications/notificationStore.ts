import type {
    NotificationCursor, NotificationFeedSnapshot, NotificationItem, NotificationPage, NotificationSeed,
} from "./notificationTypes";

export const NOTIFICATION_PAGE_SIZE = 25;
const REFRESH_ERROR = "Benachrichtigungen konnten gerade nicht geladen werden.";
const READ_ERROR = "Der Lesestatus konnte nicht gespeichert werden.";
const LIVE_ERROR = "Live-Updates sind unterbrochen. Deine Benachrichtigungen bleiben gespeichert.";
const LIVE_EVENT_MAX_AGE_MS = 30_000;

export type NotificationFeedEvent =
    | { type: "INSERT" | "UPDATE"; notification: NotificationItem }
    | { type: "status"; connected: boolean };

export type NotificationFeedAdapter = {
    loadPage: (cursor: NotificationCursor | null, unreadOnly: boolean, limit?: number) => Promise<NotificationPage>;
    markRead: (id: string) => Promise<string | null>;
    markReadThrough: (snapshotAt: string) => Promise<string | null>;
    markSeen: (ids: string[]) => Promise<string | null>;
    connect: (receive: (event: NotificationFeedEvent) => void, reconcile: () => void) => () => void;
    isVisible: () => boolean;
    now?: () => number;
    monotonicNow?: () => number;
    onIdle?: () => void;
};

function dedupe(rows: readonly NotificationItem[]) {
    return [...new Map(rows.map(row => [row.id, row])).values()];
}

function cursorFor(rows: readonly NotificationItem[]): NotificationCursor | null {
    const last = rows.at(-1);
    return last?.created_at ? { createdAt: last.created_at, id: last.id } : null;
}

function newestFirst(a: NotificationItem, b: NotificationItem) {
    return (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id);
}

/** One recipient owns one serialized feed, counter and live-event stream. */
export function createNotificationFeed(userId: string, adapter: NotificationFeedAdapter, seed: NotificationSeed = {}) {
    const now = adapter.now ?? Date.now;
    const monotonicNow = adapter.monotonicNow ?? (() => typeof performance !== "undefined" ? performance.now() : 0);
    const initialRows = dedupe(seed.initialNotifications ?? []);
    const hasSeed = seed.initialNotifications !== undefined && seed.initialUnreadCount !== undefined;
    const initial: NotificationFeedSnapshot = {
        filter: "all", notifications: initialRows, unreadCount: seed.initialUnreadCount ?? 0,
        hasMore: initialRows.length >= 10, loading: !hasSeed, loadingMore: false,
        markingAllRead: false, error: null, liveNotification: null,
    };
    let state = initial;
    let active = false;
    let connected = false;
    let baselineReady = false;
    let revision = 0;
    let dirty = false;
    let moreRequested = false;
    let inFlight: Promise<void> | null = null;
    let disconnect: (() => void) | null = null;
    let snapshotAt: string | null = null;
    let lastSnapshotUnread = seed.initialUnreadCount ?? 0;
    let liveAfter: number | null = null;
    let serverClock: { timestamp: number; monotonicAt: number } | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const listeners = new Set<() => void>();
    const knownIds = new Set(initialRows.map(row => row.id));
    const pendingReads = new Map<string, Promise<boolean>>();
    const pendingSeen = new Set<string>();
    const afterSnapshotIds = new Set<string>();
    const hiddenIds = new Set<string>();

    function publish(patch: Partial<NotificationFeedSnapshot>) {
        state = { ...state, ...patch };
        listeners.forEach(listener => listener());
    }

    function remember(id: string) {
        knownIds.add(id);
        if (knownIds.size > 1_000) knownIds.delete(knownIds.values().next().value!);
    }

    function currentServerTime() {
        return serverClock ? serverClock.timestamp + Math.max(0, monotonicNow() - serverClock.monotonicAt) : null;
    }

    const drain = async () => {
        try {
            while (active && (dirty || moreRequested)) {
                if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
                const refresh = dirty;
                dirty = false;
                moreRequested = false;
                const filter = state.filter;
                const version = revision;
                const cursor = refresh ? null : cursorFor(state.notifications);
                if (!refresh && (!state.hasMore || !cursor)) break;
                publish(refresh ? { loading: state.notifications.length === 0, loadingMore: false } : { loadingMore: true });
                try {
                    const reconcileCount = refresh ? state.notifications.length : 0;
                    const desired = Math.max(NOTIFICATION_PAGE_SIZE, reconcileCount);
                    let page = await adapter.loadPage(cursor, filter === "unread", Math.min(100, desired));
                    let rows = page.notifications;
                    // Reconcile all currently loaded history too: a deletion or
                    // read in another tab may have happened while disconnected.
                    while (refresh && page.hasMore && rows.length < reconcileCount && active && version === revision && !dirty) {
                        const nextCursor = cursorFor(rows);
                        if (!nextCursor) break;
                        const next = await adapter.loadPage(nextCursor, filter === "unread", Math.min(100, reconcileCount - rows.length));
                        if (!next.notifications.length) { page = next; break; }
                        const merged = dedupe([...rows, ...next.notifications]);
                        if (merged.length === rows.length) throw new Error("Ungültige Seitenauswahl.");
                        rows = merged;
                        page = next;
                    }
                    if (!active) return;
                    if (version !== revision || dirty || filter !== state.filter) {
                        dirty = true;
                        continue;
                    }
                    // A read already shown optimistically must not flash back to
                    // unread while its RPC is still committing. Its completion
                    // requests the authoritative snapshot after the mutation.
                    if (pendingReads.size > 0 || state.markingAllRead) { dirty = true; break; }
                    rows = rows.filter(row => row.user_id === undefined || row.user_id === userId);
                    rows.forEach(row => { remember(row.id); hiddenIds.delete(row.id); });
                    const notifications = dedupe(refresh ? rows : [...state.notifications, ...rows])
                        .filter(row => filter !== "unread" || !row.read_at);
                    snapshotAt = page.snapshotAt;
                    const serverTimestamp = Date.parse(page.snapshotAt);
                    serverClock = { timestamp: serverTimestamp, monotonicAt: monotonicNow() };
                    if (!baselineReady) liveAfter = serverTimestamp;
                    lastSnapshotUnread = page.unreadCount;
                    afterSnapshotIds.clear();
                    baselineReady = true;
                    publish({ notifications, unreadCount: page.unreadCount, hasMore: page.hasMore,
                        loading: false, loadingMore: false, error: connected || state.error !== LIVE_ERROR ? null : LIVE_ERROR });
                } catch {
                    if (active && filter === state.filter) publish({ loading: false, loadingMore: false, error: REFRESH_ERROR });
                }
            }
        } finally {
            inFlight = null;
        }
    };

    function run() {
        if (!active) return Promise.resolve();
        if (!inFlight) inFlight = Promise.resolve().then(drain);
        return inFlight;
    }

    function refresh() {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        dirty = true;
        return run();
    }

    function scheduleRefresh() {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 80);
    }

    function reconcile() {
        baselineReady = false;
        liveAfter = currentServerTime();
        void refresh();
    }

    function receive(event: NotificationFeedEvent) {
        if (!active) return;
        if (event.type === "status") {
            connected = event.connected;
            // Events replayed during reconnection only reconcile history; they do not toast.
            baselineReady = false;
            liveAfter = currentServerTime();
            if (event.connected) void refresh();
            else publish({ error: LIVE_ERROR, liveNotification: null });
            return;
        }
        const row = event.notification;
        if (row.user_id !== userId) return;
        if (row.in_app_visible === false) {
            if (event.type === "INSERT") return;
            hiddenIds.add(row.id);
            const existing = state.notifications.find(item => item.id === row.id);
            revision += 1;
            publish({ notifications: state.notifications.filter(item => item.id !== row.id),
                unreadCount: Math.max(0, state.unreadCount - Number(Boolean(existing && !existing.read_at))),
                liveNotification: state.liveNotification?.id === row.id ? null : state.liveNotification });
            scheduleRefresh();
            return;
        }
        const existing = state.notifications.find(item => item.id === row.id);
        hiddenIds.delete(row.id);
        const known = knownIds.has(row.id);
        remember(row.id);
        revision += 1;
        let notifications = state.notifications;
        let unreadCount = state.unreadCount;
        if (existing) {
            // A delayed seen acknowledgement can still carry read_at=null.
            // Preserve an in-flight read without delaying genuine hidden updates.
            const pendingRead = pendingReads.has(row.id) || (state.markingAllRead && !afterSnapshotIds.has(row.id));
            const next = pendingRead && existing.read_at && !row.read_at
                ? { ...row, read_at: existing.read_at, seen_at: row.seen_at ?? existing.seen_at } : row;
            notifications = notifications.map(item => item.id === row.id ? next : item);
            unreadCount = Math.max(0, unreadCount + Number(!next.read_at) - Number(!existing.read_at));
        } else if (event.type === "INSERT" && !known) {
            afterSnapshotIds.add(row.id);
            notifications = [...notifications, row].sort(newestFirst);
            if (!row.read_at) unreadCount += 1;
        }
        if (state.filter === "unread") notifications = notifications.filter(item => !item.read_at);
        const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
        const serverNow = currentServerTime();
        // The device's wall clock can be wrong or change while the app runs.
        // Use a server snapshot plus elapsed monotonic time for live freshness.
        const liveBoundary = liveAfter !== null && serverNow !== null
            ? Math.max(liveAfter, serverNow - LIVE_EVENT_MAX_AGE_MS) : null;
        const showLive = event.type === "INSERT" && !known && !row.read_at && connected && baselineReady
            && adapter.isVisible() && Number.isFinite(createdAt) && liveBoundary !== null && createdAt >= liveBoundary - 2_000;
        publish({ notifications, unreadCount, ...(showLive ? { liveNotification: row } : {}) });
        scheduleRefresh();
    }

    function start() {
        if (active || !userId) return;
        active = true;
        disconnect = adapter.connect(receive, reconcile);
        void refresh();
    }

    function stop() {
        active = false;
        revision += 1;
        dirty = false;
        moreRequested = false;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        disconnect?.();
        disconnect = null;
        adapter.onIdle?.();
    }

    function markRead(item: NotificationItem | string): Promise<boolean> {
        const id = typeof item === "string" ? item : item.id;
        const pending = pendingReads.get(id);
        if (pending) return pending;
        const notification = state.notifications.find(row => row.id === id) ?? (typeof item === "string" ? null : item);
        if (notification?.user_id && notification.user_id !== userId) return Promise.resolve(false);
        if (!notification || notification.read_at) return Promise.resolve(true);
        const stamp = new Date(now()).toISOString();
        revision += 1;
        publish({ notifications: state.notifications.flatMap(row => row.id !== id ? [row]
            : state.filter === "unread" ? [] : [{ ...row, read_at: stamp, seen_at: row.seen_at ?? stamp }]),
        unreadCount: Math.max(0, state.unreadCount - 1),
        liveNotification: state.liveNotification?.id === id ? null : state.liveNotification });
        const operation = (async () => {
            let error: string | null;
            try { error = await adapter.markRead(id); } catch { error = READ_ERROR; }
            if (!active) return !error;
            revision += 1;
            if (error && !hiddenIds.has(id)) {
                revision += 1;
                const current = state.notifications.find(row => row.id === id);
                if (!current || current.read_at === stamp) {
                    publish({ notifications: dedupe([...state.notifications.filter(row => row.id !== id), notification]).sort(newestFirst),
                        unreadCount: state.unreadCount + 1, error: READ_ERROR });
                }
            }
            pendingReads.delete(id);
            await refresh();
            if (error && active && !hiddenIds.has(id)) publish({ error: READ_ERROR });
            return !error || hiddenIds.has(id);
        })().finally(() => { if (pendingReads.get(id) === operation) pendingReads.delete(id); });
        pendingReads.set(id, operation);
        return operation;
    }

    let markAllOperation: Promise<boolean> | null = null;
    function markAllRead(): Promise<boolean> {
        if (markAllOperation) return markAllOperation;
        if (state.unreadCount === 0) return Promise.resolve(true);
        markAllOperation = (async () => {
            // A server timestamp is mandatory: client clocks must not broaden a read operation.
            if (!snapshotAt) await refresh();
            if (!snapshotAt || !active) return false;
            const cutoff = snapshotAt;
            const prior = state.notifications;
            const priorCount = state.unreadCount;
            const stamp = new Date(now()).toISOString();
            revision += 1;
            publish({ markingAllRead: true, liveNotification: null,
                notifications: state.filter === "unread" ? prior.filter(row => afterSnapshotIds.has(row.id))
                    : prior.map(row => row.read_at || afterSnapshotIds.has(row.id) ? row : { ...row, read_at: stamp, seen_at: row.seen_at ?? stamp }),
                unreadCount: Math.max(0, priorCount - lastSnapshotUnread) });
            let error: string | null;
            try { error = await adapter.markReadThrough(cutoff); } catch { error = READ_ERROR; }
            if (!active) return !error;
            revision += 1;
            if (error) {
                revision += 1;
                const originals = new Map(prior.map(row => [row.id, row]));
                const restored = state.notifications.map(row => row.read_at === stamp ? originals.get(row.id) ?? row : row);
                const hiddenUnread = prior.filter(row => !row.read_at && hiddenIds.has(row.id)).length;
                publish({ notifications: dedupe([...restored, ...prior.filter(row => !restored.some(next => next.id === row.id))])
                    .filter(row => !hiddenIds.has(row.id)).sort(newestFirst),
                    unreadCount: Math.max(priorCount - hiddenUnread, state.unreadCount), error: READ_ERROR });
            }
            publish({ markingAllRead: false });
            await refresh();
            if (active && error) publish({ error: READ_ERROR });
            return !error;
        })().finally(() => { markAllOperation = null; });
        return markAllOperation;
    }

    async function markSeen(ids: readonly string[]) {
        const selected = [...new Set(ids)].filter(id => !pendingSeen.has(id)
            && state.notifications.some(row => row.id === id && !row.seen_at)).slice(0, 100);
        if (!selected.length) return;
        selected.forEach(id => pendingSeen.add(id));
        try {
            const error = await adapter.markSeen(selected);
            if (!error && active) {
                const selectedIds = new Set(selected);
                const stamp = new Date(now()).toISOString();
                publish({ notifications: state.notifications.map(row => selectedIds.has(row.id) ? { ...row, seen_at: row.seen_at ?? stamp } : row) });
            }
        } catch { /* Seen state is advisory; reading and navigation remain available. */ }
        finally { selected.forEach(id => pendingSeen.delete(id)); }
    }

    return {
        getSnapshot: () => state,
        getServerSnapshot: () => initial,
        subscribe(listener: () => void) {
            listeners.add(listener);
            start();
            return () => {
                listeners.delete(listener);
                queueMicrotask(() => { if (listeners.size === 0) stop(); });
            };
        },
        refresh,
        loadMore() { if (state.hasMore && !state.loadingMore) moreRequested = true; return run(); },
        setFilter(filter: "all" | "unread") {
            if (filter === state.filter) return;
            revision += 1;
            moreRequested = false;
            publish({ filter, notifications: [], loading: true, hasMore: false, liveNotification: null });
            void refresh();
        },
        markRead, markAllRead, markSeen,
        dismissLive(id?: string) { if (!id || state.liveNotification?.id === id) publish({ liveNotification: null }); },
    };
}
