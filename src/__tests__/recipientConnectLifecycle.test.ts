import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipientConnectSession, logoutRecipientConnectSessions } from "@/components/payments/recipient-connect-lifecycle";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
afterEach(async () => { await logoutRecipientConnectSessions(); vi.useRealTimers(); });

describe("owner-bound Connect authentication lifecycle", () => {
    it("does not invalidate Stripe authentication during normal component use or replacement", async () => {
        const first = { logout: vi.fn().mockResolvedValue(undefined) };
        const second = { logout: vi.fn().mockResolvedValue(undefined) };
        createRecipientConnectSession(owner, () => first);
        createRecipientConnectSession(owner, () => second);
        expect(first.logout).not.toHaveBeenCalled(); expect(second.logout).not.toHaveBeenCalled();
        await logoutRecipientConnectSessions();
        expect(first.logout).toHaveBeenCalledOnce(); expect(second.logout).toHaveBeenCalledOnce();
    });
    it("rejects missing and foreign owners before creating a Stripe instance", () => {
        const create = vi.fn(() => ({ logout: vi.fn().mockResolvedValue(undefined) }));
        expect(() => createRecipientConnectSession(undefined, create)).toThrow();
        expect(create).not.toHaveBeenCalled();
        createRecipientConnectSession(owner, create);
        expect(() => createRecipientConnectSession(other, create)).toThrow("connect_owner_changed");
        expect(create).toHaveBeenCalledOnce();
    });
    it("invalidates stale secret refreshes immediately on app logout and permits a fresh owner afterwards", async () => {
        let guard!: () => void;
        createRecipientConnectSession(owner, assertOwner => { guard = assertOwner; return { logout: vi.fn().mockResolvedValue(undefined) }; });
        guard(); await logoutRecipientConnectSessions(); expect(guard).toThrow("connect_owner_changed");
        expect(() => createRecipientConnectSession(other, () => ({ logout: vi.fn().mockResolvedValue(undefined) }))).not.toThrow();
        expect(guard).toThrow();
    });
    it("never blocks app logout indefinitely on a stalled SDK and contains provider errors", async () => {
        vi.useFakeTimers();
        createRecipientConnectSession(owner, () => ({ logout: () => new Promise<void>(() => undefined) }));
        createRecipientConnectSession(owner, () => ({ logout: () => Promise.reject(new Error("confidential provider message")) }));
        const finished = vi.fn(); const work = logoutRecipientConnectSessions().then(finished);
        await vi.advanceTimersByTimeAsync(999); expect(finished).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1); await work; expect(finished).toHaveBeenCalledOnce();
        expect(() => createRecipientConnectSession(other, () => ({ logout: vi.fn().mockResolvedValue(undefined) }))).not.toThrow();
    });
});
