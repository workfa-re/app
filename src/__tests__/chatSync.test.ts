import { describe, expect, it, vi } from "vitest";
import { createChatReconnectHandler, createChatRefreshQueue, mergeChatHistory, mergeChatMessages } from "@/components/activity/chat-sync";
import { findChatMessages } from "@/components/activity/chat-details";
import type { ActivityMessage } from "@/lib/activity/chat";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function message(id: string, values: Partial<ActivityMessage> = {}): ActivityMessage {
    return { id, application_id: "application-a", sender_id: "person-partner", content: "Bisheriger Text", created_at: "2026-10-24T12:00:00Z", read_at: null, deleted_at: null, kind: "chat", ...values };
}

describe("authoritative chat history with concurrent realtime events", () => {
    it("recovers read receipts and content changes missed while offline", () => {
        const old = message("one");
        const server = message("one", { read_at: "2026-10-24T12:04:00Z", content: "Korrigierter Text" });
        expect(mergeChatHistory([old], [server], [])).toEqual([server]);
    });

    it("keeps an offline deletion as a tombstone and removes its content from chat search", () => {
        const old = message("deleted", { content: "Vertraulicher Treffpunkt" });
        const deleted = { ...old, deleted_at: "2026-10-24T12:05:00Z" };
        const recovered = mergeChatHistory([old], [deleted], []);
        expect(recovered[0].deleted_at).toBe(deleted.deleted_at);
        expect(findChatMessages(recovered, "Treffpunkt")).toEqual([]);
    });

    it("preserves a fresh realtime edit received during an older snapshot request", () => {
        const old = message("one");
        const duringFetch = message("one", { content: "Gerade aktualisiert", read_at: "2026-10-24T12:06:00Z" });
        const current = mergeChatMessages([old], [duringFetch]);
        expect(mergeChatHistory(current, [old], [duringFetch])).toEqual([duringFetch]);
    });

    it("does not resurrect a realtime deletion when its pending snapshot resolves", () => {
        const old = message("one");
        const duringFetch = message("one", { deleted_at: "2026-10-24T12:06:00Z" });
        const current = mergeChatMessages([old], [duringFetch]);
        const recovered = mergeChatHistory(current, [old], [duringFetch]);
        expect(recovered[0].deleted_at).toBe(duringFetch.deleted_at);
        expect(findChatMessages(recovered, "Text")).toEqual([]);
    });

    it("keeps deletion tombstones and read state over later delayed nondeleted or unread payloads", () => {
        const deleted = message("one", { deleted_at: "2026-10-24T12:06:00Z", read_at: "2026-10-24T12:04:00Z" });
        const delayed = message("one", { content: "Verzögert zugestellt" });
        const next = mergeChatMessages([deleted], [delayed]);
        expect(next[0]).toMatchObject({ deleted_at: deleted.deleted_at, read_at: deleted.read_at });
        expect(findChatMessages(next, "zugestellt")).toEqual([]);
    });

    it("preserves a fresh server read receipt even when a delayed realtime update has no read stamp", () => {
        const old = message("one");
        const read = message("one", { read_at: "2026-10-24T12:04:00Z" });
        const delayed = message("one", { content: "Neuer Inhalt" });
        const recovered = mergeChatHistory([old], [read], [delayed]);
        expect(recovered[0]).toMatchObject({ content: "Neuer Inhalt", read_at: read.read_at });
    });

    it("keeps initial incoming messages, optimistic sends and already loaded older pages", () => {
        const older = message("older", { created_at: "2026-10-20T12:00:00Z" });
        const loaded = message("loaded");
        const incoming = message("incoming", { created_at: "2026-10-24T12:01:00Z" });
        const optimistic = message("temp-send", { created_at: "2026-10-24T12:02:00Z", is_temp: true });
        const recovered = mergeChatHistory([older, incoming, optimistic], [loaded], [incoming]);
        expect(recovered.map(row => row.id)).toEqual(["older", "loaded", "incoming", "temp-send"]);
        expect(recovered.filter(row => row.id === "incoming")).toHaveLength(1);
    });

    it("does not change any input snapshots while reconciling them", () => {
        const old = Object.freeze(message("one"));
        const fresh = Object.freeze(message("one", { content: "Aktueller Text" }));
        const current = Object.freeze([old]); const snapshot = Object.freeze([fresh]);
        expect(mergeChatHistory(current, snapshot, Object.freeze([]))[0].content).toBe("Aktueller Text");
        expect(old.content).toBe("Bisheriger Text");
        expect(fresh.content).toBe("Aktueller Text");
    });
});

describe("chat synchronization across interrupted connections", () => {
    it("keeps the initial history load and only requests another snapshot after reconnection", () => {
        const refresh = vi.fn();
        const status = createChatReconnectHandler(refresh);
        status("SUBSCRIBED");
        expect(refresh).not.toHaveBeenCalled();
        status("CHANNEL_ERROR");
        expect(refresh).not.toHaveBeenCalled();
        status("SUBSCRIBED");
        expect(refresh).toHaveBeenCalledTimes(1);
        status("CLOSED"); status("TIMED_OUT"); status("SUBSCRIBED");
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("recovers even when the first connection attempt failed before joining", () => {
        const refresh = vi.fn();
        const status = createChatReconnectHandler(refresh);
        status("TIMED_OUT"); status("SUBSCRIBED");
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("coalesces synchronous online, visibility and reconnect recovery into one fetch", async () => {
        const load = vi.fn().mockResolvedValue(["message-missed-while-offline"]);
        const publish = vi.fn();
        const queue = createChatRefreshQueue(load, publish);
        const requests = [queue.refresh(), queue.refresh(), queue.refresh()];
        expect(new Set(requests).size).toBe(1);
        await Promise.all(requests);
        expect(load).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledExactlyOnceWith(["message-missed-while-offline"]);
    });

    it("discards interrupted history and makes all callers await the recovered conversation", async () => {
        const stale = deferred<string[]>(); const current = deferred<string[]>();
        const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
        const publish = vi.fn();
        const queue = createChatRefreshQueue(load, publish);
        const first = queue.refresh();
        await flush();
        const resumed = queue.refresh();
        stale.resolve(["old-snapshot"]);
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(publish).not.toHaveBeenCalled();
        let settled = false; void resumed.then(() => { settled = true; });
        await flush(); expect(settled).toBe(false);
        current.resolve(["old-snapshot", "missed-message"]);
        await Promise.all([first, resumed]);
        expect(publish).toHaveBeenCalledExactlyOnceWith(["old-snapshot", "missed-message"]);
    });

    it("preserves visible history on failure and permits a later successful retry", async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["recovered"]);
        const visible = ["existing-message"];
        const error = vi.fn();
        const queue = createChatRefreshQueue<string[]>(load, rows => visible.splice(0, visible.length, ...rows), error);
        await expect(queue.refresh()).resolves.toBeUndefined();
        expect(visible).toEqual(["existing-message"]);
        expect(error).toHaveBeenCalledTimes(1);
        await queue.refresh(); expect(visible).toEqual(["recovered"]);
    });

    it("does not show an obsolete load error when a newer recovery is already requested", async () => {
        const stale = deferred<string[]>();
        const load = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(["current"]);
        const publish = vi.fn(); const error = vi.fn();
        const queue = createChatRefreshQueue(load, publish, error);
        const running = queue.refresh(); await flush(); void queue.refresh();
        stale.reject(new Error("obsolete timeout"));
        await running;
        expect(error).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledExactlyOnceWith(["current"]);
    });

    it("prevents an unmounted conversation from publishing history or starting a queued fetch", async () => {
        const pending = deferred<string[]>();
        const load = vi.fn().mockReturnValueOnce(pending.promise);
        const publish = vi.fn(); const error = vi.fn();
        const queue = createChatRefreshQueue(load, publish, error);
        const running = queue.refresh(); await flush(); void queue.refresh();
        queue.dispose(); pending.resolve(["previous-conversation"]);
        await running; await queue.refresh();
        expect(load).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    });
});

describe("serialized chat read receipts", () => {
    it("acknowledges a message burst only after the follow-up read includes later arrivals", async () => {
        const earlierRead = deferred<void>(); const laterRead = deferred<void>();
        const write = vi.fn().mockReturnValueOnce(earlierRead.promise).mockReturnValueOnce(laterRead.promise);
        const acknowledge = vi.fn();
        const queue = createChatRefreshQueue(write, acknowledge);
        const running = queue.refresh(); await flush();
        void queue.refresh(); void queue.refresh();
        earlierRead.resolve(); await flush();
        expect(write).toHaveBeenCalledTimes(2);
        expect(acknowledge).not.toHaveBeenCalled();
        laterRead.resolve(); await running;
        expect(acknowledge).toHaveBeenCalledTimes(1);
    });

    it("cannot clear another conversation's unread state after its read request outlives the old chat", async () => {
        const pending = deferred<void>();
        const acknowledge = vi.fn();
        const queue = createChatRefreshQueue(() => pending.promise, acknowledge);
        const running = queue.refresh(); await flush(); queue.dispose();
        pending.resolve(); await running;
        expect(acknowledge).not.toHaveBeenCalled();
    });

    it("handles a failed receipt without an unhandled rejection or a false read acknowledgement", async () => {
        const acknowledge = vi.fn();
        const queue = createChatRefreshQueue(() => Promise.reject(new Error("not saved")), acknowledge);
        await expect(queue.refresh()).resolves.toBeUndefined();
        expect(acknowledge).not.toHaveBeenCalled();
    });
});
