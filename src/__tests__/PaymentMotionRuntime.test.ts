import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentMotionRuntime, type MotionIntent, type MotionPlayback } from "@/components/payments/payment-motion-runtime";

class Video extends EventTarget {
    attributes = new Map<string, string>();
    play = vi.fn(() => Promise.resolve());
    load = vi.fn();
    pause = vi.fn(() => this.dispatchEvent(new Event("pause")));
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}
class Preference extends EventTarget { matches = false; }
class Connection extends EventTarget { saveData = false; }
class Page extends EventTarget { hidden = false; }
const observed: { current?: Observer } = {};
class Observer {
    callback: IntersectionObserverCallback;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; observed.current = this; }
    visibility(isIntersecting: boolean) { this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
let motion: Preference, connection: Connection, page: Page;
const light = "/media/pay/v4/workfare-pay-depth-v4-light.mp4";
const dark = "/media/pay/v4/workfare-pay-depth-v4-dark.mp4";
const controllers: ReturnType<typeof createPaymentMotionRuntime>[] = [];
function mount(intent: MotionIntent = "auto", source = light) {
    const video = new Video();
    const states: MotionPlayback[] = [];
    const container = { getBoundingClientRect: () => ({ width: 400, height: 300, top: 20, bottom: 320 }) };
    const runtime = createPaymentMotionRuntime(video as unknown as HTMLVideoElement, container as unknown as HTMLElement, source, intent, state => states.push(state));
    controllers.push(runtime);
    return { video, states, runtime, observer: observed.current!, last: () => states.at(-1)! };
}
beforeEach(() => {
    motion = new Preference(); connection = new Connection(); page = new Page(); observed.current = undefined;
    vi.stubGlobal("window", { matchMedia: () => motion, innerHeight: 900 });
    vi.stubGlobal("navigator", { connection });
    vi.stubGlobal("document", page);
    vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => { controllers.splice(0).forEach(runtime => runtime.dispose()); vi.unstubAllGlobals(); });

describe("Workfare Pay decorative video lifecycle", () => {
    it("attaches no MP4 before observed visibility and never treats loaded data or a resolved play request as playback", async () => {
        const { video, observer, last } = mount();
        expect(video.getAttribute("src")).toBeNull(); expect(video.play).not.toHaveBeenCalled();
        observer.visibility(false); expect(video.getAttribute("src")).toBeNull();
        observer.visibility(true); expect(video.getAttribute("src")).toBe(light);
        await Promise.resolve(); video.dispatchEvent(new Event("loadeddata"));
        expect(last()).toMatchObject({ playing: false, ready: false });
        video.dispatchEvent(new Event("playing"));
        expect(last()).toMatchObject({ playing: true, ready: true });
    });
    it.each(["reduced motion", "save data"])("does not fetch an MP4 with %s, and permits deliberate opt-in", preference => {
        if (preference === "reduced motion") motion.matches = true; else connection.saveData = true;
        const { video, observer, runtime, last } = mount(); observer.visibility(true);
        expect(video.getAttribute("src")).toBeNull(); expect(video.play).not.toHaveBeenCalled();
        runtime.setIntent("play"); expect(video.getAttribute("src")).toBe(light);
        expect(last().playing).toBe(false); video.dispatchEvent(new Event("playing")); expect(last().playing).toBe(true);
    });
    it("waits for visibility even after an explicit play request", () => {
        const { video, runtime, observer } = mount();
        runtime.setIntent("play"); expect(video.getAttribute("src")).toBeNull(); expect(video.play).not.toHaveBeenCalled();
        observer.visibility(true); expect(video.play).toHaveBeenCalledOnce();
    });
    it("pauses hidden or offscreen media and resumes automatically when it is visible again", () => {
        const { video, observer, last } = mount(); observer.visibility(true); video.dispatchEvent(new Event("playing"));
        page.hidden = true; page.dispatchEvent(new Event("visibilitychange")); expect(last().playing).toBe(false);
        page.hidden = false; page.dispatchEvent(new Event("visibilitychange")); expect(video.play).toHaveBeenCalledTimes(2);
        video.dispatchEvent(new Event("playing")); observer.visibility(false); expect(last().playing).toBe(false);
        observer.visibility(true); expect(video.play).toHaveBeenCalledTimes(3);
    });
    it("does not attach a source while the page starts hidden", () => {
        page.hidden = true;
        const { video, observer } = mount(); observer.visibility(true);
        expect(video.getAttribute("src")).toBeNull(); expect(video.play).not.toHaveBeenCalled();
        page.hidden = false; page.dispatchEvent(new Event("visibilitychange")); expect(video.play).toHaveBeenCalledOnce();
    });
    it.each(["reduced motion", "save data"])("reacts to changing %s without losing an intentional pause", preference => {
        const { video, observer, runtime, last } = mount(); observer.visibility(true); video.dispatchEvent(new Event("playing"));
        const target = preference === "reduced motion" ? motion : connection;
        if (preference === "reduced motion") motion.matches = true; else connection.saveData = true;
        target.dispatchEvent(new Event("change")); expect(last()).toMatchObject({ playing: false, ready: false });
        runtime.setIntent("pause");
        if (preference === "reduced motion") motion.matches = false; else connection.saveData = false;
        target.dispatchEvent(new Event("change")); observer.visibility(false); observer.visibility(true);
        expect(video.play).toHaveBeenCalledOnce(); expect(last().playing).toBe(false);
    });
    it("keeps the new theme still until its own video actually plays and ignores events from the disposed theme", () => {
        const first = mount(); first.observer.visibility(true); first.video.dispatchEvent(new Event("playing"));
        first.runtime.dispose(); const previous = first.states.length;
        const second = mount("auto", dark); expect(second.last()).toMatchObject({ ready: false, playing: false });
        first.video.dispatchEvent(new Event("playing")); first.observer.visibility(true); expect(first.states).toHaveLength(previous);
        expect(second.video.getAttribute("src")).toBeNull(); second.observer.visibility(true);
        expect(second.video.getAttribute("src")).toBe(dark); expect(second.last().ready).toBe(false);
        second.video.dispatchEvent(new Event("playing")); expect(second.last().ready).toBe(true);
    });
    it("preserves an intentional pause when constructing the next theme", () => {
        const first = mount(); first.observer.visibility(true); first.video.dispatchEvent(new Event("playing")); first.runtime.setIntent("pause"); first.runtime.dispose();
        const second = mount("pause", dark); second.observer.visibility(true);
        expect(second.video.getAttribute("src")).toBeNull(); expect(second.video.play).not.toHaveBeenCalled();
    });
    it("keeps a matching still after playback fails and permits a deliberate retry", async () => {
        const { video, observer, runtime, last } = mount(); video.play.mockRejectedValueOnce(new Error("autoplay blocked")); observer.visibility(true);
        await Promise.resolve(); expect(last()).toMatchObject({ playing: false, ready: false });
        runtime.setIntent("play"); expect(video.play).toHaveBeenCalledTimes(2);
        video.dispatchEvent(new Event("playing")); video.dispatchEvent(new Event("error"));
        expect(last()).toMatchObject({ playing: false, ready: false });
        observer.visibility(false); observer.visibility(true); expect(video.play).toHaveBeenCalledTimes(2);
        runtime.setIntent("play"); expect(video.load).toHaveBeenCalledOnce(); expect(video.play).toHaveBeenCalledTimes(3);
    });
    it("ignores a rejected obsolete play request after disposal", async () => {
        const { video, observer, runtime, states } = mount(); let reject!: (error: Error) => void;
        video.play.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; })); observer.visibility(true); runtime.dispose();
        const count = states.length; reject(new Error("aborted")); await Promise.resolve(); expect(states).toHaveLength(count);
    });
    it("does not let a late playing event restart media that is now hidden", () => {
        const { video, observer, last } = mount(); observer.visibility(true); page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
        video.dispatchEvent(new Event("playing")); expect(last()).toMatchObject({ playing: false, ready: false });
    });
    it("disconnects every browser listener and pauses on cleanup", () => {
        const { video, observer, runtime, states } = mount(); observer.visibility(true); runtime.dispose(); const count = states.length;
        expect(observer.disconnect).toHaveBeenCalledOnce(); expect(video.pause).toHaveBeenCalled();
        motion.dispatchEvent(new Event("change")); connection.dispatchEvent(new Event("change")); page.dispatchEvent(new Event("visibilitychange"));
        video.dispatchEvent(new Event("playing")); expect(states).toHaveLength(count); expect(video.play).toHaveBeenCalledOnce();
    });
    it("stays static without IntersectionObserver until explicitly requested", () => {
        vi.stubGlobal("IntersectionObserver", undefined);
        const { video, runtime } = mount(); expect(video.getAttribute("src")).toBeNull();
        runtime.setIntent("play"); expect(video.getAttribute("src")).toBe(light);
    });
});
