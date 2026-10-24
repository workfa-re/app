import styles from "./PayWordmark.module.css";

/** Uses the platform's Inter wordmark, with a quieter product descriptor. */
export function PayWordmark() {
    return <span className={styles.wordmark}><span>Workfare</span>{" "}<span className={styles.pay}>Pay</span></span>;
}
