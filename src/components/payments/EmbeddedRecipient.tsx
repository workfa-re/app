"use client";

import { useEffect, useRef, useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js/pure";
import { ConnectAccountManagement, ConnectAccountOnboarding, ConnectBalances, ConnectComponentsProvider, ConnectNotificationBanner, ConnectPayoutsList } from "@stripe/react-connect-js";
import { useTheme } from "@/components/providers/ThemeProvider";
import type { RecipientComponent } from "@/lib/payments/recipient-types";
import { paymentRequest } from "./payment-client";
import { createRecipientConnectSession } from "./recipient-connect-lifecycle";
import { StripeEmbedHelp } from "./StripeEmbedHelp";
import { type StripeSurfaceKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";

function appearance(dark: boolean) {
    return { variables: {
        fontFamily: "Inter, system-ui, sans-serif", fontSizeBase: "15px", spacingUnit: "8px", borderRadius: "16px",
        colorPrimary: dark ? "#b6ceec" : "#164e85", colorBackground: dark ? "#101010" : "#fafafa",
        colorText: dark ? "#f3f3f3" : "#191919", colorSecondaryText: dark ? "#adadad" : "#626262",
        colorBorder: dark ? "#303030" : "#dedede", buttonPrimaryColorBackground: dark ? "#f2f2f2" : "#202020",
        buttonPrimaryColorText: dark ? "#101010" : "#ffffff", buttonPrimaryColorBorder: dark ? "#f2f2f2" : "#202020",
        buttonSecondaryColorBackground: dark ? "#151515" : "#f8f8f8", buttonSecondaryColorText: dark ? "#f2f2f2" : "#202020",
        buttonBorderRadius: "24px", formBorderRadius: "16px", overlayBorderRadius: "24px",
    } };
}

type Props = { kind: StripeSurfaceKind; publishableKey: string; clientSecret: string; component: RecipientComponent; ownerId?: string; onExit: () => void; onError: () => void; onRetry?: () => void };

export default function EmbeddedRecipient(props: Props) {
    const [attempt, setAttempt] = useState(0);
    return <RecipientConnectFrame key={attempt} {...props} firstAttempt={attempt === 0} retry={() => { props.onRetry?.(); setAttempt(value => value + 1); }} />;
}

function RecipientConnectFrame({ kind, publishableKey, clientSecret, component, ownerId, onExit, onError, firstAttempt, retry }: Props & { firstAttempt: boolean; retry: () => void }) {
    const { resolvedTheme } = useTheme();
    const [failed, setFailed] = useState(false);
    const [slow, setSlow] = useState(false);
    const started = useRef(false);
    const loaderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [instance] = useState(() => {
        let first: string | null = firstAttempt ? clientSecret : null;
        return createRecipientConnectSession(ownerId, assertCurrentOwner => loadConnectAndInitialize({ publishableKey, locale: "de-DE", appearance: appearance(resolvedTheme === "dark"),
            fetchClientSecret: async () => {
                assertCurrentOwner();
                if (first) { const secret = first; first = null; return secret; }
                const result = await paymentRequest<{ kind: string; clientSecret: string }>("/api/payments/recipient/session", { component, consent: true }, crypto.randomUUID(), ownerId ?? "");
                assertCurrentOwner();
                if (result.kind !== kind || typeof result.clientSecret !== "string" || !result.clientSecret || result.clientSecret.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(result.clientSecret)) throw new Error("session_unavailable");
                return result.clientSecret;
            },
        }));
    });
    useEffect(() => { instance.update({ appearance: appearance(resolvedTheme === "dark") }); }, [instance, resolvedTheme]);
    useEffect(() => {
        if (started.current) return;
        loaderTimer.current = setTimeout(() => setSlow(true), 30_000);
        return () => { if (loaderTimer.current !== null) clearTimeout(loaderTimer.current); };
    }, []);
    function loaderStarted() { started.current = true; if (loaderTimer.current !== null) clearTimeout(loaderTimer.current); setSlow(false); }
    function loadFailed() { setFailed(true); onError(); }
    // Connect owns its automatic height, authentication popup and required fields.
    // Unmounting a component must not invalidate the user's Stripe authentication.
    return <div className={styles.embedFrame}>
        {!failed && <ConnectComponentsProvider connectInstance={instance}>
            {component === "onboarding" ? <ConnectAccountOnboarding onExit={onExit} onLoadError={loadFailed} onLoaderStart={loaderStarted} />
                : component === "management" ? <ConnectAccountManagement onLoadError={loadFailed} onLoaderStart={loaderStarted} />
                    : component === "balances" ? <ConnectBalances onLoadError={loadFailed} onLoaderStart={loaderStarted} /> : component === "notification_banner" ? <ConnectNotificationBanner onLoadError={loadFailed} onLoaderStart={loaderStarted} /> : <ConnectPayoutsList onLoadError={loadFailed} onLoaderStart={loaderStarted} />}
        </ConnectComponentsProvider>}
        <StripeEmbedHelp failed={failed} slow={slow} onRetry={retry} onClose={onExit} />
    </div>;
}
