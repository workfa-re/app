# Workfare Pay: kompakte Verwaltung und klare Zahlungsstände

## Oberfläche

- Zahlungen und Belege, Rechnungsdaten, Gebühren und Abo, Konto und Karte sowie die Hilfe stehen in einem gemeinsamen Liquid-Glass-Block. Abgerundete interne Abtrennungen ersetzen die einzelnen Karten. Anbieter sehen den Abo-Einstieg; Jobsuchende behalten ihre eigene Zahlungs-/Auszahlungsübersicht.
- Konto und Karte erscheinen zunächst nur als aufklappbare Zeile. Der Text über die laufende Entwicklung steht erst darin; kein Planungsbadge oder Zieljahr auf der geschlossenen Seite.
- Der Aktualisieren-Knopf gehört zum geöffneten Zahlungsverlauf. Er liegt außerhalb des Summary-Elements und ist im geschlossenen Zustand nicht sichtbar oder per Tastatur erreichbar.
- Fragen zu Workfare Pay stehen zuletzt. Der Abschluss zeigt Workfare Pay × stripe und den Link „Über Stripe“. Dies beschreibt die technische Integration, keine behauptete offizielle Partnerschaft.
- Die Animationssteuerung hat einen eigenen Platz im Layout. Sie steht auf kleinen Bildschirmen weder über dem Titel noch über der folgenden Karte.
- Die Plan-Seite bündelt Preis, Gebühren, Rechner und geplante Erweiterungen ebenfalls in einer Glass-Fläche. Ein einzelner Slider zeigt null bis zwölf Jobs monatlich bei jeweils 50 € Vergütung. Der Vergleich enthält den Monatsbeitrag und zeigt bei wenig Nutzung auch den Abo-Nachteil.
- Mehrere Einsatzorte, Haushaltsbudget und aufgeteilte Zahlungen sind klar als kommende Erweiterungen gekennzeichnet. Sie sind noch nicht umgesetzt und werden nicht als enthaltene Abo-Leistungen verkauft.

## Zahlungsablauf

Es entsteht keine weitere manuelle Abschlussbestätigung. Nach bestätigtem Preis und „Jetzt bezahlen“ führt der Server den gespeicherten Zahlungsauftrag einschließlich einer gegebenenfalls nötigen Bankauthentifizierung automatisch fort. Erst der verifizierte erfolgreiche Zahlungseingang schließt Termin, Job und Chat atomar; Chat-Hinweis und Benachrichtigungen werden dabei erzeugt.

Der pauschale Hinweis „Eine Zahlung wird noch geprüft“ war keine zusätzliche normale Freigabe, sondern eine Zusammenfassung einzelner Klärfälle. Er ist aus der Übersicht entfernt. Konkrete Klärfälle bleiben am betroffenen Zahlungsvorgang mit direktem Chat-Link sichtbar. Verdienst, tatsächliche Bankverarbeitung und auszahlbarer Betrag bleiben korrekt getrennt. Geldbeträge und Zahlungszustände wurden nicht durch UI-Aussagen ersetzt.

Keine Änderung an Live-Tarifen, Stripe-Konfiguration, Verkaufsfreigabe oder Datenbankschema. Der weiterhin ungeklärte Umsatzsteuerstatus wird durch diese Oberflächenänderung nicht als bestätigt ausgegeben.

## Prüfung

- Gesamtsuite: 3.266 Tests bestanden; Produktionsbuild einschließlich TypeScript erfolgreich.
- ESLint: keine Fehler, 42 bestehende Warnungen.
- Zusätzlich 72 isolierte PostgreSQL-Direktzahlungsprüfungen und 53 Datenbankprüfungen für Chat und Zahlungsbenachrichtigungen bestanden. Keine Hosted-Schreibzugriffe oder tatsächlichen Stripe-Zahlungen.
- Pay-Verwaltung: 18 Browser-Szenarien mit 300 Assertions, beide Rollen und Farbmodi bei 320, 390, 768 und 1.440 Pixeln. Aufklappen, tatsächlicher Refresh der Testquelle, Lade-/Fehlerzustände, Fokus, fehlende Überlappungen und Überlauf geprüft.
- Plan-Seite: Slider, korrekte Vergleichsbeträge einschließlich Nullnutzung, Vertragsaktionen und Darstellung in beiden Farbmodi geprüft. Die Browser-Prüfungen verwenden tatsächliche Komponenten mit ausdrücklich synthetischen Daten und ersetzen keinen Live-Kauf.

Die [aktualisierte Produktplanung](../planning/workfare-plan-and-loyalty.md) hält die geänderten nächsten Ausbauschritte fest.
