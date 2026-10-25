"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Download, LoaderCircle } from "lucide-react";
import { OnboardingThemeToggle } from "@/components/onboarding/OnboardingThemeToggle";
import { cancellationReceiptText, formatCancellationTimestamp, formatRequestedEnd, isCancellationReceipt, type CancellationInput, type CancellationReceipt } from "./cancellation-receipt";
import styles from "./MembershipCancellation.module.css";

type Received = { input: CancellationInput; receipt: CancellationReceipt };

export function MembershipCancellation({ initialContractReference = "", action = "cancellation" }: { initialContractReference?: string; action?: "cancellation" | "withdrawal" }) {
    const id = useId();
    const withdrawal = action === "withdrawal";
    const [kind, setKind] = useState<"ordinary" | "extraordinary">("ordinary");
    const [timing, setTiming] = useState<"earliest" | "date">("earliest");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [received, setReceived] = useState<Received | null>(null);
    const locked = useRef(false);
    const mounted = useRef(false);
    const operation = useRef<{ fingerprint: string; id: string } | null>(null);
    const request = useRef<AbortController | null>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    const receiptRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
    useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
    useEffect(() => { if (received) { receiptRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); receiptRef.current?.focus({ preventScroll: true }); } }, [received]);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (locked.current) return;
        const values = new FormData(event.currentTarget);
        const name = String(values.get("name") ?? "").trim();
        const reason = !withdrawal && kind === "extraordinary" ? String(values.get("reason") ?? "").trim() : "";
        if (withdrawal && !name) { setError("Bitte gib deinen Namen an."); return; }
        if (!withdrawal && kind === "extraordinary" && !reason) { setError("Bitte beschreibe kurz den wichtigen Grund für deine Kündigung."); return; }
        const input: CancellationInput = {
            contractReference: String(values.get("contractReference") ?? "").trim(),
            email: String(values.get("email") ?? "").trim(),
            ...(name ? { name } : {}),
            kind: withdrawal ? "withdrawal" : kind,
            ...(reason ? { reason } : {}),
            requestedEnd: !withdrawal && timing === "date" ? String(values.get("requestedEnd") ?? "") : null,
        };
        const fingerprint = JSON.stringify(input);
        if (new TextEncoder().encode(fingerprint).length > 4096) { setError("Bitte kürze deinen Text etwas und sende die Erklärung erneut."); return; }
        if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
        const controller = new AbortController();
        request.current = controller;
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        locked.current = true; setBusy(true); setError(null);
        try {
            const response = await fetch("/api/payments/membership/cancellation", {
                method: "POST", credentials: "omit", cache: "no-store", signal: controller.signal,
                headers: { "Content-Type": "application/json", "idempotency-key": operation.current.id }, body: fingerprint,
            });
            const result: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                if (response.status === 429) throw new Error("Bitte warte 15 Minuten, bevor du eine weitere Anfrage sendest.");
                if (response.status === 400 || response.status === 422) throw new Error("Bitte prüfe deine Angaben und sende die Erklärung erneut.");
                throw new Error("Der Eingang konnte gerade nicht bestätigt werden. Bitte versuche es erneut.");
            }
            if (!isCancellationReceipt(result)) throw new Error("Der Eingang konnte noch nicht bestätigt werden. Bitte versuche es erneut.");
            if (mounted.current) setReceived({ input, receipt: result });
        } catch (failure) {
            if (mounted.current) setError(failure instanceof Error && failure.name !== "AbortError" && !(failure instanceof TypeError)
                ? failure.message : "Die Verbindung ist unterbrochen. Der Eingang ist noch nicht bestätigt. Bitte versuche es erneut.");
        } finally {
            window.clearTimeout(timeout);
            if (request.current === controller) request.current = null;
            locked.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    function downloadReceipt() {
        if (!received) return;
        const url = URL.createObjectURL(new Blob([cancellationReceiptText(received.input, received.receipt)], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `workfare-${received.input.kind === "withdrawal" ? "widerruf" : "kuendigung"}-${received.receipt.reference}.txt`;
        document.body.append(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }

    return <div className={`legal-experience ${styles.page}`}>
        <div className={styles.layout}>
            <header className="legal-masthead">
                <Link href="/" className="legal-brand" aria-label="Workfare Startseite"><span className="legal-brand-symbol"><Image src="/brand/workfare-mark-compact.png" width={32} height={20} alt="" /></span><span>Workfare</span></Link>
                <div className="legal-header-actions"><Link href="/legal/workfare-plan" className="legal-return" aria-label="Bedingungen des Anbieter-Abos"><ArrowLeft size={18} aria-hidden="true" /><span>Bedingungen</span></Link><OnboardingThemeToggle className="legal-theme-toggle" /></div>
            </header>
            <main className={styles.main}>
                {received ? <section className={styles.card} aria-labelledby={`${id}-received`}>
                    <span className={styles.receivedIcon} aria-hidden="true"><Check size={23} /></span>
                    <h1 id={`${id}-received`} ref={receiptRef} tabIndex={-1}>{received.input.kind === "withdrawal" ? "Widerruf eingegangen." : "Kündigung eingegangen."}</h1>
                    <p className={styles.intro}>Hier kannst du deine Erklärung und den Eingang speichern.</p>
                    <dl className={styles.receipt}>
                        <div><dt>Eingegangen</dt><dd>{formatCancellationTimestamp(received.receipt.receivedAt)}</dd></div>
                        <div><dt>Eingangsreferenz</dt><dd>{received.receipt.reference}</dd></div>
                        <div><dt>Vertragsreferenz</dt><dd>{received.input.contractReference}</dd></div>
                        <div><dt>E-Mail</dt><dd>{received.input.email}</dd></div>
                        {received.input.name && <div><dt>Name</dt><dd>{received.input.name}</dd></div>}
                        <div><dt>Art</dt><dd>{received.input.kind === "withdrawal" ? "Widerruf" : received.input.kind === "ordinary" ? "Ordentliche Kündigung" : "Außerordentliche Kündigung"}</dd></div>
                        {received.input.kind !== "withdrawal" && <div><dt>Gewünschter Zeitpunkt</dt><dd>{formatRequestedEnd(received.input.requestedEnd)}</dd></div>}
                        {received.input.kind !== "withdrawal" && received.input.reason && <div><dt>Dein Grund</dt><dd className={styles.reason}>{received.input.reason}</dd></div>}
                    </dl>
                    <p className={styles.note}>{received.input.kind === "withdrawal" ? "Diese Bestätigung dokumentiert den Eingang deines Widerrufs. Wir prüfen die Zuordnung und bearbeiten deine Erklärung anschließend." : "Diese Bestätigung dokumentiert den Eingang deiner Erklärung. Die Zuordnung und das Vertragsende werden anschließend geprüft."}</p>
                    <button type="button" className={styles.primary} onClick={downloadReceipt}><Download size={18} aria-hidden="true" />Bestätigung speichern</button>
                </section> : <>
                    <div className={styles.heading}><h1>{withdrawal ? "Vertrag widerrufen" : "Abo kündigen"}</h1><p>Für dein Anbieter-Abo bei Workfare. Ohne Anmeldung.</p></div>
                    <form onSubmit={submit} className={styles.card} aria-busy={busy}>
                        <fieldset disabled={busy} className={styles.fields}>
                            <label htmlFor={`${id}-reference`}><span id={`${id}-reference-label`} className={styles.fieldLabel}>Vertragsreferenz</span><input id={`${id}-reference`} name="contractReference" type="text" required maxLength={36} defaultValue={initialContractReference} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-labelledby={`${id}-reference-label`} aria-describedby={`${id}-reference-help`} /><small id={`${id}-reference-help`}>Die Referenz findest du in deiner Bestätigung oder bei deinem Abo.</small></label>
                            <label htmlFor={`${id}-email`}>E-Mail-Adresse<input id={`${id}-email`} name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} /></label>
                            <label htmlFor={`${id}-name`}>Dein Name {!withdrawal && <span>optional</span>}<input id={`${id}-name`} name="name" type="text" required={withdrawal} maxLength={150} autoComplete="name" /></label>
                            {!withdrawal && <><label htmlFor={`${id}-kind`}>Art der Kündigung<select id={`${id}-kind`} name="kind" value={kind} onChange={event => setKind(event.target.value as "ordinary" | "extraordinary")}><option value="ordinary">Ordentlich</option><option value="extraordinary">Aus wichtigem Grund</option></select></label>
                                {kind === "extraordinary" && <label htmlFor={`${id}-reason`}>Dein Grund<textarea id={`${id}-reason`} name="reason" rows={4} required maxLength={2000} /></label>}
                                <label htmlFor={`${id}-timing`}>Gewünschter Zeitpunkt<select id={`${id}-timing`} value={timing} onChange={event => setTiming(event.target.value as "earliest" | "date")}><option value="earliest">Zum frühestmöglichen Zeitpunkt</option><option value="date">Anderer Zeitpunkt</option></select></label>
                                {timing === "date" && <label htmlFor={`${id}-date`}>Gewünschtes Datum<input id={`${id}-date`} name="requestedEnd" type="date" required /></label>}</>}
                            <button type="submit" className={styles.primary}>{busy && <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" />}{busy ? "Wird gesendet …" : withdrawal ? "Widerruf bestätigen" : "Jetzt kündigen"}</button>
                        </fieldset>
                        {error && <p ref={errorRef} tabIndex={-1} className={styles.error} role="alert">{error}</p>}
                    </form>
                </>}
                <footer className={styles.footer}><Link href="/legal">Rechtliches</Link><Link href="/legal/datenschutz">Datenschutz</Link></footer>
            </main>
        </div>
    </div>;
}
