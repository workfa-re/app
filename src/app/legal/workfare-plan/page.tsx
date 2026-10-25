import Link from "next/link";
import { LegalHero, LegalSection, LegalStamp } from "@/components/legal/LegalContent";
import { BRAND_EMAIL } from "@/lib/constants";

export const dynamic = "force-static";
export const metadata = { title: "Workfare Plan · Bedingungen und Widerruf | Workfare" };

export default function WorkfarePlanTerms() {
    return <>
        <LegalHero title="Workfare Plan" description="Bedingungen für die freiwillige Mitgliedschaft von Jobanbietern." />
        <LegalSection title="Anbieter und Leistung">
            <p>Vertragspartner ist der im <Link href="/legal/impressum">Impressum</Link> genannte Anbieter von Workfare. Workfare Plan ist eine optionale Mitgliedschaft für volljährige Jobanbieter. Die normale Plattformnutzung bleibt auch ohne Mitgliedschaft vollständig möglich.</p>
            <p>Während eines bezahlten aktiven Zeitraums entfällt der Workfare-Anteil von sechs Prozentpunkten bei neuen Preisvorschlägen für Jobs, die ab Einführung des neuen Tarifs angelegt wurden. Für Abwicklung und Betrieb bleibt die allgemeine Servicegebühr von 6 % der vereinbarten Vergütung plus 0,49 € je Job. Diese gilt unabhängig vom Zahlungsmittel. Jobsuchende erhalten weiterhin die volle vereinbarte Vergütung.</p>
            <p>Jeder Gebührenanteil wird je Job auf Cent gerundet. Bereits vorhandene Jobs behalten ihren bisherigen Tarif. Bereits erstellte Preisvorschläge behalten zusätzlich ihren bestätigten Gebührenstand. Ein späterer Abschluss oder eine spätere Kündigung der Mitgliedschaft verändert diese Preise nicht. Geplante zusätzliche Leistungen sind bis zu ihrer ausdrücklichen Freigabe nicht Teil der bezahlten Mitgliedschaft.</p>
        </LegalSection>
        <LegalSection title="Preis, Beginn und Laufzeit">
            <p>Workfare Plan kostet 5,90 € pro Monat als Gesamtpreis. Soweit Umsatzsteuer anfällt, ist sie in diesem Endpreis enthalten. Die Abrechnung erfolgt im Voraus über Stripe. Es gibt keine kostenlose Testphase und keine jährliche Mindestbindung.</p>
            <p>Vor dem verbindlichen Kauf werden Preis, monatliche Verlängerung und Kündigungsmöglichkeit angezeigt. Die Mitgliedschaft beginnt mit bestätigter Zahlung. Eine bloße Weiterleitung oder Rückkehr von Stripe bestätigt noch keine Zahlung. Der individuelle Zeitraum und die nächste Verlängerung sind in der Mitgliedschaftsübersicht sichtbar.</p>
            <p>Die Mitgliedschaft verlängert sich monatlich, sofern sie nicht vor der nächsten Verlängerung gekündigt wurde. Es besteht keine Verpflichtung, Jobs zu veröffentlichen oder eine Mindestzahl von Aufträgen zu bezahlen. Ob sich die Mitgliedschaft lohnt, hängt von der eigenen Nutzung ab; eine Ersparnis wird nicht garantiert.</p>
        </LegalSection>
        <LegalSection title="Kündigung">
            <p>Du kannst die Mitgliedschaft jederzeit zum Ende des bezahlten Zeitraums kündigen. Die Vorteile bleiben bis zu diesem Zeitpunkt erhalten; danach wird kein weiterer Mitgliedsbeitrag eingezogen. Die Kündigung ist in deinem Konto oder ohne Anmeldung über <Link href="/membership/cancel">Verträge hier kündigen</Link> möglich. Eine E-Mail an <a href={`mailto:${BRAND_EMAIL}`}>{BRAND_EMAIL}</a> ist ebenfalls möglich.</p>
            <p>Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt bestehen. Eine gewünschte frühere Beendigung oder Erstattung wird anhand des konkreten Falls geprüft. Der Eingang einer Erklärung und die tatsächliche Vertragsbeendigung werden voneinander unterschieden.</p>
        </LegalSection>
        <LegalSection title="Zahlungen und Änderungen">
            <p>Bleibt eine Folgezahlung aus, werden keine neuen Vorteile über den bereits bezahlten Zeitraum hinaus gewährt. Ein technischer Prüfbedarf kann eine erneute Statusprüfung erfordern. Bestehende Jobvergütungen und bereits vereinbarte Preise bleiben davon unberührt.</p>
            <p>Preis- oder Leistungsänderungen werden nicht rückwirkend angewendet. Änderungen eines laufenden Mitgliedschaftsvertrags erfolgen nur nach den dafür geltenden gesetzlichen und vertraglichen Voraussetzungen. Aus einem geplanten Konto oder einer geplanten Karte entsteht kein Anspruch auf deren Verfügbarkeit zu einem bestimmten Termin.</p>
        </LegalSection>
        <LegalSection title="Widerrufsbelehrung" id="widerruf">
            <p>Als Verbraucher hast du das Recht, den Mitgliedschaftsvertrag innerhalb von 14 Tagen ab Vertragsschluss ohne Angabe von Gründen zu widerrufen. Informiere uns dafür mit einer eindeutigen Erklärung, zum Beispiel per E-Mail an <a href={`mailto:${BRAND_EMAIL}`}>{BRAND_EMAIL}</a> oder per Post an die im <Link href="/legal/impressum">Impressum</Link> genannte Anschrift. Rechtzeitig ist der Widerruf, wenn du die Erklärung vor Ablauf der Frist absendest.</p>
            <p>Du kannst den Widerruf auch über <Link href="/membership/withdraw">Vertrag widerrufen</Link> ohne Anmeldung erklären. Wir bestätigen den Eingang mit Inhalt, Datum und Uhrzeit auf einem dauerhaften Datenträger, etwa per E-Mail. Du kannst die Erklärung zusätzlich direkt speichern.</p>
            <p>Bei einem wirksamen Widerruf erstatten wir die erhaltenen Mitgliedschaftszahlungen unverzüglich, spätestens innerhalb von 14 Tagen ab Eingang der Erklärung. Wir verwenden grundsätzlich das ursprüngliche Zahlungsmittel, sofern nicht ausdrücklich etwas anderes vereinbart wird; hierfür entstehen keine Erstattungsgebühren.</p>
            <p>Verlangst du ausdrücklich, dass die Mitgliedschaft bereits vor Ablauf der Widerrufsfrist beginnt, kann für die bis zum Widerruf erbrachte Leistung nach den gesetzlichen Voraussetzungen ein angemessener anteiliger Wertersatz anfallen. Der sofortige Beginn bedeutet keinen pauschalen Verzicht auf dein Widerrufsrecht. Die Vergütung anderer Nutzer wird wegen eines Widerrufs deiner Mitgliedschaft nicht gekürzt.</p>
        </LegalSection>
        <LegalSection title="Muster für einen Widerruf">
            <p>An den im Impressum genannten Anbieter von Workfare, E-Mail: {BRAND_EMAIL}.</p>
            <p>Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über Workfare Plan. Abgeschlossen am: … · Name: … · Anschrift: … · Vertragsreferenz, falls vorhanden: … · Datum: … · Unterschrift, nur bei einer Erklärung auf Papier: …</p>
            <p>Die Verwendung dieses Musters ist freiwillig.</p>
        </LegalSection>
        <LegalStamp>Version: workfare-plan-v1 · Stand: 25. Oktober 2026</LegalStamp>
    </>;
}
