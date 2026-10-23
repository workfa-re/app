import { describe, expect, it, vi } from "vitest";
import type { AppointmentRequest } from "@/lib/activity/appointments";

vi.mock("@/app/app-home/applications/actions", () => ({ getAppointmentRequests: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));

import { createAppointmentRequestsLoader } from "@/components/activity/useAppointmentRequests";

type Snapshot = { requests: AppointmentRequest[]; available: boolean };
const snapshot = (id: string): Snapshot => ({ available: true, requests: [{ id } as AppointmentRequest] });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("appointment request refresh ownership", () => {
    it("coalesces a synchronous refresh burst into one request", async () => {
        const load = vi.fn().mockResolvedValue(snapshot("current"));
        const publish = vi.fn();
        const loader = createAppointmentRequestsLoader(load, publish);
        const first = loader.refresh();
        const second = loader.refresh();
        const third = loader.refresh();
        expect(second).toBe(first);
        expect(third).toBe(first);
        await first;
        expect(load).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledExactlyOnceWith(snapshot("current"));
    });

    it("reloads an invalidated in-flight response and makes every caller await the fresh result", async () => {
        const stale = deferred<Snapshot>();
        const fresh = deferred<Snapshot>();
        const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
        const publish = vi.fn();
        const loader = createAppointmentRequestsLoader(load, publish);
        const first = loader.refresh();
        await flush();
        const second = loader.refresh();
        const third = loader.refresh();
        expect(second).toBe(first);
        expect(third).toBe(first);
        stale.resolve(snapshot("outdated"));
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(publish).not.toHaveBeenCalled();
        let settled = false;
        void first.then(() => { settled = true; });
        await flush();
        expect(settled).toBe(false);
        fresh.resolve(snapshot("latest"));
        await Promise.all([first, second, third]);
        expect(publish).toHaveBeenCalledExactlyOnceWith(snapshot("latest"));
    });

    it("does not publish or reload a disposed conversation after its request resolves", async () => {
        const response = deferred<Snapshot>();
        const load = vi.fn().mockReturnValue(response.promise);
        const publish = vi.fn();
        const loader = createAppointmentRequestsLoader(load, publish);
        const flight = loader.refresh();
        await flush();
        void loader.refresh();
        loader.dispose();
        response.resolve(snapshot("previous-conversation"));
        await flight;
        await loader.refresh();
        expect(load).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled();
    });

    it("prevents an obsolete queued refresh from even starting", async () => {
        const load = vi.fn().mockResolvedValue(snapshot("obsolete"));
        const publish = vi.fn();
        const loader = createAppointmentRequestsLoader(load, publish);
        const flight = loader.refresh();
        loader.dispose();
        await flight;
        expect(load).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it("clears stale proposals on failure and permits a later retry, including synchronous errors", async () => {
        const load = vi.fn()
            .mockImplementationOnce(() => { throw new Error("offline"); })
            .mockRejectedValueOnce(new Error("still offline"))
            .mockResolvedValueOnce(snapshot("recovered"));
        const publish = vi.fn();
        const loader = createAppointmentRequestsLoader(load, publish);
        await loader.refresh();
        await loader.refresh();
        expect(publish).toHaveBeenNthCalledWith(1, { requests: [], available: false });
        expect(publish).toHaveBeenNthCalledWith(2, { requests: [], available: false });
        await loader.refresh();
        expect(load).toHaveBeenCalledTimes(3);
        expect(publish).toHaveBeenLastCalledWith(snapshot("recovered"));
    });
});
