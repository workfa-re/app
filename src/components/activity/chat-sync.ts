import type { ActivityMessage } from "@/lib/activity/chat";

/** Read receipts and deletion tombstones are monotonic, even for delayed payloads. */
export function mergeChatMessages(current: readonly ActivityMessage[], incoming: readonly ActivityMessage[]) {
    const byId = new Map(current.map(message => [message.id, message]));
    for (const message of incoming) {
        const previous = byId.get(message.id);
        const next = { ...previous, ...message };
        if (previous?.read_at && !next.read_at) next.read_at = previous.read_at;
        if (previous?.deleted_at && !next.deleted_at) next.deleted_at = previous.deleted_at;
        byId.set(message.id, next);
    }
    return [...byId.values()].sort((a, b) => {
        const time = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        return time || a.id.localeCompare(b.id);
    });
}

/** Replace stale local rows, then preserve only events received during this snapshot request. */
export function mergeChatHistory(
    current: readonly ActivityMessage[],
    snapshot: readonly ActivityMessage[],
    realtimeDuringLoad: readonly ActivityMessage[],
) {
    return mergeChatMessages(mergeChatMessages(current, snapshot), realtimeDuringLoad);
}

/** Coalesce event bursts and never publish a response invalidated while it was loading. */
export function createChatRefreshQueue<T>(
    load: () => Promise<T>,
    publish: (value: T) => void,
    onError: () => void = () => {},
) {
    let active = true;
    let dirty = false;
    let inFlight: Promise<void> | null = null;

    function refresh(): Promise<void> {
        if (!active) return Promise.resolve();
        dirty = true;
        if (inFlight) return inFlight;
        inFlight = Promise.resolve().then(async () => {
            try {
                while (active && dirty) {
                    dirty = false;
                    try {
                        const value = await load();
                        if (active && !dirty) publish(value);
                    } catch {
                        if (active && !dirty) onError();
                    }
                }
            } finally { inFlight = null; }
        });
        return inFlight;
    }

    return { refresh, dispose() { active = false; dirty = false; } };
}

/** The initial connection already has a history load; only a reconnect needs another one. */
export function createChatReconnectHandler(refresh: () => void) {
    let subscribed = false;
    let interrupted = false;
    return (status: string) => {
        if (status === "SUBSCRIBED") {
            if (subscribed || interrupted) refresh();
            subscribed = true;
            interrupted = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") interrupted = true;
    };
}
