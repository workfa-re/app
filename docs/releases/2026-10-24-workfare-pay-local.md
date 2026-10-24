# Workfare Pay: lokale Qualitätssicherung

Stand: **24.10.2026, 11:03 Uhr MESZ**. Geprüft wurde der lokale Arbeitsbaum auf Basis von `ed5d900173fc4a9721df9b44f005d0e94dc51e7f`. Die Nachprüfung unten dokumentiert den aktuellen Zuverlässigkeitsstand. Die nachfolgenden älteren Abschnitte halten die Prüfung um 09:54 Uhr und den damals vollständig ausgeführten Stripe-Testablauf fest. Das ist keine Produktions- oder Echtgeldfreigabe.

## Nachprüfung: Stripe-Oberflächen und Zahlungsabgleich

| Aktuelle Prüfung | Ergebnis |
| --- | --- |
| Hauptsuite, `npx vitest run --maxWorkers=2` | **106 Dateien, 1.701 Tests bestanden** |
| Offers / Demo / Dependencies | **14 / 25 / 2 Tests bestanden** |
| Gesamt der aktuellen automatisierten Suiten | **1.742 Tests bestanden**; gezielte Wiederholungen nicht zusätzlich gezählt |
| Nach letzter Scrollkorrektur | 21 betroffene Settings-, Rendering- und Connect-Lifecycle-Tests erneut bestanden |
| ESLint | **0 Fehler, 42 bestehende Warnungen**; Payment-Dateien gezielt ohne Warnungen |
| `npm run security:audit` | Erneut ausgeführt: **0 bekannte Schwachstellen** im Lockfile |
| Lokaler Produktionsbuild / TypeScript | Nach letzter Codeänderung erfolgreich; Preview unter `http://localhost:3001` gestartet |
| Terminzahlungs-Datenbanktests | Aktualisierte Suite mit **105 echten PostgreSQL-Prüfungen** bestanden; ersetzt den älteren 90er-Nachweis dieser Suite, wird nicht doppelt gezählt |
| Diffprüfung | `git diff --check` erfolgreich |

Ein früherer Wiederholungslauf unter gleichzeitigem Build-/Lintaufwand überschritt im ESLint-Konfigurationsselbsttest das Zeitlimit. Derselbe Test bestand anschließend isoliert; die komplette Hauptsuite bestand unverändert mit zwei Workern. Kein fehlgeschlagener Lauf wurde als erfolgreicher Nachweis gezählt.

Geändert und abgesichert:

- Stripe-Komponenten werden nicht mehr durch den gerundeten Container abgeschnitten; Schrift und Workfare-Pay-Wortbild folgen der vorhandenen Oberfläche.
- Das Schließen eines eingebetteten Bereichs meldet die Stripe-Sitzung nicht mehr ab. Nur ein echter App-Logout invalidiert die jeweiligen ownergebundenen Sitzungen; verspätete Antworten stellen sie nicht wieder her.
- Wiederholung, verständliche Popup-Hilfe und ein ausdrücklich angeforderter offizieller Browser-Ausweichweg verwenden frische, eng gebundene Sessions. Ein kurzlebiger Hosted-Link wurde für das vorhandene synthetische Testkonto tatsächlich vorbereitet; keine Vertragsannahme oder erfolgreiche Kontoeröffnung daraus abgeleitet.
- Echte verfügbare/pending EUR-Beträge und der tatsächliche Auszahlungsplan sind getrennt lesbar. Retention, freie Auszahlungsbeträge und SEPA bleiben korrekt nicht aktiviert.
- Der nächste finanzielle Schritt im Chat öffnet den passenden Termin in denselben Details; er löst keine Zahlung aus. Die Zahlungsdaten werden im gemeinsamen Kontext geladen. Diese Verknüpfung ist automatisiert geprüft; kein neuer vollständiger Chat-Browserdurchlauf mit einem zweiten Konto behauptet.
- Erstattungen gleichen frische Stripe-Nachweise und Streitfälle ab. Zwei lokale Vorwärtsmigrationen erhalten echte Refundbelege auch bei parallelem Prüfstatus. Die vorhandenen zwei Demo-Orders und 13 Events blieben erhalten. Ausschließlich die verifizierte lokale Demo wurde migriert; keine Produktionsmigration.

Im Codex-Browser erneut direkt geprüft: Anbieterübersicht in Hell/Dunkel bei 390 × 844 und 1280 × 900, danach Empfängerübersicht in beiden Modi. Mobile Navigation von Einstellungen zu Pay startet nach der Korrektur bei `scrollTop=0`, mit sichtbarer Überschrift und ohne horizontalen Überlauf. Eingebettetes Onboarding lädt bis zum tatsächlichen Stripe-Einstieg; Schließen gleicht den Serverstand ab und zeigt weiterhin korrekt offene Anforderungen. Keine abgeschlossene Empfängerprüfung aus diesem Einstieg behauptet. Das letzte Fehlerprotokoll enthielt keine erfassten Browserfehler. Viewport und heller Ausgangsmodus wurden wiederhergestellt.

Aktuelle Bildbelege liegen außerhalb des Repositorys unter `/Users/rezan/.codex/visualizations/2026/10/24/workfare-pay-reliability/`: `desktop-light.png`, `desktop-dark.png`, `mobile-light.png`, `mobile-dark.png`, `recipient-mobile-light.png`, `recipient-mobile-dark.png`, `recipient-desktop-light.png`, `recipient-desktop-dark.png` und `recipient-browser-fallback.png`. `dns-only.png` belegt die ausdrücklich genehmigte CNAME-Proxykorrektur; die abschließende Stripe-Domain-/TLS-Aktivierung ist weiterhin nicht nachgewiesen. Stripes Sandboxtext zeigt teils noch „Default“; das ist kein abgenommener Live-Markenname.

**Produktplanung abgeschlossen, Live-Umsetzung offen:** Einmalige Elterneinrichtung für 14–17, automatische Bankauszahlung und kein Wallet zum ersten Start. Der Nutzer versendet die vorbereitete Supportanfrage selbst. Die konkrete deutsche Guardian-/Empfänger-/Bankzuordnung bleibt vor Live nachzuweisen; Planung und unabhängige Vorbereitung warten nicht auf eine Antwort. Siehe [Produktplan](../planning/workfare-pay-ux.md) und [Produktionsplan mit Anfrage](../operations/workfare-pay-production.md).

## Überarbeitung: Pay-Oberfläche und Familienzugang

Die lokale Pay-Seite hat einen breiten, reduzierten Einstieg mit dem Workfare-Pay-Schriftzug und einer eigenen Glasbrücken-Animation. Ein einziger Higgsfield-Clip kostete 10 Credits (966 → 956); daraus entstehen die helle und dunkle Webfassung. Die Dateien zusammen bleiben unter 220 kB, enthalten keinen Ton und benötigen keinen externen Player. Die Animation ist pausierbar; reduzierte Bewegung und Datensparen starten mit einem Standbild. Verdeckte oder außerhalb des Sichtbereichs liegende Wiedergabe pausiert. Zahlungsmittel, Verlauf, Belege und Rechnungsdaten bleiben in ihren bestehenden, kontogebundenen Funktionen; zusätzliche Angaben werden bei Bedarf aufgeklappt.

Der Elternzugang ist ein eigener, passwortloser Zweckzugang. Für neue Eltern sind Name und Geburtsdatum erforderlich, kein Anbieterprofil und keine Adresse. Einladungen sind in beiden Richtungen möglich. Plattformzustimmung für Minderjährige und freiwillige Familienverbindung für Volljährige sind getrennt von Stripe-Einrichtung und Auszahlungsbereitschaft. Die Bewerbungsprüfung und die Profilanzeige verwenden denselben aktuellen, serverseitig geprüften Freigabestand.

Im Browser direkt nachgewiesen: Anmeldecode aus dem ausschließlich lokalen Testpostfach, Schutz gegen Bestätigung im eigenen Kinderkonto, ausdrückliche Zustimmung durch einen zweiten synthetischen Elternteil und die umgekehrte freiwillige Einladung einer volljährigen Testperson. Ein realer Konflikt mit dem alten globalen Zustimmungsindex wurde dabei gefunden und mit additiven Migrationen behoben; bestehende Belege wurden nicht umgeschrieben. Helle und dunkle Pay-Ansicht, tatsächliche Videowiedergabe und Pause, aufgeklappter Zahlungsverlauf sowie 393-Pixel-Layout ohne horizontalen Überlauf wurden geprüft.

Neue lokale Preisvorschläge binden den angezeigten Testtarif an die Bestätigung. Bei einem Tarifwechsel wird der neue Gesamtbetrag erneut bestätigt. Ein identisch wiederholter Vorgang bleibt auch nach einem Tarifwechsel beim ursprünglichen Vertragsstand; geänderte Parameter desselben Schlüssels werden abgewiesen. Der zusätzliche 5-%-Brutto-Testtarif bleibt vom wirtschaftlichen 5-%-Beitragsziel getrennt. Der tatsächliche Stripe-Durchlauf mit zusätzlicher Servicegebühr und zugehöriger Erstattung ist weiterhin offen. Der zuvor nachgewiesene Nullgebühr-Durchlauf bleibt historisch gültig.

Aktuelle automatisierte Prüfung: 1.839 Tests der Hauptsuite, 14 Angebotstests, 25 Demo-Vertragstests und 2 Abhängigkeitstests bestanden. Optimierter Demo-Build einschließlich TypeScript erfolgreich. Die bearbeiteten Zahlungs- und Elternmodule haben keine ESLint-Befunde; der gesamte Bestand hat keine Fehler und 40 vorhandene Warnungen. Dependency-Audit ohne bekannte Schwachstellen. In 563 nicht ignorierten Textdateien wurden keine aktuell konfigurierten privaten Secretwerte gefunden. Diese Prüfungen sind keine Freigabe des Echtgeldbetriebs; das deutsche Stripe-Modell für Minderjährige bleibt vor Live nachzuweisen.

## Erstprüfung um 09:54 Uhr: automatisierte Prüfungen

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Hauptsuite `npm test` | 99 Testdateien, **1.555 Tests bestanden** |
| `npm run test:offers` | 2 Testdateien, **14 Tests bestanden** |
| `npm run test:demo` | Nach der letzten zusätzlichen CLI-Regression erneut ausgeführt: **24 Tests bestanden** |
| `npm run test:dependencies` | **2 Tests bestanden** |
| `npm run lint` | **0 Fehler, 42 Warnungen**; Anzahl entspricht dem dokumentierten Bestandsstand |
| `git diff --check` | Keine Fehler |
| TypeScript `npx tsc --noEmit --incremental false` | Im vorangegangenen Prüfblock erfolgreich abgeschlossen; in diesem abschließenden Paket nicht erneut gestartet |

`npm run test:all` wurde vollständig erfolgreich ausgeführt. Zu diesem Zeitpunkt enthielt die Demo-Suite 23 Tests. Nach dem letzten zusätzlichen Test für Accounts-v2-Thin-Events wurde ausschließlich diese betroffene Suite erneut ausgeführt und mit 24 Tests bestätigt. Der finale Prüfstand umfasst damit **1.595 Tests**: 1.555 + 14 + 24 + 2. Es gab keine übersprungenen oder fehlgeschlagenen Tests in diesen erfolgreichen Läufen.

Die 42 ESLint-Warnungen bleiben sichtbar; sie wurden nicht unterdrückt oder als Fehlerfreiheit sämtlichen Bestands-Codes ausgegeben. Die bekannte Einordnung steht im [Plattform-Code-Audit](2026-10-24-platform-code-audit.md). Die zusätzlich gezielt geprüften Payment-Dateien hatten keine ESLint-Warnungen.

Die Hauptprüfung meldet für `npm run security:audit` **0 bekannte Schwachstellen im Lockfile**. Dieser Audit wurde in diesem abschließenden Teilpaket nicht nochmals ausgeführt. Ein Abhängigkeitsaudit ersetzt keine Prüfung des Zahlungsmodells oder des laufenden Systems.

Nach dem Gesamtlauf wurden ausschließlich zwei Hinweise präzisiert: Die Autorisierung beschreibt jetzt die Vormerkung auf der Karte; die noch laufende Empfängerprüfung verspricht keine automatische Aktualisierung ohne erneuten Abgleich. Die jeweils betroffenen UI-Suiten wurden erneut erfolgreich geprüft (17 beziehungsweise 16 Tests, bereits in der Gesamtzahl enthalten). Der anschließende lokale Produktionsbuild kompiliert den aktuellen Stand und prüft dessen TypeScript-Typen.

## Echte lokale Datenbankprüfungen

Diese Suiten wurden gegen kurzlebige eigene PostgreSQL-Datenbanken im zuvor verifizierten lokalen Dockerprojekt `workfare-website-demo` ausgeführt. Sie akzeptieren keine fremde Datenbank-URL. Die Prüfungen verwendeten keine Stripe-Zugangsdaten und führten keine Stripe-Aufrufe aus. Die temporären Datenbanken wurden im Abschlussblock entfernt; die laufende Demo und deren Payment-Gates wurden dadurch nicht geändert.

| Suite | Ergebnis |
| --- | --- |
| `scripts/database/test-payments.mjs` | **107 PostgreSQL-Prüfungen bestanden** |
| `scripts/database/test-payment-orders.mjs` | **90 PostgreSQL-Prüfungen bestanden** |
| `scripts/database/test-payment-demo-cleanup.mjs` | **50 PostgreSQL-Prüfungen bestanden** |
| `scripts/database/test-payment-sandbox-preview.mjs` | **40 PostgreSQL-Prüfungen bestanden** |
| `scripts/database/test-payment-recipients.mjs` | **74 PostgreSQL-Prüfungen bestanden**, nach dem tatsächlichen Empfänger-Onboarding erneut separat ausgeführt |
| Gesamt | **361 echte PostgreSQL-Prüfungen bestanden** |

Die Buyer-Suite verpasste beim zunächst parallelen Lauf unter Last das kurze Beobachtungsfenster eines echten Sperrtests. Sie wurde anschließend unverändert alleine ausgeführt; alle 107 Prüfungen bestanden. Dieser erste fehlgeschlagene Prüflauf wurde nicht als fachlich erfolgreicher Nachweis gezählt.

Geprüft wurden insbesondere Eigentumsgrenzen, RLS und Funktionsrechte, konkurrierende Kartenentfernung und Terminänderung, unveränderliche Cent-Beträge und Leistungsbeschreibungen, UTC-Fingerprints, neue Quote-Versionen, Ereignis-Deduplizierung, verspätete Statusantworten, Erwachsenen-/Kohorten-Gates und die Aufbewahrung finanzieller Demo-Datensätze.

## Wiederaufnahme unterbrochener Zahlungsaktionen

Die abschließende Prüfung der Terminoberfläche fand einen konkreten Fehler: Nach einem Netzwerkabbruch konnte eine Order in `capture_pending`, `cancel_pending` oder `refund_pending` verbleiben, obwohl der Server die ursprüngliche Operation wiederaufnehmen konnte. Die Oberfläche bot diesen Weg nicht an.

Die Oberfläche bietet jetzt **Einzug fortsetzen**, **Storno fortsetzen** beziehungsweise **Test-Erstattung fortsetzen** an. Jede Aktion verlangt erneut eine ausdrückliche Zustimmung und verwendet die bestehende Order sowie die ursprünglich vom Server gespeicherte Operation. Es wird kein Ersatz-Zahlungsobjekt angelegt. **Stand aktualisieren** prüft die konkrete Order über den serverseitigen Sync-Endpunkt; es lädt nicht lediglich die gespeicherte Liste erneut.

Dieser Fix ist durch 102 gezielte UI-, Service-, Adapter- und Routentests abgesichert; diese Tests sind in der Hauptsuite enthalten und werden nicht zusätzlich auf die 1.595 Tests aufgeschlagen. Die Prüfung fand keinen weiteren relevanten Ablaufblocker in den betrachteten Zuständen: Abgebrochene Bankbestätigung kann fortgesetzt oder storniert werden, abgelaufene Einzugsfristen erlauben keinen Einzug, und eine Ersatzquote benötigt eine neue Bestätigung. Diese automatisierte Prüfung ersetzt keinen tatsächlichen Stripe-Durchlauf.

## Vertrauliche Secret-Prüfung

Es wurden 504 Textdateien aus dem Git-Dateisatz einschließlich nicht ignorierter neuer Dateien geprüft. In diesen Dateien wurde keiner der aktuellen privaten Secretwerte aus den lokalen Umgebungsdateien gefunden. Zusätzlich wurden Muster für Stripe-Schlüssel, Webhook-Secrets, GitHub-Tokens, private Schlüssel und weitere Zugangsdaten geprüft. Ein Treffer war ein benannter synthetischer Mutationswert im vollständig gemockten Stripe-SDK-Test und wurde als Testfixture eingeordnet. Es blieb kein ungeklärter Kandidat.

Die lokalen Umgebungsdateien sind nicht Teil des Git-Dateisatzes. `.env.demo.local` und `.env.stripe-sandbox.local` haben Dateirechte `0600`. Die bestehende `.env.local` ist ebenfalls ignoriert, hat jedoch weitergehende Dateirechte; sie wurde in diesem lesenden Paket nicht verändert. Es wurden keine Schlüssel, Tokens oder sonstigen Secretwerte in Bericht oder Toolausgabe übernommen. Die Prüfung belegt die geprüften Werte und Muster, keine allgemeine Garantie gegen sämtliche möglichen Geheimnisformate.

## Tatsächlich geprüfter Stripe-Sandbox-Ablauf

Der Prüfbereich dieses Durchlaufs war die isolierte lokale Demo mit Stripe-Testobjekten und ausdrücklich ausgewählten synthetischen Anbietern sowie volljährigen deutschen Testempfängern. Minderjährige werden nicht über geänderte Geburtsdaten oder Elternkonten für Stripe freigeschaltet. Dieser Durchlauf nutzte `local-zero-fee-v1` mit null Servicegebühr. Neue lokale Quotes verwenden inzwischen `test-service-5-v1` mit 5 % zusätzlicher Brutto-Servicegebühr und simulierter Steueraufteilung; der gesonderte Stripe-End-to-End-Nachweis dafür steht noch aus. Keiner dieser Testtarife ist ein Produktionspreis.

Die Hauptprüfung hat die Terminzahlungs-Vorschau für ihre lokale QA-Auswahl ausdrücklich aktiviert. Diese gezielte Testfreigabe ist von den deaktivierten Installationsstandards zu unterscheiden. Die vorstehenden automatisierten Prüfungen aktivierten keine Gates.

Der Browserdurchlauf verwendete ausschließlich benannte synthetische Demo-Personen in der vorhandenen Stripe-Sandbox. Die tatsächliche Testkarte und Stripes eingebautes Testbankkonto sind keine realen Zahlungsdaten. Das Geburtsdatum im Workfare-Profil wurde nicht geändert. Die gesonderten Stripe-Testwerte `1902-01-01` und `address_full_match` dienen ausschließlich dem offiziellen simulierten Prüfpfad.

| Schritt | Direkter Nachweis |
| --- | --- |
| Anbieter-Einrichtung | Visa-Testkarte im eingebetteten Checkout gespeichert; danach verifiziertes Zahlungsmittel im selben Bereich. Zugehörige Setup-Webhooks mit HTTP 200. |
| Verwaltung | Einrichtungsabbruch geprüft; Entfernen-Menü und Bestätigung geöffnet und mit „Behalten“ abgebrochen. Rechnungsname, Rechnungs-E-Mail und Testadresse bei Stripe gespeichert und erneut angezeigt; Profilangaben bleiben getrennt. |
| Auszahlkonto | Embedded Connect im regulären Helium-Browser einschließlich offizieller Testtelefon-Anmeldung und Testbankkonto durchlaufen. Anschließend aktueller serverseitiger Abgleich: `stripe_transfers=active`, `payouts=active`, verwendbares EUR-Ziel, Angaben eingereicht, keine offenen Nutzeranforderungen und Datenbankbereitschaft bestätigt. |
| Guthaben | Echte eingebettete Stripe-Ansicht mit 0,00 € Testsaldo geöffnet. Keine erfundenen Einnahmen oder Bankauszahlungen. |
| Auszahlungsverlauf und Verwaltung | Stripes echter Auszahlungsverlauf im dunklen Modus mit leerem Verlauf, Filtern und Exportaktion geladen. Anschließend eingebettete Kontoverwaltung einschließlich erforderlicher erneuter Stripe-Testanmeldung geöffnet: Personen-, Tätigkeits- und Testbankdaten sichtbar. „Fertig“ schließt denselben Bereich und bestätigt die Bereitschaft erneut. Dabei wurden weder Auszahlungsdaten geändert noch eine Auszahlung ausgelöst. |
| Preisvereinbarung | Anbieter schlägt 10,00 € vor; Empfänger bestätigt genau diese Fassung im selben Termin. Test-Servicegebühr 0,00 €. |
| Autorisierung | Anbieter stimmt ausdrücklich zu; manuell einzuziehender PaymentIntent reserviert 10,00 €. UI unterscheidet Freigabe und Abbuchung. |
| Einzug | Nach dem eindeutig synthetischen, bereits begonnenen Testtermin ausdrücklich 10,00 € eingezogen; Oberfläche zeigt „Bezahlt“. |
| Rückabwicklung | Vollständige Test-Erstattung ausdrücklich bestätigt; Oberfläche zeigt „Erstattet“, Anbieterhistorie ebenfalls mit vorhandenem Stripe-Beleg. |
| Unabhängiger Abgleich | Frische lesende Stripe-Abfragen bestätigen 1.000 Cent eingezogen, 1.000 Cent erfolgreich erstattet, 1.000 Cent Empfängertransfer vollständig zurückgebucht. Der konkrete Transfer-Reversal gehört genau zu diesem Refund. Eigentum, Testmodus und EUR-Beträge stimmen entlang der gesamten Zuordnung. |
| Datenbank und Ereignisse | Endzustand `refunded`; je eine Autorisierungs-, Einzugs- und Erstattungsoperation. Acht unterschiedliche Ereignis-IDs einschließlich vier tatsächlich verarbeiteter Stripe-Webhooks. Keine manuell erneut zugestellten Duplikate in diesem Browserlauf; Wiederholungs- und Konkurrenzfälle sind zusätzlich automatisiert geprüft. |
| Minderjährigenansicht | Normale minderjährige Demo-Person sieht keine Bankeinrichtungsaktion und den ehrlichen Hinweis auf das noch erforderliche Modell. Kein fremdes Elternkonto und keine Altersumschreibung als Umgehung. |

Der klar markierte synthetische Auftrag heißt **Workfare Pay · Sandbox-Testtermin**. Seine Conversation-ID ist `4f5d736f-1782-4bd0-a276-4586ce39e7ee`, Termin-ID `6d0b1774-b92a-4797-be7f-a2c1beb55b29`, Zahlungsauftrag `c5424048-b9c5-49c2-8b34-b13e74e4fb2c`. Diese IDs sind reine lokale QA-Zuordnungen. Es gab keine echten Abbuchungen, Bankauszahlungen oder Änderungen an der Produktionsdatenbank.

### Behobene Integrationsbefunde

- Ein abgebrochener manueller Kartenbetrag besitzt bei Stripe unter Umständen eine erfolgreiche, aber nicht eingezogene Charge. Die Historie liest den eigentumsgebundenen Parent-PaymentIntent im selben Listenaufruf und zeigt korrekt **Vormerkung aufgehoben** statt weiter **Vorgemerkt**.
- Ein kurzzeitig gesperrter Stripe-Status ohne offene Nutzeranforderung fordert nicht mehr sinnlos zur Datenergänzung auf. **Status prüfen** liest den tatsächlichen Stand erneut und hat im Browserlauf anschließend die korrekte Bereitschaft hergestellt.
- Die lokale CLI filterte Thin Events ohne `context` bereits vor der Weiterleitung aus. Acht fehlende historische Events hatten nachweislich leeren Kontext. Der Listener verwendet nun beide Ursprünge mit unverändert engem Ereignistypfilter. Alle vier Listener wurden danach kontrolliert neu gestartet. Historische Events werden dadurch nicht rückwirkend als zugestellt behauptet; der reguläre aktuelle Kontosync stellt den Stand wieder her.
- Unterbrochene finanzielle Operationen lassen sich mit derselben gespeicherten Operation fortsetzen. Der Autorisierungshinweis beschreibt jetzt ausdrücklich die Kartenvormerkung.

### Visuelle Endprüfung und Grenzen

Die Anbieterübersicht wurde in Hell und Dunkel bei 390 × 844 sowie auf dem Desktop bei 1280 × 900 geprüft. Bei 360 Pixel Breite wurden zusätzlich die Übersicht, der geöffnete Rechnungsbereich, das Bearbeitungsformular und die Hilfe geprüft. Empfänger-Onboarding, Guthaben und Terminzahlung wurden im regulären Desktopbrowser geprüft. Die gemessene Dokumentbreite der Anbieterübersicht entsprach jeweils der Ansichtsbreite; kein horizontaler Überlauf. Die finale Zahlungsübersicht zeigte keine erfassten Browserfehler. Verwaltungsabbruch und Fokusrückkehr wurden direkt geprüft. Temporäre Ansichtsgrößen wurden anschließend zurückgesetzt.

Screenshots liegen außerhalb des Repositorys unter `/Users/rezan/.codex/visualizations/2026/10/24/workfare-pay-v2/`: `mobile-light.png`, `mobile-dark.png`, `desktop-light.png`, `desktop-dark.png`, `stripe-balance.png`, `stripe-payouts-dark.png`, `stripe-management-dark.png` und `chat-paid.png`. Die letzte Datei dokumentiert den zwischenzeitlich bezahlten Zustand vor der anschließenden vollständigen Erstattung.

Nicht als tatsächlicher Browsernachweis ausgegeben werden eine herausgeforderte 3-D-Secure-Karte, eine Bankauszahlung, ein produktiver PayPal-Pfad oder die vollständige Empfängerprüfung Minderjähriger. Diese Freigaben und zusätzliche Tests bleiben vor dem Echtgeldpilot erforderlich. Der IAB ließ den notwendigen Connect-Authentifizierungs-Popup nicht erfolgreich abschließen; derselbe eingebettete Pfad wurde anschließend im regulären Helium-Browser erfolgreich bis zum verwendbaren Konto durchlaufen. Die Stripe-eigenen Testtexte enthalten teilweise noch den synthetischen Seednamen „Default“; dies ist kein verifizierter Firmenname für einen Livebetrieb.

Echtgeld, Produktionsgebühren, das verbindliche Minderjährigen-/Tätigkeitsmodell, finanzielle Buchführung, dauerhafte Reconciliation und die produktive Streitfall-/Erstattungsorganisation bleiben eigenständige Freigaben. Die offenen Voraussetzungen und Betriebsabläufe stehen in [Workfare Pay lokal prüfen](../operations/workfare-pay-local.md) und [Terminzahlungen im Testbetrieb](../operations/workfare-pay-orders.md).

## Ergänzung: Familienkonto und persönliche Finanzübersicht

Der abschließende lokale Stand erweitert den Familienzugang um ein neutrales Elternkonto ohne Marketplace-Rolle. Vollständiger Privat-Anbieterzugang wird ausdrücklich im bestehenden Onboarding eingerichtet; Name, Geburtsdatum und Familiennachweise bleiben erhalten. Bereits vollständige Anbieter werden nicht erneut durch die Einrichtung geschickt. Unvollständige ältere Privat-Anbieterkonten können ihre Einrichtung mit derselben Rolle und demselben Geburtsdatum fortsetzen. Passwortwahl nach frischer E-Mail-Bestätigung und Passwortanmeldung sind vorbereitet; bestehende und verwaltete Demo-Zugangsdaten werden nicht überschrieben.

Die Startseite der Jobsuchenden zeigt bestätigten Verdienst sowie verfügbare und ausstehende Stripe-Beträge. Die vollständige Pay-Übersicht ergänzt Bankauszahlungen und eigene Terminzahlungsvorgänge. Unbekannte Salden erscheinen als „—“. Die Datenbank zählt bezahlte Termine, nicht unterschiedliche Jobs. Minderjährige können ihre eigenen Statistiken sehen; dadurch wird keine Auszahlungseinrichtung freigegeben. Die Startseite liest keine Payout-Historie. Der eigene GET-Kontext `view=home` ist strikt begrenzt, hat keinen Zielnutzerparameter und behält die vollständigen Eigentumsprüfungen bei. Es gibt keine periodischen Finanzabfragen im Browser.

Aktueller Abschlussnachweis, der die früheren Zwischenstände dieses Berichts ergänzt:

- `npm run test:all`: **1.944 Haupttests + 14 Angebotstests + 25 Demotests + 2 Abhängigkeitsprüfungen = 1.985 erfolgreiche Prüfungen**.
- Neue Eltern-/Upgrade-Prüfungen: **137 echte PostgreSQL-Prüfungen**; Finanzübersicht: **33**; zukünftiger Eltern-Demoseed und Besuchsisolation: **26**. Die Wegwerfdatenbanken verwenden keine Stripe-Aufrufe oder fremden Zugangsdaten.
- Gesamtes ESLint: **0 Fehler, 40 bestehende Warnungen**. Der gezielt geprüfte Payment-/Guardian-Bereich ist ohne Warnungen. TypeScript, abschließender lokaler Next-Produktionsbuild und `git diff --check` sind erfolgreich. Die gebaute Vorschau läuft auf Loopback-Port 3001.
- Lockfile-Audit: **0 bekannte Schwachstellen**. In 581 geprüften Textdateien des Git-Dateisatzes wurden keine aktuellen privaten Secretwerte aus den lokalen Umgebungsdateien gefunden; die Werte selbst wurden nicht ausgegeben.
- Browser: regulärer E-Mail-Code-Zugang zum vorhandenen Eltern-Testkonto, Familienverwaltung und Passwortoptionen geprüft. Das vorhandene Konto ist bereits vollständiger Anbieter; die erstmalige Family-only-Aufwertung ist durch die realen Datenbank-/Routingprüfungen belegt, nicht als neuer vollständiger Browserdurchlauf ausgegeben. Es wurde kein Passwort neu gesetzt oder zurückgesetzt.
- Jobsuchenden-Startseite, Minderjährigenstatistik und vollständige Pay-Ansicht auf 393 Pixel Breite sowie Pay auf Desktop geprüft; kein horizontaler Überlauf in den gemessenen Ansichten und keine erfassten Browserfehler. Die richtigen hellen beziehungsweise dunklen Videoquellen wurden tatsächlich abgespielt. Nach der Optimierung wurde die gebaute Startseite erneut erfolgreich geöffnet. Temporäre Viewports wurden zurückgesetzt.

Der zukünftige lokale Seed gibt Sam ausschließlich Familienzugang und ordnet seine zwei offenen Angebote dem bereits vollständigen Testanbieter Robin zu. Der Seed ist für bereits angelegte Besuche idempotent. Vor dem lokalen Funktionsupdate wurden die bestehenden 20 Identitäten, vier Besuche, 60 Jobs, 33 Bewerbungen, 96 Nachrichten, zehn Familienverbindungen, neun Zustimmungen sowie zwei Zahlungsaufträge mit 13 Ereignissen unverändert verglichen. Normale spätere Testanmeldungen aktualisieren ihre Auth-Sitzungen; sie ersetzen keine Profil- oder Finanzdaten. Das lokale Setup verifiziert die ergänzten RPCs und die nullable Elternrolle ohne Schema-Neuinstallation.

Neue Screenshotnachweise liegen außerhalb des Repositorys unter `/Users/rezan/.codex/visualizations/2026/10/24/workfare-pay-accounts/`: `earnings-mobile-light.png`, `minor-earnings-dark.png`, `pay-mobile-light.png`, `pay-mobile-dark.png`, `pay-desktop-dark.png`, `family-mobile-light.png` und `family-mobile-dark.png`.

Die Stripe-Erweiterung ist inzwischen als installiert bestätigt. Dieser laufende Werkzeugbestand stellt jedoch noch keine Stripe-Kontoaktionen bereit; deshalb ist daraus kein neuer Live-Kontoabgleich entstanden. Es wurden keine Produktionsmigrationen, Live-Zahlungen oder Bankauszahlungen ausgeführt. Die vorhandenen Testkennzeichnungen bleiben bis zur tatsächlichen Live-Umsetzung erhalten. Der fehlende Gebühren-End-to-End-Nachweis und das offene deutsche Minderjährigen-Auszahlungsmodell werden durch diese lokalen UI-/Datenbankprüfungen nicht als erledigt erklärt.
