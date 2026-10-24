# JobBridgePay: Planung für Zahlungen innerhalb der Plattform

Stand und Quellenabruf: **24.10.2026**. Status: **Entscheidungsgrundlage, nicht implementiert und nicht für Echtgeld freigegeben.** JobBridgePay ist hier der Arbeitsname; die bestehende Produktmarke heißt Workfare.

## 1. Empfehlung und Freigabegrenzen

Zahlungen gehören zum jeweiligen Auftrag und Termin. Der volljährige Jobanbieter bezahlt die vereinbarte Vergütung über einen zugelassenen Zahlungsdienstleister; der Jobsuchende erhält sie auf sein dafür freigegebenes, geprüftes Auszahlungskonto. Die Plattform zeigt Betrag, nächsten Schritt und Beleg direkt in der bestehenden Zusammenarbeit. Es gibt kein eigenes aufladbares Guthaben, keine Überweisungen zwischen Nutzern und keinen vierten Haupttab.

**Empfehlung unter Vorbehalt der folgenden Freigaben:** Stripe Connect als PSP, ein Zahlungsempfänger pro Termin, Deutschland/EUR, Stripe-geführte Identitätsprüfung und Checkout Sessions. Für das Marktplatzmodell ist eine Destination Charge der technische Ausgangspunkt. Eine kurz vor dem Termin autorisierte Kartenzahlung wird nach bestätigter Leistung eingezogen. Anschließend erfolgen Transfer und reguläre PSP-Auszahlung. Das ist weder ein Treuhandkonto noch eine Zahlungsgarantie.

Die folgenden Punkte sind echte Startbedingungen, keine nachgelagerten Optimierungen:

| Entscheidung | Vor Echtgeld erforderlich | Noch offen |
| --- | --- | --- |
| Vertragspartner der Plattform | Geschäftsfähiger, identifizierter Betreiber mit zulässigem Geschäftsmodell, Stripe-Vertrag und Verantwortlichen für Support, Steuern und Verluste | Rechtsform, Vertretung, tatsächliche PSP-Freigabe und Risikobudget sind lokal nicht belegt |
| Art der vermittelten Arbeit | Prüfung, welche Tätigkeiten selbständige Dienstleistungen, Beschäftigung/Minijob oder bloße Gefälligkeit sind; passende Vertrags- und Abgabenprozesse | Kein pauschales „Taschengeldjob = selbständig“ |
| Empfänger von 14–17 Jahren | Schriftliche Bestätigung von Stripe für genau dieses deutsche Connect-Modell, Minderjährigen-Onboarding, erwachsenen Representative, Auszahlungskonto und Haftung; gesonderte rechtliche Freigabe | Allgemeine Altersregel ist keine spezifische Modellzusage |
| Zahlungsrechtlicher Geldfluss | Vertraglich und technisch geprüfte PSP-Abwicklung einschließlich Verfügungsmacht, Gebühren und Rückabwicklung | Connect allein beweist keine ZAG-Ausnahme |
| Preis und Geldfreigabe | Verbindliche Regeln für Höchstbetrag, tatsächliche Arbeitszeit, Gebühren, Einzug, fehlende Bestätigung, Storno und Streit | Vorschlag unten; noch keine verabschiedeten Nutzerbedingungen |
| Steuer-/Datenschutzbetrieb | PStTG/DAC7-Einordnung, Meldeverantwortung, Datenfelder, Fristen, Löschkonzept und PSP-Rollen geprüft | Darf nicht erst nach der ersten Auszahlung geklärt werden |

Ein möglicher Pilot ausschließlich mit rechtlich und von Stripe freigegebenen Volljährigen wäre eine **gesonderte Produktentscheidung**. Er löst die Anforderung 14–20 nicht. Solange Minderjährige nicht freigegeben sind, bleiben ihre Echtgeldfunktionen serverseitig gesperrt; kein stiller Umweg über das Elternkonto.

## 2. Tatsächlicher Ausgangsstand

Read-only im Repository geprüft:

- `package.json` enthält `stripe: ^20.3.1`. Es wurde keine operative Stripe-Initialisierung, Checkout-/PaymentIntent-/Payout-Integration, Zahlungs-Webhook-Verarbeitung oder finanzielle Buchführung gefunden. Ein installiertes SDK ist keine Zahlungsanbindung.
- `infrastructure/database/README.md` und `docs/architecture/activities-domain.md` bezeichnen Workfare Pay ausdrücklich als nicht live. Benachrichtigungen, Chat und Jobabschluss sind keine finanziellen Belege.
- `jobs.payment_type` unterscheidet `hourly` und `fixed`; `jobs.wage_hourly` ist bisher Angebotsinformation. Daraus lässt sich weder ein verbindlicher Gesamtbetrag noch ein ausbezahlter Anspruch ableiten.
- Der Fachablauf bleibt `offen → reserviert → vereinbart → abgeschlossen`. Erste Bewerbung reserviert einen Platz; wiederkehrende Arbeit besteht aus `job_engagements` mit mehreren `job_appointments`. `job_agreements` ist Kompatibilitätsstruktur. Zahlung hängt an der einzelnen gültigen Termin-/Vergütungsvereinbarung.
- Onboarding akzeptiert Jobsuchende von 14 bis vor dem 21. Geburtstag und volljährige Anbieter. Das aktuelle Bewerbungs-RPC verlangt eine aktive Elternverknüpfung für **alle** Jobsuchenden. Diese Plattformregel ist von Minderjährigkeit, gesetzlicher Vertretung und Stripe-KYC zu trennen und vor Pay ausdrücklich zu entscheiden.
- AGB erklären die Plattform zur technischen Vermittlerin; Vertragspartner der Arbeit sind die Nutzer. Datenschutzhinweise erwähnen Stripe nur bedingt. Die Legal-Seiten tragen Stand April 2026 und sind kein fertiger Zahlungs-/Beschäftigungsvertrag.
- Das Impressum nennt eine natürliche Person und „Projekt: Workfare“. Daraus werden hier weder Rechtsform noch Geschäftsfähigkeit, Gewerbe-, Steuer- oder PSP-Zulassung abgeleitet. Der Markenhinweis „Ein Projekt der Ray Group“ ist ebenfalls kein Nachweis eines Rechtsträgers.
- `https://app.workfa.re` war beim Abruf am 24.10.2026 per HTTPS erreichbar, HTTP 200. Geprüft wurde die öffentliche HTTP-Erreichbarkeit, keine Stripe-Dashboardkonfiguration, Kontofreigabe oder Eigentümerschaft. Für JobBridgePay wurde keine eigene Domain oder Marke eingerichtet.

Diese Planung ändert keine Tabellen, Konten, Verträge, Produkttexte oder bestehenden Jobs.

## 3. Minderjährige, Arbeit und Verträge

Stripe gestattet Accounts grundsätzlich ab 13, verlangt bei noch nicht Volljährigen einen verantwortlichen Erwachsenen. Die Supportseite beschreibt Minderjährigen-Onboarding nur für bestimmte Länder, ohne die konkrete deutsche Accounts-v2-Konfiguration dieses Vorhabens zu bestätigen. Die deutschen Stripe-AGB beschränken die Nutzung zudem auf geschäftliche Zwecke. Ein Haushalt darf Kunde einer Dienstleistung sein; daraus folgt aber keine automatische Eignung eines privaten Lohn-/Taschengeldempfängers als angeschlossener Händler. Ein Datenfeld `individual` ersetzt diese Prüfung nicht. [Stripe-Altersanforderung](https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account?locale=en-GB), [Stripe-AGB, Abschnitte 1.1–1.2](https://stripe.com/de/legal/ssa).

Das Minderjährigenmodell muss drei getrennte Nachweise führen: **Berechtigung zur Arbeit und zum Vertrag**, **PSP-Vertretung und Vertragsannahme**, **zulässiger wirtschaftlicher Empfänger und Bankkontoinhaber**. Eine bestätigte Plattformadresse oder Elternverknüpfung erfüllt diese Nachweise nicht automatisch.

| Altersgruppe | Konsequenz für die Planung |
| --- | --- |
| 14 Jahre | Im JArbSchG Kind; nur gesetzlich zulässige Ausnahmen. Leichte geeignete Beschäftigung über 13 erfordert die Einwilligung des Personensorgeberechtigten. Grundregel hierfür: höchstens zwei Stunden täglich, nicht zwischen 18 und 8 Uhr und nicht vor/während des Unterrichts; die Drei-Stunden-Ausnahme betrifft landwirtschaftliche Familienbetriebe. |
| 15–17 Jahre | Jugendliche; bei Vollzeitschulpflicht gelten grundsätzlich die Kindervorschriften. Ohne diese Schulpflicht gelten eigene Jugendschutzregeln. Eine Alterszahl allein reicht daher für die Jobzulässigkeit nicht. |
| 18–20 Jahre | Volljährig; keine automatische zivilrechtliche Elternvertretung. Bestehende App-Elternregel und weitere Schutzregeln bewusst separat behandeln. |

Gartenarbeit ist nicht pauschal zulässig: Die KindArbSchV erlaubt bestimmte leichte Tätigkeiten in privaten/landwirtschaftlichen Haushalten, schließt aber ungeeignete Belastungen und Unfallgefahren ein. „Rasen mähen“ mit einer Maschine benötigt daher eine konkrete Tätigkeits-/Risikoprüfung; ein grünes Kategorie-Icon genügt nicht. [JArbSchG § 2](https://www.gesetze-im-internet.de/jarbschg/__2.html), [§ 5](https://www.gesetze-im-internet.de/jarbschg/__5.html), [KindArbSchV § 2](https://www.gesetze-im-internet.de/kindarbschv/__2.html).

Für nicht lediglich vorteilhafte Erklärungen Minderjähriger gilt grundsätzlich das Zustimmungserfordernis. § 112 BGB betrifft die besondere Ermächtigung zum selbständigen Erwerbsgeschäft mit Familiengericht; § 113 betrifft gestattete Dienst-/Arbeitsverhältnisse. Keine der beiden Varianten wird aus einem normalen Elternklick unterstellt. [BGB § 107](https://www.gesetze-im-internet.de/bgb/__107.html), [§ 108](https://www.gesetze-im-internet.de/bgb/__108.html), [§ 112](https://www.gesetze-im-internet.de/bgb/__112.html), [§ 113](https://www.gesetze-im-internet.de/bgb/__113.html).

Ob ein Arbeitsverhältnis besteht, richtet sich nach tatsächlicher Weisungsbindung und Durchführung, nicht nach der Schaltflächenbezeichnung. Haushaltshilfe als abhängiger Minijob kann Anmelde-/Abgabenpflichten des anbietenden Haushalts auslösen. PSP-KYC ersetzt das Haushaltsscheckverfahren nicht. Bei Beschäftigung sind außerdem Mindestlohn, Arbeitszeiten und Versicherung zu prüfen; die Ausnahme des MiLoG für unter 18-Jährige ohne abgeschlossene Berufsausbildung darf nicht pauschal auf 18–20-Jährige übertragen werden. [BGB § 611a](https://www.gesetze-im-internet.de/bgb/__611a.html), [Minijob-Zentrale](https://www.minijob-zentrale.de/DE/die-minijobs/haushaltshilfe/haushaltshilfe_node.html), [MiLoG § 22](https://www.gesetze-im-internet.de/milog/__22.html).

**Folge:** Ein Connect-Marktplatz für zugelassene selbständige Leistungserbringer und ein Lohnzahlungsprodukt sind unterschiedliche Vorhaben. Falls die vorgesehenen Jobs Beschäftigung sind, wird der unten skizzierte Händlerfluss nicht unverändert übernommen. Dann sind Arbeitgeberpflichten, Vergütungsanspruch und ein hierfür freigegebenes PSP-/Abrechnungsmodell neu festzulegen.

## 4. Konten und Geldfluss nach Freigabe

### Rollen

| Rolle | Aufgabe | Kein automatischer Rollenwechsel |
| --- | --- | --- |
| Jobanbieter, mindestens 18 | Auftraggeber/Zahler; bestätigt vereinbarte Vergütung und bezahlt | Wird durch Kartenzahlung nicht automatisch von Arbeitgeberpflichten befreit |
| Jobsuchender, 14–20 | Tatsächlicher Leistungserbringer und vorgesehener Vergütungsempfänger | Volljähriger Representative wird nicht ohne Weiteres zum wirtschaftlichen Empfänger |
| Gesetzliche Vertretung/PSP-Representative | Nur nach jeweils geprüftem Auftrag und Nachweis handeln | Plattform-Elternkonto allein begründet keine Verfügungsmacht über Zahlungen |
| Workfare | Vermittlung, Zahlungsanstoß, Statusanzeige, eigene Gebühren und Support | Kein eigenes Wallet, keine selbst behauptete Treuhand, keine Bank |
| Stripe/zugelassener PSP | Akzeptanz, Authentifizierung, KYC, PSP-Konten, Transfer und Bankauszahlung im freigegebenen Vertrag | Übernimmt nicht sämtliche arbeits-, steuer- und verbraucherrechtlichen Plattformpflichten |

Zielbild: **Zahlungsmittel des Anbieters → PSP-Zahlung → verbundenes PSP-Konto des freigegebenen Empfängers → dessen verifiziertes Bankkonto**. Eine offen ausgewiesene Plattformgebühr geht an die Plattform. Keine Kundengelder auf das gewöhnliche Geschäftskonto einsammeln und anschließend manuell verteilen.

Zahler brauchen dafür kein Auszahlungskonto. Eine gegebenenfalls gespeicherte PSP-Kundenreferenz ist von der Empfängereinrichtung getrennt. Das Plattform-/Connect-Vertragswerk muss die zulässigen Handlungen der Plattform, Gebühren, Unterstützung und Datenteilung konkret beschreiben. [Stripe Connected Account Agreement](https://stripe.com/de/legal/connect-account).

BaFin bewertet Erlaubnispflichten nach tatsächlichem Geldfluss und Vertragslage. Die technische Dienstleisterausnahme setzt bestimmte Voraussetzungen voraus; die Handelsvertreterausnahme hilft insbesondere nicht schon durch eine AGB-Klausel oder gleichzeitiges Handeln für beide Seiten. Deshalb ist vor Umsetzung die konkrete Connect-Verfügungsmacht samt Vertragswerk fachlich zu prüfen. [BaFin: Erlaubnisprüfung](https://www.bafin.de/ref/19629832), [BaFin: ZAG-Merkblatt, Abschnitt C](https://bafin.de/SharedDocs/Veroeffentlichungen/DE/Merkblatt/mb_111222_zag.html).

### Technischer Kontovorschlag

Neue verbundene Konten vorzugsweise mit **Accounts v2**, Stripe-hosted Onboarding und `dashboard: express`; keine selbst gebaute Sammlung von Ausweisfotos. Benötigt wird die Recipient-Konfiguration für indirekte Transfers; Merchant-Funktionen nur, soweit das abgestimmte Modell sie tatsächlich braucht. Die Verantwortlichkeiten für Gebühren und negative Salden werden ausdrücklich vereinbart, für den vorgeschlagenen Destination-Flow grundsätzlich bei der Plattform eingeplant. Diese Festlegung ist teilweise später nicht änderbar. [Accounts v2](https://docs.stripe.com/connect/accounts-v2), [Konfiguration und Verantwortlichkeiten](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration).

`recipient` als **v2-Konfiguration** ist nicht dasselbe wie das **recipient service agreement**. Letzteres hat andere Fähigkeiten, Ländergrenzen und aktuell v1-Anforderungen. Keine ungeprüfte Auswahl dieses Vertrags zur Umgehung von Händler- oder Altersvoraussetzungen. Das passende Service Agreement und gegebenenfalls `on_behalf_of` bleiben Teil der Stripe-Freigabe. [Service Agreements](https://docs.stripe.com/connect/service-agreement-types).

Destination Charges sind für einen zentralen Marktplatzfluss geeignet, belasten aber das Plattformkonto mit Stripe-Kosten, Erstattungen und Chargebacks. Der Transfer ins verbundene PSP-Guthaben entsteht beim Einzug; er ist nicht identisch mit der späteren Bankauszahlung. `on_behalf_of` bestimmt unter anderem den Settlement Merchant und den Kontoauszugstext, entscheidet aber nicht allein über die zivilrechtliche Vertragsrolle. [Charge-Typen](https://docs.stripe.com/connect/charges), [Destination Charges](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted).

Die verwendete API-/SDK-Version wird erst beim technischen Freigabetermin fest gepinnt. Aktuelle Accounts-v2-Beispiele enthalten `2026-09-30.preview`; das ist kein Grund, eine Preview stillschweigend produktiv zu übernehmen. Vorher Verfügbarkeit, deutsche Minderjährigenführung und fehlende Fähigkeiten mit Stripe bestätigen. Legacy-Kontotypen `standard`/`express`/`custom` werden nicht unbesehen als neues Datenmodell übernommen.

## 5. Konkreter Ablauf pro Termin

### Vergütung eindeutig vereinbaren

Ein Zahlungsauftrag erhält einen unveränderlichen Vertragsstand: Zahler, tatsächlicher Empfänger, Job, Engagement, Terminversion, Währung, Vergütungsmodell, Leistungsumfang, Höchstbetrag und Gebührensatz/-betrag. Alle Beträge werden serverseitig in Cent berechnet. Der Client darf weder Empfängerkonto noch Preis frei einsetzen.

- **Festbetrag:** vereinbarte Terminvergütung, beispielsweise 30,00 €.
- **Stundenpreis:** Satz, geplante Minuten und ausdrücklich akzeptierter Höchstbetrag. Tatsächliche Minuten werden später gemeinsam nachvollziehbar bestätigt. Keine offene, unbegrenzte Kartenbelastung.
- **Gebührenvorschlag:** Anbieter bezahlt Vergütung plus klar getrennte Plattformgebühr; der vereinbarte Verdienst wird nicht überraschend gekürzt. Konkrete Gebühr, Umsatzsteuerbehandlung und Erstattungsregel sind offene Produkt-/Steuerentscheidungen. Bei Lohnzahlung wären zulässige Abzüge zusätzlich separat zu prüfen.
- **Wiederkehrend:** ein Engagement, aber ein eigener Zahlungsauftrag pro Termin. Kein verstecktes Abo und keine pauschale Berechtigung für unbegrenzte Folgeabbuchungen.

Beispiel ohne festgelegten Tarif: „Vergütung 30,00 € · Servicegebühr X,XX € · Gesamt 3X,XX €“. Der Empfänger sieht seinen vereinbarten Betrag und den Auszahlungsstatus. Stripe-Verarbeitungskosten sind Plattformkosten gemäß freigegebenem Gebührenmodell, keine nachträgliche Überraschung.

### Zeitlicher Vorschlag für einen begrenzten MVP

1. **Erste Bewerbung:** ausschließlich Platzreservierung. Keine Kartenbelastung, keine finanzielle Sicherung behaupten.
2. **Termin vereinbaren:** beide Seiten bestätigen Termin und Vergütungsstand; falls rechtlich erforderlich bestätigt die legitimierte Vertretung. Auszahlungseinrichtung muss vor Aktivierung des Pay-Auftrags freigegeben sein. Bei weiter entferntem Termin steht „Zahlung vor dem Termin bestätigen“.
3. **Kurz vor Beginn:** vorgeschlagener Startwert 24 Stunden vorher, konfigurierbar nach Pilotprüfung. Anbieter öffnet Checkout im eigenen Benutzerkontext und autorisiert den klar benannten Höchstbetrag. Bei kurzfristigem Termin sofort. Es wird noch nicht eingezogen.
4. **Arbeit melden:** Jobsuchender meldet die Leistung/Minuten fertig. Anbieter prüft den Endbetrag innerhalb des vereinbarten Rahmens. Nach dessen Bestätigung veranlasst der Server genau einen Einzug. Jobabschluss und Zahlungsfreigabe können im selben übersichtlichen Dialog liegen, bleiben technisch zwei getrennte Zustände.
5. **Transfer/Auszahlung:** nach erfolgreichem PSP-Einzug Status „Bezahlt“, danach eigener PSP-Transfer-/Bankauszahlungsstatus. Reguläre Auszahlung nach PSP-Verfügbarkeit; keine feste Ankunftszeit oder Zahlungsunwiderruflichkeit versprechen.
6. **Fehlende Bestätigung/Streit:** klarer Supportfall mit Frist und benanntem Verantwortlichen. Kein automatischer Einzug allein wegen ablaufender Kartenautorisierung. Bei Ablauf endet der Kartenvormerkversuch; ein möglicher Vergütungsanspruch bleibt separat offen und wird nicht als „erstattet“ oder „erledigt“ gelöscht. Neue Zahlung nur mit gültiger Grundlage und nötiger erneuter Bestätigung.

Stripe-Kartenautorisierungen gelten häufig fünf bis sieben Tage, abhängig vom Transaktionstyp; maßgeblich ist die tatsächliche `capture_before`-Frist. Checkout unterstützt manuelles Capture. Teilcapture gibt den Rest frei; üblicherweise ist kein zweites Capture desselben Versuchs möglich. SEPA-Lastschrift unterstützt diesen Vormerkablauf nicht. Deshalb zunächst nur dafür geeignete Kartenzahlungsmethoden, keine BNPL-Produkte, keine angenommene 30-Tage-Garantie und keine automatische Preview-Funktion zum Fristablauf. [Autorisierung und Capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).

Die Einzugsfrist wird mit Sicherheitsabstand überwacht. Ein Jobtermin außerhalb des verfügbaren Fensters erhält keinen künstlich verlängerten Vormerkstatus. Speichern einer Zahlungsmethode via SetupIntent kann später optional Komfort bieten, reserviert aber kein Geld. Off-session-Einzüge brauchen eine eigene ausdrückliche Grundlage und einen SCA-Rückkehrpfad; sie sind **nicht Teil des ersten MVP**. [SetupIntents](https://docs.stripe.com/api/setup_intents), [SCA und spätere Authentifizierung](https://stripe.com/guides/strong-customer-authentication).

### Jobstatus und Zahlungsstatus getrennt anzeigen

| Fachzustand | Möglicher Zahlungszustand | Nutzertauglicher Hinweis |
| --- | --- | --- |
| Reserviert | Noch kein Zahlungsauftrag | „Termin und Vergütung vereinbaren“ |
| Vereinbart | Betrag bestätigt, Zahlung fällig | „Zahlung vor dem Termin bestätigen“ |
| Vereinbart | Karte autorisiert | „Betrag auf der Karte vorgemerkt“; Betrag und Frist im Detail |
| Leistung erledigt | Endbetrag wartet auf Bestätigung | „Vergütung prüfen und bezahlen“ |
| Abgeschlossen | Capture erfolgreich, Auszahlung ausstehend | „Bezahlt · Auszahlung in Bearbeitung“ nur für den Empfänger |
| Abgeschlossen oder abgesagt | Refund/Streit noch offen | Finanzfall bleibt erreichbar; Archivierung beendet ihn nicht |

„Reserviert“ bleibt der Jobplatz. Für Karten wird „vorgemerkt“ verwendet, damit zwei unterschiedliche Reservierungen nicht miteinander verwechselt werden.

## 6. Änderungen, Absagen und finanzielle Sonderfälle

| Ereignis | Fachlich/finanziell vorgesehene Reaktion |
| --- | --- |
| Terminänderung vor Autorisierung | Neue Termin-/Vergütungsversion bestätigen; alte Fälligkeit ersetzen; keine Abbuchung |
| Terminverschiebung nach Autorisierung | Tatsächliche Frist und akzeptierten Zweck prüfen. Passt die Änderung nicht, alte Vormerkung kontrolliert beenden und neue Zustimmung/Autorisierung anfordern. Keine gleichzeitigen unbemerkten Vormerkungen |
| Geringerer Endbetrag | Innerhalb des Vertragsstands bestätigen und nur diesen Betrag einziehen; Rest der Vormerkung freigeben |
| Mehr Minuten/Leistungsumfang/höherer Betrag | Zusatzleistung vorab neu vereinbaren und ausdrücklich genehmigen. Kein Overcapture oder Nachbelasten ohne bestätigten Auftrag; MVP lehnt Überschreitung ab |
| Absage vor Einzug | Autorisierten Versuch abbrechen; „Vormerkung aufgehoben“, kein Refund-Beleg. Keine Stornogebühr im MVP ohne gesondert geprüfte und akzeptierte Regel |
| Absage/Fehler nach Einzug | Vollständige oder begründete Teilerstattung über ursprüngliches Zahlungsmittel, mit eigener Entscheidung, Status und Beleg |
| Refund nach Transfer/Auszahlung | Plattformliquidität und Transfer-Rückabwicklung separat betrachten; Bankauszahlung nicht als reversibel voraussetzen |
| Wiedereröffnung eines Jobs/Chats | Keine Wiederverwendung eines bezahlten oder stornierten Zahlungsauftrags. Neue Leistung/Terminversion; historische Belege unverändert |
| Konto-/KYC-Sperre | Keine neue Zahlungsannahme oder Auszahlung außerhalb freigegebener Fähigkeiten. Bereits entstandene Ansprüche und notwendige Refunds gehen in einen betreuten Fall |
| Kartenreklamation/Chargeback | Eigener PSP-Streitfall mit Frist, minimal erforderlichen Nachweisen und verantwortlichem Support. App-Meldung und Kartenreklamation sind verschiedene Vorgänge |

Für Destination-Refunds sind Transfer-Rückholung und Rückerstattung der Plattformgebühr getrennte Entscheidungen; Stripe bietet dafür unter anderem `reverse_transfer` und `refund_application_fee`. Nicht behaupten, dass ein Kundenrefund automatisch alle Geldbewegungen rückgängig macht. Fehler bei bereits zurückgeholten Transfers benötigen Ausgleich und Abstimmung. [Destination-Refunds/-Disputes](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted).

Uncaptured PaymentIntents werden abgebrochen, nicht erstattet. Refunds können ausstehend sein oder scheitern, verbrauchen verfügbares PSP-Guthaben und gehen grundsätzlich zurück zum ursprünglichen Zahlungsmittel. Ursprüngliche Stripe-Verarbeitungskosten werden regelmäßig nicht zurückgezahlt. Die Oberfläche darf erst nach bestätigtem PSP-Ergebnis „Erstattet“ anzeigen. [Stripe-Refunds](https://docs.stripe.com/refunds).

Der erste MVP verwendet keinen zusätzlichen manuellen Auszahlungsstau nach dem bestätigten Einzug. Falls später verzögerte Auszahlungen benötigt werden: Stripe bietet ausdrücklich **kein Escrow**; für Deutschland nennt die Dokumentation beim manuellen Halten grundsätzlich 90 Tage als äußere Grenze. Das ist keine empfohlene Wartezeit und ersetzt keine vertraglich/rechtlich begründete Freigaberegel. [Manuelle Auszahlungen](https://docs.stripe.com/connect/manual-payouts).

Verbraucherverträge über Plattformleistungen und gegebenenfalls die vermittelten Dienstleistungen benötigen passende Bestell-, Informations- und Widerrufsprozesse. Eine bestätigte Ausführung lässt ein gegebenenfalls bestehendes Widerrufsrecht nicht automatisch ohne weitere Voraussetzungen erlöschen. Die genaue Vertragsrolle entscheidet, welche Texte und Zustimmungen notwendig sind. [BGB § 356](https://www.gesetze-im-internet.de/bgb/__356.html). Storno-/Refundregeln werden erst nach dieser Prüfung veröffentlicht.

## 7. Gebühren und Wirtschaftlichkeit vorab rechnen

Die am Abrufdatum veröffentlichte deutsche Standardpreisangabe beträgt beispielhaft 1,5 % + 0,25 € für Standardkarten aus dem EWR. Connect mit eigener Plattformpreisgestaltung nennt zusätzlich unter anderem 2 € pro monatlich aktivem Auszahlungskonto sowie 0,25 % + 0,10 € pro Auszahlung; weitere Komponenten hängen vom Tarif ab. Diese Werte sind kein Angebot und müssen für das genehmigte Modell bestätigt werden. [Payments-Preise](https://stripe.com/de/pricing), [Connect-Preise](https://stripe.com/en-de/connect/pricing).

Bei kleinen Einzeljobs sind fixe Kosten wesentlich. Vor Tarifentscheidung werden mindestens 10/20/50-Euro-Jobs, eine/mehrere Auszahlungen pro Monat, volle/teilweise Refunds und Chargebacks kalkuliert. Preisbestandteile: PSP-Verarbeitung, Connect-/Routing-/Auszahlungskosten, Steuer auf eigene Gebühren, Support, Ausfälle und Reserve. Mehrere Bankauszahlungen zusammenzufassen darf keine verschleierte oder unangemessen verzögerte Auszahlung erzeugen.

Die genaue Gebührenverteilung, ein möglicher Mindestbetrag und der Umgang mit fehlgeschlagenen Zahlungen bleiben offen. Keine Preisveröffentlichung und kein positiver Deckungsbeitrag aus dem bloßen SDK ableiten.

## 8. Konzeptionelles Datenmodell

Die folgenden Namen beschreiben einen Entwurf, **keine vorhandenen Tabellen oder beschlossene Migration**. PSP-Rohdaten und Steueridentifikatoren gehören nicht in öffentliche Profilprojektionen, Chat-Events oder Benachrichtigungs-Payloads.

| Baustein | Inhalt und wesentliche Integrität |
| --- | --- |
| `pay_accounts` | Benutzer, PSP-Konto-ID, Umgebung, Land, zulässige Rolle, Capability-/Requirement-Status, Onboardingstand. Eindeutiges aktives Empfängerkonto pro Person/PSP/Umgebung; echte Identität getrennt von Vertretung |
| `pay_authorities` | Nachweisart, legitimierter Vertreter, Geltungsbereich, angenommene Vertragsversion, Beginn/Widerruf/Ablauf. Keine Ableitung aus bloßem `guardian_relationships.status` |
| `payment_terms` | Versionierter unveränderlicher Vergütungsstand für `application_id`, `engagement_id`, `appointment_id` und Terminversion; Zahler/Empfänger, Satz/Minuten/Höchstbetrag, Gebühren, Zustimmung beider Seiten/Vertretung, Zeitpunkte |
| `payment_orders` | Genau eine finanzielle Verpflichtung je bestätigtem Termin-/Leistungsstand; Währung, Sollbetrag, bestätigter Endbetrag, Gesamt-Capture/-Refund, eigenständiger Finanzstatus und Versionszähler |
| `payment_attempts` | Mehrere Versuche bei Ablauf/Fehler zulässig, aber höchstens ein aktiver autorisierender Versuch pro Auftrag. Checkout-/PaymentIntent-/Charge-IDs, PSP-Kontext, Betrag, `capture_before`, Status. Global eindeutige externe IDs innerhalb PSP/Account/Umgebung |
| `payment_operations` | Dauerhafter Befehl mit eindeutiger fachlicher Idempotenz-ID, Parameterversion/-hash, Actor, Berechtigungsentscheidung, PSP-Key, Versuchszahl und Ergebnis. Transactional Outbox für externe Aufrufe |
| `payment_provider_events` | Signaturgeprüfter Eingang, PSP-Event-ID, Account-/Livekontext, Empfang/Verarbeitung/Retry. Eindeutigkeit pro Event; Rohpayload minimiert, nur interne Verarbeitung |
| `financial_journals` + `financial_entries` | Unveränderliche, ausgeglichene Buchungssätze in Cent je Währung; Referenz auf tatsächliche externe Transaktion/Operation. Korrekturen durch Gegenbuchung, keine UPDATEs historischer Beträge |
| `settlements` + Zuordnungen | Transfer, Application Fee, Refund, Transfer Reversal, PSP-Fee und Bank-Payout separat; PSP-Balance-Transaction-IDs, Pending/Available und Zuordnung von Sammelauszahlungen zu ihren Beträgen |
| `payment_cases` | Nichtbestätigung, Betragseinwand, Refund, Dispute oder Auszahlungsausfall; Eigentümer, Frist, Status, begrenzte Evidence und Audit. Kein öffentliches Chatprotokoll als Finanzakte |
| Getrennter Compliance-Bereich | Nur erforderliche Steuer-/Vertretungsnachweise, Zugriffszweck, Fristen und Export-/Meldestand. Zugriff enger als normale Support-/Profilrechte |

### Invarianten

- Alle Beziehungen werden serverseitig über Jobanbieter, Bewerbung, Engagement und Termin aufgelöst. Ein Nutzer darf keine fremde Stripe-ID, Partner-ID oder Kontoverbindung unterschieben.
- Finanzobjekte haben keine löschende Kaskade von Chat, Profil oder Job. Erforderliche Nachweise bleiben nach geprüfter Fristenregel erhalten; Personenbezug wird danach entfernt/gelöscht.
- Geldbeträge sind Integer-Cent und Währung ist Pflicht. Kein Float, kein Addieren unterschiedlicher Währungen. Gegenbuchungen, Refunds und Gebühren sind ausdrücklich typisiert.
- Preisänderungen erzeugen neue bestätigte Versionen. Ein Zahlungsversuch bleibt an seinen alten Snapshot gebunden, bis er kontrolliert beendet wurde.
- Capture und Storno, parallele Refunds und Mehrfachklicks werden mit Sperre/Versionierung serialisiert. Gesamterstattung überschreitet den eingezogenen Betrag nicht; kein zweites Capture wegen eines neuen Browsers.
- Autorisierung ist eine Vormerkung und kein Geldzufluss. Auftrag abgeschlossen, `PaymentIntent.succeeded`, PSP-Transfer und `payout.paid` sind verschiedene Fakten.
- Beträge anderer Aufträge dürfen nicht ohne nachvollziehbare Zuordnung zur Deckung eines individuellen Anspruchs verwendet werden. Auszahlungen werden gegen freigegebene, verfügbare PSP-Mittel und bereits reservierte Auszahlungsvorgänge geprüft.
- Authentifizierte Nutzer lesen nur ihre benötigte Projektion und fordern erlaubte Aktionen an. Nur vertrauenswürdige Serverprozesse verbuchen PSP-Ereignisse und verändern Finanzzustände; Finanz-/Compliance-Schreibrechte nie direkt an Browserclients.
- Eltern erhalten ausschließlich die ausdrücklich legitimierte Sicht. Mit Volljährigkeit oder Widerruf wird eine neue Zugriffsprüfung ausgelöst; bestehende Nachweispflichten werden nicht unkontrolliert gelöscht.

### Journal und Abstimmung

Das Journal bildet PSP-Geldbewegungen, Vergütungsansprüche, eigene Gebühren, PSP-Kosten, Rückzahlungen und Bankabstimmung nachvollziehbar ab. Es ist **keine ausgabefähige Nutzer-Wallet**. Kontenrahmen, Umsatzrealisierung, Umsatzsteuer und mögliche Lohnbestandteile werden mit der Buchhaltung festgelegt; nicht durch einen generischen „balance“-Zähler.

Für die PSP-Abstimmung dienen Balance Transactions mit Quelle, Gebühren, Nettobetrag, Währung und Verfügbarkeit als Grundlage. Ein Transfer kann noch im PSP liegen, ein Payout kann mehrere Zahlungen bündeln. Das muss separat nachweisbar bleiben. [Stripe: Balance Transactions](https://docs.stripe.com/reports/balance-transaction-types).

Vorgeschlagener Betrieb: täglicher Import aller relevanten Balance-Transaktionen beider PSP-Kontexte, Abgleich gegen Zahlungsauftrag und Journal, Summenprüfung von Anfangsbestand + Bewegungen = Endbestand sowie gesonderter Bank-Payout-Abgleich. Abweichungen erzeugen einen internen Fall und verhindern risikobehaftete Folgeaktionen; sie werden nie durch einen stillen Saldo-UPDATE „repariert“.

## 9. Verlässliche Server- und Webhook-Verarbeitung

Checkout-Sessions und Zahlungsbefehle entstehen ausschließlich serverseitig nach Prüfung der angemeldeten Identität, Rolle, aktuellen Berechtigung, Terminversion und bestätigten Beträge. Externe Aufrufe laufen über eine dauerhafte Operation; SQL-Transaktion und Stripe-Aufruf sind keine gemeinsame atomare Transaktion. Bei Timeout wird erst der bekannte PSP-Vorgang abgeglichen, statt mit neuer ID erneut abzubuchen.

Stripe-Idempotenz ergänzt die interne Eindeutigkeit. Bei API v1 werden unter gleichem Key auch bestimmte Fehlerantworten wiederholt; Keys können nach mindestens 24 Stunden entfernt werden. Daher schützt ein PSP-Key allein nicht dauerhaft vor Doppelzahlung. Accounts v2 hat abweichende Retry-Semantik; Adaptertests müssen dies berücksichtigen. [Stripe: Idempotente Requests](https://docs.stripe.com/api/idempotent_requests).

Webhook-Grundlage: unveränderter Raw Body, Signatur-/Zeitprüfung mit offiziellem SDK, getrennte Test-/Live-Secrets, Prüfung des erwarteten PSP-/Accountkontexts, dauerhafte Annahme vor `2xx`, asynchrone Verarbeitung und gesicherte Retries. Events können mehrfach und ungeordnet eintreffen; Dedupe nach Event-ID und fachlichem Ergebnis, bei Bedarf aktuellen PSP-Objektstand abrufen. Ein `success_url`-Aufruf ist kein Zahlungsbeweis. [Stripe-Webhooks](https://docs.stripe.com/webhooks).

Benötigte Ereignisfamilien werden vor Implementierung gegen die gewählte API-Version festgelegt: Checkout/Autorisierung, PaymentIntent-/Charge-Ergebnis, Refund, Dispute, Transfer/Reversal, Payout sowie Account-/Capability-/Requirement-Änderung. Die jeweils unterstützten Thin-/Snapshot-Events bekommen die passende Verarbeitung; das Payloadformat folgt nicht einfach der Versionsnummer des Accounts. [Stripe-Ereignisformate](https://docs.stripe.com/events/how-events-work).

Bankauszahlungen haben einen eigenen Lebenszyklus mit `pending`, `in_transit`, `paid`, `failed` oder `canceled`. Ihr Status wird vom PSP übernommen und nicht aus dem Jobabschluss oder dem Transfer erraten; fehlgeschlagene Auszahlungsziele brauchen eine betreute Korrektur. Auch bei Accounts v2 beschreibt Stripe hierfür weiterhin v1-Payout-Events. [Connect-Auszahlungen](https://docs.stripe.com/connect/manage-connected-account-payouts).

Fehlerfälle erhalten eine sichtbare Aktion: Karte erneut bestätigen, Auszahlungseinrichtung vervollständigen oder Supportfall ansehen. Ein Ausfall von Benachrichtigungen darf keinen finanziellen Status verändern. Finanzereignisse können nach Commit über eine deduplizierte Outbox ins bestehende Benachrichtigungssystem gelangen; sensible Beträge/Personaldaten werden auf externen Sperrbildschirmen minimiert. Push/SMS werden dadurch nicht automatisch aktiviert.

## 10. KYC, Datenschutz und Steuermeldungen

KYC ist ein laufender Zustand: Identitätsanforderungen und Capabilities können sich ändern. Backend prüft die tatsächlich benötigten aktiven Fähigkeiten vor neuen Vorgängen und reagiert auf neue Anforderungen/Sperren; die Rückkehr aus einem Onboarding-Link allein bedeutet nicht „verifiziert“. [Stripe-Verifizierung](https://docs.stripe.com/connect/handling-api-verification).

Datenschutzvorschlag: Zahlungsdurchführung, gesetzliche Aufbewahrung/Meldung und optionale Komfortfunktionen bekommen getrennte Zwecke/Rechtsgrundlagen. Informationen werden vor Datenerhebung verständlich bereitgestellt; keine pauschale „Einwilligung für alles“. Stripe handelt je nach Verarbeitung als Auftragsverarbeiter oder eigener Verantwortlicher. Rollen, AV-Verträge soweit passend und Drittlandtransfers werden konkret geprüft. [DSGVO, insbesondere Art. 5, 6, 13, 25, 28, 32 und 44](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679), [Stripe-DPA](https://stripe.com/legal/dpa).

Karten- und Ausweisdaten bleiben möglichst direkt beim PSP; keine PAN/CVC, Ausweiskopie oder vollständige IBAN in Logs, Chats oder allgemeinem Profil. Auszahlungszielwechsel benötigen erneute Authentifizierung und PSP-gestützte Prüfung. Vor dem Start wird die DSFA-Erforderlichkeit dokumentiert, insbesondere wegen Minderjährigen und Finanz-/Identitätsdaten; nicht pauschal als bereits erfüllt behaupten. [Stripe-Integrationssicherheit](https://docs.stripe.com/security/guide), [Datenschutzaufsicht: DSFA-Prüfung](https://www.datenschutz-berlin.de/themen/unternehmen-und-vereine/datenschutz-folgenabschaetzung/).

### DAC7/PStTG nicht mit Steuerpflicht verwechseln

Die Plattform-/Betreibereigenschaft und relevante persönliche Dienstleistungen sind anhand der tatsächlichen Organisation zu prüfen. Das Thema kann schon bei vermittelten Leistungen bestehen; es entsteht nicht zwingend erst durch das Einbauen von Stripe. Gerade die aktuelle Betreiberform muss einbezogen werden. Eine BZSt-Auskunft zum konkreten Sachverhalt ist gegebenenfalls zu prüfen. [PStTG § 3](https://www.gesetze-im-internet.de/psttg/__3.html), [§ 5](https://www.gesetze-im-internet.de/psttg/__5.html), [§ 10](https://www.gesetze-im-internet.de/psttg/__10.html).

Die oft genannte Ausnahme „weniger als 30 und weniger als 2.000 €“ betrifft unter ihren Voraussetzungen **Warenverkäufe**, nicht pauschal Gartenarbeit oder andere persönliche Dienstleistungen. Minderjährigkeit ist dort keine allgemeine Freistellung. Eine Meldepflicht sagt wiederum nicht, dass jede gemeldete Vergütung steuerpflichtig ist. [PStTG § 4 Abs. 5](https://www.gesetze-im-internet.de/psttg/__4.html).

Wenn Workfare meldender Betreiber ist, braucht es unter anderem überprüfte Identitäts-/Ansässigkeits- und Steuerangaben, gegebenenfalls Kontoinhaber, quartalsbezogene Vergütung, Zahl der Tätigkeiten und separat Gebühren/Provisionen/Steuern. Modell und Nachweise müssen Rückzahlungen und Korrekturen nachvollziehbar behandeln. Meldung und betroffenenbezogene Information sind grundsätzlich bis 31. Januar des Folgejahres vorgesehen; PSP-KYC ersetzt diese Pflichten nicht. [PStTG § 14](https://www.gesetze-im-internet.de/psttg/__14.html), [§ 13](https://www.gesetze-im-internet.de/psttg/__13.html), [§ 22](https://www.gesetze-im-internet.de/psttg/__22.html).

Sorgfaltspflichten, Dienstleisteraufteilung, Aufzeichnungen und Aufbewahrung gehören vor Pilotbeginn in den Betriebsprozess. Das PStTG sieht für seine Aufzeichnungen zehn Jahre vor und anschließend für bestimmte personenbezogene Aufzeichnungen Löschung. Das ist keine pauschale Frist für sämtliche Chat-/Profil-/Webhookdaten. [PStTG § 20](https://www.gesetze-im-internet.de/psttg/__20.html), [§ 21](https://www.gesetze-im-internet.de/psttg/__21.html), [§ 24](https://www.gesetze-im-internet.de/psttg/__24.html).

## 11. Oberfläche ohne zusätzliche Hauptnavigation

**Auftrags-/Chatdetails bleiben der Mittelpunkt.** Unter Termin/Vergütung erscheint ein ruhiger Liquid-Glass-Bereich „Zahlung“ mit Gesamtbetrag, einem Statussatz und höchstens einer primären Aktion. Die Hauptnavigation bleibt unverändert. Zahlungsdaten stehen nicht zusätzlich als Chatnachrichten mit konkurrierenden Buttons im Verlauf.

| Oberfläche | Einbettung |
| --- | --- |
| Jobkarte | Bestehende Vergütung; keine Wallet-/Gebührenwerbung und keine private Bankinformation |
| Termin vereinbaren | Klarer Vergütungsblock, Gebührenaufschlüsselung, nötige Zustimmungen und nächster Zahlungszeitpunkt |
| Chatkopf | Nur wenn eine konkrete Handlung fällig ist ein Shortcut: „Zahlung bestätigen“ oder „Vergütung prüfen“; öffnet den passenden Bereich der Details |
| Details | Gesamtbetrag/Empfänger, Terminbezug, aktueller Zustand, ein Hauptbutton, darunter zurückhaltend „Beleg“ und „Problem melden“ |
| Einstellungen | Unterpunkt „Zahlungen“: Anbieter Zahlungsmittel/Belege; Jobsuchende Auszahlungseinrichtung, Verlauf und Nachweise; legitimierte Eltern nur ihren erlaubten Umfang |
| Benachrichtigungen | Aktionsbezogener, berechtigungsgeprüfter Deep-Link direkt zum Zahlungsfall; keine separate Sackgasse |
| Archiv | Abgeschlossene Aufträge behalten ihre echten Belege und offenen Finanzfälle; keine irreführende Erfolgsmeldung bei unbearbeitetem Refund |

Mobil eine Spalte, feste klare Beträge, große verständliche Touchziele, aufklappbare Kosten-/Belegdetails. Hell/Dunkel verwenden dieselben bestehenden Glas-Tokens und zurückhaltende blaue Textakzente; Finanzzustände brauchen Text/Icon und dürfen nicht allein über Farbe vermittelt werden. Tastatur, Screenreader, Fokus-Rückkehr, Fehlermeldung und reduzierte Bewegung gehören zum Abnahmetest. Die Stripe-Zahlungsoberfläche wird innerhalb ihrer unterstützten Anpassung gebrandet; kein eigenes nachgebautes Kartenformular für einen stärkeren Glaseffekt.

## 12. Umsetzungsetappen und Abnahme

### A. Freigabepaket, noch ohne Zahlungsimplementierung

- [ ] Schriftlicher Stripe-Sachverhalt mit Betreiberform, Deutschland/EUR, privaten/gewerblichen Auftraggebern, Empfängern 14–20, Tätigkeiten, arbeitsrechtlicher Einordnung, Representative, Gebühren, Charge-Typ und Auszahlungspfad beantwortet.
- [ ] Bestätigt, ob deutsche Minderjährige im ausgewählten Accounts-v2-/Dashboard-/Service-Agreement-Modell zulässig und technisch vollständig onboardbar sind. Dokumente, Einwilligende, Kontoinhaber und Volljährigkeitsübergang konkret benannt.
- [ ] Arbeits-/Minderjährigen-, Zahlungsaufsichts-, Verbraucher-, Datenschutz- und Steuerprüfung abgeschlossen; keine Vorlage behauptet, die Plattform sei automatisch Treuhänder, Arbeitgeber oder davon freigestellt.
- [ ] Fees, verlorene PSP-Gebühren, Reserve, Supportverantwortung, Vergütungsfreigabe bei Nichtreaktion und Eskalationsfristen beschlossen.
- [ ] Betreiber-/Legal-/PStTG-Prozesse tatsächlich bereit; API-Version und freigegebene Fähigkeiten festgelegt.

### B. Isolierter Sandbox-Prototyp

Nur freigegebene Testidentitäten und Testgeld. Zunächst ein Festpreis, ein Empfänger, ein Termin. Vertragssnapshot, Hosted Onboarding, Checkout, Vormerkung, Einzug, reguläre Auszahlungssimulation und Belegansicht vollständig durchtesten. Keine Echtgeldfreigabe durch einen erfolgreichen Sandbox-Screenshot ableiten.

### C. Technische Abnahmekriterien

- [ ] Fremde Job-/Termin-/Stripe-/Bank-ID sowie Clientpreis-Manipulation werden serverseitig abgewiesen; bestätigte Minderjährigenberechtigung kann nicht clientseitig gefälscht werden.
- [ ] Zwei Geräte, Doppelklicks und konkurrierendes Capture/Storno/Refund erzeugen genau die zulässige Geldbewegung. Idempotenz hält auch nach 24 Stunden, Deploy/Restart und Netzwerk-Timeout.
- [ ] Unsignierte/falsch signierte/replayte und falsche Live-/Accountkontexte scheitern. Doppelte, vertauschte, verspätete und verlorene Webhooks werden ohne Doppelbuchung aufgearbeitet.
- [ ] Redirect ohne Webhook zeigt keinen erfundenen Zahlungserfolg; Autorisierung ist sichtbar von Einzug und Bankauszahlung getrennt.
- [ ] SCA erforderlich, abgelehnte Karte, Checkout-Abbruch, abgelaufene Autorisierung, erneute Autorisierung und PSP-Ausfall haben einen erreichbaren nächsten Schritt.
- [ ] Termin-/Betragsänderung, Stundenabrechnung, Teilcapture, Absage vor/nach Einzug, Teil-/Vollrefund, Refundfehler und Chargeback einschließlich Fristen und Liquiditätsmangel sind getestet.
- [ ] Bereits ausgezahlter Betrag, gesperrtes Empfängerkonto und gewechseltes Bankkonto führen nicht zu falscher Erstattungs-/Auszahlungsbestätigung.
- [ ] Wiederkehrende Termine und Wiedereröffnung verändern keine historischen Belege; kein alter Zahlungsversuch wird für neue Leistung reaktiviert.
- [ ] Journal ist pro Währung ausgeglichen; jeder PSP-Balance-Transaction-/Transfer-/Refund-/Fee-/Payout-Betrag lässt sich genau einmal zuordnen. Tages-/Bankabgleich deckt absichtlich eingebaute Differenzen auf.
- [ ] Zugriff auf fremde Zahlungs-/Steuer-/KYC-Daten ist ausgeschlossen; Export, Rollenwechsel, Volljährigkeit, Vertretungswiderruf, Kontolöschung und Aufbewahrungsende sind geprüft.
- [ ] Mobile und Desktop, beide Farbmodi, Tastatur/Screenreader und reduzierte Bewegung funktionieren ohne zusätzlichen Haupttab oder widersprüchliche Status.

### D. Begrenzter Echtbetrieb erst nach A–C

Separates serverseitiges Feature-Flag für genehmigte Nutzer-/Tätigkeitskohorte, begrenztes Volumen, besetzter Support, Monitoring und täglich geprüfte Abstimmung. Abschaltmöglichkeit verhindert neue Zahlungen, lässt Webhooks, Refunds, Streitfristen und vorhandene Auszahlungen weiter betreut laufen. Bestehende Jobs werden nicht rückwirkend als bezahlt markiert oder ohne Zustimmung auf neue Bedingungen umgestellt.

Erst nach erfolgreichen realen, ausdrücklich freigegebenen Pilotfällen folgen Stundenabrechnung und weitere Terminszenarien. Neue Zahlungsmethoden, Cross-Border, Trinkgeld, Sofortauszahlung, Off-session und zusätzliche Empfänger sind eigene Erweiterungen mit neuer Prüfung.

## 13. Quellenstand und noch nicht bestätigte Aussagen

Alle verlinkten Quellen sind Primärquellen von Stripe, deutschen Behörden/Gesetzesportalen oder EUR-Lex; Abruf am **24.10.2026**. Stripe-AGB im Abruf: geändert 28.09.2026; Connected Account Agreement: geändert 18.11.2025; Stripe-DPA: geändert 28.09.2026. Preise, API-Verfügbarkeit und Onboardingregeln sind vor tatsächlicher Umsetzung erneut zu bestätigen.

Bei einzelnen EUR-Lex-Volltextabrufen trat eine Botprüfung auf; die genannten DSGVO-Regeln wurden über die indexierten amtlichen Fassungen und die verlinkte Datenschutzaufsicht gegengeprüft. Für die Freigabe ist die vollständige geltende Fassung erneut heranzuziehen. Es wurde kein Stripe-Konto angelegt oder geprüft, keine Business-Zulassung behauptet und keine juristische Einzelfallfreigabe erteilt.

Offene Kernentscheidung bleibt: **Welches rechtlich zulässige Arbeits-/Dienstleistungsmodell soll die Plattform für 14–20-Jährige tatsächlich vermitteln, und welcher PSP bestätigt genau diesen Geldfluss?** Erst danach lässt sich der technische Entwurf verbindlich finalisieren.
