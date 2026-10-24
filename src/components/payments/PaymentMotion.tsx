"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/providers/ThemeProvider";
import styles from "./Payments.module.css";

/** Decorative local media: no third-party player, audio, tracking or financial claims. */
export function PaymentMotion() {
    const { resolvedTheme, isHydrated } = useTheme();
    const container = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [visible, setVisible] = useState(true);
    const [intersects, setIntersects] = useState(true);
    const [readyTheme, setReadyTheme] = useState<string | null>(null);
    const theme = resolvedTheme === "dark" ? "dark" : "light";

    useEffect(() => {
        const motion = matchMedia("(prefers-reduced-motion: reduce)");
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        const preference = () => setPlaying(!motion.matches && !connection?.saveData);
        const visibility = () => setVisible(document.visibilityState !== "hidden");
        preference(); visibility();
        motion.addEventListener("change", preference);
        document.addEventListener("visibilitychange", visibility);
        return () => { motion.removeEventListener("change", preference); document.removeEventListener("visibilitychange", visibility); };
    }, []);
    useEffect(() => {
        if (!container.current || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(([entry]) => setIntersects(entry.isIntersecting), { threshold: .05 });
        observer.observe(container.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const element = video.current;
        if (!element || !isHydrated) return;
        let current = true;
        if (playing && visible && intersects) void element.play().catch(() => { if (current) setPlaying(false); });
        else element.pause();
        return () => { current = false; element.pause(); };
    }, [playing, visible, intersects, theme, isHydrated]);

    return <div ref={container} className={styles.motion}>
        <div className={styles.motionVisual} aria-hidden="true">
            <Image src="/media/pay/workfare-pay-glass-light.jpg" alt="" fill sizes="(max-width: 600px) 100vw, 1100px" className={styles.posterLight} />
            <Image src="/media/pay/workfare-pay-glass-dark.jpg" alt="" fill sizes="(max-width: 600px) 100vw, 1100px" className={styles.posterDark} />
            <video ref={video} key={theme} muted playsInline loop preload="none" tabIndex={-1}
                src={isHydrated ? `/media/pay/workfare-pay-glass-${theme}.mp4` : undefined}
                onLoadedData={() => setReadyTheme(theme)} className={styles.motionVideo} data-ready={readyTheme === theme} />
        </div>
        <button type="button" className={styles.motionToggle} aria-label={playing ? "Animation pausieren" : "Animation abspielen"}
            onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}</button>
    </div>;
}
