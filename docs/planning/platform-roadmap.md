# Workfare: priorisierter Ausbauplan

Stand: **24.10.2026**. **98 konkrete Backlogpunkte in zehn Bereichen.** Dies ist ein Planungs- und Entscheidungskatalog, keine Behauptung, dass die Funktionen entwickelt, freigegeben oder live sind.

Aktiv vorbereitet wird jetzt **Workfare Pay**. Die anderen Features bleiben für spätere Pakete dokumentiert; notwendige Sicherheits-/Betriebsaufgaben laufen als Voraussetzung des Zahlungspakets mit. Den konkreten nächsten Umfang beschreibt der [Planungsindex](README.md).

**Zuerst lesbar:** Die [Feature-Übersicht](feature-overview.md) bündelt die echten Nutzerfunktionen und stellt Elternübersicht, Zahlungen und SMS heraus. Dieser Katalog bleibt die technische Vertiefung. Der [Zahlungsanbieter-Vergleich](payment-provider-comparison.md) erklärt das präzisierte Gebührenmodell: voller Jugendverdienst, zusätzliche Anbieter-Servicegebühr und ca. 5 % Zielbeitrag nach direkten Zahlungskosten.

**Angefragt sind Workfare Pay, Treue/Vorteile und Freunde/Einladungen.** Deren fachliche und technische Freigaben stehen teilweise noch aus. Die übrigen Bereiche sind Vorschläge für sinnvolle Ergänzungen oder Abnahmen bestehender Funktionen; sie sind nicht pauschal zur Umsetzung beauftragt. Bereits vorhandene Funktionen werden nur dort erneut aufgeführt, wo eine konkrete Qualitäts-, Sicherheits- oder Ausbaustufe gemeint ist.

## Produktbild und Grenzen

Workfare hilft Menschen, einen passenden lokalen Job zu finden beziehungsweise anzubieten, eine Person verbindlich zu reservieren, Termin und Vergütung zu vereinbaren und die Zusammenarbeit nachvollziehbar abzuschließen. Die Oberfläche zeigt jeweils **einen verständlichen nächsten Schritt**.

- **Drei Haupttabs bleiben:** Jobs – rollenabhängig „Jobs finden“ oder „Meine Jobs“ –, Nachrichten, Einstellungen. Keine eigene Hauptnavigation für Pay, Vorteile oder Freunde.
- **Zahlungen:** zuerst im Auftrags-/Terminbereich neben der nächsten nötigen Aktion; zusammenfassender Verlauf unter Einstellungen. Berufliche Zusammenarbeit und Finanzstatus bleiben getrennt.
- **Treue/Vorteile:** sekundärer Einstieg im Profil oder in den Einstellungen; klare, finanzierbare Gebührenvorteile statt eines Geldguthabens.
- **Freunde und Einladungen:** privater sekundärer Bereich und natives Teilen; kein Social Feed, keine Telefonbuchsammlung und keine automatisch verschickten Einladungsmails.
- **Eine aktive Person pro Job:** erste erfolgreiche Bewerbung reserviert. Ablehnung, Rückzug oder zulässige Absage können den Job wieder freigeben. Keine neue Jobwarteliste, keine automatische Nachrücklogik, keine Mehrbewerber- oder Teamfunktion als Nebenprojekt.
- **Ruhiges Liquid Glass:** gemeinsame Materialien, Typografie, Fokus- und Bewegungsregeln in Hell/Dunkel, lesbare Inhalte und eindeutige Aktionen. Keine zusätzlichen Glows, Banner oder Animationen ohne Funktion.
- **Fotos bleiben optional:** ohne Foto ein klar erkennbares Kategorie-Icon; mit Foto ein kleiner Vorschaubereich und überlagertes Kategoriezeichen. Keine bildlastige Pflicht zur Jobveröffentlichung.
- **Schutz und Verständlichkeit:** keine öffentlichen Vertrauenszahlen, Kinderrankings, Streak-Zwänge oder KI-Pflichtfunktionen. Öffentliche Profile enthalten keine Bank-, Steuer-, Eltern- oder genaue Privatadressdaten.

## So wird priorisiert

| Kennzeichen | Bedeutung |
| --- | --- |
| **P0** | Voraussetzung für sicheren Betrieb beziehungsweise zwingende Freigabe vor Aktivierung des betreffenden Produkts. Keine automatische Anweisung zu Produktionsänderungen. |
| **P1** | Kernfunktion oder notwendige Abnahme für das nächste freigegebene Paket. |
| **P2** | Sinnvolle Erweiterung nach einem nachweislich stabilen Kern. |
| **P3** | Spätere Option; erst mit Bedarf, Kapazität und gesonderter Produktentscheidung. |
| **D-01 … D-10** | Offene Produktentscheidungen am Ende dieses Dokuments. |
| **G0 … G6** | Abnahmemeilensteine; keine Kalenderzusagen. |
| **ID-Verweise** | Fachliche beziehungsweise technische Voraussetzung. „S-02“ bedeutet beispielsweise: passender serverseitiger Berechtigungsvertrag geprüft. |

Die P0-Punkte Leaked Password Protection, öffentlich erreichbare Definer-RPCs sowie Staging/Recovery stammen aus dem aktuellen Auditauftrag. Ihre **tatsächliche Konfiguration und Abnahme muss separat belegt** werden. Dieses Planungsdokument aktiviert keine Einstellung und ersetzt keinen Advisor-Bericht.

### Einbauorte

Bestehende Orte sind konkret genannt. Neue Routen, Module und Tabellen sind ausdrücklich **geplant**, nicht bereits vorhanden. Für längere Pfade verwenden die Tabellen diese Kürzel:

| Kürzel | Bestehender Ort |
| --- | --- |
| Jobs | `/app-home/jobs`; `src/components/jobs/JobsList.tsx`, `JobCard.tsx`, `JobDetailModal.tsx` |
| Angebote | `/app-home/offers`, `/app-home/offers/new`, `/app-home/offers/edit/[jobId]`; `CreateJobForm.tsx` und zugehörige Actions |
| Nachrichten | `/app-home/activities?conversation=<id>`; `ApplicationChat.tsx`, `ChatDetails.tsx`, `ChatAppointments.tsx` |
| Profil | `/app-home/profile`; `ProfileEditForm.tsx`, `UserProfileModal.tsx`, `public-profile.ts` |
| Einstellungen | `/app-home/settings`; Unterseiten `security` und `notifications` |
| Benachrichtigungen | `src/components/notifications/`; gemeinsamer Store, Feed, Panel und Routing |
| DAL/RPC | `src/lib/dal/platform.ts`, fachliche Server-Actions; additive Migrationen unter `infrastructure/database/migrations/` |
| Betrieb/Admin | Bestehende externe Administration, serverseitige privilegierte Zugriffe und `docs/operations/database-rollout.md`; keine neue Adminrolle im Consumer-Browser |

## 1. Stabilität und Sicherheit — Vorschlagskatalog, zehn Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| S-01 | Leaked Password Protection prüfen und für den freigegebenen Betrieb korrekt konfigurieren; bekannte kompromittierte Passwörter nicht unbemerkt zulassen | Supabase-Auth-Konfiguration; Passwortwechsel unter Einstellungen/Sicherheit; dokumentierter Konfigurationstest | P0 | Betreiberzugriff und Tarif-/Funktionsverfügbarkeit prüfen; G0 |
| S-02 | Alle öffentlich ausführbaren Definer-RPCs inventarisieren und Rolle, Ownership, Argumente, Suchpfad und Grants prüfen; Rechteausweitung ausschließen | Migrationen, PostgreSQL-Grants/RLS, DAL/RPC; negative Tests mit anon und fremdem Nutzer | P0 | Aktueller Schema-/Ledgerabgleich; G0 |
| S-03 | Sauberes Staging und beweisbar wiederherstellbare Backups einrichten; Änderungen vor echten Nutzerdaten prüfen | Getrennte Auth-/DB-/Storage-/PSP-Umgebungen, Secrets und Rollout-Runbook; Restore-Probe | P0 | Betriebsverantwortlicher und Datenminimierung; G0 |
| S-04 | Verifizierte Sitzung und saubere Rollenwechsel über alle Einstiege absichern; kein Zugriff über veraltete Cookies oder alte Ansichten | `src/lib/auth.ts`, `app-shell.ts`, Server-Actions und Auth-Tests | P1 | S-02 |
| S-05 | Automatisierte Kernpfade pro Rolle prüfen; Anmeldung, Veröffentlichung, Reservierung, Termin und Abschluss dürfen nicht auseinanderlaufen | Bestehende Unit-/UI-Tests und isolierte Datenbanktests; repräsentative mobile/desktop Rollenpfade | P1 | S-02, S-03 |
| S-06 | Doppelte initiale Reads und Realtime-Abonnements vermeiden; schnellere App bei unveränderter Berechtigung | App-Shell, DAL, Chat-Synchronisierung, Notification-Store; Messung von Requests und Abos | P1 | S-04; keine Änderung an RLS aus Performancegründen |
| S-07 | Fehler, Offlinezustand und Wiederholen vereinheitlichen; keine verlorenen Eingaben oder Endlosspinner | Gemeinsame Lade-/Fehlerkomponenten, Formulare und Server-Action-Ergebnisse | P1 | S-04 |
| S-08 | Glass-Materialien und Übergänge als verbindliche Tokens abnehmen; Hell/Dunkel und Touch bleiben einheitlich | `app-chrome.css`, `GlassCard`, `GlassTabs`, Komponenten-CSS; Fokus und reduzierte Bewegung | P1 | S-05 |
| S-09 | Abhängigkeiten und Lieferkette regelmäßig prüfen; reproduzierbare Builds ohne ungeprüfte Upgrade-Ketten | Lockfile, Build-/CI-Konfiguration, dokumentierte Dependency- und Secret-Scans | P1 | S-03 |
| S-10 | Kernseiten mit messbarem Performancebudget abnehmen; langsame Geräte und schlechte Verbindung berücksichtigen | Jobs-/Angebots-/Nachrichtenseiten, serverseitige Laufzeiten und Bundle-/Netzwerkmessung | P2 | S-05, S-06 |

## 2. Jobs finden und erstellen — Vorschlagskatalog, zwölf Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| J-01 | Eine klare Kartenhierarchie für Titel, kurze Beschreibung, Vergütung, Ort und nächste Aktion festlegen; mobil ohne Informationssprünge | Jobs/Angebote; `JobCard.tsx` und `JobCard.module.css`; gemeinsames Read Model | P1 | S-08 |
| J-02 | Kategorie-Icon als Standard und optionales kleines Foto mit Kategoriezeichen verwenden; gute Angebote ohne Bild möglich | `JobCard`, `CreateJobForm`; vorhandener Medien-/Storagepfad mit Uploadprüfung | P1 | J-01, S-02; keine Pflichtfotos |
| J-03 | Filter wie Ort/Umkreis, Kategorie und Vergütungsart verständlich machen; aktive Filter einzeln oder gemeinsam wirklich entfernen | `JobFilterSortPanel`, Jobs-URL-/Formstate und DAL-Filterparameter | P1 | J-01, S-05 |
| J-04 | Öffentliche Ortskarte mit passender Genauigkeit zeigen; Entfernung verstehen, private Adresse schützen | `JobLocationMap`, Detailansicht; `public_location_label` und bestehende Address-Reveal-Regeln | P1 | S-02, J-01 |
| J-05 | Veröffentlichung in kompakte Schritte mit vollständiger Vorschau ordnen; Tippfehler vor dem Freigeben sehen | Angebote/Neu, `CreateJobForm`, `create_job`-Vertrag | P1 | J-02, J-04 |
| J-06 | Vorhandene lokale Entwürfe nach Konto trennen und den Umgang beim Abmelden festlegen; ein anderes Konto auf demselben Gerät sieht keinen fremden Entwurf. Geräteübergreifendes Speichern erst später ergänzen | Angebote/Neu, `use-job-persistence.ts`, kontobezogener Storage-Key samt sicherer Altdatenmigration; später privater Draft-RPC mit Provider-Ownership | P1 | S-04, S-05; S-02 vor serverseitiger Speicherung |
| J-07 | Zulässige Tätigkeiten für Alter und Schulstatus prüfen; ungeeignete Angebote nicht erst nach Vertragsabschluss erkennen | Angebotserstellung/-Prüfung und Bewerbungs-RPC; fachlich freigegebene Tätigkeitsregeln geplant | P0 vor erweitertem Minderjährigenfluss | D-01, S-02; Pay-Konzept |
| J-08 | Exklusive Reservierung einschließlich Rennen zweier Bewerbungen abnehmen; eine klare Zu- oder Absage statt Warteliste | Job-/Bewerbungs-Actions, `applications`, Reservierungs-RPC und Unique Constraints | P1 | S-05; bestehendes Reservierungsmodell erhalten |
| J-09 | „Absagen und wieder anbieten“ mit klarer Wirkung zeigen; Anbieter bringt einen freien Job verständlich zurück | Angebotsdetails und Chatdetails; bestehende Close-/Reopen-RPCs mit Zustandsprüfung | P1 | J-08, C-03 |
| J-10 | Wiederkehrenden Job als Beziehung mit einzelnen Terminen erklären; kein dupliziertes Angebot pro Besuch nötig | Erstellung, Angebotsdetails und Termine; `job_engagements`, `job_appointments` | P2 | C-04, J-05 |
| J-11 | Archiv und kopierbares neues Angebot sauber trennen; alte Bewerbungen/Belege bleiben unverändert | Angebote/Archiv; neue Kopieraktion geplant mit neuer Job-ID und ohne Übernahme alter Teilnehmer | P2 | J-08, C-03; P-04 bei Pay |
| J-12 | Verständliche Leer-/Nichtverfügbar-Zustände anbieten; Nutzer erkennen Filterproblem, reservierten Job oder inaktive Region | Jobs/Angebote und Deep-Link-Fehlerzustände; berechtigungsgeprüfte Verfügbarkeitsprojektion | P1 | J-03, J-08, R-01 |

## 3. Chat und Termine — Vorschlagskatalog, zwölf Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| C-01 | Inbox auf Jobtitel, Gesprächspartner, letzte Nachricht und ein dezentes Statussignal reduzieren; gleichnamige Jobs bleiben unterscheidbar | Nachrichtenliste, `ProviderActivityList`/Workspace und `get_activity_inbox_summaries` | P1 | S-06, S-08 |
| C-02 | Chat auf Mobilgeräten den verfügbaren Platz nutzen lassen; Header, Verlauf, Composer und Tabbar verdecken sich nicht | `ActivityWorkspace.module.css`, `ApplicationChat`, App-Chrome; Viewport-/Safe-Area-Tests | P1 | S-08 |
| C-03 | Offen/reserviert/vereinbart/abgeschlossen mit genau einer sinnvollen Folgeaktion führen; Statusduplikate entfernen | `ChatDetails`, `chat-details.ts`, Statusleiste; bestehende Lifecycle-RPCs | P1 | S-05, J-08 |
| C-04 | Vereinbaren, Änderungsanfrage, Annahme, Rückzug und weiterer Termin konsistent behandeln; keine versteckten offenen Anfragen | `ChatAppointments`, `useAppointmentRequests`, `job_appointment_requests`; Versionsprüfung | P1 | C-03, S-02 |
| C-05 | Aktive Hinweise direkt zum passenden Detailbereich verlinken; zurückgezogene/historische Hinweise bleiben reine Information | `ApplicationChat`, `ChatDetails`, Focus-Hook; stabile Request-/Appointment-IDs | P1 | C-04 |
| C-06 | Suche im Verlauf mit vollständiger Paginierung und Trefferrückkehr anbieten; alte relevante Absprachen auffinden | Suchbereich in Chatdetails, Timeline-Abfrage/-RPC und Cursor-Paginierung | P2 | C-01, S-02 |
| C-07 | Senden gegen Doppelklick, Reconnect und Timeout absichern; fehlgeschlagener Text bleibt wiederholbar | Composer, `chat-sync.ts`, Message-Nonce und `send_application_message` | P1 | S-05, S-06 |
| C-08 | Einheitliches Profil aus Name/kompakter Personenkarte öffnen; Details bleiben auf den Auftrag konzentriert | Chatkopf/-Details → `UserProfileModal`; Partnerprofil-Projektion | P1 | U-01, U-02 |
| C-09 | Person, Chat oder einzelne Nachricht zentral melden; Auswahl und Rückkehr ohne Datenverlust | `ReportDialog` in Details; scoped Reporting-RPC und service-only Evidence | P1 | S-02; bestehende Reporting-Abnahme |
| C-10 | Archiv, Lesen und begrenzte Wiederanfrage konsistent abnehmen; alte Chats bleiben nachvollziehbar, ohne freie Wiederaufnahme | Nachrichten/Archiv, Closure-Version, Reopen-Request-RPC und Focus-Hook | P1 | C-03, S-05 |
| C-11 | Relevante Absprachen als gut lesbare Termin-/Statuszeile statt Nachricht vortäuschen; verständliche Zeitpunkte | Systemereignisse im Verlauf und Statusleiste; vorhandene Event-IDs, Formatierung/Zeitzonen | P2 | C-04, C-05 |
| C-12 | Verbindlichen Abschluss mit noch offenen Terminen und später Pay-Fällen zusammenführen; kein stiller Datenverlust | Abschlussdialog in Details; Engagement-/Appointment-Status, später Zahlungsprojektion | P1 | C-03, C-04; P-10 vor Pay-Aktivierung |

## 4. Workfare Pay — angefragt, sechzehn Punkte

Der ausführliche Geldfluss, Primärquellen und offene Zulässigkeitsfragen stehen in [Workfare Pay](workfare-pay.md). Alle folgenden Pay-Orte sind geplant; es gibt noch keine fertige Zahlungsintegration.

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| P-01 | Betreiber-, Arbeits-/Dienstleistungs- und Zahlungsmodell schriftlich freigeben; keine unzulässige Lohnzahlung als Händlerverkauf behandeln | Produkt-/Legal-Entscheidung, PSP-Sachverhalt, versionierte Vertragsgrundlage | P0 vor Pay | D-01, D-02; G1 |
| P-02 | Deutsche Empfänger von 14–17 samt Erwachsenenvertretung und Bankkonto von PSP und Recht prüfen lassen; keine Elternkonto-Umgehung | Stripe-/PSP-Freigabe, geplante Berechtigungsnachweise, Eltern-/Onboardingablauf | P0 vor Minderjährigen-Pay | P-01, D-02, U-04 |
| P-03 | Tarif, Steuerbehandlung, Verlustreserve, Refunds und Nichtreaktion entscheiden; Kosten und Verantwortung sind vor Zahlung klar | Preis-/Vertragsstand, interner Betrieb; keine unbeschlossene Gebühr veröffentlichen | P0 vor Pay | P-01, D-03, D-04 |
| P-04 | Finanzauftrag mit unveränderlicher Termin-/Vergütungsversion anlegen; spätere Jobänderungen verändern keine Zahlung | Geplante `payment_terms`/`payment_orders`; Teilnehmerauflösung über Anwendung/Engagement/Termin | P1 | P-01, P-03, C-04, S-02 |
| P-05 | Festbetrag und Stundenhöchstbetrag mit getrennten Gebühren bestätigen; Anbieter kennt Gesamtpreis, Jobsuchender seinen Verdienst | Termin-/Vergütungsdialog in Details; serverseitige Cent-Berechnung und Zustimmungsnachweise | P1 | P-04, D-03 |
| P-06 | Geprüfte Auszahlungseinrichtung über PSP-geführtes Onboarding anbieten; keine Ausweisdokumente im allgemeinen Profil sammeln | Geplant Einstellungen/Zahlungen → Auszahlung einrichten; `pay_accounts`, Capabilities/Requirements | P1 | P-01, P-02 für Minderjährige, U-02, S-03 |
| P-07 | Geeignete Kartenzahlung kurz vor Termin über Checkout autorisieren; Platzreservierung und Kartenbetrag nicht verwechseln | Next-Action-Shortcut und Details/Zahlung; Checkout/PaymentIntent, tatsächliche Capture-Frist | P1 | P-04–P-06, D-04; G2 |
| P-08 | Autorisierungsablauf und Terminverschiebung mit erneuter Bestätigung behandeln; keine monatelange falsche Zahlungssicherheit | Zahlungsversuche, Fälligkeits-/Fristworker und Chatdetails | P1 | P-07, C-04 |
| P-09 | Bestätigten Endbetrag genau einmal einziehen; kein stilles Überziehen des Höchstbetrags | Abschluss-/Vergütungsdialog; Capture-Operation mit Lock, Version und Idempotenz | P1 | P-05, P-07, P-12 |
| P-10 | Transfer und Bankauszahlung unabhängig vom Jobabschluss zeigen; „bezahlt“ bedeutet nicht automatisch „auf dem Bankkonto“ | Details/Zahlung und Einstellungen/Zahlungsverlauf; PSP-Settlement-/Payout-Projektion | P1 | P-06, P-09, P-12 |
| P-11 | Storno vor Einzug sowie Teil-/Vollrefund nach Einzug sauber abwickeln; Kunde und Empfänger sehen den echten Stand | Details/Problemfall, serverseitige Refund-/Transfer-Reversal-Operationen und Belege | P1 | P-03, P-09, P-12, A-08 |
| P-12 | Signierte Webhooks, dauerhafte Befehle, Deduplizierung und Journal aufbauen; Doppelabbuchung/Statusverlust verhindern | Geplante PSP-Adapter, Event-Inbox, Operations-Outbox und ausgeglichenes Finanzjournal | P0 vor Echtgeld | S-02, S-03, P-04; G2 |
| P-13 | Tagesabgleich, Chargeback-/Auszahlungsfälle und Liquiditätsalarme betreiben; Abweichungen bleiben nicht unsichtbar | Interner Betrieb/Admin, Balance-Transaction-/Bankabgleich und Fristenfälle | P0 vor Echtgeld | P-10–P-12, A-03, A-08 |
| P-14 | Einen klaren Zahlungsbereich samt Verlauf und Belegzugriff einbetten; keine neue Wallet-Navigation | `ChatDetails` beim Termin/Next Action; geplant `/app-home/settings/payments`, nur Teilnehmerprojektionen | P1 | P-04–P-12, S-08; G2 |
| P-15 | Begrenzten echten Pilot mit Kill-Switch und belegter Ende-zu-Ende-Abstimmung durchführen; Sandboxerfolg nicht mit Echtbetrieb verwechseln | Server-Feature-Flags, benannte genehmigte Kohorte, Support und Abnahmeprotokoll | P0 vor allgemeinem Pay | P-01–P-14, A-05; G3 |
| P-16 | Plattformzahlung nur für neue versionierte Aufträge verbindlich machen; Altfälle und zulässige Empfänger nachvollziehbar trennen | Neue Angebots-/Terminkonditionen, Eligibility-Regeln und geplanter Migrationshinweis | P1 nach Pilot | P-15, D-05; G4; keine rückwirkende Zwangsumstellung |

## 5. Treue und Vorteile — angefragt, acht Punkte

Ziel sind verständliche, begrenzte Vorteile für tatsächliche Nutzung. Kein Bargeldsaldo, kein investierbarer Punktestand, keine öffentliche Rangliste und kein Anreiz, Kinder zu möglichst vielen Jobs zu drängen.

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| L-01 | Kleinen Vorteilskatalog mit Kostenobergrenze festlegen; Nutzer verstehen, was sie konkret erhalten | Geplant Einstellungen/Vorteile und Tarifregeln, beispielsweise begrenzter Rabatt auf eigene Plattformgebühren | P2 | D-06, P-03; G5 |
| L-02 | Berechtigung nur aus qualifizierten, abgerechneten und stornofreien Jobs ableiten; keine Belohnung bloßer Klicks | Geplanter Benefit-Evaluator auf bestätigtem Settlement, Refund-/Dispute-Status und definierter Wartefrist | P2 | P-13, P-15, D-06 |
| L-03 | Vorteile unveränderlich buchen und Korrekturen gegenbuchen; doppelte Rewards und versteckte Löschungen vermeiden | Geplantes append-only `reward_ledger` mit Event-/Regelversion und Unique-Key; vom Finanzjournal getrennt | P0 vor Vorteilen | L-01, L-02, S-02 |
| L-04 | Anwendbaren Gebührenrabatt vor Zahlung transparent zeigen; Rechnung und Vorteil passen zusammen | Vergütungs-/Checkout-Zusammenfassung; reservierter/realisierter Benefit mit Operation und Preis-Snapshot | P2 | L-03, P-05, P-12 |
| L-05 | Persönliche Vorteile, Nutzung und Bedingungen knapp erklären; keine großen Punkte-Dashboards | Sekundärer Einstieg Profil/Einstellungen, geplanter Vorteilsverlauf mit Details bei Bedarf | P2 | L-01, L-03, S-08 |
| L-06 | Refund, Chargeback und berechtigten Betrugseinwand nachvollziehbar rückabwickeln; keine heimlichen negativen Geldschulden | Gegenbuchung im Reward-Ledger, begründeter interner Fall und Einspruchsmöglichkeit | P0 vor Vorteilen | L-03, P-11, P-13, A-08 |
| L-07 | Budget, Ablauf, Einlöseobergrenze und Kombination von Rabatten serverseitig prüfen; ein Vorteil bleibt finanzierbar | Geplante versionierte Benefit-Regeln und atomare Einlösung; klare Bedingungen in Vorteilen | P2 | L-01, L-04, D-06 |
| L-08 | Verständlichkeit und wirtschaftliche Wirkung ohne öffentliche Kinderrankings prüfen; nur nachgewiesen nützliche Regeln behalten | Aggregierte interne Auswertung, Test-/Kontrollkohorten erst nach Datenschutzprüfung | P3 | L-05–L-07, A-09 |

## 6. Freunde und Einladungen — angefragt, acht Punkte

Freundschaft ist eine beidseitig bestätigte private Beziehung. Referral ist eine getrennte, optional vergütete Herkunftszuordnung; ein Einladungslink allein macht niemanden zum Freund und gewährt keinen Zugriff auf Profile oder Jobs.

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| F-01 | Privaten Freundebereich mit klaren Zuständen anlegen; ein- und ausgehende Anfrage sind verständlich | Geplant Einstellungen/Freunde mit sekundärem Profileinstieg; `friend_requests`/`friendships` nur als Entwurf | P2 | D-08, U-02, S-02; keine vierte Hauptnavigation |
| F-02 | Anfrage ausdrücklich annehmen, ablehnen oder zurückziehen; Freundschaft entsteht nie einseitig | Freundebereich; atomare RPCs mit eindeutiger kanonischer Nutzerpaarung und Race-Tests | P2 | F-01 |
| F-03 | Entfernen, blockieren und melden durchgängig unterstützen; Block gilt auch für neue Anfragen und Einladungseinstiege | Freundedetails/Profil und bestehender Meldeweg; zentraler geplanter Block-Vertrag | P0 vor Freunden | F-01, C-09, S-02 |
| F-04 | Minderjährigen-Privatsphäre und Auffindbarkeit begrenzen; keine öffentliche Freundesliste, kein Kontaktbuch- oder Standortleck | Profilprojektionen und Freundes-RLS; explizite erlaubte Kontakte/Alterskonstellationen statt offener Personensuche | P0 vor Freunden | D-08, U-04, F-03 |
| F-05 | Manuell gewählten Einladungslink über natives Share Sheet oder Kopieren teilen; kein ungefragter Mail-/SMS-Versand | Profil/Einstellungen/Freunde → Einladen; Web Share API/Fallback; kurzlebiger widerrufbarer Token geplant | P2 | F-04; keine Telefonbuchuploads |
| F-06 | Referral-Zuordnung getrennt und datensparsam bestätigen; Herkunft ist kein Freundschafts- oder Profilrecht | Geplanter Referral-Link-/Annahmeprozess, `referral_attributions`; keine Nutzer-/E-Mail-ID im öffentlichen Link | P2 | D-07, F-05, S-02 |
| F-07 | Empfehlung erst nach echtem qualifizierten bezahlten Job belohnen; Selbstwerbung, Mehrfachkonten und Stornos erzeugen keinen Vorteil | Referral-Qualifikation mit einmaligem Claim, Regelversion, Reward-Ledger und manueller Fraudprüfung | P0 vor Referral-Prämien | F-06, L-02, L-03, L-06, P-13; G5 |
| F-08 | Einladung widerrufen und Status verständlich zeigen; Eingeladene behalten Kontrolle über Sichtbarkeit | Einladungsdetails mit Ablauf/Annahme/Widerruf; Rate Limits und nur erlaubte Statusprojektion | P2 | F-02, F-05, F-06 |

## 7. Profile und Eltern — Vorschlagskatalog, acht Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| U-01 | Eine gemeinsame öffentliche Profilansicht aus Jobs, Chat und eigener Vorschau nutzen; Informationen und Layout widersprechen sich nicht | `UserProfileModal`, `public-profile.ts`, einheitliche Avatar-/Namensdarstellung | P1 | S-08 |
| U-02 | Öffentliche, private und Compliance-Daten in getrennten Projektionen halten; keine Kontaktdaten aus Versehen veröffentlichen | Profil/DAL; vorhandene Creator-/Partner-RPCs, zukünftige Pay-/Friends-Projektionen mit eigener RLS | P0 vor neuen persönlichen Daten | S-02, U-01 |
| U-03 | Eigene Übersicht kompakt und erst auf Wunsch bearbeitbar machen; Adresse, Kontakt und Bio schnell finden | `ProfileEditForm`, Identitätskopf, geschlossene weitere Kontodaten und expliziter Bearbeiten-Modus | P1 | U-01, U-02 |
| U-04 | Vollständige berechtigte Elternübersicht pro Kind mit Jobs, Terminen, Vergütung, später Pay-Status und offenen Freigaben schaffen; Verknüpfung, Arbeitszustimmung und PSP-Vertretung getrennt erklären | Elternrolle im Jobs-Tab, Kinderauswahl und Einstellungen/Familie; `GuardianConsentModal`, minimale Rollen-/Consentprojektionen und Apply-Berechtigung. Keine pauschale Offenlegung privater Chats | P1; P0 vor Minderjährigen-Pay/Friends | D-01, D-02 für Pay, D-08, S-02 |
| U-05 | Volljährigkeitsübergang und Widerruf von Berechtigungen behandeln; private Daten bleiben nicht unbegrenzt für Eltern sichtbar | Geplanter Berechtigungsprozess; Profil-/Guardian-RPCs und Pay-Authorities ohne automatisches Löschen nötiger Belege | P1 | U-04, D-08; P-02 bei Pay |
| U-06 | Anforderungsbezogene Verifizierung und nächste Aktion erklären; Adresse, Elternfreigabe und Auszahlung sind keine austauschbaren Badges | Identitätskarte und relevante Formulare; benannte vorhandene/neu geplante Verifizierungsprojektionen | P1 | U-02, U-04 |
| U-07 | Avatar optional lassen und Initialen hochwertig darstellen; kein Fotozwang für ältere Anbieter oder Minderjährige | `ProfileAvatar`, Profilbearbeitung und Upload-/Löschpfad mit geprüfter Dateigröße/-art | P2 | U-02, S-08 |
| U-08 | Export, Kontoschließung und verbleibende Verpflichtungen verständlich machen; offene Jobs/Zahlungen nicht versteckt verlieren | Einstellungen/Konto und geplanter DSGVO-/Schließprozess; minimierte Daten, definierte Aufbewahrungsregeln | P1 | U-02, A-04; P-11/P-13 bei Pay |

## 8. Benachrichtigungen und Support — Vorschlagskatalog, acht Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| N-01 | Bestehenden einen Feed mit klarer Leselogik abnehmen; ungelesen/gesehen/gelesen und Bulk-Cutoff bleiben korrekt | Notification-Store, Feed-RPC, Read-/Seen-RPCs und Realtime; kein zweites Nachrichtenzentrum | P1 | S-05, S-06 |
| N-02 | Neue Aufgaben direkt an den passenden Detailabschnitt binden; kein zusätzliches Fenster ohne Zweck | `notificationRouting.ts`, `ChatDetails`-Fokusziel und berechtigungsgeprüfte Job-/Termindeep-Links | P1 | C-04, C-05; P-14 bei Pay |
| N-03 | In-App-Livehinweise sichtbar, zurückhaltend und zugänglich halten; keine konkurrierenden Banner im offenen Chat | Bestehender Header/Livebanner, Fokus-/Interaktionspausen und Reduced Motion | P1 | N-01, S-08 |
| N-04 | Web-Push als separat aktivierbaren Kanal planen; nur nach echter Einwilligung und überprüftem Gerät zustellen | Einstellungen/Benachrichtigungen; geplanter Service Worker/Provider, private Endpoints/Outbox, Revoke und Retry | P2 | D-10, N-01, S-02, S-03; derzeit deaktiviert lassen |
| N-05 | SMS als eigenständiges Feature für ausgewählte wichtige Ereignisse anbieten; Nummer verifizieren, Kanal bewusst aktivieren/deaktivieren und Häufigkeit begrenzen. E-Mail-Digests getrennt ergänzen | Einstellungen/Benachrichtigungen, vorhandene private Delivery-Grundlage, geplanter Provider/Worker/Scheduler; Consent, Kostenlimit und Zustellstatus | SMS P1; E-Mail-Digests P2 | D-10, N-01, S-02, S-03; gemeinsame Zustellgrundlage, Web-Push selbst keine Voraussetzung |
| N-06 | Support aus dem jeweiligen Problem mit Kontext öffnen; Nutzer müssen Job/Termin nicht erneut suchen | Bestehender Hilfe-Einstieg, geplanter kompakter Supportfall; keine automatischen Vollchat-Anhänge | P1 | C-09, A-02, U-02 |
| N-07 | Unterstützung bei Registrierung und wichtigste Fragen schrittweise veröffentlichen; nur verfügbare Hilfen aktiv zeigen | Onboarding-Hilfepanel und Support; kleine gepflegte FAQ statt inaktiver falscher Versprechen | P2 | D-10, N-06 |
| N-08 | Benachrichtigungspräferenzen und Eskalationen verständlich gestalten; Nutzer steuern normale Hinweise, dringende Zustände bleiben erreichbar | Einstellungen/Benachrichtigungen und bestehende interne Prioritäten 1–3; keinerlei P1/P2-Labels für Endnutzer | P1 | N-01, D-10; P-13 für finanzielle Eskalationen |

## 9. Firmen und Regionen — Vorschlagskatalog, sechs Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| R-01 | Aktive Region und tatsächliche Angebotsverfügbarkeit konsistent anzeigen; keine falsche leere Region oder Freigabe suggerieren | Header, Jobs und `getMarketSummary`; `regions_live`/Market-RPC mit serverseitigen Regeln | P1 | S-02, S-04 |
| R-02 | Regionalen Radius und Ortswechsel kontrolliert ermöglichen; Nachfrage ohne genaue Privatadresse einschätzen | Jobfilter und private Profileinstellungen; regionale Eligibility, öffentliche grobe Geodaten | P2 | J-03, J-04, R-01 |
| R-03 | Firmenidentität und verantwortlichen Ansprechpartner vom Privatprofil unterscheiden; Nutzer wissen, wer Auftraggeber ist | Firmen-Profilansicht und Angebotserstellung; geplante Organisation/Vertretungs-Projektion | P2 | D-09, U-02, J-07 |
| R-04 | Echte Firmenkonten samt Nachweisen und passenden Verträgen freigeben; Logo oder Domain allein ist keine Prüfung | Geplanter interner Verifizierungsfall und bestehender Providerstatus; Legal-/Pay-Vertrag | P0 vor erweitertem Firmenfluss | R-03, P-01 bei Pay, A-02 |
| R-05 | Weitere Regionen zuerst als begrenzten betreuten Pilot freigeben; Support und rechtliche Regeln wachsen mit | Betriebsfreigabe pro Markt, Feature-Flags und aggregierte Nachfrage-/Supportdaten | P3 | D-09, G3/G4 bei Pay, A-09 |
| R-06 | Firmenmehrbenutzer erst nach belegtem Bedarf separat gestalten; Zuständigkeit ohne geteilte Passwörter | Später geplante Organisationseinladungen/Rollen im Firmenbereich; keine Mehrarbeiter-Jobteams | P3 | R-03, R-04, S-02; gesonderte Freigabe |

## 10. Administration und Betrieb — Vorschlagskatalog, zehn Punkte

| ID | Funktion und konkreter Nutzen | UI-/Backend-Ort | Priorität | Abhängigkeit |
| --- | --- | --- | --- | --- |
| A-01 | Interne Rollen und dienstliche Zugriffe auf notwendige Aufgaben begrenzen; Consumerrollen erhalten keine Adminabkürzung | Externe Administration, serverseitiger Staff-Check, Audit und Service-Secrets | P0 vor neuen Adminfunktionen | S-02, S-03 |
| A-02 | Support-/Moderationsfälle mit Zuständigkeit, Frist und Ergebnis führen; Meldungen nicht im Datenbestand verschwinden lassen | Externe Administration; bestehende Reports/Evidence und geplanter Case-Workflow | P1 | A-01, C-09 |
| A-03 | Konsequente unveränderliche Auditspur für sensible Aktionen festlegen; Entscheidungen sind später erklärbar | Interne Audit-Events für Moderation, Rollen, Zahlungen und Vorteile; zweckgebundene Zugriffskontrolle | P0 vor Pay/Vorteilen | A-01, S-02 |
| A-04 | Datenexport, Auskunft, Aufbewahrung und Löschung als echte Vorgänge betreiben; Datenschutzanfragen nachvollziehbar beantworten | Externe Administration und geplante zeitgesteuerte Retention-Jobs; separate Datenklassen | P1 | A-01, U-02; Pay-Konzept bei Finanz-/Steuerdaten |
| A-05 | Releases, additive Migrationen und Feature-Flags mit Rücknahmeplan abnehmen; Rollback gefährdet keine bestehenden Ansprüche | CI/Deployment, Migrationsledger und Rollout-Runbook; eigene Freigaben für Test/Live | P0 vor weiterem Datenmodell | S-03, S-05 |
| A-06 | Fehler und auffällige Latenzen datensparsam überwachen; keine Nachrichten-/Ausweisdaten in Diagnoselogs | Server-/Client-Observability, korrelierbare Vorgangs-IDs und Zugriff auf Logs | P1 | S-06, A-01, U-02 |
| A-07 | Recovery regelmäßig proben und Ausfallkommunikation vorbereiten; Sicherung ist auch tatsächlich nutzbar | Restore-Drill, Runtime-/Secret-/Storagewiederherstellung und intern benannter Incident-Owner | P0 für Echtgeldbetrieb | S-03, A-05 |
| A-08 | Finanzielle Ausnahmen mit Vier-Augen-Regeln und Fristen bearbeiten; Refund-/Dispute-Macht nicht an beliebige Supportrollen geben | Geplante Payment-Cases der externen Administration, Limits, getrennte Berechtigungen und Audit | P0 vor Echtgeld | A-01, A-03, P-03, P-12 |
| A-09 | Wenige aggregierte Qualitätskennzahlen definieren; echte Verständlichkeit und erfolgreichen Abschluss statt Aktivitätsdruck messen | Interne Auswertung: Reservierung→Termin→Abschluss, Fehler, Supportbedarf, Zahlungsabgleich und Kosten | P2 | A-04, A-06; keine öffentlichen Personenrankings |
| A-10 | Datenschutz-, Sicherheits- und PSP-/DAC7-Verantwortung dauerhaft benennen; Fristen und Vertretung sind nicht personenabhängig vergessen | Betriebsregister, Legal-/PSP-Dokumentation, Melde-/Eskalationskalender und regelmäßige Reviews | P0 vor Pay | D-01–D-03, D-10, A-01; Pay-Konzept |

## Abnahmemeilensteine statt fiktiver Termine

| Meilenstein | Ergebnis, das vorliegen muss | Danach möglich |
| --- | --- | --- |
| **G0: sichere Basis; parallel Pay klären** | S-01–S-03 sind belegt bearbeitet, Kernrollenpfade geprüft, bestehende Daten geschützt, Zuständigkeiten klar. Gleichzeitig P-01–P-03 als Rechts-/PSP-/Geschäftsentscheidung bearbeiten | Konkrete Kernpakete und freigegebener Pay-Entwurf; noch kein Echtgeld |
| **G1: genehmigtes Zahlungsmodell** | Betreiber, Tätigkeits-/Altersgruppen, PSP-Konfiguration, Zahlungszeitpunkt, Gebühren, Reserve, Support und Datenschutz/Steuermeldung sind entschieden. Minderjährige sind entweder ausdrücklich zugelassen oder sichtbar ausgeschlossen | Pay-Sandbox für genau dieses Modell; keine Umgehung ungeklärter Empfänger |
| **G2: vollständige Pay-Sandbox** | Ein Termin/ein Empfänger; Onboarding, Autorisierung, Einzug, Refund, Auszahlungsstatus, Replay/Konkurrenz und ausgeglichenes Journal sind Ende zu Ende geprüft; UI zeigt echte Zustände | Freigabeentscheidung für einen begrenzten Echtgeldpilot |
| **G3: betreuter Pilot** | Genehmigte Kohorte, zulässige reale Fälle, besetzter Support, Reserve, täglicher Abgleich und Kill-Switch funktionieren. Offene Refunds/Disputes werden auch nach Abschaltung weiter betreut | Entscheidung über begrenzte produktive Einführung |
| **G4: neue versionierte Aufträge** | Plattformzahlung ist für die freigegebenen neuen Auftragsarten ausdrücklich Vertragsbestandteil; Legacy-Jobs behalten ihren Verlauf. Zielgruppe 14–20 ist nicht fälschlich als erledigt bezeichnet, wenn nur Volljährige freigegeben wurden | Kontrollierter Ausbau von Stunden-/Folgeterminen und zulässigen Nutzergruppen |
| **G5: Vorteile und Empfehlungen** | Zahlungs- und Rückabwicklungshistorie ist verlässlich, Benefit-Budget und Regeln beschlossen, Reward-Ledger und Abuse-/Widerrufswege geprüft. Freundschaft/Referral/Elternrechte bleiben getrennt | Kleine private Vorteils-/Einladungspiloten, keine Wachstumsautomatik |
| **G6: breitere Regionen/Firmen** | Recht, Support, Sicherheit und Wirtschaftlichkeit sind über den Kernpilot hinweg nachgewiesen; Kapazität und Verantwortliche für jede Region vorhanden | Schrittweise Expansion nach Bedarf, keine vorgezogene Massenfreischaltung |

Ein übersprungenes Gate wird nicht durch ein schönes UI, installierte SDKs oder grüne Einzeltests ersetzt. Abnahme nennt immer Umgebung, Nutzerrolle, getesteten Pfad und verbleibende Grenzen.

## Die nächsten drei konkreten Arbeitspakete

1. **Basisabschluss mit Belegen:** bestehende Performance-/Auth-/Chatänderungen abschließen; Kernrollen auf Mobil/Desktop prüfen. S-01/S-02/S-03 sowie Release-/Recovery-Status in einer kurzen Abnahmeliste mit tatsächlichen Befunden und Verantwortlichen dokumentieren. Ergebnis: reproduzierbarer Stand, freigegebene lokale Änderungen, keine ungeprüfte Produktionskonfiguration.
2. **Pay-Freigabepaket parallel erstellen:** D-01 bis D-05 mit dem Pay-Dokument in eine konkrete Betreiber-/Rechts-/Stripe-Anfrage übersetzen. Wer zahlt wem, 14–17/18–20, Vertreter, Arbeitsmodell, ein Termin/ein Empfänger, Capture, Gebühren/Verluste und Meldungen eindeutig beschreiben. Ergebnis: schriftliche Antworten oder benannte Blocker. Kein Konto-/Providerabschluss oder Versand allein durch diese Roadmap.
3. **Ein durchgängiges UI-/Vertragspaket spezifizieren:** J-01, C-03–C-05, U-01/U-02 und P-04/P-14 für Reservierung, Termin, Zahlung fällig, vorgemerkt, abgeschlossen und Problemfall zusammenführen. Copy, mobile Platzierung, Deep-Link-Ziele, serverseitige Projektion und Fehlerzustände festhalten. Ergebnis: überprüfbare Spezifikation; erst nach G1 Umsetzung der Pay-Sandbox, Vorteile/Freunde danach gesondert priorisieren.

Diese drei Pakete begrenzen den nächsten Arbeitsumfang. Sie sind keine Anweisung, alle 98 Punkte gleichzeitig zu bauen oder bereits freigegebene Komponenten erneut zu redesignen.

## Zehn offene Produktentscheidungen

| ID | Zu entscheiden | Konkreter Einfluss |
| --- | --- | --- |
| **D-01** | Welcher Betreiber mit welcher Vertretung vermittelt welche rechtlich zulässigen Arbeits-/Dienstleistungsarten? Welche Alters-/Schulpflicht-/Elternregeln gelten tatsächlich, auch für Volljährige? | Verträge, Bewerbungsberechtigung, Jobkategorien, Sozial-/Steuerpflichten und U-04 |
| **D-02** | Welcher PSP bestätigt Deutschland, private/gewerbliche Zahler und Empfänger 14–20 einschließlich Minderjährigenvertretung und Kontoinhaber? | Connect-/Kontokonfiguration, KYC, zulässiger Geldfluss; P-01/P-02 |
| **D-03** | Wer trägt welche Gebühren, Steuern, Refundkosten und Ausfälle; wie groß ist die finanzierte Reserve? | Gesamtpreis, Auszahlung, Vorteilskosten, Pilotgrenzen und Betrieb |
| **D-04** | Wann wird der Betrag vorgemerkt/eingezogen, wer bestätigt Minuten/Leistung, und was passiert bei Schweigen oder Streit? | Fristen, Next Action, rechtlicher Vergütungsanspruch, C-12 und Pay-Cases |
| **D-05** | Für welche neuen versionierten Auftragsarten wird Plattformzahlung nach dem Pilot verbindlich; wie bleiben Altfälle verständlich? | Angebotsbedingungen, Eligibility, Feature-Flags, kein rückwirkender Zahlungszwang |
| **D-06** | Welche wenigen Vorteile sind finanzierbar, für wen, nach welchem qualifizierten Auftrag und mit welchen Limits/Ablauffristen? | Treue ohne Geld-Wallet, transparente Einlösung und Rückabwicklung |
| **D-07** | Wann zählt eine Empfehlung, welche bereits bestehenden Nutzer sind ausgeschlossen und wann wird welcher Vorteil endgültig berechtigt? | Referral-Zuordnung, Selbst-/Mehrfachkontoschutz, Wartefrist und Fraud-Einspruch |
| **D-08** | Wer darf wem Freundschaft anbieten; welche Minderjährigen-/Erwachsenenkonstellationen, Sichtbarkeiten und Elternrechte sind erlaubt? | Auffindbarkeit, Blockieren, Profile, Share-Link und Volljährigkeitsübergang |
| **D-09** | Welche Firmen-/Regionstypen werden zuerst wirklich betreut; wer prüft Nachweise und trägt den lokalen Support? | Regionfreigaben, Firmenverträge, Organisationseinladungen und Expansionsgates |
| **D-10** | Welche Supportwege und Zustellkanäle werden tatsächlich betrieben, finanziert und mit welchen Reaktionsfristen? | Push/SMS/E-Mail bleiben bis dahin deaktiviert; interne Eskalation und Verantwortlichkeit |

## Frontend-, Berechtigungs- und Datenabhängigkeiten

| Produktbaustein | Frontendvertrag | Backend/RLS und Integrität | Vor Aktivierung zu beweisen |
| --- | --- | --- | --- |
| Jobs/Reservierung | Eine Karte, ein echter Zustand, verständliche Aktion | Bestehende Job-/Application-Ownership, exklusive aktive Reservierung und erlaubtes Reopening | Zwei konkurrierende Bewerbungen, fremder Provider, Rückzug und erneutes Anbieten |
| Chat/Termine | Nachricht, Systemhinweis, Termin und Next Action sind unterscheidbar; Fokus gelangt zum Ziel | Teilnehmerprüfung, persistierte Message-/Request-IDs, Terminversionen und idempotente Actions | Archiv/read-only, alte Nachrichtenseiten, verlorene Verbindung und parallele Änderung |
| Profile/Eltern | Öffentliche Vorschau nutzt dieselbe sichere Projektion; private/gesetzliche Daten getrennt | Own-Row-/Teilnehmerprojektionen, explizite Vertretung, Widerruf/Volljährigkeit | Kein Zugriff auf fremde Adresse, E-Mail, Steuerdaten oder Kinderbeziehungen |
| Pay | Kurzstatus und eine passende Aktion im Termin; eigene Belege/Verlauf unter Einstellungen | Immutable Terms, Payment Operations, Webhook-Inbox, server-only Finanzjournal/Compliance; keine Client-Saldenwrites | Teilnehmer-/PSP-ID-Manipulation, Replays, Doppelklicks, Refund/Dispute/Payout und Abstimmung |
| Vorteile | Konkreter Rabatt und Bedingungen, kein Geldguthaben | Versionierte Regeln, atomare Einlösung, append-only Reward-Ledger und einmaliges qualifizierendes Ereignis | Parallele Einlösung, Selbstempfehlung, Storno/Chargeback und nachvollziehbare Gegenbuchung |
| Freunde/Referral | Anfrage ausdrücklich bestätigen; Sharing über bewusste Nutzerauswahl | Paarweise RLS, zentraler Block-Check, getrennte Link-/Attribution-/Reward-IDs, Ablauf/Rate Limit | Keine fremden Kontakte, erratene Links, einseitige Freundschaft oder Privilegien durch Referral |
| Benachrichtigungen | Ein gemeinsamer Feed, klare Lesen-/Gesehen-Logik, direkte Ziele | Empfängergrenze, Event-Dedupe, Snapshot-Cutoff; externe Ziele/Outbox nur privat und consent-geprüft | Wiederverbindung, neue Nachricht nach Bulk-Read, Hidden-Event und widerrufener Endpoint |
| Admin/Betrieb | Kein Staff-Override im Consumer-UI; zuständige interne Fallansicht | Externe autorisierte Servergrenze, Audit, minimale Service-Rechte und Geheimnisse | Consumer-Denial, getrennter Test-/Livekontext, Restore und kontrollierte Rechtevergabe |

Neue Datenmodelle werden additiv und mit Schema-/Ledgerabgleich eingeführt. Bereits angewandte Migrationen bleiben unverändert. Keine Featuretabelle erhält vorsorglich breit zugängliche persönliche Daten; Freigaben und minimale Projektionen werden zusammen mit dem jeweiligen Feature spezifiziert. Die Umsetzbarkeit folgt aus durchgeführten Rollen-/Konkurrenz-/Restoretests, nicht aus einem Tabellenentwurf allein.

## Quellen im aktuellen Repository

Die Planung orientiert sich an den am 24.10.2026 gelesenen lokalen Quellen. Ein vorhandener Pfad oder eine Migrationsdatei belegt allein keinen Live-Status.

- [Pay-Konzept mit Stripe-/Behördenquellen](workfare-pay.md): Zulässigkeit, Geldfluss, Gebühren, KYC, Minderjährige, DSGVO/PStTG, Schema und Zahlungsabnahme.
- [Activities-Domäne](../architecture/activities-domain.md): exklusive Reservierung, Jobs/Engagements/Termine, Profile, Meldungen und Consumer-/Admin-Grenze.
- [Benachrichtigungsarchitektur](../architecture/notifications.md): ein Feed, Prioritäten, Read/Seen, private externe Kanäle und deaktivierter Versand.
- [Datenbankworkflow](../../infrastructure/database/README.md) und [Rollout-Runbook](../operations/database-rollout.md): geschützte Daten, additive Migrationen, Recovery und reale Abnahme.
- [App-Shell](../../src/lib/app-shell.ts), [Auth](../../src/lib/auth.ts), [DAL](../../src/lib/dal/platform.ts): Rollen, Markt, Zugriff und bestehende Lesewege.
- [Jobkarte](../../src/components/jobs/JobCard.tsx), [Erstellung](../../src/components/jobs/CreateJobForm.tsx), [Chat](../../src/components/activity/ApplicationChat.tsx), [Details](../../src/components/activity/ChatDetails.tsx), [Termine](../../src/components/activity/ChatAppointments.tsx): vorhandene Einbauorte.
- [Eigenes Profil](../../src/components/profile/ProfileEditForm.tsx), [öffentliche Ansicht](../../src/components/profile/UserProfileModal.tsx), [Profilprojektion](../../src/components/profile/public-profile.ts), [Benachrichtigungsstore](../../src/components/notifications/notificationStore.ts): Wiederverwendung statt konkurrierender Oberflächen.

## Nichtziele dieser Roadmap

Kein kompletter Neubau, keine pauschale Freigabe aller Vorschläge und keine Umsetzung ohne abgegrenztes Paket. Keine eigene Bank/Wallet/Treuhand, kein Kredit-/Krypto-/Investmentprodukt, keine offenen Personenlisten oder öffentliche Kinderbewertungen. Keine Jobwarteliste, keine Mehrbewerberauktion, kein Multiwerkerteam und kein Social Feed. Kein Bild- oder KI-Zwang, keine erfundenen Versand-/Verifizierungs-/Zahlungszustände und keine ungefragten Kontakte.

Dieses Dokument ändert weder Code noch Daten, Konfiguration, Preise, Vertragsbedingungen oder Livebetrieb. Commit und jede Veröffentlichung werden vom übergeordneten Arbeitsauftrag getrennt gesteuert.
