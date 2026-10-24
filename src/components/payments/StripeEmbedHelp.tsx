import { RefreshCw } from "lucide-react";
import styles from "./Payments.module.css";

/** Recovery never treats closing a Stripe window as successful verification. */
export function StripeEmbedHelp({ failed = false, slow = false, onRetry, onClose, headerControls = false }: {
    failed?: boolean; slow?: boolean; onRetry: () => void; onClose: () => void; headerControls?: boolean;
}) {
    if (!failed && !slow) return null;
    const actions = <div className={styles.editorActions}>
        <button type="button" className={`app-glass-control ${styles.action}`} onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Stripe neu laden</button>
        <button type="button" className={styles.quietButton} onClick={onClose}>Zurück zur Übersicht</button>
    </div>;
    return <div className={styles.embedRecovery}>
        <p role={failed ? "alert" : "status"}>{failed
            ? "Stripe konnte nicht geladen werden. Dein bisheriger Stand bleibt erhalten."
            : "Stripe braucht länger. Prüfe, ob dein Browser das Stripe-Fenster blockiert hat."}</p>
        {!headerControls && actions}
    </div>;
}
