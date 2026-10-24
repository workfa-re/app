# Zahlungen: verständliches Modell und Anbietervergleich

Stand und Quellenabruf: **24.10.2026**. Planung, keine eingerichtete Zahlungsanbindung und kein freigegebener Tarif.

## 1. Was wir erreichen wollen

Die vereinbarte Vergütung bleibt vollständig beim Jugendlichen. Der erwachsene Jobanbieter bezahlt zusätzlich eine offen angezeigte Plattform-Servicegebühr. Daraus bezahlt Workfare die Zahlungsabwicklung und behält seinen Anteil.

Die aktuelle Vorgabe lautet: **ungefähr 5 % verdienen**. Für diese Kalkulation bedeutet das zunächst **5 % der vereinbarten Jobvergütung nach den direkten Zahlungskosten**. Bei einem 10-Euro-Job sollen also rund 0,50 € übrig bleiben. Das ist ein Zielbeitrag vor Support, Entwicklung, Ausfällen und Gewinnsteuern, noch kein garantierter Unternehmensgewinn. Eine andere Definition von „5 %“ verändert die Rechnung.

Der einfache Ablauf:

1. Beide Seiten vereinbaren beispielsweise **10,00 € Vergütung**.
2. Der Anbieter sieht **Vergütung + Servicegebühr = Gesamtpreis**, bevor er verbindlich bestätigt.
3. Er bezahlt mit einer freigegebenen Zahlart, etwa Karte oder PayPal.
4. Ein zugelassener Marktplatz-Zahlungsdienstleister ordnet die Beträge zu und zahlt **10,00 € auf das geprüfte Bankkonto des Jugendlichen** aus.
5. Die Plattform erhält ihre Gebühr, bezahlt die vereinbarten Zahlungs-/Auszahlungskosten und verbucht den verbleibenden Beitrag.

**Die Zahlart des Erwachsenen und das Bankkonto des Jugendlichen sind zwei getrennte Dinge.** Der Jugendliche benötigt in diesem Modell kein eigenes PayPal-Konto, wenn der genehmigte Zahlungsdienstleister PayPal-Einzug und anschließende Bankauszahlung unterstützt.

Unser Revolut-Konto kann dabei das Geschäftskonto für unsere eigenen Gebühreneinnahmen und Betriebskosten sein, sofern Kontotyp und Vertragsbedingungen dafür geeignet sind. Es ist nicht automatisch das Konto, auf dem wir sämtliche fremden Jobvergütungen einsammeln und verteilen dürfen.

## 2. Welche Geschäftsmodelle überhaupt infrage kommen

| Modell | Wie es funktioniert | Einordnung für Workfare |
| --- | --- | --- |
| **Vermittlungsplattform mit Marktplatz-PSP** | Zahlungsdienstleister übernimmt Einzug, Empfängerprüfung, Zuordnung und Bankauszahlung; Workfare erhält eine Plattformgebühr | Passender Ausgangspunkt für die gewünschte Nutzererfahrung. Private Empfänger, Minderjährige und Arbeitsmodell müssen ausdrücklich zugelassen sein |
| Direkte Zahlung an den Helfer, Plattformgebühr separat | Helfer wird selbst Zahlungsempfänger beim PSP; unsere Leistung wird getrennt abgerechnet | Mehr Einrichtung und Abrechnung für Nutzer; kann zwei Zahlungsvorgänge erzeugen. Kein einfacher Ersatz für den gewünschten einheitlichen Ablauf |
| Workfare verkauft die Arbeit als eigene Leistung | Workfare wird selbst Vertragspartner der Dienstleistung und bezahlt Beschäftigte beziehungsweise Subunternehmer | Anderes Unternehmen mit anderen Leistungs-, Arbeitgeber-, Steuer- und Haftungspflichten. Nicht bloß ein günstigerer Zahlungsadapter |
| Eigenes Einsammeln und Weiterüberweisen fremder Gelder | Gesamte Vergütung geht auf unser normales Geschäftskonto und wird anschließend verteilt | Ohne gesonderte passende Vertrags-/Aufsichtsgrundlage kein freigegebener Weg. Eine Banking-API allein reicht nicht |

BaFin stellt ausdrücklich auf tatsächlichen Geldfluss und Verträge ab. Die Annahme von Kundengeldern auf eigenen Konten kann eine Erlaubnis für Zahlungsdienste erfordern. Die Einordnung ist daher vor dem Echtgeldbetrieb anhand des konkreten Modells zu prüfen. [BaFin: Erlaubnisprüfung](https://www.bafin.de/ref/19629832).

## 3. Vergleich der relevanten Anbieter

Die Preise sind veröffentlichte Standardwerte für Deutschland und keine Angebote für Workfare. Ein günstiger Karteneinzug beweist weder günstige Marktplatz-Gesamtkosten noch die Zulassung unserer Zielgruppe.

| Anbieter | Passende Fähigkeit | PayPal hinein, Bankauszahlung hinaus | Kosten und Einordnung |
| --- | --- | --- | --- |
| **Stripe Connect** | Geprüfte verbundene Empfänger, Plattformgebühr und Bankauszahlung | Für genehmigte Marktplätze dokumentiert; PayPal landet bei Connect auf Stripe und kann im freigegebenen Empfängerfluss weiter ausgezahlt werden | Gut dokumentierter technischer Kandidat. Aktive Empfängerkonten und Auszahlungen verursachen zusätzliche Kosten; nicht automatisch der günstigste |
| **Mollie Connect for Marketplaces** | Gelder auf Mollie-Balance aufteilen und auf verifizierte Seller-Konten routen | Dokumentiert über **PayPal collecting** und Delayed Routing; separate Freischaltung nach Händlerkategorie notwendig | Zweiter ernsthafter Kandidat. Vollständigen Marktplatz-/Empfängertarif und private Minderjährige schriftlich bestätigen lassen |
| **Revolut Merchant + Business API** | Merchant nimmt eigene Händlerzahlungen an; Business API automatisiert gewöhnliche Geschäftskontoüberweisungen | PayPal ist in der geprüften Merchant-Zahlmethodenliste nicht dokumentiert; kein allgemeiner Seller-Split belegt | Günstiger Einzug eigener Verkäufe, aber nach Standardvertrag kein Ersatz für unseren Marktplatz-PSP |
| **PayPal Multiparty direkt** | Verkäufer-Onboarding und Plattformprovision | Standardmodell führt zunächst zum PayPal-Verkäuferkonto; keine bloße Bankauszahlung an kontolose Minderjährige | Für unser gewünschtes Empfängermodell keine einfache Standardlösung; deutsche Seller- und Altersbedingungen passen nicht automatisch |
| **Mangopay** | Marktplatz-Wallets, PayPal-Einzug, Transfers und Bankauszahlungen | Grundsätzlich dokumentiert; PayPal muss gesondert genehmigt werden | Individuelles Angebot, kein öffentlicher Startertarif. Natural Users müssen laut aktueller Doku über 18 sein; damit kein Standardweg für 14–17 |
| **Lemonway** | Marktplatz-Pay-in, Aufteilung und Bank-Pay-out; PayPal als Methode | Grundsätzlich dokumentiert; Aktivierung und konkreter Empfängerkreis zu prüfen | Öffentlicher Startertarif mit 5.490 € Einrichtung und 840 €/Monat Service ist für einen kleinen Start eine hohe Hürde |
| **Adyen for Platforms** | Split, Provision, verifizierte Empfänger und Bank-Payouts | Eigenes PayPal-Marketplace-Setup dokumentiert; Settlement-Vertrag konkret abnehmen | Alternative für ein passendes größeres Volumen. Mindestabrechnung modellabhängig; zusätzliche Plattformprodukte separat bepreist, kein belastbarer Kleinstart-Gesamtpreis veröffentlicht |

### Stripe: was tatsächlich freigeschaltet werden muss

PayPal für Connect braucht eine gemeinsame Prüfung durch Stripe und PayPal. Unterstützt sind Destination Charges sowie Separate Charges and Transfers; **Direct Charges und `on_behalf_of` werden für PayPal nicht unterstützt**. Für unseren Ausgangsentwurf bleibt ein Empfänger und ein konsequent verwendeter Destination-Flow vorgesehen. Die allgemeine Verfügbarkeit ist keine Workfare-Freigabe. [PayPal mit Connect](https://docs.stripe.com/payments/paypal#connect), [Connect-Settlement auf Stripe](https://docs.stripe.com/payments/paypal/choose-settlement-preference).

„Stripe übernimmt die Preisgestaltung“ kann ohne zusätzliche Connect-Gebühren für die Plattform auskommen, wenn Stripe seine Zahlungsgebühren direkt den verbundenen Konten berechnet. Das darf nicht unbesehen mit unserem PayPal-Destination-Flow kombiniert werden, bei dem die Plattform die Zahlungskosten trägt. Keine Ersparnis einplanen, die eine andere Zahlungsarchitektur oder Kürzung des Jugendverdiensts voraussetzt. [Connect-Preise](https://stripe.com/en-de/connect/pricing), [Destination Charges](https://docs.stripe.com/connect/destination-charges).

### Mollie: normales PayPal-Linking reicht nicht

Beim gewöhnlichen PayPal-Linking fließt Geld direkt zu PayPal. Für Split und anschließende Bankauszahlung benötigen wir dagegen **PayPal collecting**: zunächst Mollie-Balance, danach genehmigtes Routing und Bank-Payout. Delayed Routing und die Zielkonten müssen freigeschaltet beziehungsweise verifiziert sein; die Ziellogik verlangt eine KYB-geprüfte Organisation. Öffentliche Standardbedingungen belegen keine Zulassung privater 14–17-jähriger Helfer. Genau diese Frage muss Mollie beantworten. [Connect-Modelle](https://docs.mollie.com/docs/connect-overview), [Delayed Routing und PayPal collecting](https://docs.mollie.com/docs/delayed-routing), [Bank-Payout-API](https://docs.mollie.com/reference/create-payout), [Nutzungsbedingungen](https://www.mollie.com/de/legal/user-agreement).

Mollie beschreibt den Marktplatz in diesem Zahlungsmodell als Merchant of Record und belastet ihn mit Refunds und Chargebacks. Die entsprechende Zahlungsrolle, Reserve und Liquidität müssen daher ausdrücklich zur Betreiber-/Vertragsstruktur passen. PSP-Lizenzierung bedeutet nicht, dass Workfare keine Ausfall- oder Rückzahlungsverantwortung trägt; die zivilrechtliche Rolle bei der tatsächlichen Arbeit bleibt zusätzlich zu prüfen. [Verantwortung bei Delayed Routing](https://docs.mollie.com/docs/delayed-routing#refunds-and-chargebacks).

### Revolut: nützliches Geschäftskonto, kein belegter Ersatz

Die deutschen Zahlungsabwicklungsbedingungen erlauben den Einzug für eigene Waren/Dienstleistungen und untersagen die Annahme oder Verarbeitung im Namen anderer. Der Merchant-Payout-Endpunkt zahlt verfügbares Händlerguthaben intern auf das Business-Konto aus; er verteilt nicht automatisch Jugendvergütungen auf geprüfte Empfängerkonten. Die Business API kann Überweisungen automatisieren, ändert diese Vertragsgrenze aber nicht. Sie setzt im geprüften deutschen Angebot Grow oder höher voraus. Der tatsächlich vorhandene Kontotyp wurde nicht geprüft. [Bedingungen, Abschnitt 3](https://www.revolut.com/de-DE/legal/business-acquiring/), [Merchant API](https://developer.revolut.com/docs/api/merchant), [Business-API-Voraussetzungen](https://help.revolut.com/de-DE/business/help/integrating-with-external-apps/revolut-business-api/question-using-revolut-business-api/).

### Weitere Anbieter: entscheidende Grenzen

PayPal führt Deutschland in der Seller-Onboarding-Tabelle für Business-Seller, nicht für Casual/Personal-Seller. Ein eigenes deutsches PayPal-Konto setzt bei natürlichen Personen 18 Jahre voraus. Die allgemeine Dokumentation zu Gelegenheitsverkäufern darf nicht als deutsche Minderjährigenfreigabe verstanden werden. [Ländertabelle](https://developer.paypal.com/platforms/seller-onboarding), [deutsche Nutzungsbedingungen](https://www.paypal.com/de/legalhub/paypal/useragreement-full).

Mangopay beschreibt PayPal mit gesonderter Genehmigung und Auszahlung auf ein Konto des Nutzers, schließt in seinem Natural-User-Standard jedoch unter 18-Jährige aus. Ein möglicher Sondervertrag ist nicht belegt. [Benutzertypen](https://docs.mangopay.com/guides/users/types), [PayPal](https://docs.mangopay.com/guides/payment-methods/paypal), [Bankauszahlung](https://docs.mangopay.com/guides/payouts), [Preismodell](https://mangopay.com/en-gb/pricing).

Lemonway veröffentlicht PayPal-Unterstützung und Marktplatzpreise; die Minderjährigen-/Arbeitsmodellfreigabe ist offen. Adyen dokumentiert Split und Bank-Payouts sowie ein eigenes PayPal-Marketplace-Setup; ein tatsächliches Workfare-Angebot samt Empfängerfreigabe fehlt ebenfalls. [Lemonway PayPal](https://documentation.lemonway.com/docs/paypal-payments), [Lemonway Preise](https://www.lemonway.com/de/preise), [Adyen Splits](https://help.adyen.com/en_US/knowledge/adyen-for-platforms/manage-payments/how-can-i-split-payments-between-different-accounts), [Adyen Bank-Payouts](https://docs.adyen.com/platforms/quickstart-guide/payouts), [Adyen PayPal](https://docs.adyen.com/payment-methods/paypal/setup-paypal-marketplaces/), [Adyen Preise/Mindestabrechnung](https://www.adyen.com/pricing?navItem=europe).

## 4. Die Kosten, die wir vergleichen müssen

| Kostenart | Geprüfter öffentlicher Standardwert | Grenze |
| --- | --- | --- |
| Stripe EWR-Standardkarte online | 1,50 % + 0,25 € | Andere Karten/Länder kosten anders; nur Einzug |
| Stripe PayPal | 0,20 % + 0,10 € **zusätzlich** zu PayPal | Kein Ersatz für die PayPal-Gebühr |
| PayPal Checkout Deutschland/EWR, EUR | 2,99 % + 0,39 € | Standard, ohne Sondervertrag/FX/Auslandszuschläge. 2,49 % + 0,35 € für manuelles Waren-/Dienstleistungssenden ist ein anderer Transaktionstyp |
| Stripe Connect bei eigener Plattformpreisgestaltung | 2 € je aktivem Empfängerkonto/Monat plus 0,25 % des Auszahlungsvolumens + 0,10 € je Auszahlung | Auszahlungshäufigkeit und Jobs pro aktivem Konto verändern die Stückkosten. Detaillierte Routing-/Vertragskonditionen bestätigen; den Prozentwert nicht ungeprüft doppelt zählen |
| Mollie EWR-Verbraucherkarte online | 1,80 % + 0,25 € | Separater Marktplatz-/Seller-/Routingtarif nicht aus diesem Einzugspreis ableitbar |
| Mollie PayPal | PayPal-Gebühren + 0,10 € | PayPal collecting/Connect-Angebot gesondert bestätigen |
| Revolut EWR-Verbraucherkarte online | 1 % + 0,20 € | Eigene Händlerverkäufe; keine Workfare-Marktplatzzulassung |
| Revolut Grow / gewöhnliche lokale Überweisungen | ab 35 €/Monat; 100 lokale Überweisungen inklusive, danach 0,20 € | Geschäftskontokosten und Überweisungen, kein neuer Marktplatzzahlungsvertrag |
| Lemonway Starter | Karte 1,10 % + 0,25 €; natürliche Person 0,40 €/Monat; europäische Auszahlung 0,50 €; PayPal 0,40 % + PayPal-Gebühren | Zusätzlich 5.490 € Einrichtung und 840 €/Monat Service |
| Mangopay und Adyen Platforms | Modell-/volumenabhängiges Angebot erforderlich | Keine selbst erfundenen Mindestkosten oder angeblichen kostenlosen Empfängerkonten |

Quellen zu den Tabellenwerten: [Stripe Payments](https://stripe.com/de/pricing), [Stripe lokale Methoden](https://stripe.com/de/pricing/local-payment-methods), [Stripe Connect](https://stripe.com/en-de/connect/pricing), [PayPal Händlergebühren, Stand 07.09.2026](https://www.paypal.com/de/business/paypal-business-fees), [Mollie Deutschland](https://www.mollie.com/de/pricing), [Revolut Grow Preisblatt](https://www.revolut.com/en-DE/legal/business-grow-fees/), [Revolut Kontotarife](https://www.revolut.com/de-DE/business/business-account-plans/), [Lemonway](https://www.lemonway.com/de/preise).

Gesamtvergleich zusätzlich mit Erstattungen, verlorenen Einzugsgebühren, Chargebacks, Identitätsprüfung, Mindestabrechnungen, Zusatzprodukten und Betriebskosten rechnen. Kostenloser Standard-Checkout bedeutet nicht kostenlose Gesamtintegration.

## 5. Warum 5 % verdienen mehr als 5 % Servicegebühr verlangt

Bei **10 € Vergütung plus 0,70 € Gebühr** und Gesamtzahlung **10,70 €** ergibt sich bereits vor Connect, Auszahlung und Steuern:

| Szenario | Nur Einzugskosten | Von 0,70 € übrig |
| --- | ---: | ---: |
| Stripe EWR-Standardkarte | rund 0,41 € | rund 0,29 € |
| PayPal Checkout über Stripe, Standardtarife addiert | rund 0,83 € | rund −0,13 € |

Diese unterschiedlichen Kosten sind **keine Empfehlung für unterschiedliche Checkout-Zuschläge je Zahlungsmethode**. Vorgesehen ist eine echte, vorab transparente Plattform-Servicegebühr für die Vermittlungsleistung, grundsätzlich einheitlich über die unterstützten Zahlarten. PayPal untersagt Aufschläge für seine Nutzung; § 270a BGB begrenzt Zahlungsmittelentgelte für bestimmte Karten und SEPA. Ein bloß anders benannter Zahlungszuschlag wird dadurch nicht zur zulässigen Servicegebühr. [PayPal-Regeln zu Aufschlägen](https://www.paypal.com/de/legalhub/paypal/useragreement-full), [§ 270a BGB](https://www.gesetze-im-internet.de/bgb/__270a.html).

### Vollständigeres Stripe-Rechenbeispiel

**Nur Kostenillustration, kein verabschiedeter Tarif:** fünf Jobs je aktivem Empfängerkonto im Monat, eine reguläre Bankauszahlung pro Job, oben veröffentlichter Connect-Haupttarif. Die Gebühr enthält in diesem Szenario 19 % Umsatzsteuer auf unsere Plattformleistung; die Vergütung des Jugendlichen wird davon nicht automatisch umsatzsteuerpflichtig. Der tatsächliche Steuerstatus und Vorsteuer-/Reverse-Charge-Behandlung sind separat zu bestätigen. 19 % ist der Regelsteuersatz, keine Feststellung unserer individuellen Steuerpflicht. [§ 12 UStG](https://www.gesetze-im-internet.de/ustg_1980/__12.html).

| Jugendvergütung | Zielbeitrag nach direkten Zahlungskosten | Erforderliche Brutto-Servicegebühr: nur Kartenszenario | Erforderliche Brutto-Servicegebühr: nur PayPal-Szenario |
| --- | ---: | ---: | ---: |
| 10,00 € | 0,50 € | ca. 1,73 € | ca. 2,27 € |
| 30,00 € | 1,50 € | ca. 3,37 € | ca. 4,36 € |
| 50,00 € | 2,50 € | ca. 5,00 € | ca. 6,45 € |
| 100,00 € | 5,00 € | ca. 9,09 € | ca. 11,67 € |

Auch diese Spalten sind alternative **Kostenszenarien**, keine zahlartabhängigen Nutzerpreise. Ein gemeinsamer Tarif braucht eine Mischkalkulation mit realistischer PayPal-Quote. Bei 50 € wären im gezeigten Kartenszenario 55 € Gesamtzahlung erforderlich; der Jugendliche erhält 50 €, rund 2,50 € verbleiben nach den modellierten direkten Zahlungskosten und der Umsatzsteuer auf unsere Gebühr. Support, Ausfälle und sonstige Betriebskosten sind noch nicht bezahlt.

Die Connect-Vergleichstabelle nennt 0,25 % zusätzlich auch unter „Funds routing and platform management“. Ob und wann dies gegenüber dem oben ausgewiesenen Haupttarif eine weitere Kostenposition ist, muss das konkrete Angebot beantworten. Die Beispielwerte enthalten diese Position **nicht ein zweites Mal**. Falls sie zusätzlich anfällt, erhöht sich die nötige Gebühr im gezeigten 19-%-Szenario bei 10 € Vergütung um ungefähr 0,03 € und bei 50 € um ungefähr 0,16 €. Die Tabelle ist daher ausdrücklich kein zugesagter vollständiger Workfare-Tarif. [Connect-Komponenten](https://stripe.com/en-de/connect/pricing).

Bei wenigen Jobs pro Empfänger wirkt die Monatsgebühr stark. Auszahlungen sinnvoll zu bündeln kann Stückkosten senken, benötigt aber transparente Zahlungsfristen und darf verdienten Lohn nicht unzulässig zurückhalten. Kein Guthaben-Zwang oder als „Treuhand“ beworbenes Zwischenkonto.

### Nachvollziehbare Formel

`J` = vereinbarte Jugendvergütung, `S` = zusätzliche Brutto-Servicegebühr, `a` = prozentuale Einzugskosten auf `J + S`, `b` = fixe Einzugskosten, `C` = zugerechnete Connect-/Auszahlungskosten, `t` = Umsatzsteuerfaktor der Servicegebühr, `m = 0,05`.

```text
Ziel: S / t − a × (J + S) − b − C = m × J
S = (m × J + a × J + b + C) / (1 / t − a)

Beispielkosten C = 2 € / 5 Jobs + 0,0025 × J + 0,10 €
Karte: a = 0,015; b = 0,25 €
PayPal über Stripe: a = 0,0299 + 0,002; b = 0,39 € + 0,10 €
```

Die Beispielgebühr wird auf den nächsten Cent aufgerundet. Reale Rechnungsrundung, Umsatzsteuerstatus, Refund-/Disputequote und ausgehandelte Tarife können das Ergebnis ändern. Ohne Umsatzsteuer auf unsere Servicegebühr ergäbe dasselbe 50-Euro-Kartenszenario rund 4,19 € statt 5,00 € Servicegebühr. Dieser Unterschied ist keine freie Produktwahl, sondern folgt dem tatsächlichen Steuerstatus.

## 6. Meine Empfehlung

**Zuerst Stripe Connect und Mollie Connect mit demselben Sachverhalt vergleichen.** Stripe ist der gut dokumentierte technische Ausgangspunkt; Mollie ist eine ernsthafte Preisalternative, insbesondere wegen des beschriebenen PayPal-Collecting-Flows. Den günstigsten passenden Anbieter kann man erst nach vollständigem Angebot und Zulassung unseres Modells bestimmen.

Beide müssen schriftlich beantworten:

1. Dürfen private Helfer von 14–17 und 18–20 Jahren die vorgesehenen Tätigkeiten über dieses Modell abrechnen? Selbständige Dienstleistung oder Beschäftigung/Minijob nicht vermischen.
2. Wer ist wirtschaftlicher Empfänger, wer darf vertreten, und auf wessen Bankkonto darf ausgezahlt werden?
3. Ist PayPal-Einzug mit Plattformgebühr und Bankauszahlung für genau diese Zielgruppe freigegeben?
4. Was kosten Einzug, aktive Empfänger, Identitätsprüfung, Routing, Auszahlung, Refund und Dispute vollständig? Gibt es monatliche Mindestkosten?
5. Wie erfolgen Autorisierung, spätere Belastung und Absage bei Karte und PayPal? Kartenfristen nicht ungeprüft auf PayPal übertragen.

Erst danach einen **allgemeinen Gebührentarif mit ca. 5 % Zielbeitrag** festlegen. Prozentgebühr plus kleiner fixer Sockel oder Mindestgebühr kann bei Kleinstjobs wirtschaftlich sinnvoller sein als ein einheitlicher Prozentsatz. Das ist ein zu testender Tarifvorschlag, keine bereits beschlossene Gebühr. Eine feste 5-Euro-Gebühr ist durch die Nutzerpräzisierung ausdrücklich **nicht** das angenommene Ziel.

Revolut zunächst als mögliches Konto für eigene Plattformerlöse und Ausgaben behalten. Keine Kombination „normaler Merchant-Einzug plus freie Business-Überweisung“ als schon zugelassenen Marktplatz implementieren. Das eigene Revolut-Konto wurde nicht eingesehen, Anbieter wurden nicht angeschrieben und keine Verträge angenommen. Für die erste technische Vorbereitung wurde inzwischen Stripe gewählt; die vorhandene Connect-Konfiguration wurde read-only geprüft und im [Umsetzungskonzept](workfare-pay-implementation.md) berücksichtigt.

Für Nutzer bleibt der Ablauf einfach: **Termin und Vergütung bestätigen → Gesamtpreis bezahlen/bestätigen → Arbeit abschließen → Auszahlung verfolgen**. Der Prüf-, Journal- und Webhookaufwand liegt im Hintergrund. Die [technische Pay-Planung](workfare-pay.md) beschreibt diese Anforderungen; die [Feature-Übersicht](feature-overview.md) ordnet Zahlungen, Elternansicht und SMS im Produkt ein.
