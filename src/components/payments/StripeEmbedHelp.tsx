import { RefreshCw } from "lucide-react";
import styles from "./Payments.module.css";

/** Recovery never treats closing a Stripe window as successful verification. */
export function StripeEmbedHelp({ failed = false, slow = false, onRetry, onClose }: {
    failed?: boolean; slow?: boolean; onRetry: () => void; onClose: () => void;
}) {
    const actions = <div className={styles.editorActions}>
        <button type="button" className={`app-glass-control ${styles.action}`} onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Stripe neu laden</button>
        <button type="button" className={styles.quietButton} onClick={onClose}>Zurück zur Übersicht</button>
    </div>;
    if (failed) return <div className={styles.embedRecovery}><p role="alert">Dieser Stripe-Bereich konnte nicht geladen werden. Dein bisheriger Stand bleibt erhalten.</p>{actions}</div>;
    return <details className={styles.embedHelp} open={slow || undefined}>
        <summary>{slow ? "Stripe braucht länger als erwartet" : "Probleme beim Öffnen?"}</summary>
        <p>Stripe kann zur Anmeldung ein eigenes Fenster öffnen. Prüfe, ob dein Browser es blockiert hat. Wenn du dort fertig bist, kehre hierher zurück. Wir prüfen deinen Stand anschließend bei Stripe.</p>
        {actions}
    </details>;
}
