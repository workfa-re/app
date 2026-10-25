# Workfare Pay: Kontodaten, Bankverwaltung und Familie

## Änderungen

- Vergütung, aufklappbare Gebühren und Gesamtbetrag bilden eine klare Abrechnung. Die sichtbaren Beträge bleiben an den bestätigten Tarifstand gebunden. Die neue Vorgabe ist ein 6-%-Beitragsziel; auf Wunsch des Betreibers wird zuerst ein höherer allgemeiner Gesamttarif kalkuliert. Es wurde kein neuer Live-Tarif aktiviert und kein separater Zahlungsaufschlag eingeführt.
- Neue Stripe-Customers bekommen Profilname beziehungsweise Firmenname und bestätigte Konto-E-Mail. Bestehende Customers werden beim nächsten Pay-Aufruf oder Setup abgeglichen. Der Rechnungsname bleibt profilgebunden; eine E-Mailänderung verwendet die normale Auth-Bestätigung. Die optionale Rechnungsadresse wird getrennt gespeichert, gelesen oder ausdrücklich entfernt.
- Der Belegverlauf hat einen kleinen Aktualisieren-Button oben. Hilfe steht kompakt in einer aufklappbaren Zeile. Originalbelege und PDFs behalten ihre geprüften Stripe-URLs; eine Checkout-Domain wird nicht als Rechnungshost ausgegeben.
- „Insgesamt verdient“ steht prominent oben. Darunter folgen ausgezahlt, Bearbeitung und verfügbar. Die Terminanzahl entfällt auch auf der Startseite. Die native Guthabenansicht führt nicht mehr in Stripe-Kontoeinstellungen. Ein Freigabedatum erscheint nur bei vollständigem Nachweis der ausstehenden EUR-Beträge.
- Die Bankkarte zeigt Banknamen und Endziffern. „Ändern“ öffnet ausschließlich die offiziell unterstützte Bankverwaltung mit aktuellem Eigentums-, Modus-, Modell- und Consentnachweis. Nur für das geprüfte application/none-Modell entfällt Stripes zusätzliche Nutzeranmeldung. Der Bereich darf weder auszahlen noch den Plan oder die Identität bearbeiten.
- Der Auszahlungstag lässt sich ohne überflüssige Checkbox speichern. Parallele Statusabgleiche werden anhand der tatsächlichen Identität eingeordnet. Bei einer neueren, noch laufenden Beobachtung erfolgt höchstens eine vollständige neue Stripe-Prüfung. Geldaktionen behalten ihre privaten Datenbank-, Bereitschafts-, Lease- und Idempotenzprüfungen.
- Eltern sehen eine begrenzte, ausschließlich lesende Finanzübersicht für aktuell freigegebene 14–17-Jährige. Sie enthält Verdienst, Salden, fünf Auszahlungen und maskierte Bankdaten. Der Jugendliche verwaltet seine Bank und Auszahlungen. Chats und vollständige Bankdaten bleiben privat; Widerruf, Volljährigkeit und fremde Eltern sind gesperrt.
- Ein Eltern-E-Mailwechsel erhält historische Erklärungen und Stripe-Personendaten. Nur ein exakt belegter bestehender Bindungs-/Annahmenachweis erlaubt den Kontaktwechsel. Preflight und ein zusätzlicher Trigger beim tatsächlichen Auth-Update schützen auch das Zeitfenster zwischen Anfrage und späterer E-Mailbestätigung.

## Prüfung

- 3.117 automatisierte Tests: 3.063 Haupttests, 14 Angebots-, 26 Demo-, zwei Abhängigkeits- und zwölf Betriebs-/Kalkulationsprüfungen.
- Produktionsbuild einschließlich TypeScript erfolgreich. Vollständiger Lint ohne Fehler; 43 bestehende Warnungen.
- 67 isolierte PostgreSQL-Prüfungen der neuen Familien-/Kontaktschnittstellen und 45 bestehende Annahmeprüfungen. Der vollständige produktionsnahe Rollout umfasst 35 Migrationen und prüft atomare Installation/Rollback, private Rechte und RLS.
- Browserprüfung in vier Größen von 320 bis 1440 Pixeln und beiden Modi für Abrechnung, Billing, Auszahlungsseite und Familie. Interaktionen umfassen Gebühren-Aufklappen, erste Tagesänderung, natives Guthaben, Rechnungsadresse, E-Mail-Bestätigung, Fehlerbehandlung und Ownerwechsel. Backendantworten dieser UI-Fixtures sind simuliert.
- Tatsächliche Stripe-Sandbox: bestehender synthetischer Customer wurde über den App-Adapter synchronisiert, seine Adresse geschrieben und entfernt; anschließend wurde der ursprüngliche Zustand exakt wiederhergestellt. Die Bankkomponente erreichte Bankliste und Bearbeiten ohne zusätzliche Stripe-Anmeldung. Es wurde keine Bankänderung durchgeführt.
- Ein tatsächlicher Sandbox-Pending-Saldo wurde vollständig mit Balance Transactions abgeglichen. Das belegte `available_on` ist die Grundlage der Anzeige; eine Bestätigung der Zahlung wird nicht mit verfügbarem Guthaben oder Bankeingang gleichgesetzt.
- Die kanonische Migration `20261025105410_guardian_contact_and_finance_visibility.sql` ist installiert. Die neuen öffentlichen RPC-Wrapper sind ausschließlich für den Server ausführbar; der Auth-Trigger ist aktiv. Die normalisierten Supabase-Sicherheits- und Performancehinweise sind gegenüber dem vorherigen Stand unverändert.

Die Prüfungen haben keine echten Zustimmungen, Auth-Bestätigungsmails, Zahlungen oder Bankauszahlungen erzeugt. Der tatsächliche E-Mail-Bestätigungsabschluss und ein Bankwechsel bleiben Nutzeraktionen. Es gibt keinen globalen Customer-Backfill und keine behauptete erfolgreiche Live-Branding-Änderung.

## Nächste Preisentscheidung

Die [Kalkulation](../planning/payment-provider-comparison.md#7-neue-preisentscheidung-vom-25102026) enthält einen ausführbaren Centrechner mit offen ausgewiesenen Kosten- und Steuerannahmen. 12 % + 0,49 € allgemeine Plattformgebühr sind ein **noch nicht freigegebener Vorschlag**. Er erreicht das 6-%-Beitragsziel im gezeigten normalen Nutzungsszenario, aber nicht bei nur einem kleinen Job je aktivem Empfängermonat. Individueller Stripe-Vertrag, Steuerstatus, Aktivität und ein bewusstes Budget für seltene Nutzung müssen vor der Freigabe feststehen.

Der [Billing-Vertrag](../operations/workfare-pay-billing-identity.md) beschreibt die Kontobindung und die Grenzen der Originalbelege.
