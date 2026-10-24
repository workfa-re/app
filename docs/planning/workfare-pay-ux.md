# Workfare Pay: Ablauf und Oberfläche

Stand: 24.10.2026. Festgelegter Produktplan und Abnahmevertrag. Der zweckgebundene Elternzugang mit Familienverbindung und gesonderter Plattformzustimmung ist lokal umgesetzt. Die Stripe-Zahlungsvertretung Minderjähriger und der Echtgeldbetrieb sind damit weiterhin weder implementiert noch freigegeben.

## Ziel

Eine Zahlungsübersicht, die sich wie ein fester Teil von Workfare anfühlt. Einrichtung, Änderungen und Fehlerbehebung bleiben im selben Bereich. Ein erledigter Schritt führt direkt zum ursprünglichen Job zurück; er veröffentlicht oder reserviert niemals selbst einen Job.

## Entscheidung für den ersten Start

**Einmal einrichten, danach im Auftrag bezahlen und automatisch aufs Bankkonto auszahlen.** Der erste Live-Start umfasst 14–20-Jährige einschließlich eines zulässigen Elternablaufs für 14–17-Jährige. Ein Erwachsenenpilot ersetzt diesen Umfang nicht.

- Anbieter erstellen ihren Account und ihren Job ohne Zahlungsformular. Erst vor der ersten Veröffentlichung hinterlegen sie ein unterstütztes Zahlungsmittel bei Stripe.
- Jugendliche können zunächst die Plattform und Jobs ansehen. Vor der ersten verbindlichen Reservierung wird die Auszahlung eingerichtet; der ausgewählte Job bleibt als Rückkehrziel erhalten, ohne einen Platz während einer offenen Einrichtung zu blockieren.
- Bei 14–17-Jährigen führt eine einmalige Einladung zum bereits verknüpften, berechtigten Elternteil. Dieser richtet die Zahlungsvertretung in seiner eigenen Sitzung ein. Jugendliche müssen weder das Elternkonto bedienen noch für jeden Job erneut das gesamte Stripe-Onboarding durchlaufen.
- Bei 18–20-Jährigen ist die eigene Einrichtung der Ausgangspunkt. Eine bestehende allgemeine App-Elternregel wird separat bereinigt; daraus entsteht keine künstliche gesetzliche Vertretung Volljähriger.
- Das freigegebene Auszahlungskonto erhält verfügbare Beträge automatisch nach dem tatsächlichen Stripe-Auszahlungsplan. Ein manueller Auszahlknopf, aufladbares Guthaben, ein Wallet und frei gewählte Teilbeträge gehören nicht zum ersten Start.
- Im Chat bleiben Termin, Vergütung und eine passende nächste Aktion. Nach der Arbeit bestätigt der Anbieter die Zahlung. Eine finanzielle Bestätigung ersetzt keine bestehende Preiszustimmung oder notwendige Bankauthentifizierung.

Das ist eine Produktentscheidung, keine Behauptung, dass Stripe die konkrete deutsche Minderjährigenkonfiguration bereits bestätigt hat. Die öffentliche Dokumentation erlaubt noch keine sichere Festlegung von Connected-Account-Inhaber, Guardian-Führung und Bankkontoinhaber für genau dieses Modell. Diese Zuordnung wird vor Live-Abnahme nachgewiesen; sie wird weder durch ein Eltern-Häkchen noch durch falsche Kontodaten ersetzt. Der Plan wird jetzt fertiggestellt und nicht bis zu einer Supportantwort angehalten. Die vorbereitete Anfrage schickt der Nutzer selbst ab; sie wurde von uns nicht versendet. [Offene Zuordnung und Anfrage](../operations/workfare-pay-production.md).

## Der normale Ablauf aus Nutzersicht

| Zeitpunkt | Anbieter | Jugendliche / Eltern | Sichtbares Ergebnis |
| --- | --- | --- | --- |
| Registrieren | Account erstellen | Account erstellen und bei Minderjährigen Eltern verknüpfen | Jobs ansehen ist sofort möglich; keine erzwungene Zahlungsdateneingabe beim Einstieg |
| Erster eigener Job | Vor Veröffentlichung einmal „Zahlungsmittel hinterlegen“ | — | Entwurf bleibt erhalten, nach Rückkehr veröffentlicht der Anbieter ausdrücklich |
| Ersten Job reservieren | — | „Auszahlung einrichten“; bei Minderjährigen einmal „Eltern einladen“ | Eindeutig „Wartet auf Eltern“, „Angaben ergänzen“ oder „Bereit“; keine technische Fehlerseite |
| Termin und Vergütung vereinbaren | Betrag/Dauer und Termin vorschlagen | Genau diesen Stand bestätigen | Gleiche Vereinbarung für beide, höchstens eine nächste Aktion im Chat |
| Zahlung vorbereiten | Karte innerhalb des gültigen Autorisierungsfensters ausdrücklich bestätigen | Hinweis zum echten Zahlungsstand sehen | „Auf der Karte vorgemerkt“ ist keine Abbuchung und keine Zahlungsgarantie |
| Arbeit erledigt | „Prüfen und bezahlen“ mit Vergütung, Servicegebühr und Gesamtbetrag | Fortschritt sehen; nicht erneut Zahlungsdaten einrichten | Nach tatsächlichem Einzug „Bezahlt“; Auszahlung getrennt anzeigen |
| Auszahlung | Beleg abrufen | „Unterwegs zur Bank“ und tatsächlichen Auszahlungsstand sehen | Kein behaupteter Bankeingang allein aufgrund eines Transfers oder einer Browserrückkehr |

Länger im Voraus vereinbarte Termine lösen keine dauerhafte Kartenreservierung aus. Kurz vor dem zulässigen Autorisierungszeitraum erinnert Workfare an die ausdrücklich erforderliche Zahlungsbestätigung. Eine versäumte Aktion bleibt als konkreter nächster Schritt sichtbar; sie führt nicht zu einem stillen Einzug.

## Einmalige Eltern-Einrichtung

1. Der Jugendliche sieht beim ersten Reservierungsversuch einen kurzen Zweck: „Damit deine Vergütung auf dein Bankkonto ausgezahlt werden kann.“ Nur notwendige Angaben und eine Aktion „Eltern einladen“.
2. Der verknüpfte Elternteil erhält einen zweckgebundenen Einstieg. Ohne Sitzung meldet er sich an; Links allein erteilen keine Vertretungs- oder Zahlungsberechtigung. Der Elternteil sieht eindeutig, für welches Kind er handelt.
3. Stripe erhebt die tatsächlich erforderlichen Prüf-, Vertretungs-, Vertrags- und Bankdaten. Bereits verwertbare Daten werden unterstützt wiederverwendet. Die Eltern brauchen dafür kein Zahlungsmittel als Jobanbieter und müssen kein eigenes öffentliches Anbieterprofil erstellen.
4. Nach Rückkehr gleicht der Server den tatsächlichen Status ab. Offene Anforderungen bleiben konkret sichtbar. Eine Rückkehr-URL, ein geschlossenes Popup oder die bestehende Workfare-Elternfreigabe zählt niemals als abgeschlossene Auszahlungseinrichtung.
5. Sobald beide unabhängigen Voraussetzungen erfüllt sind — Plattformfreigabe und zulässige PSP-Auszahlungsbereitschaft — kann der Jugendliche den ausgewählten Job erneut reservieren. Ist er inzwischen vergeben, geht es verständlich zurück zu verfügbaren Jobs.

„Einmalig“ bedeutet keine Garantie gegen spätere gesetzlich oder von Stripe erforderliche Aktualisierungen. Mehrere Kinder behalten eigene Empfängerzuordnungen; Elternwechsel, Widerruf und der 18. Geburtstag haben einen ausdrücklichen Übergang. Alte Zahlungen, Erstattungen und Belege bleiben dabei zugeordnet. Der exakte Stripe-Personen-/Kontoschnitt bleibt bis zum deutschen Modellnachweis offen.

## Was sichtbar wird — und was nachgeordnet bleibt

| Ort | Inhalt | Sichtbare Hauptaktion |
| --- | --- | --- |
| Veröffentlichung | Kurz erklären, warum ein Zahlungsmittel nötig ist; keine Identitätsbehauptung | „Zahlungsmittel hinterlegen“ |
| Erste Reservierung | Auszahlung/Elternstatus und gespeichertes Rückkehrziel | „Auszahlung einrichten“ oder „Eltern einladen“ |
| Chatkopf | Nur der gerade notwendige Zahlungs- oder Terminschritt neben Details | Zum konkreten Bereich in Details öffnen; kein unmittelbarer Geldauftrag |
| Termindetails | Vereinbarte Vergütung, Servicegebühr, Gesamtbetrag; passende Zahlungsaktion | „Zahlung bestätigen“ beziehungsweise „Prüfen und bezahlen“ |
| Workfare Pay in Einstellungen | Zahlungsmittel oder Auszahlung, echte Vorgänge, Belege, notwendige Datenänderungen | Genau eine Hauptaktion pro Zustand; weitere Funktionen aufklappbar |
| Elternansicht | Kind, Zahlungsvertretung, offene Anforderungen, zugeordnete Vorgänge | Nur eine notwendige Einrichtung oder Aktualisierung pro Kind |

Keine wiederholte Vertrauenswerbung, keine rechte Infospalte, keine neuen Haupttabs, keine unverständlichen Guthaben-Unterkonten. „Verfügbar“, „Vorgemerkt“ und Bankauszahlungen bleiben fachlich unterscheidbar. Ein echter Auszahlungsverlauf wird erst gezeigt, wenn tatsächlich eigene Daten vorliegen.

## Umfang und Reihenfolge der Umsetzung

| Reihenfolge | Paket | Fertig, wenn |
| --- | --- | --- |
| 1 | Bestehende Stripe-Oberflächen zuverlässig machen | Wiederholung, Schließen/Öffnen, notwendige Authentifizierung, Browser-Ausweichweg, Mobil, Hell/Dunkel und ehrliche Serverzustände geprüft sind; weitgehend lokal umgesetzt |
| 2 | Eltern-Einrichtung und volljähriger Eigenpfad | Rollen und Bankzuordnung konkret belegt, eigene Elternsitzung und getrennte Zustimmungen implementiert; 14–15, 16–17, mehrere Kinder und Volljährigkeitswechsel geprüft sind |
| 3 | Produktionsfähiger Kartenablauf | Eigene Live-Konfiguration, Migrationen, Tarif, Webhooks, Wiederabgleich und Fehlerbetrieb fertig sind; weder Testbereitschaft noch Testobjekte in Live übernommen werden |
| 4 | Begrenzter erster Live-Start einschließlich Minderjähriger | Einrichtung bis tatsächlicher Bankauszahlung und Rückabwicklung für den freigegebenen Teilnehmerkreis nachgewiesen sind |
| 5 | SEPA als unmittelbar folgendes Zahlartenpaket | Mandat, Einzug nach Leistung, verzögerter Eingang, Rückgabe und Fehlerwege eigenständig implementiert sind; kein Karten-Capture für Lastschrift wiederverwendet wird |
| Später | PayPal und zusätzliche Komfortfunktionen | Bedarf und tatsächliche Methodenfreigabe vorliegen; kein Ausbau zulasten eines funktionierenden Grundablaufs |

Das Ziel von ungefähr 5 % Beitrag nach direkten Zahlungskosten wird für den späteren Live-Tarif kalkuliert: Die vereinbarte Vergütung bleibt beim Jugendlichen; der Anbieter sieht eine Servicegebühr zusätzlich. Der aktuelle lokale Testtarif `test-service-5-v1` berechnet ausdrücklich **5 % Bruttogebühr**, mit nur simulierter 19-%-Steueraufteilung. Er erreicht damit nicht automatisch das Beitragsziel und legt weder Live-Steuerbehandlung noch Produktionspreis fest. Alte Nullgebühr-Quotes bleiben unverändert.

## Aufbau

Einspaltig, maximal 780 Pixel breit, dieselben neutralen Glasmaterialien und Inter wie in den übrigen Einstellungen. Desktop und Mobil verwenden dieselbe Reihenfolge. Keine rechte Infospalte, keine erfundenen Kennzahlen, keine zusätzlichen Haupttabs.

| Anbieter | Jobsuchende |
| --- | --- |
| Zahlungsmittel mit einer sichtbaren Aktion „Ändern“ | Auszahlung mit einer sichtbaren nächsten Aktion |
| Echte Zahlungen und Belege, kompakt und mit klaren Zuständen | Guthaben und Auszahlungsverlauf nur aus tatsächlichen Stripe-Daten |
| Rechnungsdaten als aufklappbarer Bereich | Auszahlungsdaten und offene Stripe-Anforderungen eingebettet ändern |
| Fragen und Datenschutz am Ende, geschlossen | Fragen und Datenschutz am Ende, geschlossen |

Der lokale Testbetrieb ist mit einer kurzen, durchgehend sichtbaren Kennzeichnung versehen. Erklärungen zu Speicherung und Abbuchung stehen unmittelbar vor der Zustimmung. „Zahlungsabwicklung durch Stripe“ erscheint nur bei tatsächlicher Stripe-Anbindung.

## Zustände und Rückkehr

1. Konto erstellen und Jobs ansehen bleibt ohne Zahlungsdaten möglich.
2. Anbieter füllt seinen Job aus. Erst vor Veröffentlichung erscheint der Einstieg zum Zahlungsmittel; der Entwurf wird vorher gesichert.
3. In Workfare Pay öffnet sich die Stripe-Einrichtung im vorhandenen Glasbereich. Kein eigenes Kartenformular, keine separate Zwischenseite.
4. Nach bestätigtem Abschluss lädt der Server den aktuellen Status. Bei vorhandenem Jobkontext geht es direkt dorthin zurück. Ohne Jobkontext verwandelt sich derselbe Bereich in die Übersicht des hinterlegten Zahlungsmittels.
5. Abbrechen schließt nur den Einrichtungsbereich. Bestehendes Zahlungsmittel und Jobentwurf bleiben erhalten. Ein Ersatz wird erst nach geprüftem Erfolg übernommen.
6. Jobsuchende richten vor ihrer ersten Reservierung die Auszahlung ein. Die Datenbank prüft Bereitschaft bei jeder neuen Reservierung erneut, falls Stripe sie später entzieht. Elternfreigabe bleibt eine unabhängige Voraussetzung.
7. Für Empfänger laufen Einrichtung, spätere Datenpflege, Guthaben und Auszahlungsverlauf über die jeweils benötigte Stripe-Komponente. Notwendige Stripe-Authentifizierung bleibt erhalten.
8. Arbeit abgeschlossen, Zahlung eingezogen und auf dem Bankkonto angekommen sind verschiedene Zustände. Der Chat zeigt nur die passende nächste Aktion.

## Verwaltung

- „Ändern“ beginnt den Austausch direkt im Hauptbereich.
- Ein nachgeordnetes Menü bietet Entfernen; vor dem Entfernen erscheint eine knappe Bestätigung an derselben Stelle.
- Fehlgeschlagene Entfernungen behalten einen ehrlichen Status und eine gezielte Wiederholung. Sie führen nicht zu einer erneuten Einrichtungsschleife.
- Zahlungs- und Rechnungsbelege stammen aus dem eigenen Stripe-Kundenkonto. Kein behaupteter Zahlungsverlauf aus Chatnachrichten oder Jobstatus.
- Rechnungsdaten werden getrennt von Profil, geprüfter Anbieteradresse und Einsatzort gespeichert und geändert.
- Keine Abonnements, Rabatte, Instant Payouts oder manuellen Auszahlungsfunktionen allein deshalb hinzufügen, weil Stripe sie anbietet.

## Umsetzungspakete und Abnahme

| Paket | Abnahme |
| --- | --- |
| Eingebettete Käufer-Einrichtung | Stripe-Testkarte, Abbruch, Ersatz, Entfernung und unmittelbare Rückkehr tatsächlich geprüft |
| Empfänger und Reservierung | Eigentum, offene Anforderungen, keine falsche Bereitschaft, Testkohorte und Datenbank-Gate geprüft |
| Übersicht und Verwaltung | Echte Belege, leere/fehlerhafte Zustände, Rechnungsdaten, Hell/Dunkel und Handy geprüft |
| Terminzahlung | Beidseitig bestätigter Vergütungsstand, unveränderlicher Cent-Preis, ausdrückliche Zahlungsaktion, getrennte Finanzzustände und idempotente Verarbeitung |
| Echtbetrieb | Passendes Empfänger-/Minderjährigenmodell, Betreiberpflichten, Preise, Verträge und Betrieb gesondert freigeben |

Die vorhandene Stripe-Sandbox darf mit bestätigten privaten Testschlüsseln verwendet werden. Live-Schlüssel, echte Karten, echte Auszahlungen oder unbestätigte Minderjährigenmodelle werden nicht automatisch aktiviert.

## Gestaltungsvertrag

Das vollständige Bildkonzept liegt außerhalb des Repositorys unter `generated_images/.../exec-70d8f4ec-c5c3-4575-8d9c-df0dcaa6fcc1.png`. Es ist eine Layoutreferenz, kein eingebautes Bitmap. Die bestehende Workfare-Kopfzeile bleibt maßgeblich; das Bild ersetzt weder das Brückenlogo noch dessen etablierte Gestaltung.

Eine klare Spalte, drei kompakte Bereiche, runde Glaskontrollen, höchstens eine primäre Aktion pro Zustand. Bestehende `--app-surface-*`- und `--app-glass-*`-Variablen steuern beide Farbmodi. Keine gefärbten Flächen, kein blaues Leuchten, keine Skalierung beim Seitenwechsel. Stripe-Inhalte werden ausschließlich über unterstützte Appearance-Optionen angepasst.
