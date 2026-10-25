import { ArrowRight } from "lucide-react";
import type { PaymentSurfaceKind } from "./PaymentEnvironment";
import { PayWordmark } from "./PayWordmark";
import styles from "./PaymentProviderBrand.module.css";

/** Shared product and processor branding, separate from financial readiness. */
export function PaymentProviderBrand({ kind }: { kind?: PaymentSurfaceKind }) {
    return <div className={styles.provider}>
        {kind === "local" ? <span>Lokaler Test ohne Verbindung zu Stripe</span> : kind === "disabled" ? <PayWordmark /> : <>
            <div className={styles.providerBrand} aria-label="Workfare Pay mit Stripe"><PayWordmark /><span className={styles.providerCross} aria-hidden="true">×</span><span className={styles.stripeWordmark}>stripe</span></div>
            <a href="https://stripe.com/de" target="_blank" rel="noopener noreferrer" className={styles.providerLink}>Über Stripe<ArrowRight size={13} aria-hidden="true" /></a>
        </>}
    </div>;
}
