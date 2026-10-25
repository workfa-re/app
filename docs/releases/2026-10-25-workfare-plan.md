# Workfare Pay und Workfare Plan

## Produkt und Oberfläche

- Die Pay-Seite hat einen kompakten Kopf ohne zusätzliche Hero-Unterzeile. Der bestehende Light-/Dark-Film bleibt direkt integriert; Pause und Weiterlaufen sind erreichbar. Es wurde kein neuer Clip generiert und es wurden keine Mediencredits verbraucht.
- Belege und Rechnungsdaten liegen in eigenen abgerundeten Glass-Karten. Die Trennlinie vor der Hilfe bleibt erhalten.
- Ein kleiner Konto-/Kartenausblick nennt Januar 2027 ausdrücklich als unverbindliches Ziel unter Partnerfreigabe. Ein Bankkonto oder eine Banklizenz wird nicht als heute vorhanden ausgegeben.
- Workfare Plan ist ein freiwilliges Anbieter-Abo für 5,90 € monatlich. Es erlässt den Workfare-Anteil von sechs Prozentpunkten im neuen Tarif. Grundfunktionen bleiben vollständig ohne Abo nutzbar; geplante Extras werden nicht als bereits enthalten verkauft.
- Der Rechner vergleicht tatsächlich gerundete Jobgebühren einschließlich Monatsbeitrag und zeigt bei wenig Nutzung den Nachteil des Abos. Er bleibt für eine ruhige mobile Seite standardmäßig geschlossen.
- Neue Tarife werden als Cent-Snapshot gespeichert. Bestehende Jobs behalten ihren bisherigen Tarif; bereits vereinbarte Preisstände werden auch bei späterem Aboabschluss oder Kündigung nicht umgeschrieben.

## Kauf und Betrieb

Das neue Produkt, der monatliche EUR-Preis und eine begrenzte Portal-Konfiguration sind im Live-Katalog angelegt und zurückgelesen. Dies hat kein Nutzer-Abo erstellt und keine Zahlung ausgelöst.

| Objekt | Referenz |
| --- | --- |
| Produkt | `prod_workfare_plan_v1` |
| Preis, 590 Cent/Monat, steuerinklusiver Endpreis | `price_1UUQIBCnn9FsZa9S4HVsqs6d` |
| Beleg-/Zahlungsmittelportal | `bpc_1UUQIOCnn9FsZa9S7RXnFJDu` |

Kunden werden über die vorhandene modegebundene Workfare-/Stripe-Zuordnung identifiziert. Rechnung, InvoicePayment, PaymentIntent und Charge müssen einen tatsächlich gezahlten gültigen Zeitraum belegen. Browser-Rückkehr, Trial, Gutschrift oder ein manuell als bezahlt markierter Vorgang erzeugen keinen Rabatt. Webhook, Wiederholung, Abbruch, erneuter Abschluss und parallele Abgleiche sind eigene Fälle.

Kündigung und Widerruf sind öffentlich ohne Login erreichbar. Erklärungen erhalten einen dauerhaften Nachweis; gewöhnliche Kündigungen werden zum tatsächlichen bezahlten Periodenende ausgeführt. Sonderfälle und Erstattungen erhalten einen nachvollziehbaren Prüfstatus. Der Recovery-Worker verarbeitet nur bereits gespeicherte Erklärungen und legt keine Zahlungen oder Abos an. Der [Betriebsablauf](../operations/workfare-plan.md) beschreibt Wiederholung, getrennte Eingangs-/Endbestätigung und die manuelle Prüfung besonderer Fälle.

## Steuerstatus und Freischaltung

Stripe Tax Settings sind aktiv, aber es ist keine Tax Registration gespeichert. Daraus folgt keine Aussage über den tatsächlichen steuerrechtlichen Status des Betreibers. Die neue Abo-Konfiguration bleibt deshalb standardmäßig gesperrt, bis Kleinunternehmerstatus oder die konkrete steuerpflichtige Behandlung bestätigt und passend eingerichtet ist. `automatic_tax` wird nicht ohne Grundlage aktiviert. Produktanlage und steuerinklusiver Endpreis sind kein Nachweis korrekt abgeführter Umsatzsteuer.

Die höhere Jobgebühr wird erst zusammen mit dem vollständig freigegebenen Angebot und kompatiblen Code aktiviert. Ohne Freischaltung bleiben bisherige Zahlungsabläufe und Tarife bestehen.

## Datenbank

- `20261025125848_provider_memberships.sql`: private Mitgliedschaften, Eigentümerbindung, Checkout-/Vertragsreferenzen, bezahlte Berechtigung, Kündigungs-/Widerrufserklärungen und Benachrichtigungen.
- `20261025125908_membership_fee_tariffs.sql`: exakte Gebührenkomponenten, serverseitige Auswahl und Bestandsschutz.
- Beide Dateien stimmen über den MD5 des vollständigen SQL mit dem Produktions-Migrationsregister überein. Nach Migration: weiterhin Live-Modus, bisheriger 5-%-Tarif, drei unveränderte bestehende Zahlungsaufträge und keine Mitgliedschaft. Der neue Verkauf ist `enabled=false`, Steuerbehandlung `pending`, Tarifstart noch nicht gesetzt.
- Supabase-Prüfung: keine zusätzlichen Sicherheitswarnungen. Die vier neuen privaten Tabellen haben absichtlich RLS ohne Client-Policy; Zugriff erfolgt über begrenzte serverseitige Funktionen. Die sechs neuen Index-Hinweise betreffen bisher ungenutzte neue Indizes. Vorhandene Warnungen zu älteren öffentlichen Funktionen und Passwortschutz bleiben gesonderte Betriebsaufgaben.

## Nachweise

Abschließende Prüfungen: 3.271 automatisierte Tests (3.213 Plattform, 14 Angebote, 26 Demo, 2 Abhängigkeiten, 16 Betriebsworker), TypeScript und Produktionsbuild bestanden. ESLint: null Fehler und 42 bereits vorhandene Warnungen; Dependency-Audit: null bekannte Schwachstellen. Zusätzlich bestanden 46 echte PostgreSQL-Mitgliedschaftsprüfungen und 33 Tarifprüfungen sowie ein atomarer Testlauf aller 39 Release-Migrationen einschließlich Rollback und privater RLS. Browserprüfungen decken 320 bis 1.440 Pixel in Hell und Dunkel ab; Kündigung/Widerruf wurden auch mit Netzfehlern und fehlerhaften Antworten geprüft. Die geänderten Dateien enthalten nach Secret-Scan keine privaten Schlüssel.

Eine tatsächliche Stripe-Sandboxprüfung des App-Helpers hat ein 5,90-€-Testabo erfolgreich anhand seiner Rechnungskette geprüft, eine Kündigung zum Periodenende nachvollzogen und eine Teilerstattung korrekt als fehlende Berechtigung/Prüfbedarf behandelt. Der Testbetrag wurde vollständig erstattet, das Testabo beendet, Produkt/Preis archiviert und der synthetische Kunde gelöscht. Keine App-Datenbank oder Live-Zahlung wurde für diese Probe verändert.

Die [Produkt-/Treueplanung](../planning/workfare-plan-and-loyalty.md) enthält Preisbeispiele, Kostengrenzen, die nächsten Funktionen und ein budgetiertes Vorteilsmodell. Der vorhandene Konten-/Kartenplan bleibt die Grundlage für die spätere Partnerprüfung.
