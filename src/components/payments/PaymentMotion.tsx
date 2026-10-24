"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/providers/ThemeProvider";
import { createPaymentMotionRuntime, type MotionIntent, type MotionPlayback } from "./payment-motion-runtime";
import styles from "./Payments.module.css";

/** Decorative local media: no third-party player, audio, tracking or financial claims. */
export function PaymentMotion() {
    const { resolvedTheme, isHydrated } = useTheme();
    const container = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const intent = useRef<MotionIntent>("auto");
    const runtime = useRef<ReturnType<typeof createPaymentMotionRuntime> | null>(null);
    const [playback, setPlayback] = useState<MotionPlayback & { theme: string } | null>(null);
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    const playing = playback?.theme === theme && playback.playing;
    const ready = playback?.theme === theme && playback.ready;
    const reduceMotion = playback?.reducedMotion ?? true;
    useEffect(() => {
        const element = video.current;
        const parent = container.current;
        if (!element || !parent || !isHydrated) return;
        const controller = createPaymentMotionRuntime(element, parent, `/media/pay/v5/workfare-pay-material-v5-${theme}.mp4`, intent.current,
            (state) => setPlayback({ ...state, theme }));
        runtime.current = controller;
        return () => { controller.dispose(); if (runtime.current === controller) runtime.current = null; };
    }, [theme, isHydrated]);

    return <div ref={container} className={styles.motion}>
        <div className={styles.motionVisual} data-ready={ready} aria-hidden="true">
            <Image src="/media/pay/v5/workfare-pay-material-v5-light.webp" alt="" fill sizes="(max-width: 600px) 139px, 208px" className={styles.posterLight} />
            <Image src="/media/pay/v5/workfare-pay-material-v5-dark.webp" alt="" fill sizes="(max-width: 600px) 139px, 208px" className={styles.posterDark} />
            <video ref={video} key={theme} muted playsInline loop preload="none" tabIndex={-1}
                poster={`/media/pay/v5/workfare-pay-material-v5-${theme}.webp`} className={styles.motionVideo} data-ready={ready} />
        </div>
        <button type="button" className={`app-glass-control ${styles.motionToggle}`} aria-pressed={playing} aria-label={playing ? "Animation pausieren" : "Animation abspielen"}
            onClick={() => { intent.current = playing ? "pause" : "play"; runtime.current?.setIntent(intent.current); }}>
            <AnimatePresence initial={false}>
                <motion.span key={playing ? "pause" : "play"} style={{ gridArea: "1 / 1", display: "grid", placeItems: "center" }}
                    initial={reduceMotion ? false : { opacity: 0, scale: .25, filter: "blur(4px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: .25, filter: "blur(4px)" }} transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: .3, bounce: 0 }}>
                    {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                </motion.span>
            </AnimatePresence>
        </button>
    </div>;
}
