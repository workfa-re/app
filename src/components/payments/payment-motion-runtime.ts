export type MotionIntent = "auto" | "play" | "pause";
export type MotionPlayback = Readonly<{ playing: boolean; ready: boolean; reducedMotion: boolean }>;

type DataConnection = EventTarget & { saveData?: boolean };

/** One local decorative video. Browser events, rather than a render loop, own playback. */
export function createPaymentMotionRuntime(
    media: HTMLVideoElement,
    container: HTMLElement,
    source: string,
    initialIntent: MotionIntent,
    onChange: (state: MotionPlayback) => void,
) {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    let intent = initialIntent;
    let visible = false;
    let disposed = false;
    let failed = false;
    let pending = false;
    let attempt = 0;
    let playing = false;
    let ready = false;
    let published: MotionPlayback | null = null;
    const publish = () => {
        if (disposed || (published?.playing === playing && published.ready === ready && published.reducedMotion === motion.matches)) return;
        published = { playing, ready, reducedMotion: motion.matches };
        onChange(published);
    };
    const allowed = () => !disposed && !failed && visible && !document.hidden
        && intent !== "pause" && (intent === "play" || (!motion.matches && !connection?.saveData));
    const pause = (showStill = false) => {
        attempt += 1;
        pending = false;
        playing = false;
        if (showStill) ready = false;
        media.pause();
        publish();
    };
    const update = () => {
        if (!allowed()) { pause(intent !== "play" && (motion.matches || !!connection?.saveData)); return; }
        if (playing || pending) return;
        // Even preload=none can fetch once a src exists: attach it only after visibility is known.
        if (media.getAttribute("src") !== source) media.setAttribute("src", source);
        pending = true;
        const current = ++attempt;
        void media.play().catch(() => {
            if (disposed || current !== attempt) return;
            pending = false;
            playing = false;
            ready = false;
            publish();
        });
    };
    const onPlaying = () => {
        if (!allowed()) { pause(true); return; }
        pending = false;
        playing = true;
        ready = true;
        publish();
    };
    const onPause = () => { playing = false; publish(); };
    const onError = (event: Event) => {
        if (event.target !== media) return;
        failed = true;
        pause(true);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting === true;
        update();
    }, { threshold: .05 });
    media.addEventListener("playing", onPlaying);
    media.addEventListener("pause", onPause);
    media.addEventListener("error", onError);
    motion.addEventListener("change", update);
    connection?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    observer?.observe(container);
    publish();

    return {
        setIntent(next: MotionIntent) {
            if (disposed) return;
            intent = next;
            if (next === "play") {
                if (failed) media.load();
                failed = false;
                // Older browsers without an observer stay still until a deliberate play request.
                if (!observer) {
                    const bounds = container.getBoundingClientRect();
                    visible = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight;
                }
            }
            update();
        },
        dispose() {
            disposed = true;
            attempt += 1;
            observer?.disconnect();
            media.removeEventListener("playing", onPlaying);
            media.removeEventListener("pause", onPause);
            media.removeEventListener("error", onError);
            motion.removeEventListener("change", update);
            connection?.removeEventListener?.("change", update);
            document.removeEventListener("visibilitychange", update);
            media.pause();
        },
    };
}
