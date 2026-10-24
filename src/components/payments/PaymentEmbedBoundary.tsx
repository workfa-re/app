"use client";
import { Component, type ReactNode } from "react";
import styles from "./Payments.module.css";

/** Keeps a failed chunk/render inside the payment region, with explicit recovery. */
export class PaymentEmbedBoundary extends Component<{ children: ReactNode; onCancel: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { /* Never log provider exceptions, secrets or bank details. */ }
    render() {
        if (!this.state.failed) return this.props.children;
        return <div role="alert" className={styles.notice}><p>Stripe konnte gerade nicht geladen werden. Du kannst die Seite neu laden oder die Einrichtung schließen.</p>
            <div className={styles.editorActions}><button type="button" className={`app-glass-control ${styles.action}`} onClick={() => window.location.reload()}>Seite neu laden</button>
                <button type="button" className={styles.quietButton} onClick={this.props.onCancel}>Bereich schließen</button></div></div>;
    }
}
