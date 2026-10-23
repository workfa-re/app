import { describe, expect, it, vi } from "vitest";
import { createNotificationFeed, type NotificationFeedAdapter, type NotificationFeedEvent } from "@/components/notifications/notificationStore";
import type { NotificationItem, NotificationPage } from "@/components/notifications/notificationTypes";

const USER = "15ae217f-228a-445b-9340-a91b141e9271";
const NOW = Date.parse("2026-10-23T12:00:00Z");
function item(id: string, extra: Partial<NotificationItem> = {}): NotificationItem {
    return { id, user_id: USER, title: "Neue Nachricht", body: "Rasen mähen", type: "message",
        created_at: new Date(NOW - 1_000).toISOString(), read_at: null, ...extra };
}
function page(notifications: NotificationItem[] = [], extra: Partial<NotificationPage> = {}): NotificationPage {
    return { notifications, unreadCount: notifications.filter(row => !row.read_at).length,
        hasMore: false, snapshotAt: new Date(NOW).toISOString(), ...extra };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture(initial = page(), clientClockOffset = 0) {
    let receive!: (event: NotificationFeedEvent) => void;
    let reconcile!: () => void;
    let visible = true;
    let monotonicTime = 0;
    const disconnect = vi.fn();
    const adapter: NotificationFeedAdapter = {
        now: () => NOW + clientClockOffset,
        monotonicNow: () => monotonicTime,
        isVisible: () => visible,
        loadPage: vi.fn().mockResolvedValue(initial),
        markRead: vi.fn().mockResolvedValue(null),
        markReadThrough: vi.fn().mockResolvedValue(null),
        markSeen: vi.fn().mockResolvedValue(null),
        connect: vi.fn((onEvent, onReconcile) => { receive = onEvent; reconcile = onReconcile; return disconnect; }),
        onIdle: vi.fn(),
    };
    const feed = createNotificationFeed(USER, adapter);
    const unsubscribe = feed.subscribe(vi.fn());
    return { feed, adapter, disconnect, unsubscribe,
        receive: (event: NotificationFeedEvent) => receive(event),
        reconnect: () => reconcile(),
        advanceMonotonic(milliseconds: number) { monotonicTime += milliseconds; },
        setVisible(value: boolean) { visible = value; } };
}

describe("the shared notification feed", () => {
    it("hydrates history without creating a live banner", async () => {
        const f = fixture(page([item("old")]));
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        expect(f.feed.getSnapshot()).toMatchObject({ loading: false, unreadCount: 1, liveNotification: null });
        expect(f.feed.getSnapshot().notifications.map(row => row.id)).toEqual(["old"]);
    });

    it("shares a connection and serializes concurrent refresh callers", async () => {
        const f = fixture();
        const load = deferred<NotificationPage>();
        vi.mocked(f.adapter.loadPage).mockReturnValueOnce(load.promise);
        const secondUnsubscribe = f.feed.subscribe(vi.fn());
        const running = f.feed.refresh();
        await Promise.resolve();
        const again = f.feed.refresh();
        expect(running).toBe(again);
        expect(f.adapter.connect).toHaveBeenCalledTimes(1);
        expect(f.adapter.loadPage).toHaveBeenCalledTimes(1);
        load.resolve(page([item("outdated")]));
        await running;
        expect(f.adapter.loadPage).toHaveBeenCalledTimes(2);
        expect(f.feed.getSnapshot().notifications).toEqual([]);
        secondUnsubscribe();
    });

    it("only emits a new recipient-owned visible INSERT once", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        const fresh = item("new");
        f.receive({ type: "INSERT", notification: fresh });
        expect(f.feed.getSnapshot().liveNotification?.id).toBe("new");
        f.feed.dismissLive("new");
        f.receive({ type: "INSERT", notification: fresh });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        f.receive({ type: "INSERT", notification: item("foreign", { user_id: "other" }) });
        f.receive({ type: "INSERT", notification: item("hidden", { in_app_visible: false }) });
        expect(f.feed.getSnapshot().notifications.map(row => row.id)).toEqual(["new"]);
        await f.feed.refresh();
    });

    it("removes a hidden UPDATE immediately, including its unread count", async () => {
        const f = fixture(page([item("deleted")]));
        await f.feed.refresh();
        f.receive({ type: "UPDATE", notification: item("deleted", { in_app_visible: false }) });
        expect(f.feed.getSnapshot().notifications).toEqual([]);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page());
        await f.feed.refresh();
    });

    it("does not toast before the first baseline is loaded", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        f.receive({ type: "INSERT", notification: item("new") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
    });

    it.each([-300_000, 300_000])("uses server time for live INSERTs when the device is skewed by %i ms", async clientClockOffset => {
        const f = fixture(page(), clientClockOffset);
        f.receive({ type: "status", connected: true });
        f.receive({ type: "INSERT", notification: item("initial-replay") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
        f.advanceMonotonic(10_000);
        f.receive({ type: "INSERT", notification: item("genuine", { created_at: new Date(NOW + 10_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification?.id).toBe("genuine");
        f.feed.dismissLive();
        f.receive({ type: "INSERT", notification: item("old-replay", { created_at: new Date(NOW - 60_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
    });

    it.each([-300_000, 300_000])("suppresses reconnect replay despite a %i ms device skew", async clientClockOffset => {
        const f = fixture(page(), clientClockOffset);
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        f.advanceMonotonic(300_000);
        f.receive({ type: "status", connected: false });
        f.receive({ type: "status", connected: true });
        f.receive({ type: "INSERT", notification: item("inflight-replay", { created_at: new Date(NOW + 299_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([], { snapshotAt: new Date(NOW + 300_000).toISOString() }));
        await f.feed.refresh();
        f.receive({ type: "INSERT", notification: item("post-reconnect-replay", { created_at: new Date(NOW + 240_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        f.receive({ type: "INSERT", notification: item("genuine", { created_at: new Date(NOW + 301_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification?.id).toBe("genuine");
        await f.feed.refresh();
    });

    it("expires replay eligibility using elapsed monotonic time between server reads", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        f.advanceMonotonic(300_000);
        f.receive({ type: "INSERT", notification: item("stale-replay") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        f.receive({ type: "INSERT", notification: item("genuine", { created_at: new Date(NOW + 300_000).toISOString() }) });
        expect(f.feed.getSnapshot().liveNotification?.id).toBe("genuine");
        await f.feed.refresh();
    });

    it("does not toast read events, hidden tabs or historical replay", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        f.receive({ type: "INSERT", notification: item("read", { read_at: new Date(NOW).toISOString() }) });
        f.receive({ type: "INSERT", notification: item("historical", { created_at: "2026-10-20T12:00:00Z" }) });
        f.setVisible(false);
        f.receive({ type: "INSERT", notification: item("hidden-tab") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
    });

    it("reconciles reconnect history without replaying banners", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        f.receive({ type: "status", connected: false });
        expect(f.feed.getSnapshot().error).toContain("Live-Updates");
        f.receive({ type: "status", connected: true });
        f.receive({ type: "INSERT", notification: item("replay") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
        expect(f.feed.getSnapshot().error).toBeNull();
    });

    it("suppresses visibility reconciliation history too", async () => {
        const f = fixture();
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        f.reconnect();
        f.receive({ type: "INSERT", notification: item("replay") });
        expect(f.feed.getSnapshot().liveNotification).toBeNull();
        await f.feed.refresh();
    });

    it("loads older rows by the last timestamp and ID, preserving the global unread count", async () => {
        const first = item("b");
        const older = item("a", { created_at: "2026-10-22T11:00:00Z" });
        const f = fixture(page([first], { hasMore: true, unreadCount: 30 }));
        await f.feed.refresh();
        vi.mocked(f.adapter.loadPage).mockResolvedValueOnce(page([older], { unreadCount: 30 }));
        await f.feed.loadMore();
        expect(f.adapter.loadPage).toHaveBeenLastCalledWith({ createdAt: first.created_at, id: "b" }, false, 25);
        expect(f.feed.getSnapshot().notifications.map(row => row.id)).toEqual(["b", "a"]);
        expect(f.feed.getSnapshot().unreadCount).toBe(30);
        expect(f.feed.getSnapshot().hasMore).toBe(false);
    });

    it("fetches unread history on the server rather than filtering only the first page", async () => {
        const f = fixture(page([item("read", { read_at: "2026-10-23T10:00:00Z" })]));
        await f.feed.refresh();
        vi.mocked(f.adapter.loadPage).mockResolvedValueOnce(page([item("old-unread")], { unreadCount: 1 }));
        f.feed.setFilter("unread");
        await f.feed.refresh();
        expect(f.adapter.loadPage).toHaveBeenLastCalledWith(null, true, 25);
        expect(f.feed.getSnapshot()).toMatchObject({ filter: "unread", unreadCount: 1 });
        expect(f.feed.getSnapshot().notifications.map(row => row.id)).toEqual(["old-unread"]);
    });

    it("reconciles previously loaded history after a deletion missed while disconnected", async () => {
        const rows = Array.from({ length: 25 }, (_, index) => item(`row-${index}`));
        const older = item("older", { created_at: "2026-10-20T12:00:00Z" });
        const f = fixture(page(rows, { hasMore: true, unreadCount: 26 }));
        await f.feed.refresh();
        vi.mocked(f.adapter.loadPage).mockResolvedValueOnce(page([older], { unreadCount: 26 }));
        await f.feed.loadMore();
        expect(f.feed.getSnapshot().notifications).toHaveLength(26);
        vi.mocked(f.adapter.loadPage).mockResolvedValueOnce(page(rows, { unreadCount: 25 }));
        await f.feed.refresh();
        expect(f.adapter.loadPage).toHaveBeenLastCalledWith(null, false, 26);
        expect(f.feed.getSnapshot().notifications.some(row => row.id === "older")).toBe(false);
    });

    it("discards an in-flight all-items result after switching to unread", async () => {
        const f = fixture();
        const old = deferred<NotificationPage>();
        vi.mocked(f.adapter.loadPage).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([item("wanted")]));
        const loading = f.feed.refresh();
        await Promise.resolve();
        f.feed.setFilter("unread");
        old.resolve(page([item("wrong")]));
        await loading;
        expect(f.feed.getSnapshot().notifications.map(row => row.id)).toEqual(["wanted"]);
        expect(f.adapter.loadPage).toHaveBeenLastCalledWith(null, true, 25);
    });

    it("marks a clicked notification read once and reconciles its counter", async () => {
        const original = item("read-me");
        const f = fixture(page([original]));
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(f.adapter.markRead).mockReturnValueOnce(mutation.promise);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([{ ...original, read_at: new Date(NOW).toISOString() }]));
        const first = f.feed.markRead(original);
        const duplicate = f.feed.markRead(original);
        expect(first).toBe(duplicate);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        mutation.resolve(null);
        expect(await first).toBe(true);
        expect(f.adapter.markRead).toHaveBeenCalledTimes(1);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
    });

    it("rolls back an unsuccessful read and keeps a useful error", async () => {
        const original = item("read-me");
        const f = fixture(page([original]));
        await f.feed.refresh();
        vi.mocked(f.adapter.markRead).mockResolvedValueOnce("Nicht bestätigt");
        expect(await f.feed.markRead(original)).toBe(false);
        expect(f.feed.getSnapshot().notifications[0].read_at).toBeNull();
        expect(f.feed.getSnapshot().unreadCount).toBe(1);
        expect(f.feed.getSnapshot().error).toContain("Lesestatus");
    });

    it("does not flash unread again when a refresh finishes before the read RPC", async () => {
        const original = item("read-me");
        const f = fixture(page([original]));
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(f.adapter.markRead).mockReturnValueOnce(mutation.promise);
        const operation = f.feed.markRead(original);
        await f.feed.refresh();
        expect(f.feed.getSnapshot().notifications[0].read_at).toBeTruthy();
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([{ ...original, read_at: new Date(NOW).toISOString() }]));
        mutation.resolve(null);
        expect(await operation).toBe(true);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
    });

    it.each(["single", "bulk"] as const)("keeps a pending %s read over a delayed seen UPDATE", async kind => {
        const original = item("read-me");
        const f = fixture(page([original]));
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(kind === "single" ? f.adapter.markRead : f.adapter.markReadThrough).mockReturnValueOnce(mutation.promise);
        const operation = kind === "single" ? f.feed.markRead(original) : f.feed.markAllRead();
        const seenAt = new Date(NOW - 100).toISOString();
        f.receive({ type: "UPDATE", notification: { ...original, seen_at: seenAt } });
        expect(f.feed.getSnapshot().notifications[0]).toMatchObject({ read_at: expect.any(String), seen_at: seenAt });
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([{ ...original, seen_at: seenAt, read_at: new Date(NOW).toISOString() }]));
        mutation.resolve(null);
        expect(await operation).toBe(true);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
    });

    it.each(["single", "bulk"] as const)("still rolls back a failed %s read after a delayed seen UPDATE", async kind => {
        const original = item("read-me");
        const f = fixture(page([original]));
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(kind === "single" ? f.adapter.markRead : f.adapter.markReadThrough).mockReturnValueOnce(mutation.promise);
        const operation = kind === "single" ? f.feed.markRead(original) : f.feed.markAllRead();
        const seenAt = new Date(NOW - 100).toISOString();
        f.receive({ type: "UPDATE", notification: { ...original, seen_at: seenAt } });
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([{ ...original, seen_at: seenAt }]));
        mutation.resolve("Nicht gespeichert");
        expect(await operation).toBe(false);
        expect(f.feed.getSnapshot().notifications[0]).toMatchObject({ read_at: null, seen_at: seenAt });
        expect(f.feed.getSnapshot().unreadCount).toBe(1);
        expect(f.feed.getSnapshot().error).toContain("Lesestatus");
    });

    it.each(["single", "bulk"] as const)("does not resurrect a hidden item when a pending %s read fails offline", async kind => {
        const original = item("removed");
        const f = fixture(page([original]));
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(kind === "single" ? f.adapter.markRead : f.adapter.markReadThrough).mockReturnValueOnce(mutation.promise);
        const operation = kind === "single" ? f.feed.markRead(original) : f.feed.markAllRead();
        f.receive({ type: "UPDATE", notification: { ...original, in_app_visible: false, read_at: new Date(NOW).toISOString() } });
        expect(f.feed.getSnapshot().notifications).toEqual([]);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
        vi.mocked(f.adapter.loadPage).mockRejectedValue(new Error("offline"));
        mutation.resolve("Nicht verfügbar");
        await operation;
        expect(f.feed.getSnapshot().notifications).toEqual([]);
        expect(f.feed.getSnapshot().unreadCount).toBe(0);
    });

    it("never sends a foreign recipient's mark-read request", async () => {
        const f = fixture();
        await f.feed.refresh();
        expect(await f.feed.markRead(item("foreign", { user_id: "other" }))).toBe(false);
        expect(f.adapter.markRead).not.toHaveBeenCalled();
    });

    it("bulk-read sends the server snapshot and preserves arrivals after it", async () => {
        const original = item("old");
        const incoming = item("incoming", { created_at: new Date(NOW + 1_000).toISOString() });
        const f = fixture(page([original]));
        f.receive({ type: "status", connected: true });
        await f.feed.refresh();
        const mutation = deferred<string | null>();
        vi.mocked(f.adapter.markReadThrough).mockReturnValueOnce(mutation.promise);
        const operation = f.feed.markAllRead();
        f.receive({ type: "INSERT", notification: incoming });
        f.receive({ type: "UPDATE", notification: { ...incoming, seen_at: new Date(NOW).toISOString() } });
        expect(f.feed.getSnapshot().notifications.find(row => row.id === "incoming")?.read_at).toBeNull();
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([{ ...original, read_at: new Date(NOW).toISOString() }, incoming]));
        mutation.resolve(null);
        expect(await operation).toBe(true);
        expect(f.adapter.markReadThrough).toHaveBeenCalledWith(new Date(NOW).toISOString());
        expect(f.feed.getSnapshot().unreadCount).toBe(1);
    });

    it("rolls back bulk-read failure", async () => {
        const f = fixture(page([item("old")]));
        await f.feed.refresh();
        vi.mocked(f.adapter.markReadThrough).mockRejectedValueOnce(new Error("offline"));
        expect(await f.feed.markAllRead()).toBe(false);
        expect(f.feed.getSnapshot()).toMatchObject({ unreadCount: 1, markingAllRead: false });
        expect(f.feed.getSnapshot().notifications[0].read_at).toBeNull();
    });

    it("does not optimistically read an arrival excluded by the previous server snapshot", async () => {
        const f = fixture(page([item("old")]));
        await f.feed.refresh();
        const incoming = item("incoming");
        f.receive({ type: "INSERT", notification: incoming });
        const mutation = deferred<string | null>();
        vi.mocked(f.adapter.markReadThrough).mockReturnValueOnce(mutation.promise);
        const operation = f.feed.markAllRead();
        expect(f.feed.getSnapshot().notifications.find(row => row.id === "incoming")?.read_at).toBeNull();
        expect(f.feed.getSnapshot().unreadCount).toBe(1);
        vi.mocked(f.adapter.loadPage).mockResolvedValue(page([incoming]));
        mutation.resolve(null);
        await operation;
    });

    it("marks visible IDs seen without marking them read", async () => {
        const f = fixture(page([item("one"), item("two")]));
        await f.feed.refresh();
        await f.feed.markSeen(["one", "one", "foreign"]);
        expect(f.adapter.markSeen).toHaveBeenCalledWith(["one"]);
        expect(f.feed.getSnapshot().notifications[0].seen_at).toBeTruthy();
        expect(f.feed.getSnapshot().notifications[0].read_at).toBeNull();
        expect(f.feed.getSnapshot().unreadCount).toBe(2);
    });

    it("treats failed seen acknowledgements as advisory", async () => {
        const f = fixture(page([item("one")]));
        await f.feed.refresh();
        vi.mocked(f.adapter.markSeen).mockRejectedValueOnce(new Error("offline"));
        await expect(f.feed.markSeen(["one"])).resolves.toBeUndefined();
        expect(f.feed.getSnapshot().notifications[0].seen_at).toBeUndefined();
    });

    it("retains useful history after a load failure and retries", async () => {
        const f = fixture(page([item("one")]));
        await f.feed.refresh();
        vi.mocked(f.adapter.loadPage).mockRejectedValueOnce(new Error("offline"));
        await f.feed.refresh();
        expect(f.feed.getSnapshot().notifications).toHaveLength(1);
        expect(f.feed.getSnapshot().error).toContain("geladen");
        await f.feed.refresh();
        expect(f.feed.getSnapshot().error).toBeNull();
    });

    it("does not publish late requests after the final subscriber leaves", async () => {
        const f = fixture();
        const load = deferred<NotificationPage>();
        vi.mocked(f.adapter.loadPage).mockReturnValueOnce(load.promise);
        const running = f.feed.refresh();
        await Promise.resolve();
        f.unsubscribe();
        await Promise.resolve();
        load.resolve(page([item("late")]));
        await running;
        expect(f.feed.getSnapshot().notifications).toEqual([]);
        expect(f.disconnect).toHaveBeenCalledTimes(1);
        expect(f.adapter.onIdle).toHaveBeenCalledTimes(1);
    });

    it("does not create an anonymous live connection", async () => {
        const f = fixture();
        const feed = createNotificationFeed("", f.adapter);
        feed.subscribe(vi.fn());
        await feed.refresh();
        expect(f.adapter.connect).toHaveBeenCalledTimes(1);
    });
});
