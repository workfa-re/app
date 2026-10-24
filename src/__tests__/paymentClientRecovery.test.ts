import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentRequest } from "@/components/payments/payment-client";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded owner payment requests", () => {
    it("contains a stalled network request without reporting payment failure or exposing provider details", async () => {
        vi.useFakeTimers();
        const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("private provider error")))));
        vi.stubGlobal("fetch", fetch);
        const work = paymentRequest("/api/payments/recipient/sync", {}, "stable-owner-operation");
        const rejected = expect(work).rejects.toMatchObject({ code: "request_timed_out", message: expect.stringContaining("noch nicht bestätigt") });
        await vi.advanceTimersByTimeAsync(25_001); await rejected;
        expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].headers).toMatchObject({ "idempotency-key": "stable-owner-operation" });
        expect(vi.getTimerCount()).toBe(0);
    });
    it("clears the timeout after a confirmed server response", async () => {
        vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }));
        expect(await paymentRequest("/api/payments/status")).toEqual({ ok: true }); expect(vi.getTimerCount()).toBe(0);
    });
});
