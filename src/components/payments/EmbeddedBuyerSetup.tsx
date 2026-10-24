"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { mountBuyerCheckout } from "./buyer-checkout-mount";
import styles from "./Payments.module.css";
import { StripeEmbedHelp } from "./StripeEmbedHelp";

const loaders = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string) {
    let loader = loaders.get(key);
    if (!loader) {
        loader = loadStripe(key).then(stripe => { if (!stripe) loaders.delete(key); return stripe; }, () => {
            loaders.delete(key); throw new Error("stripe_loader_unavailable");
        });
        loaders.set(key, loader);
    }
    return loader;
}

export default function EmbeddedBuyerSetup({ publishableKey, clientSecret, onComplete, onCancel }: {
    publishableKey: string; clientSecret: string; onComplete: () => void; onCancel: () => void;
}) {
    const targetRef = useRef<HTMLDivElement>(null);
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    useEffect(() => {
        if (!targetRef.current) return;
        return mountBuyerCheckout({ load: () => stripeFor(publishableKey), target: targetRef.current, clientSecret, onComplete,
            onReady: () => setStatus("ready"), onError: () => setStatus("error") });
    }, [publishableKey, clientSecret, onComplete, attempt]);
    const retry = () => { loaders.delete(publishableKey); setStatus("loading"); setAttempt(value => value + 1); };
    return <div className={styles.embedFrame} aria-busy={status === "loading"}>
        {status === "loading" && <p role="status" className={styles.loading}>Stripe wird geladen …</p>}
        <div ref={targetRef} hidden={status === "error"} />
        <StripeEmbedHelp failed={status === "error"} onRetry={retry} onClose={onCancel} />
    </div>;
}
