# Workfare Plan, Gebühren und die nächste Produktphase

Entscheidungsstand: 25.10.2026. Workfare Plan und der neue Tarif sind freigegeben; tatsächliche Freischaltungen und Tests stehen im zugehörigen Release-Nachweis. Die aktuelle UI-Abnahme und die nächsten Umsetzungsschritte sind unten festgehalten. Geplante Vorteile werden nicht als bereits verkauft dargestellt.

**Aktualisierte Freigabe:** Deutsche Regelbesteuerung mit 19 % wurde bestätigt. Abo und neuer Bruttotarif sind seit 25.10.2026, 15:13:03 MEZ live freigegeben. 5,90 € Monatsbeitrag enthalten 0,94 € Umsatzsteuer. Details und verbleibende Aussteller-/Gebührenbuchhaltungsaufgaben stehen im [Freigabenachweis](../releases/2026-10-25-workfare-plan-vat-release.md).

## Die konkrete Produktentscheidung

**Workfare Plan kostet 5,90 € pro Monat als Endpreis**, ohne Testphase, Jahresbindung oder Einschränkung der normalen Plattform. Kündigung zum Ende des bezahlten Monats ist jederzeit möglich. Der Name beschreibt eine andere Abrechnungsform, keine bessere Klasse von Nutzern.

| Bestandteil je neuem Job im freigegebenen Tarif | Einzelzahlung | Workfare Plan |
| --- | ---: | ---: |
| Allgemeiner Anteil für Abwicklung und Betrieb | 6 % + 0,49 € | 6 % + 0,49 € |
| Workfare-Anteil | 6 % | Entfällt |
| Mitgliedschaft | Keine | 5,90 € pro Monat |

Der Anbieter zahlt die allgemeine Servicegebühr zusätzlich zur Vergütung. Jobsuchende erhalten den vollen vereinbarten Betrag. Dies sind zahlartunabhängige Plattformpreise, keine weitergereichten, angeblich von einer Bank festgelegten Kartengebühren. Zahlungsdienstleisterkosten, Connect, Betrieb und Risiken werden intern kalkuliert. § 270a BGB wird nicht durch das Umbenennen eines Zahlungsmittelaufschlags umgangen. [§ 270a BGB](https://www.gesetze-im-internet.de/bgb/__270a.html).

Beide Prozentanteile werden je Job einzeln auf Cent gerundet. Dadurch kann die Summe um einen Cent von einer einzigen Rundung mit 12 % abweichen. Angezeigt und vertraglich gespeichert wird immer dieselbe Komponentenrechnung. Der Tarif wird erst zusammen mit dem kompatiblen Code und dem vollständig freigegebenen Angebot aktiviert.

**Bestandsschutz:** Vor der Tarifaktivierung angelegte Jobs behalten ihren bisherigen Tarif. Bereits erstellte Preisvorschläge behalten darüber hinaus ihren unveränderlichen Gebührenstand. Ein Abo wirkt auf neue Vorschläge für neue Jobs im neuen Tarif; es erhöht, senkt oder ersetzt keine bereits vereinbarten Preise rückwirkend.

## Wann sich das Abo lohnt

| Nutzung in einem Monat | Servicegebühren ohne Abo | Gebühren und Monatsbeitrag mit Plan | Ergebnis |
| --- | ---: | ---: | --- |
| Ein Job mit 17 € Vergütung | 2,53 € | 7,41 € | Einzelzahlung ist 4,88 € günstiger |
| Sechs Jobs mit jeweils 17 € | 15,18 € | 14,96 € | Plan spart 0,22 € |
| Vier Jobs mit jeweils 34 € | 18,28 € | 16,02 € | Plan spart 2,26 € |

Die Tabelle ist eine interne Kalkulation; die Vergütung ist in beiden Varianten identisch. Rund 100 € monatliche Vergütung ist ein grober Orientierungspunkt, die genaue Schwelle hängt von den Cent-Rundungen je Job ab. Die Produktseite zeigt nur Monatsbeitrag sowie 12 % beziehungsweise 6 % zuzüglich jeweils 0,49 € je neuem Job. Ein Gebührenrechner wird dort vorerst nicht angeboten. Vereinbarte Preise und frühere Tarife bleiben unverändert.

## Wirtschaftlichkeit für Workfare

Die folgende Kalkulation ist ein Kostenszenario, kein bestätigter individueller Stripe-Vertrag: deutsche Listenpreise, 2,8 % + 0,25 € Karteneinzug, 2 € je aktivem Empfänger/Monat, eine Auszahlung je Empfänger/Monat, 0,25 % + 0,10 € dafür und beispielhaft 19 % Umsatzsteuer innerhalb der Servicegebühr. Der tatsächliche Umsatzsteuerstatus wird separat festgestellt. [Stripe Payments](https://stripe.com/de/pricing), [Stripe Connect](https://stripe.com/de/connect/pricing).

Bei zehn bezahlten Jobs je aktivem **Empfänger**, nicht je Anbieter, bleiben beim 17-€-Job modelliert 1,08 € aus der normalen Gebühr beziehungsweise 0,25 € aus dem allgemeinen Anteil beim Plan. Bei nur einem solchen Job je aktivem Empfänger/Monat sind es −0,81 € beziehungsweise −1,64 €: Die Connect-Monatskosten dominieren. Support, Streitfälle und sonstiger Betrieb sind noch nicht bezahlt. Der Mitgliedsbeitrag darf daher nicht als garantierter Gewinn oder als vollständige Absicherung seltener Empfänger ausgegeben werden.

Bei 5,90 € Mitgliedsbeitrag ergeben 0,7 % Billing und 1,5 % + 0,25 € Karteneinzug modelliert rund 0,38 € direkte Einzugskosten. Bei angenommenen 19 % enthaltenen Umsatzsteuer verbleiben rund 4,58 € vor weiteren Kosten. Auch das ist nur eine Modellrechnung. Tatsächliche Karten, Steuern, Ausfälle, Volumen und Vertragskonditionen entscheiden. [Stripe Billing](https://stripe.com/de/billing/pricing).

Folgerung: Keine unbegrenzten zusätzlichen Geldboni zum Start. Seltene kleine Empfänger bewusst budgetieren, tatsächliche Aktivität messen und vor Wachstum das Connect-Angebot nachverhandeln. Die heutige Kalkulation lässt sich mit dem bestehenden Offline-Centrechner `scripts/payments/price-model.mjs` nachrechnen; er ändert keine Live-Preise.

## Kauf und Vertragsbetrieb

- Ein vorhandenes Workfare-Konto bleibt die Identität. Stripe-Customer und Profilname werden wiederverwendet; keine zweite Kundendatenwelt.
- Klarer Monatsendpreis, Verlängerung und Kündigung stehen vor dem Kauf. Der sofortige Leistungsbeginn hat eine eigene, nicht vorausgewählte Zustimmung. Das 14-tägige Widerrufsrecht wird nicht pauschal zum Erlöschen gebracht.
- Erst die tatsächliche bezahlte Rechnung im aktuellen Zeitraum schaltet den Vorteil frei. Rückkehr von Checkout, Trial, Gutschein, offene Rechnung oder ein manuell als bezahlt markierter Vorgang reichen nicht.
- Kündigung, Zahlungsausfall, Rückzahlung und Streitfall laufen über tatsächliche Stripe-Zustände und idempotente Datenbankübergänge. Ein veralteter Browser- oder Webhookstand verleiht keine neue Berechtigung.
- Kündigung und Widerruf bleiben ohne Login öffentlich erreichbar. Erklärungen erhalten einen dauerhaften Eingangsbeleg; ein bestätigter Beendigungszeitpunkt wird getrennt ausgewiesen. Besondere Fälle und Erstattungen werden nachvollziehbar geprüft. [§ 312k und § 356a BGB](https://www.gesetze-im-internet.de/bgb/BJNR001950896.html).
- Stripe Tax wird nicht aufgrund eines vorhandenen Stripe-Kontos aktiviert. Ohne geklärten Steuerstatus bleibt der neue Verkauf gesperrt. Kleinunternehmerstatus oder die konkrete steuerpflichtige Behandlung muss zuerst verbindlich vorliegen; es wird keine Registrierung erfunden.

## Die nächsten Funktionen – in sinnvoller Reihenfolge

| Reihenfolge | Funktion und konkreter Nutzen | Platz | Voraussetzung |
| --- | --- | --- | --- |
| 1 | **Automatische Terminabstimmung:** Gemeinsame verfügbare Zeiten vorschlagen und Terminänderungen abstimmen | Auftrag → Termin; optionale Verfügbarkeiten | Beide Seiten bestätigen; keine unbeaufsichtigte Kalender- oder Zahlungsänderung |
| 2 | **Freigaben im Haushalt:** Eigene Aufträge und Budgets mit weiteren Erwachsenen organisieren | Workfare Pay → Haushalt; Auftrag → Freigaben | Eigene Konten und explizite Rollen; keine pauschale Zahlungsfreigabe und kein gemeinsames Bankkonto |
| 3 | **Ersatzsuche bei Absagen:** Einen frei gewordenen Job erneut passenden Jobsuchenden anbieten | Auftrag → Absage → Erneut anbieten | Keine Ersatzgarantie, keine automatische Beauftragung und kein bevorzugter Zugang zu Jugendlichen |
| 4 | **Verständlicher Plan-Nutzen:** Tatsächlich bei bezahlten Jobs erlassene Workfare-Anteile zeigen | Mitgliedschaft → Übersicht | Nur belastbare, nicht erstattete Mitgliedstarif-Aufträge; keine hochgerechnete fiktive Ersparnis |
| 5 | **Push und wichtige SMS:** Terminänderungen und konkreten Handlungsbedarf auf dem gewählten Kanal erhalten | Benachrichtigungseinstellungen | Bestätigte Geräte/Nummern, bewusste Zustimmung, Kostenlimit, Datenminimierung |
| 6 | **Treuevorteile:** Kleine, finanzierte Vorteile für verlässliche langfristige Nutzung | Einstellungen → Vorteile | Stabiles Zahlungsmodell, Budget und Betrugsschutz; Details unten |
| 7 | **Bewusste Empfehlungen:** Einen persönlichen Link teilen, freiwillige Teilnahme | Vorteile → Freunde einladen | Kein Kontaktbuch-Upload oder automatischer Werbeversand; qualifizierte erste Zahlung |
| 8 | **Workfare Konto und Karte:** Verdienst nach tatsächlichem Eingang mit eigener Karte nutzen | Workfare Pay | Lizenziertes Jugendprogramm, Vertrags-/KYC-Freigabe, wirtschaftliches Angebot und operativer Pilot |

Die ersten drei Punkte stehen aufklappbar als „Demnächst“ auf der Plan-Seite und werden dort knapp erklärt. Die zuvor vorgeschlagenen Jobvorlagen, Sammelübersichten und die unspezifische gemeinsame Organisation werden dort nicht weiter beworben. Sie sind bis zum echten Start ausdrücklich nicht Teil des bezahlten Produkts. Kein schnellerer Zugang zu Jugendlichen, keine bezahlte Bevorzugung im Marktplatz und kein Sicherheitsvorteil nur für zahlende Anbieter.

## Nächste Umsetzung nach der UI-Abnahme

Die folgenden Punkte sind geplante Arbeit. Die bestehenden Unit-, Browser- und öffentlichen Zugriffstests ersetzen keinen bestätigten Zahlungseingang auf einem echten Bankkonto.

| Reihenfolge | Arbeit | Ort und fertiges Ergebnis |
| --- | --- | --- |
| 1 | **Gemeinsame Abnahme des Geldflusses** | Anbieter → Termin → Preisbestätigung → Bezahlen → Workfare-Pay-Verlauf → tatsächlicher Bankeingang. Die Rollen- und Elternfreigabe separat prüfen; SCA, unterbrochene Zahlung und Erstattung in der Sandbox abnehmen. Echte Zahlungen nur mit vorher festgelegten Beteiligten und Beträgen. |
| 2 | **Gebührenbelege vervollständigen** | Workfare Pay → Zahlungen und Belege. Aussteller- und Steuerangaben mit dem Live-Stand abgleichen und gegebenenfalls ergänzen; eigene Servicegebühren und Erstattungen vollständig nachvollziehbar verbuchen. Workfare-Gebührenrechnungen zusätzlich zu den Zahlungsbelegen berücksichtigen. |
| 3 | **Vollständigen Verlauf erschließen** | Transaktionshistorie → Zeitraum, Status und weitere Seiten. Empfänger sehen heute bis zu zehn jüngste Bewegungen, Anbieter bis zu zwanzig je Bereich. Den begrenzten Ausschnitt klar vom Gesamtverdienst trennen. |
| 4 | **Familienansicht abnehmen** | Familienbereich → pro Kind Bild oder Initialen, aktive und abgeschlossene Jobs sowie die jeweiligen Auftraggeber. Ein aktueller, genau zugeordneter Minderjährigen-Consent erlaubt diese Jobmetadaten; freiwillige volljährige Verbindungen bleiben ohne zusätzliche Freigabe auf das Profil beschränkt. Keine Chattexte, Privatadressen oder Kontaktdaten. Widerruf und Volljährigkeitswechsel sperren neue Jobabfragen; Elternfreigabe und Auszahlung bleiben getrennt. |
| 5 | **Benachrichtigungen zustellen** | Einstellungen → Benachrichtigungen. Bestehende In-App-/Chat-Ereignisse mit optionalem Push und gezielten wichtigen SMS verbinden; Einwilligung, bestätigtes Ziel, doppelte Zustellung und Kostenlimit berücksichtigen. |
| 6 | **Tatsächlichen Plan-Nutzen zeigen** | Workfare Plan → bereits erlassene Gebühren aus bezahlten Jobs. Erstattungen und bestehende Preisstände einbeziehen; keine Prognose als erzielte Ersparnis ausgeben. |

Danach folgen die oben konkretisierten Funktionen, mehrere Einsatzorte und ein begrenztes Treueprogramm. Konto und Karte bleiben ein eigenes Partnerprojekt und erhalten erst nach bestätigtem Modell einen verbindlichen Starttermin.

## Vorschlag für ein ruhiges Treueprogramm

**Arbeitstitel: Workfare Danke.** Ein privater Bereich für echte Vorteile, ohne Ranglisten, Streaks oder Druck zu mehr Arbeit. Zuverlässigkeit und faire Zusammenarbeit sind wichtiger als möglichst viele Arbeitsstunden.

Erste Version: Nach fünf vollständig bezahlten, nicht erstatteten Jobs ein begrenzter 1-€-Vorteil aus dem eigenen Marketingbudget. Bei Einzelzahlung nur auf den Workfare-Anteil eines folgenden Jobs; beim Plan gegebenenfalls auf einen zukünftigen Mitgliedsbeitrag. Keine Auszahlung, keine Kürzung der Jugendvergütung und keine Verringerung unter null. Das ist ein zu prüfender Vorschlag, noch keine zugesagte Belohnung.

Vor Umsetzung: monatliches Gesamtbudget und Nutzerlimit festlegen, Mehrfachkonten/Selbstaufträge ausschließen, Prüfzeitraum abwarten und Erstattungen beachten. Ein eindeutiger Qualifikations- und Einlösungsnachweis verhindert Doppelboni. Ohne finanziertes Budget wird kein Bonus versprochen.

Empfehlungen später separat: Persönlichen Link freiwillig teilen; eine Einladung allein qualifiziert keinen Vorteil. Erst nach einer echten ersten qualifizierten Zusammenarbeit kann ein begrenzter, klar bezifferter Vorteil entstehen. Keine öffentlichen Profildaten der eingeladenen Person im Empfehlungsstatus und keine Belohnung für die Rekrutierung möglichst vieler Minderjähriger.

## Konto und Karte: Ziel Januar 2027

Januar 2027 ist ein **unverbindlicher Zielmonat**, abhängig von Partnerfreigabe, Jugendmodell, Kosten und erfolgreicher Integration. Es handelt sich heute nicht um eine Bankzulassung von Workfare oder ein bereits eröffnetes Bankkonto. Der [Konten- und Kartenplan](workfare-account-card.md) beschreibt die notwendige Trennung vom heutigen Pay-Saldo, die tatsächlichen Geldflüsse und die offenen Anbieterfragen. Ein bewährter Auszahlungsweg auf die eigene IBAN bleibt bestehen.
