"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, CircleHelp, CalendarRange, Users, WalletCards } from "lucide-react";
import type { PaymentSettingsSnapshot } from "@/lib/payments/repository.server";
import type { RecipientSettingsSnapshot } from "@/lib/payments/recipient-types";
import { sanitizePaymentReturnPath } from "@/lib/payments/return-path";
import { followGlassPointer } from "@/lib/glass-pointer";
import { BuyerPaymentMethod } from "./BuyerPaymentMethod";
import { RecipientPayments } from "./RecipientPayments";
import { RecipientSummaryProvider } from "./RecipientOverview";
import { PayWordmark } from "./PayWordmark";
import { PaymentMotion } from "./PaymentMotion";
import { PaymentProviderBrand } from "./PaymentProviderBrand";
import { PaymentEnvironment, type PaymentSurfaceKind } from "./PaymentEnvironment";
import styles from "./Payments.module.css";

const BuyerAccountPanel = dynamic(() => import("./BuyerAccountPanel"), { loading: () => <div className={styles.utilitySection}><p className={styles.utilityLoading} role="status">Zahlungen werden geladen …</p></div> });

type Props = {
    snapshot: PaymentSettingsSnapshot;
    recipientSnapshot?: RecipientSettingsSnapshot | null;
    role: "job_provider" | "job_seeker" | "guardian";
    returnTo: string | null;
    result: "success" | "canceled" | "unconfirmed" | null;
    resumeSetupId?: string | null;
    ownerId?: string;
    recipientHostedReturned?: boolean;
};

export function PaymentQuestions({ recipient, kind }: { recipient: boolean; kind: PaymentSurfaceKind }) {
    return <details className={`${styles.questions} ${styles.utilitySection}`}>
        <summary className={styles.settingsRow}><span className={`app-glass-control ${styles.rowIcon}`}><CircleHelp size={21} aria-hidden="true" /></span><span>Fragen zu Workfare Pay</span><ChevronRight size={18} className={styles.rowArrow} aria-hidden="true" /></summary>
        <div className={styles.answers}>
            <h3>{recipient ? "Wann kommt meine Vergütung an?" : "Wird beim Einrichten etwas abgebucht?"}</h3>
            <p>{recipient ? <>Nach der Zahlung kann die Vergütung zunächst in Bearbeitung sein. Erst verfügbare Beträge werden nach deinem Auszahlungstag oder auf deinen Wunsch an deine Bank überwiesen. Den aktuellen Stand siehst du in der Zahlungsübersicht.{kind === "sandbox" ? " Im Testbetrieb wird kein echtes Geld bewegt." : kind === "local" ? " In der lokalen Simulation wird kein echtes Geld bewegt." : ""}</> : "Nein. Du hinterlegst nur dein Zahlungsmittel. Vor einer Zahlung siehst du Vergütung, Servicegebühr und Gesamtbetrag und bestätigst den Vorgang gesondert."}</p>
            <h3>Wo bleiben meine Daten?</h3>
            <p>Vollständige Karten-, Bank- und erforderliche Prüfdaten gibst du direkt bei Stripe ein. Sie gehören nicht in dein öffentliches Profil oder den Chat.{kind === "local" ? " Die lokale Simulation benötigt keine solchen Daten." : ""}</p>
            <h3>Bin ich dadurch verifiziert?</h3>
            <p>Ein Zahlungsmittel bestätigt keine Identität oder Wohnadresse. Die nötigen Prüfungen bleiben getrennt. Für Minderjährige muss zusätzlich das passende Auszahlungsmodell freigegeben sein.</p>
            <Link href="/legal/datenschutz" prefetch={false}>Datenschutzhinweise<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
    </details>;
}

export function PaymentSettingsUnavailable() {
    return <div className={styles.page} onPointerMove={followGlassPointer}><Link className={`app-glass-control ${styles.back}`} href="/app-home/settings"><ArrowLeft size={18} aria-hidden="true" />Einstellungen</Link><header className={styles.header}><h1><PayWordmark /></h1></header><section className={styles.surface}><h2>Der aktuelle Stand ist gerade nicht verfügbar.</h2><p className={styles.smallCopy}>Bitte lade ihn erneut, bevor du fortfährst.</p><a href="/app-home/settings/payments" className={`app-glass-control ${styles.action}`}>Erneut laden<ArrowRight size={17} /></a></section></div>;
}

export function PaymentSettings({ snapshot, recipientSnapshot, role, returnTo, result, resumeSetupId, ownerId, recipientHostedReturned }: Props) {
    const router = useRouter();
    const [accountVersion, setAccountVersion] = useState(0);
    const methodChanged = useCallback(() => setAccountVersion(value => value + 1), []);
    const provider = role === "job_provider";
    const kind = provider ? snapshot.kind : recipientSnapshot?.kind ?? snapshot.kind;
    const questions = <PaymentQuestions recipient={!provider} kind={kind} />;
    useEffect(() => {
        // Next can retain the settings page's scroll position under the fixed
        // mobile navigation. Start this surface at its heading, once per mount.
        const frame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
        return () => cancelAnimationFrame(frame);
    }, []);
    useEffect(() => {
        const destination = sanitizePaymentReturnPath(returnTo);
        if (provider && result === "success" && snapshot.buyerReady && snapshot.method && destination) {
            router.replace(destination); router.refresh();
        }
    }, [provider, result, returnTo, router, snapshot.buyerReady, snapshot.method]);

    function renderUtilities(recipientTools?: ReactNode) {
        return <section className={`${styles.surface} ${styles.utilityGroup}`} aria-label="Workfare Pay verwalten">
            {provider && <>
                {(snapshot.featureEnabled || snapshot.setupEnabled === true) && <BuyerAccountPanel ownerId={ownerId} kind={snapshot.kind} version={accountVersion} />}
                <Link href="/app-home/settings/membership" prefetch={false} className={`${styles.settingsRow} ${styles.utilitySection} ${styles.planEntry}`}>
                    <span className={`app-glass-control ${styles.rowIcon}`} aria-hidden="true"><CalendarRange size={21} strokeWidth={1.5} /></span>
                    <span>Gebühren &amp; Abo</span><ChevronRight size={18} className={styles.rowArrow} aria-hidden="true" />
                </Link>
            </>}
            {recipientTools}
            <details className={`${styles.utilitySection} ${styles.outlook}`}>
                <summary className={styles.settingsRow}><span className={`app-glass-control ${styles.rowIcon}`} aria-hidden="true"><WalletCards size={21} strokeWidth={1.5} /></span><span>Konto &amp; Karte</span><ChevronRight size={18} className={styles.rowArrow} aria-hidden="true" /></summary>
                <div className={styles.outlookBody}><p>Wir arbeiten an einem eigenen Zahlungskonto mit Workfare Pay Karte. Neuigkeiten findest du hier.</p></div>
            </details>
            {questions}
        </section>;
    }

    const page = <div className={`${styles.page} ${styles.workspace}`} onPointerMove={followGlassPointer}>
        <Link href={returnTo || "/app-home/settings"} prefetch={false} className={`app-glass-control ${styles.back}`}><ArrowLeft size={18} aria-hidden="true" />{returnTo ? "Zum Job" : "Einstellungen"}</Link>
        <header className={`${styles.header} ${styles.hero}`}><div className={styles.heroCopy}><h1><PayWordmark /></h1><PaymentEnvironment kind={kind} className={styles.environment} /></div><PaymentMotion /></header>
        <div className={styles.stack} key={kind}>
            {result === "canceled" && <p role="status" className={styles.feedback}>Einrichtung abgebrochen. Dein bisheriger Stand bleibt erhalten.</p>}
            {result === "unconfirmed" && <p role="status" className={styles.notice}>Die Einrichtung ist noch nicht bestätigt. Prüfe den aktuellen Stand, bevor du fortfährst.</p>}
            {provider ? <>
                <BuyerPaymentMethod key={ownerId} ownerId={ownerId} initial={snapshot} returnTo={returnTo} resumeSetupId={resumeSetupId} onChanged={methodChanged} />
                {renderUtilities()}
            </> : role === "job_seeker" ? <RecipientPayments initial={recipientSnapshot ?? null} returnTo={returnTo} ownerId={ownerId} hostedReturned={recipientHostedReturned} renderUtilities={renderUtilities} /> : <>
                <section className={styles.surface}><div className={styles.familyRow}><span className={`app-glass-control ${styles.familyIcon}`}><Users size={24} aria-hidden="true" /></span><div className={styles.identity}><strong>Freigaben und Auszahlungen</strong><span>Verwalte die Freigaben und die Auszahlungseinrichtung deiner Kinder im Familienbereich.</span></div><Link href="/guardian/access" className={`app-glass-control ${styles.action}`}>Familienbereich öffnen<ArrowRight size={17} /></Link></div></section>
                {renderUtilities()}
            </>}
        </div>
        <PaymentProviderBrand kind={kind} />
    </div>;

    return role === "job_seeker" && ownerId && recipientSnapshot && kind !== "disabled"
        ? <RecipientSummaryProvider key={`${ownerId}:${kind}`} ownerId={ownerId} kind={kind}>{page}</RecipientSummaryProvider>
        : page;
}
