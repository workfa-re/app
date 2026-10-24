import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeMinuteClock } from "@/components/activity/useMinuteClock";

const start = Date.parse("2026-10-24T12:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => vi.useRealTimers());

describe("the idle appointment clock", () => {
    it("updates an idle subscriber every minute using the current wall clock", () => {
        const update = vi.fn();
        const stop = subscribeMinuteClock(update);
        vi.advanceTimersByTime(59_999);
        expect(update).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(update).toHaveBeenLastCalledWith(start + 60_000);
        vi.advanceTimersByTime(60_000);
        expect(update).toHaveBeenLastCalledWith(start + 120_000);
        expect(update).toHaveBeenCalledTimes(2);
        stop();
    });

    it("removes its timer on unmount and never updates an obsolete subscriber", () => {
        const update = vi.fn();
        const stop = subscribeMinuteClock(update);
        expect(vi.getTimerCount()).toBe(1);
        stop();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(180_000);
        expect(update).not.toHaveBeenCalled();
    });

    it("does not leak duplicate timers across a cleanup and remount", () => {
        const previous = vi.fn(); const current = vi.fn();
        subscribeMinuteClock(previous)();
        const stop = subscribeMinuteClock(current);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(60_000);
        expect(previous).not.toHaveBeenCalled();
        expect(current).toHaveBeenCalledExactlyOnceWith(start + 60_000);
        stop();
    });

    it("resynchronizes after a delayed tick or a changed device clock", () => {
        const update = vi.fn();
        const stop = subscribeMinuteClock(update);
        vi.setSystemTime(start + 5 * 60_000);
        vi.advanceTimersByTime(60_000);
        expect(update).toHaveBeenCalledExactlyOnceWith(start + 6 * 60_000);
        stop();
    });
});
