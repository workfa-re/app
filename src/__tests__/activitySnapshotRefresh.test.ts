import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));

import { createActivitySnapshotRefresher } from "@/components/activity/ActivityCommandCenter";

describe("activity snapshot recovery", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("uses the server-rendered snapshot for the first connection, then recovers after reconnection", () => {
        const refresh = vi.fn();
        const snapshot = createActivitySnapshotRefresher(refresh, () => true);
        snapshot.onStatus("SUBSCRIBED");
        vi.runAllTimers();
        expect(refresh).not.toHaveBeenCalled();

        snapshot.onStatus("CHANNEL_ERROR");
        snapshot.onStatus("SUBSCRIBED");
        vi.runAllTimers();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("recovers an interrupted initial connection whose server snapshot may have aged", () => {
        const refresh = vi.fn();
        const snapshot = createActivitySnapshotRefresher(refresh, () => true);
        snapshot.onStatus("TIMED_OUT");
        snapshot.onStatus("SUBSCRIBED");
        vi.runAllTimers();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("combines reconnect, visible, online and transaction events into one current snapshot", () => {
        const refresh = vi.fn();
        const snapshot = createActivitySnapshotRefresher(refresh, () => true);
        snapshot.onStatus("SUBSCRIBED");
        snapshot.onStatus("SUBSCRIBED");
        snapshot.request();
        vi.advanceTimersByTime(80);
        snapshot.request();
        snapshot.request();
        vi.advanceTimersByTime(149);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("waits for a visible online page instead of refreshing in the background", () => {
        const refresh = vi.fn();
        let visible = false;
        let online = true;
        const snapshot = createActivitySnapshotRefresher(refresh, () => visible && online);
        snapshot.request();
        vi.runAllTimers();
        expect(refresh).not.toHaveBeenCalled();

        visible = true;
        online = false;
        snapshot.request();
        vi.runAllTimers();
        expect(refresh).not.toHaveBeenCalled();

        online = true;
        snapshot.request();
        vi.runAllTimers();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not start a fetch if the page becomes hidden during the event burst", () => {
        const refresh = vi.fn();
        let visible = true;
        const snapshot = createActivitySnapshotRefresher(refresh, () => visible);
        snapshot.request();
        visible = false;
        vi.runAllTimers();
        expect(refresh).not.toHaveBeenCalled();
        visible = true;
        snapshot.request();
        vi.runAllTimers();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("cancels queued recovery and ignores stale channel callbacks after cleanup", () => {
        const refresh = vi.fn();
        const snapshot = createActivitySnapshotRefresher(refresh, () => true);
        snapshot.request();
        snapshot.dispose();
        snapshot.onStatus("CHANNEL_ERROR");
        snapshot.onStatus("SUBSCRIBED");
        snapshot.request();
        vi.runAllTimers();
        expect(refresh).not.toHaveBeenCalled();
    });
});
