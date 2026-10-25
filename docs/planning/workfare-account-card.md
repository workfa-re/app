# Workfare Konto und Karte

Stand: 25.10.2026. Produktentscheidung zur Vorbereitung, kein eröffnetes Konto, keine bestellte Karte und keine zugesagte Anbieterfreigabe.

## Empfehlung in einfachen Worten

Workfare sollte **ein optionales Zahlungskonto mit eigener Workfare-Karte über einen zugelassenen Partner** anbieten. Nutzer verdienen über Jobs, erhalten das tatsächlich freigegebene Geld auf dieses Konto und können es mit ihrer Karte ausgeben. Die Kontoführung und Kartenausgabe übernimmt der Partner; Workfare gestaltet die Oberfläche und den Arbeitsablauf.

**Treezor zuerst prüfen.** Die deutschen Bedingungen beschreiben ausdrücklich Konten für 7–17-Jährige mit Zustimmung und Identifikation der gesetzlichen Vertreter. Die technische Dokumentation beschreibt ein Zahlungskonto, dessen Inhaber der Jugendliche ist. Das passt deutlich besser als ein Konto, das rechtlich nur den Eltern gehört. Es ist noch keine Freigabe unseres konkreten Geschäftsmodells oder ein Preisangebot. [Deutsche Bedingungen, 4.6 und 5](https://www.treezor.com/app/uploads/2025/03/DETCs-TREEZOR-V5.pdf), [Eltern-/Kindmodell für Zahlungskonten](https://docs.treezor.com/guide/users/parent-children.html#natural-parent-and-minor-using-payment-account).

Der günstigste und schnellste Weg **heute** bleibt die bereits vorhandene Auszahlung auf eine eigene, passende IBAN. Ein eigenes Kartenprogramm lohnt sich erst mit freigegebenem Jugendmodell, belastbarem Angebot und tragbaren laufenden Kosten. Es wird keine Voraussetzung für Jobs, keine verpflichtende Umstellung bestehender Nutzer und kein neues Schattenkonto in unserer Datenbank.

## Welche Partner passen

| Weg | Belegbarer Stand | Entscheidung für Workfare |
| --- | --- | --- |
| **Treezor: Zahlungskonto + gebrandete Karte** | Deutsche Minderjährigenbedingungen; API-Modell mit Jugendlichem als Kontoinhaber und KYC für Kind und Eltern. Dokumentierter deutscher Jugendkarten-Anwendungsfall Bling aus 2021 | Erster Kandidat für die konkrete Prüfung. Historische Referenz ist keine aktuelle Zusage für Workfare; DE-IBAN, Vertrag, Betrieb und Preise gesondert bestätigen |
| **Solaris: tatsächliches Bankkonto + Karte** | Deutsche Banklizenz, Privatkonten und Karten. Die aktuell veröffentlichte Standard-Kontoeröffnung nennt für Retail 18+ | Nur weiterverfolgen, wenn ein gesondertes deutsches 14–17-Programm schriftlich angeboten wird. Kein belegter Ersatz für unsere gesamte Zielgruppe |
| **Swan** | Individuelle Kontoeröffnung laut aktueller Zulassung ab 18 | Für das geforderte 14–17-Modell derzeit kein Standardweg |
| **Stripe Issuing** | Die veröffentlichte Verbotsliste schließt Karten für private Verbraucherzwecke sowie Vergütungs-/Auszahlungskarten aus | Bestehendes Connect nicht einfach um eine Verbraucherkarte erweitern. Eine besondere Freigabe müsste konkret vorliegen; auf unveröffentlichte Programme bauen wir keinen Start |
| **Bestehende eigene IBAN** | Unser heutiger Auszahlungspfad | Verlässlicher Rückfallweg während Angebots- und Integrationsphase; keine Workfare-Karte und kein als Bankkonto beworbener Stripe-Saldo |

Quellen: [Treezor/Bling – historische Referenz](https://www.treezor.com/startup-bling-card-treezor-germany/), [Solaris Konten](https://www.solarisgroup.com/de/services/accounts/), [Solaris Kontoeröffnung](https://docs.solarisgroup.com/guides/digital-banking/account-opening), [Swan Zulassung](https://support.swan.io/hc/en-150/articles/20730839895837-Eligibility-criteria-for-opening-a-payment-account), [Stripe Issuing: verbotene Verbraucherzwecke](https://stripe.com/legal/restricted-businesses#prohibitions-for-stripe-issuing-products).

Die vorgeschriebene Stripe-Directory-Suche wurde vor der Anbieterauswahl durchgeführt. Zwei allgemeine Suchen lieferten nur nicht passende Onchain-/Infrastrukturergebnisse; Treezor lieferte keinen Treffer. Die Bewertung oben beruht deshalb auf den verlinkten Primärquellen, nicht auf einer vermeintlichen Directory-Zertifizierung.

## Was ein Nutzer tatsächlich macht

1. **Optional entdecken:** Auf der Pay-Seite nach dem ersten bestätigten Verdienst eine ruhige Karte „Dein Verdienst. Deine Workfare-Karte.“ mit Gebühren und Leistungen vor Beginn. Kein zusätzlicher Registrierungszwang beim ersten Job.
2. **Konto eröffnen:** Bekannte Profildaten nach Zustimmung vorausfüllen; Partnerbedingungen, Kontoart, Datenschutz und Kosten klar zeigen. Fehlende Pflichtdaten direkt im Ablauf erfassen. Kein Versprechen, dass jede Identitätsprüfung ohne Dokumente funktioniert.
3. **Unter 18:** Gesetzliche Vertretung über den vorhandenen Familienweg einladen. Vorhandene bestätigte Angaben wiederverwenden, soweit der Partner das akzeptiert. Die bisherige Workfare-Teilnahmeerlaubnis ersetzt weder den Kontovertrag noch die vorgeschriebene Identifikation. Bei gemeinsamem Sorgerecht die erforderlichen Zustimmungen beziehungsweise eine anerkannte Vertretung abbilden. [BZSt: Kontoeröffnung Minderjähriger](https://karriere.bzst.de/SharedDocs/Kurzmeldungen/DE/2025_Kurzmeldungen/20250131_CRS_01_2025.html), [Treezor KYC](https://docs.treezor.com/guide/user-verification/introduction.html).
4. **Freigabe abwarten:** „Wir prüfen deine Angaben“ nur während einer tatsächlichen Prüfung. Konkrete fehlende Angabe mit genau einer Aktion zeigen. Konto erst nach bestätigter Partnerfreigabe als aktiv darstellen.
5. **Karte erhalten:** Zunächst virtuelle Karte, physische Karte optional. Apple Pay/Google Pay nur nach tatsächlicher Programmfreigabe und passender Alters-/Länderberechtigung anbieten, keine pauschale Zusage für jeden 14-Jährigen. Treezor dokumentiert Karten und Wallet-Integration grundsätzlich; In-App-Provisionierung benötigt zusätzlich Aktivierung und Zertifizierung durch die Wallet-Anbieter. [Treezor Karten](https://docs.treezor.com/guide/cards/introduction.html), [X-Pay](https://docs.treezor.com/guide/cards/x-pay-google-apple.html).
6. **Verdienst nutzen:** Bestätigter Zahlungseingang → Freigabe beim Zahlungsdienstleister → Übertragung auf das persönliche Zahlungskonto → verfügbare Kartenmittel. Erst nach dem letzten belegten Schritt „Mit Karte verfügbar“ melden. Kein Kredit auf vorgemerkte Vergütung.

## Geldfluss und technische Einbindung

**Erster Entwurf, vom Partner und Stripe zu bestätigen:** Der Anbieter bezahlt weiter über unseren geprüften Stripe-Ablauf. Nach Settlement erfolgt die normale Empfängerauszahlung auf die ausdrücklich freigegebene persönliche Partner-IBAN. Die Bankverbindungs-, Namens- und Kontoinhaberprüfung bleibt erforderlich. Kein Sammeln fremder Vergütungen auf dem Workfare-Geschäftskonto und kein frei erfundener Direkttransfer zwischen Stripe- und Karten-Salden.

Das neue Konto ersetzt **nicht** die bestehende Stripe-Connect-Empfänger-/Vertreterprüfung. Bei diesem Geldfluss benötigen wir die Freigaben beider Dienstleister; die Daten lassen sich nur mit entsprechender Rechtsgrundlage und akzeptiertem Wiederverwendungsmodell übernehmen. Stripe beschreibt für Minderjährige weiterhin einen gesetzlichen Vertreter vor Einzug/Auszahlung und länderabhängige Express-/Custom-Unterstützung. Die genaue deutsche Accounts-v2-Konfiguration bleibt gesondert zu bestätigen. [Stripe-Altersanforderungen](https://support.stripe.com/questions/can-i-use-stripe-if-i-am-under-18).

Wenn zwei Prüfabläufe zu viele Abbrüche verursachen, wäre die spätere Alternative ein vertraglich genehmigter gemeinsamer Einzugs-/Kontopfad beim Partner. Treezor bietet Acquiring grundsätzlich an; die Eignung für unsere Jobvergütungen, Zahlungsarten, Gebührenaufteilung und Minderjährigen ist damit noch nicht bestätigt. Dies wäre ein eigenes Migrationsprojekt mit Erstattungs- und Altzahlungsbetrieb, kein nebenbei aktivierter Austausch des laufenden Stripe-Systems. [Treezor Acquiring](https://www.treezor.com/de/).

In der App bleiben zwei Beträge getrennt: **„In Bearbeitung“** bei Stripe und **„Mit Karte verfügbar“** beim Kontopartner. Ein bestätigter Auftrag ist kein Bankeingang. Falls der Partner diesen Zufluss nicht unterstützt, ist dieser Entwurf nicht freigegeben; dann entweder genehmigtes alternatives Routing oder den bestehenden IBAN-Pfad beibehalten.

Der Partner führt Konto, Verfügungsrahmen und Kartentransaktionen. Wir speichern nur Eigentümerzuordnung, externe Referenzen, bestätigte Status, Ereignisse und einen lesenden Cache. Serverseitige Eigentumsprüfung, eindeutige Ereignis-IDs, Signaturprüfung, unveränderliche Buchungsreferenzen und regelmäßiger Abgleich verhindern doppelte Übertragungen. Beträge intern in ganzen Cent; Partner-API-Dezimalwerte strikt konvertieren. Verfügbar ist der Partnerbetrag nach offenen Kartenreservierungen, nicht der gesamte historische Verdienst. [Treezor Salden und Reservierungen](https://docs.treezor.com/guide/wallets/balances.html).

Kartenaktionen benötigen starke Authentifizierung und den offiziellen sicheren Anzeigepfad für Kartennummer/PIN. Keine PAN/CVC/PIN in Logs, Analytics oder eigenen Tabellen. Zwei getrennte Funktionen für vorübergehend sperren/entsperren und dauerhaft ersetzen. Kontoauszug, Reklamation, Kartenverlust, Rückerstattung und Kündigung gehören bereits zum ersten nutzbaren Umfang.

Unsere Web-App benötigt außerdem den freigegebenen SCA-Zugangsweg einschließlich Geräteeinrichtung, Gerätewechsel und Wiederherstellung. Treezor beschreibt dafür unter anderem Web Native mit WebAuthn und zusätzlichem Passcode. Eine normale Workfare-Anmeldung ersetzt diese Kontoauthentifizierung nicht. [Treezor SCA](https://docs.treezor.com/guide/strong-customer-authentication/introduction.html).

## Platz in der Plattform

| Ort | Inhalt |
| --- | --- |
| **Startseite** | Kleines Guthaben-Widget; zur Karte verfügbar und insgesamt verdient. „In Bearbeitung“ bleibt auf Pay erreichbar |
| **Workfare Pay** | Guthaben, Karte, tatsächliche Kontoumsätze, IBAN, Sparziele, Auszahlen/Überweisen. Noch nicht eingerichtete Produkte erscheinen als klares optionales Angebot |
| **Kartenansicht** | Sperren, Limits, sichere Kartendetails, Wallet hinzufügen, Ersatz bestellen; keine überladene Bank-Dashboard-Kopie |
| **Familie** | Nur die ausdrücklich freigegebenen und vom Partner zugelassenen Konto-/Karteneinblicke und Schutzfunktionen. Keine automatische Öffnung privater Chats. Mit 18 gesetzliche Vertretung und Zugriffsrechte neu bewerten |
| **Chat** | Auftragsbezogene Hinweise zu Preis und Zahlung; kontoweite Auszahlung/Kartenzahlung nur in Pay und Benachrichtigungen |
| **Einstellungen** | Dokumente, Kosten, Datenschutz, Mitteilungen, Support und Konto schließen |

Die vorhandenen Jobs- und Chat-Tabs bleiben unverändert. Keine neue Hauptnavigation allein für ein optionales Finanzprodukt.

## Vorteile, die wir wirklich bauen können

- Verdienst ohne manuelles Weiterüberweisen ausgeben, sobald er nachweislich auf dem Partnerkonto angekommen ist.
- Karte sofort in der App sperren; Ausgabelimits und Kaufbenachrichtigungen nach den Partnerregeln.
- Sparziele aus echtem Guthaben und eine verständliche Trennung von verdient, vorgemerkt und verfügbar.
- Optionaler physischer Workfare-Kartenauftritt, transparente Elternfunktionen und ein sauberer Übergang mit 18.
- Später echte lokale Händlerangebote: beispielsweise ein vom Händler finanzierter Rabatt nach einem abgeschlossenen Job. Kein versprochenes universelles Cashback und keine Belohnung für riskantes Mehrausgeben.

## Kosten und belastbarer Start

Ein öffentlicher Komplettpreis für genau dieses Programm liegt nicht vor. Benötigt wird ein Angebot für Einrichtung, Monatsminimum, aktive/inaktive Konten, Jugend-/Eltern-KYC, Karte, Versand/Ersatz, Tokenisierung, SEPA, Buchungen, Betrug, Chargebacks, Reklamation, Support und Programmende. Keine erfundene Gratis-Bank und kein „in wenigen Tagen live“.

Kartenumsatz alleine finanziert das Angebot kaum: Bei regulierten EU-Verbraucher-Debittransaktionen liegt die Interchange-Obergrenze grundsätzlich bei 0,2 %. Bei 100 € entsprechendem Umsatz sind das höchstens 0,20 € Interchange für die Emittentenseite, vor Kosten und einer überhaupt vereinbarten Workfare-Beteiligung. Daraus folgt unsere Kalkulationsannahme: Start aus dem Plattformbudget, optionale physische Karte zu transparenten Kosten, Händlerangebote nur gegen echte Finanzierung. [EU-Verordnung 2015/751, Artikel 3](https://eur-lex.europa.eu/eli/reg/2015/751/oj).

Treezor ist ein E-Geld-Institut; ein dortiges Zahlungs-/E-Geld-Konto ist nicht automatisch ein Bankgirokonto mit gesetzlicher Einlagensicherung. Kundengeldsicherung und Einlagensicherung dürfen in unserem Branding nicht gleichgesetzt werden. Wenn ein echtes Bankeinlagenkonto zwingend gewünscht ist, braucht es ein anderes ausdrücklich jugendfähiges Bankprogramm. [Treezor Compliance](https://www.treezor.com/company/compliance/), [BaFin zur Sicherung bei E-Geld](https://bafin.de/SharedDocs/Veroeffentlichungen/DE/Merkblatt/mb_111222_zag.html).

## Nächste Schritte in dieser Reihenfolge

1. **Angebot/Freigabe:** Deutsches Verbrauchermodell 14–20, Jugendlicher als Inhaber, Sorgeberechtigung, Art des verdienten Geldes und Stripe-Zufluss, verfügbare IBAN, Karten/Wallettoken und Kosten schriftlich bestätigen. Insbesondere Beschäftigungsvergütung und selbstständige Dienstleistung unterscheiden: Die deutschen Treezor-Bedingungen 4.1 schließen eine kombinierte geschäftliche/nichtgeschäftliche Kontonutzung aus. Daher muss der Partner die konkreten Workfare-Eingänge im vorgesehenen Privatkonto zulassen. Workfares Rolle als technischer Partner beziehungsweise registrierter Agent und die verbleibenden Pflichten vertraglich klären.
2. **Wirtschaftlichkeit:** Für 100, 1.000 und 10.000 aktive Konten aus dem tatsächlichen Angebot rechnen. Nur bei tragbarem Monatsminimum weiter. Der aktuell geplante allgemeine Job-Servicepreis wird dadurch nicht stillschweigend geändert.
3. **Sandbox:** Freigabe, Eingang, Reservierung, Kauf, Ablehnung, Erstattung, Sperre, Ersatz, Auszahlung, SCA/Gerätewechsel/Wiederherstellung, Vertragsende, Wiederholungsereignisse und Anbieter-Ausfall testen. Jugendliche und Eltern im selben Probelauf, kein nur volljähriger Ersatz für das Zielmodell.
4. **Nutzertest:** Einladungsablauf mit Jugendlichen und Eltern sowie Kontrollen mit älteren Auftraggebern prüfen. Kontoeröffnung bleibt optional und ohne Einfluss auf normale Jobauszahlungen.
5. **Begrenzter echter Pilot:** Erst nach vertraglicher Freigabe, vollständigen Kosten, Support-/Reklamationsbetrieb und abgestimmtem Geldfluss. Erweiterung erst nach abgeglichenen Kontosalden und stabilen Auszahlungen.

Es wurden keine Anbieter angeschrieben, Verträge angenommen, Konten eingerichtet oder Kartendaten angelegt.
