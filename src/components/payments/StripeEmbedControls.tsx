"use client";

import type { RefObject } from "react";
import { RefreshCw } from "lucide-react";
import styles from "./Payments.module.css";

export type StripeEmbedControls = { reload: () => void };

/** Retries the mounted Stripe region; a failed chunk can fall back to a page reload. */
export function StripeReloadButton({ controls, disabled = false }: {
    controls: RefObject<StripeEmbedControls | null>; disabled?: boolean;
}) {
    return <button type="button" className={`app-glass-control ${styles.iconButton}`} disabled={disabled}
        aria-label="Stripe-Bereich neu laden" title="Neu laden"
        onClick={() => controls.current ? controls.current.reload() : window.location.reload()}>
        <RefreshCw size={17} aria-hidden="true" />
    </button>;
}
