import type { Stripe, StripeEmbeddedCheckout } from "@stripe/stripe-js";

/** Async provider failures need explicit handling; React boundaries cannot catch them. */
export function mountBuyerCheckout(input: {
    load: () => Promise<Stripe | null>; target: HTMLElement; clientSecret: string;
    onComplete: () => void; onReady: () => void; onError: () => void;
    timeoutMs?: number;
}) {
    let disposed = false;
    let failed = false;
    let completed = false;
    let instance: StripeEmbeddedCheckout | null = null;
    const destroy = () => {
        const current = instance; instance = null;
        try { current?.destroy(); } catch { /* Unmount stays safe after a provider failure. */ }
    };
    const fail = () => {
        if (disposed || failed) return;
        failed = true; clearTimeout(timer); destroy(); input.onError();
    };
    const timer = setTimeout(fail, input.timeoutMs ?? 20_000);
    void (async () => {
        try {
            const stripe = await input.load();
            if (disposed || failed) return;
            if (!stripe) { fail(); return; }
            const checkout = await stripe.createEmbeddedCheckoutPage({ clientSecret: input.clientSecret, onComplete: () => {
                if (!disposed && !failed && !completed) { completed = true; input.onComplete(); }
            } });
            if (disposed || failed) { try { checkout.destroy(); } catch { /* Late initialization is discarded. */ } return; }
            instance = checkout;
            checkout.mount(input.target);
            clearTimeout(timer);
            input.onReady();
        } catch {
            // Provider exceptions can contain the client secret or contact data.
            // Only a generic failure reaches React, never the original exception.
            clearTimeout(timer); fail();
        }
    })();
    return () => { disposed = true; clearTimeout(timer); destroy(); };
}
