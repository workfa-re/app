# Workfare Pay lokal prüfen

Stand: **24.10.2026**. Dieses Runbook beschreibt den implementierten lokalen Testbetrieb. Es ist keine Produktionsfreigabe und aktiviert kein Echtgeld. Die Oberfläche kennzeichnet Simulation und Stripe-Testbetrieb ausdrücklich.

## Implementierter Umfang

| Rolle / Bereich | Lokaler Funktionsumfang |
| --- | --- |
| Anbieter | Zahlungsmittel eingebettet hinterlegen, ersetzen und entfernen; gespeicherten Stand serverseitig prüfen; Veröffentlichungs-Gate; echter kundenbezogener Stripe-Testverlauf und vorhandene Belege; Rechnungsdaten inline bearbeiten |
| Jobsuchende | Auszahlung lokal simulieren oder für ausdrücklich freigegebene volljährige Testpersonen über Embedded Connect einrichten; Anforderungen und Auszahlungsziel verwalten; bei Browserproblemen dieselbe Einrichtung über einen kurzlebigen eigenen Stripe-Link fortsetzen; verfügbare und vorgemerkte EUR-Testbeträge, tatsächlichen Auszahlungsplan und Auszahlungsverlauf anzeigen |
| Gemeinsamer Auftrag | Getrennt freischaltbare Terminzahlungs-Vorschau: Vergütung bestätigen, Kartenbetrag autorisieren, ausdrücklich einziehen, offene Autorisierung stornieren oder vollständig erstatten; der nächste erforderliche Schritt ist neben „Details“ erreichbar und öffnet den passenden Termin |
| Eltern | Zweckgebundener eigener Zugang `/guardian/access`, Familienverbindung und ausdrückliche versionierte Plattformzustimmung ohne Anbieter-Onboarding; keine vollständige Chat-/Finanzfreigabe, kein Stripe-Auszahlungskonto und keine automatische Zahlungsberechtigung |

Die Zahlungsseite liegt unter **Einstellungen → Workfare Pay**. Einrichtung und Verwaltung bleiben im aktuellen Bereich. Es gibt keine Informations-Seitenspalte. Rechnungsdaten und Fragen sind nachgeordnet aufklappbar. Historie und Belege zeigen ausschließlich vorhandene Daten; in der Simulation gibt es keinen erfundenen Zahlungsverlauf oder Kontostand.

Normales Schließen eines eingebetteten Bereichs meldet Stripe nicht mehr ab. Der echte App-Logout invalidiert die eigenen Connect-Instanzen; ein fremder Kontoinhaber kann keine bestehende Instanz weiterverwenden. Der Browser-Ausweichweg bestätigt allein keine Einrichtung: Nach der Rückkehr wird der tatsächliche Stripe-Stand erneut gelesen. [Empfängersteuerung](./workfare-pay-recipient-controls.md) beschreibt Verfügbarkeitsprüfung und Schutzgrenzen. SEPA, frei wählbare Auszahlungsbeträge und Guthabenhalten werden noch nicht als aktive Funktion angeboten. Die belegten Voraussetzungen für echte Zahlungen stehen im [Produktionsplan](./workfare-pay-production.md).

Die Anbieterhistorie umfasst höchstens 20 Charges und 20 Rechnungen des eigenen Stripe-Kunden. Weitere vorhandene Einträge werden als begrenzter Ausschnitt kenntlich gemacht. Eine Autorisierung erscheint nicht als bezahlter Betrag. Rechnungsdaten ändern weder Login-E-Mail noch geprüfte Anbieteradresse oder bereits ausgestellte Rechnungen. Diese Übersicht ist keine vollständige Finanzbuchhaltung.

## Modi und unabhängige Freigaben

| Modus | Verhalten |
| --- | --- |
| `disabled` | Standard. Payment-Mutationen und externe Payment-Aufrufe bleiben geschlossen |
| `local_simulation` | Nur isolierte lokale Demo; persistierte Testzustände ohne Karten-, Bank- oder Prüfdokumente und ohne Stripe-Verbindung |
| `sandbox` | Nur isolierte lokale Demo und Stripe-Testschlüssel; eingebettetes Checkout-Setup, Embedded Connect und ausdrücklich freigegebene Test-Zahlungsaufträge |

Alle aktiven Abläufe verlangen die vorhandene Demo-Umgebungsprüfung, dieselbe lokale Supabase-Umgebung und eine Loopback-`APP_ORIGIN`. Datenbankmodus und Servermodus müssen zusammenpassen. Ein Testschlüssel oder Client-Boolean allein schaltet nichts frei. Live-Schlüssel und Live-Objekte werden abgewiesen. Der ursprüngliche Offline-Client bleibt netzwerkfrei; nur die getrennten Sandbox-Adapter kommunizieren mit Stripe.

Weitere Freigaben gelten zusätzlich:

- Anbieter und Empfänger benötigen getrennte explizite Testkohorten. Die Sandbox verlangt eine aktive synthetische Identität mit nachgewiesener Zuordnung zu Demo-Besuch, Persona und Auth-Konto.
- Empfänger-Sandbox: `WORKFARE_PAY_RECIPIENT_SANDBOX=enabled`, Datenbankfreigabe und eigene Kohorte; ausschließlich deutsche volljährige Testpersonen im Produktalter 18–20. Minderjährige werden nicht über umgeschriebene Geburtsdaten oder Elternkonten umgangen.
- Terminzahlungen: `WORKFARE_PAY_ORDER_PREVIEW=enabled`; im Sandboxmodus zusätzlich `WORKFARE_PAY_ORDER_SANDBOX=enabled`. Die private Datenbankkonfiguration muss unabhängig `order_configuration.enabled=true` und einen bekannten Testtarif erlauben. Die Installationsmigration setzt diese Funktion auf **aus**. Die Vorbereitungsskripte wählen für neue Quotes `fee_policy='test-service-5-v1'`, aktivieren aber keine Terminzahlungen.
- **Testtarif:** `test-service-5-v1` berechnet 5 % Brutto-Servicegebühr zusätzlich zur vollen Empfängervergütung, centgenau gerundet. Die 19-%-Steueraufteilung im Snapshot ist ausdrücklich eine Simulation, keine Live-Steuer-/Rechnungsvorgabe. Alte `local-zero-fee-v1`-Quotes behalten ihre Nullgebühr. 5 % Bruttogebühr sind kein Nachweis des Ziels von ungefähr 5 % Beitrag nach direkten Zahlungskosten und kein festgelegter Live-Tarif.

Eine bestätigte Karte ist kein Identitäts-/Adressnachweis. „Job abgeschlossen“, erfolgreicher Einzug, Transfer an einen Empfänger und tatsächliche Bankauszahlung sind getrennte Zustände. Die Sandbox bestätigt keine Zulässigkeit des deutschen Jugendjobmodells.

## 1. Isolierte Demo vorbereiten

```sh
npm ci
npm run demo:setup
```

`demo:setup` ist für eine neue dedizierte Demo bestimmt. Es prüft Docker-Projekt, Netzwerk, Loopback-Bindings, Auth-Einstellungen und Quellfingerprints. Bestehende Datenbanken werden bei Abweichungen nicht zurückgesetzt. Eine ältere Demo benötigt einen einzeln geprüften Vorwärtsabgleich mit Wiederherstellungspunkt; ein erneuter Komplettaufbau ist kein Migrationsersatz.

Die sechs Payment-Dateien stehen im [Migrationskatalog](../../infrastructure/database/README.md). Dazu gehören auch die gesonderte Aufbewahrung finanzieller Demo-Besuche und die unveränderlichen Leistungsbeschreibungen neuer Terminquotes. Die Installation startet deaktiviert und nimmt keine Konten in Kohorten auf. Keine dieser lokalen Anleitungen darf gegen eine produktive Supabase-Umgebung verwendet werden.

## 2. Simulation ohne Zahlungsdaten

```sh
npm run demo:payments
npm run demo:dev
```

`demo:payments` verifiziert die lokale Demo und sämtliche vorhandenen Auth-/Profilbindungen. Danach setzt es den Datenbankmodus auf `local_simulation` und aktiviert Anbieter-/Empfänger-Gates; es nimmt keine Konten auf und ruft Stripe nicht auf. In der privaten `.env.demo.local` ändert es nur:

```dotenv
WORKFARE_PAY_MODE=local_simulation
APP_ORIGIN=http://localhost:3001
```

Das Skript verweigert einen automatischen Rückwechsel aus einer bestehenden Sandbox-Konfiguration. Einen gewünschten Moduswechsel separat prüfen; keine Zahlungsdaten oder Profile pauschal löschen.

Explizite Simulationseinstiege:

- [Privater Anbieter](http://localhost:3001/demo?role=private-provider&pay=1)
- [Gewerblicher Anbieter](http://localhost:3001/demo?role=company&pay=1)
- [Jobsuchende](http://localhost:3001/demo?role=seeker&pay=1)

`pay=1` prüft die passende eigene synthetische Persona und nimmt sie in die jeweilige lokale Kohorte auf. Normale Demo-Besuche ohne Payment-Opt-in bleiben unverändert. Die lokale Empfängersimulation darf den bestehenden minderjährigen Demofall abbilden; sie erstellt dabei kein Stripe-Konto und beweist keine Echtgeldberechtigung.

Im Browser durchgehend `localhost` verwenden. Der Origin muss für Cookies, Mutationen und Rückkehr exakt zur Konfiguration passen.

## 3. Stripe-Sandbox ausdrücklich vorbereiten

Private, autorisierte **Testschlüssel** in `.env.demo.local` hinterlegen. [`.env.payments.example`](../../.env.payments.example) dokumentiert die Namen und deaktivierten Standardwerte. Geheimnisse gehören niemals in Git, Chat, Screenshots, Browsercode oder `NEXT_PUBLIC_*`. Der Publishable Key ist für die Stripe-Einbettung bestimmt und wird gezielt an den angemeldeten Client geliefert; er ersetzt keinen Server-Schlüssel.

Vor dem Moduswechsel einen eigenen synthetischen Demo-Besuch mit den üblichen Rollen vorbereiten. Die gewünschten UUIDs aus diesem bestehenden Besuch ermitteln. Für die erwachsene Empfänger-Vorschau ist dessen bereits vorhandener volljähriger `peer-seeker` vorgesehen. Kein Profilalter ändern.

```sh
npm run demo:payments:sandbox -- --provider PROVIDER_UUID --recipient ADULT_RECIPIENT_UUID
```

Die Namen sind Platzhalter. Der Befehl akzeptiert ein bis acht ausdrücklich genannte Anbieter und optional bis zu acht erwachsene Empfänger. Er prüft lokale Isolation, Auth-/Profilbindungen, Deutschland/Alter und private Testschlüssel. Er setzt Sandboxmodus und Gates und ersetzt die bisherigen Preview-Mitgliedschaften durch genau diese Auswahl. Konten, Profile, Jobs und Geburtsdaten bleiben bestehen. Es gibt keine Stripe-Aufrufe oder automatische Produktionskonfiguration.

In der privaten Datei werden nur drei Runtimewerte gesetzt:

```dotenv
WORKFARE_PAY_MODE=sandbox
WORKFARE_PAY_RECIPIENT_SANDBOX=enabled
APP_ORIGIN=http://localhost:3001
```

Die bestehende Schlüsselkonfiguration bleibt erhalten und wird nicht ausgegeben. Dateischreibvorgang und Datenbanktransaktion sind keine gemeinsame Transaktion: Scheitert das private Speichern nach erfolgreicher Datenbankänderung, schließen nicht übereinstimmende Modi den Flow. Nach Behebung denselben geprüften Auswahlbefehl wiederholen.

Sandbox-Einstiege erfordern den **vorhandenen Cookie-Besuch** und dessen vorab ausgewählte Kohorte:

- Anbieter: `/demo?role=private-provider&pay=1`
- Erwachsener Empfänger: `/demo?role=seeker&pay=1&recipient=adult`

Der zweite Link wählt ausschließlich den eigenen freigegebenen `peer-seeker`; die normale minderjährige Jobsuchendenrolle bleibt unverändert. Ein neuer Browser ohne den bestehenden Besuch erzeugt über diese Sandbox-Links weder eine neue Identität noch eine neue Freigabe.

## 4. Lokale Webhooks und gebaute Vorschau

Nach dem Sandboxwechsel in einem eigenen Terminal:

```sh
npm run demo:stripe-listen
```

Der Helper prüft die lokale Demo und startet vier getrennte Listener mit gepinnter Stripe-CLI. Er übergibt den privaten API-Key über die Prozessumgebung, unterdrückt rohe CLI-/Eventausgaben und speichert jeden Signaturschlüssel atomar mit Dateirechten `0600` in `.env.demo.local`. Im Terminal erscheinen nur Bereitschaft und HTTP-Antwortstatus. Keine manuelle Ausgabe von `whsec_`-Werten nötig.

| Ereignisgruppe | Lokaler Endpunkt | Konfigurationsvariable |
| --- | --- | --- |
| Checkout / Setup / Methodenentfernung | `/api/payments/webhook` | `STRIPE_WEBHOOK_SECRET` |
| Connect Accounts v2 Thin Events | `/api/payments/recipient/webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| Connect Account-/Bankziel-Snapshot-Events | `/api/payments/recipient/webhook-snapshot` | `STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET` |
| Terminzahlungen / Erstattungen | `/api/payments/orders/webhook` | `STRIPE_PAYMENT_WEBHOOK_SECRET` |

Die Listener laufen ausschließlich gegen `http://localhost:3001`. Ihre Endpunkte, Ereignisfilter und Konfigurationsnamen bleiben getrennt. Die lokal geprüfte Stripe-CLI `1.55.1` kann jedoch für mehrere Listener denselben Signaturschlüssel liefern, auch bei unterschiedlichen Gerätenamen. Gleiche Secretwerte sind deshalb in dieser isolierten CLI-Sandbox zulässig; jede Route prüft weiterhin ihre konfigurierte Signatur und den passenden Ereignistyp. Daraus folgt keine Regel für gehostete Produktions-Endpunkte: deren tatsächliche Konfiguration ist bei einem späteren Rollout gesondert zu prüfen. Der Helper erzeugt keinen gehosteten Produktions-Webhook. Das Terminal während der Tests offen lassen; `Ctrl+C` beendet die Listener.

Der Thin-Listener verwendet den engen Accounts-v2-Ereignisfilter mit `--events-from all`. Das bedeutet beide Ereignisursprünge, **nicht alle Ereignistypen**. In CLI `1.55.1` entscheidet allein ein nichtleeres `context`, ob ein Thin Event als Connect-Ereignis gilt; `@accounts` würde Kontext-freie Plattformereignisse bereits vor dem lokalen POST verwerfen. `--forward-to` versorgt bei `all` beide Ursprünge. Ein zusätzlicher `--forward-connect-to`-Parameter behebt dagegen keinen falschen Ursprungsfilter. Die Backend-Zuordnung prüft weiterhin das eigene gespeicherte Empfängerkonto. [Gepinnter CLI-Filter](https://github.com/stripe/stripe-cli/blob/v1.55.1/pkg/proxy/webhook_event_processor.go), [CLI-Routing](https://github.com/stripe/stripe-cli/blob/v1.55.1/pkg/cmd/listen.go).

**Erst wenn alle vier Listener bereit sind**, die App mit der aktualisierten privaten Umgebung bauen und starten:

```sh
npm run demo:preview
```

Das ist ein lokaler Next.js-Build mit anschließendem Start auf `127.0.0.1:3001`, kein Deployment. Im Browser weiterhin `http://localhost:3001` verwenden. Für einen reinen Build ohne Server gibt es `npm run demo:build`. Alternativ startet `demo:dev` den Entwicklungsserver. Nicht gleichzeitig beide Server auf demselben Port betreiben.

Die gebaute Vorschau hat kein Hot Reload. Nach Quelländerungen sowie nach neu gespeicherten Webhook-Secrets/Umgebungswerten den Server beenden und `demo:preview` erneut ausführen. Ein alter laufender Prozess übernimmt keine neu gespeicherten Secrets.

## Erwartete Abläufe und Abbruchwege

### Anbieter und Veröffentlichung

1. Konto ohne Zahlungsdaten erstellen; Jobentwurf eingeben. Vor fehlender Einrichtung den Entwurf synchron speichern. Scheitert Gerätespeicher, nicht still navigieren.
2. Die Karte im eingebetteten Stripe-Formular hinterlegen oder den klar markierten lokalen Test bestätigen. Einrichtung bucht nichts ab. Erforderliche Bankauthentifizierung darf weiterhin ein Fenster oder eine Rückleitung verlangen.
3. Abschluss serverseitig gegen eigene Session, erfolgreichen SetupIntent, Kundenbindung, Methode und Testmodus prüfen. Client-Callback und `setup=success` beweisen keinen Erfolg.
4. Nach bestätigter Einrichtung zum gespeicherten eigenen Job zurückkehren. Erst eine bewusste Veröffentlichung macht ihn sichtbar und entfernt den lokalen Neuanlage-Entwurf.
5. Bestehende offene Jobs bleiben nach Entfernung der Karte bearbeitbar. Neue Veröffentlichungen und Wiederöffnungen benötigen die aktuellen Voraussetzungen. Bearbeitete Entwürfe/Archive vor einem Einrichtungswechsel unveröffentlicht sichern.
6. Absage und Rückzug bleiben möglich. Fehlt die Bereitschaft zur Wiederöffnung, bleibt das Angebot nichtöffentlich; die Historie behauptet keine erfolgreiche Wiederveröffentlichung.

Ersetzen/Entfernen arbeitet eigentumsgebunden. Eine fehlgeschlagene Bereinigung der alten Karte bleibt wiederholbar und darf eine erfolgreiche neue Einrichtung nicht zurücksetzen. Dauerhafte Entfernungsmarker verhindern eine spätere Reaktivierung durch veraltete Ereignisse.

### Jobsuchende und Auszahlung

1. Browsen und bestehende Chats bleiben erreichbar. Vor einer neuen Bewerbung/Reservierung prüft der Server die eigene aktuelle Auszahlungseinrichtung.
2. „Auszahlung einrichten“ öffnet Embedded Connect beziehungsweise die Simulation. Vollständige Bank-/Prüfdaten gehen direkt an Stripe, nicht in Workfare-Profile oder Chats.
3. Ein Exit-Callback genügt nicht: aktuelle Fähigkeiten, Anforderungen und verwendbares Bankziel serverseitig neu lesen. Unbekannte oder fehlende Angaben bedeuten nicht bereit.
4. Nach bestätigter Einrichtung die ursprüngliche Jobkarte frisch laden. Die Bewerbung/Reservierung erfolgt weiter ausdrücklich; kein automatisches Annehmen eines womöglich inzwischen vergebenen Jobs.
5. Spätere Anforderungen oder ein entferntes Bankziel können Bereitschaft wieder entziehen. Kontoverwaltung bleibt eingebettet. Guthaben- und Auszahlungsverlauf sind lesend; manuelle/sofortige Auszahlungen und frei änderbare Auszahlungspläne sind nicht aktiviert.

### Separat freigegebene Terminzahlungs-Vorschau

Die Vorschau ist ein eigenständiges Testpaket und bleibt ohne sämtliche Runtime-/Datenbankfreigaben geschlossen. Im Chat ist sie dem konkreten vereinbarten Termin zugeordnet:

1. Anbieter schlägt serverseitig berechnete Vergütung vor; bei Stundenlohn muss die geplante Dauer ausdrücklich feststehen. Die vollständigen Bedingungen sind versioniert und an den Termin gebunden.
2. Empfänger bestätigt genau diese Fassung. Termin-/Preisänderungen brauchen eine neue abgestimmte Fassung; bestehende Zahlungsobjekte werden nicht still umgeschrieben.
3. Anbieter autorisiert den Gesamtbetrag ausdrücklich. Der PaymentIntent verwendet `capture_method=manual`; eine zusätzliche Kartenbestätigung wird bei Bedarf eingebettet durchgeführt. Autorisiert bedeutet reserviert, nicht bezahlt.
4. Einzug erfolgt als separate bewusste Aktion nach Leistung. Ein Jobabschluss löst keinen Einzug aus. Tatsächliche Autorisierungsfrist, Betrag, Kunde, Karte, Empfänger und Testmodus werden erneut geprüft.
5. Eine offene Autorisierung kann storniert werden; ein eingezogener Betrag ist im Test vollständig erstattbar. Der Adapter prüft auch die Rückabwicklung des zugehörigen Transfers. Teilrefunds und automatisierte Streitfallbearbeitung sind kein fertig angebotenes Produkt.
6. „Bezahlt“ bestätigt den Einzug, nicht den Eingang auf dem Bankkonto. Neue Testquotes zeigen volle Vergütung, 5 % zusätzliche Brutto-Servicegebühr und Gesamtbetrag vor beiden Zustimmungen. Vollerstattung verlangt auch den tatsächlichen Gebührenrefund und die Transfer-Rückbuchung; keine freigegebene Livegebühr suggerieren.

## Prüfungen und Nachweisgrenzen

```sh
npm run test:all
npm run typecheck
npm run lint
npm run security:audit
npm run demo:build
npm run test:payments:db
npm run test:payments:recipients:db
node scripts/database/test-payment-orders.mjs
node scripts/database/test-payment-sandbox-preview.mjs
node scripts/database/test-payment-demo-cleanup.mjs
```

Die Payment-Datenbanksuiten erzeugen eigene temporäre Datenbanken im bereits verifizierten lokalen Demo-Container und entfernen sie im Abschlussblock. Sie lesen keine Stripe-Zugangsdaten, verwenden keine Remote-Datenbank und aktivieren die laufende Demo nicht. Sie sind absichtlich unabhängig von der normalen `test:all`-Suite ausführbar.

Automatisierte Tests prüfen SDK-Verträge, Eigentum, Fremd-IDs, Alter/Staat, Kohorten, Signaturen, Deduplizierung, Generationen, konkurrierende Operationen, Abbruch, Rückkehr und Grenzbeträge. Gemockte SDK-Verträge und echte PostgreSQL-Tests belegen **keinen** erfolgreichen Stripe-Durchlauf. Der abschließende Prüfbericht muss deshalb getrennt festhalten:

- aktuelle Test-, TypeScript-, Lint-, Build- und Sicherheitsresultate;
- welche Rollen/Flows tatsächlich im Browser geprüft wurden, einschließlich Mobilbreite, Hell/Dunkel, Tastatur und Fehlerzuständen;
- welche Setup-, Connect-, Zahlungs-, Erstattungs- und Webhookpfade wirklich mit Stripe-Testobjekten durchlaufen wurden;
- offene Authentifizierungs-/Prüfanforderungen sowie nicht getestete Schritte.

Die endgültigen Zahlen und Ergebnisse gehören zum finalen Validierungslauf dieses Arbeitsstands; ältere Suitezahlen sind kein aktueller Nachweis. Ein erfolgreiches Testobjekt ist keine Produktionszulassung. Vor Echtgeld fehlen insbesondere bestätigtes Geschäfts-/Minderjährigenmodell, verbindlicher Gebühren-/Haftungsrahmen, Produktionskonfiguration, betriebliche Abstimmung/Buchführung und betreute Fehler-/Streitfallabläufe.

Der tatsächliche Abschlussstand mit 1.595 automatisierten Tests, 361 PostgreSQL-Prüfungen und dem vollständigen 10-Euro-Sandboxablauf steht im [Prüfbericht vom 24.10.2026](../releases/2026-10-24-workfare-pay-local.md).

Weiter: [Umsetzungskonzept](../planning/workfare-pay-implementation.md), [UI-Konzept](../planning/workfare-pay-ux.md), [Geldfluss und Freigaben](../planning/workfare-pay.md).
