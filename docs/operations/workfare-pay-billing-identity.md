# Workfare Pay: Profilgebundene Rechnungsdaten

Stand: 25.10.2026.

## Name und E-Mail

Der Anzeigename des Stripe-Customers stammt aus dem tatsächlichen Workfare-Profil (`full_name`, bei Unternehmensprofilen `company_name`). Die E-Mail stammt ausschließlich aus dem bestätigten, serverseitig abgefragten Auth-Konto. Veränderbare User-Metadaten und eine möglicherweise ältere Profil-E-Mail sind dafür keine Quelle.

Neue Customers erhalten beide Werte bereits bei ihrer Anlage. Ältere Customers werden beim nächsten Öffnen der Zahlungsübersicht oder vor einer neuen Zahlungsmittel-Einrichtung abgeglichen. Ein Customer wird dabei anhand von Modus, gespeicherter Referenz und eigener Nutzer-Metadaten geprüft. Die Aktualisierung schreibt ausschließlich Name und E-Mail; Rechnungsadresse, Zahlungsmittel, sonstige Metadaten und Paymentdefaults werden nicht überschrieben. Eine frische Rücklesung bestätigt das Ergebnis. Es erfolgt kein globaler Bestandsdaten-Backfill.

In Rechnungsdaten sind Name und aktuelle E-Mail als Kontodaten gekennzeichnet. Der Name ist dort nicht frei editierbar. „E-Mail ändern“ nutzt den normalen Auth-Bestätigungsablauf, keine zweite Rechnungsadresse im selben Konto.

`POST /api/payments/account/email` akzeptiert nur `{email}` mit eigener `X-Workfare-Owner`-Assertion und geprüftem Same-Origin-/JSON-Kontext. Der Server prüft den angemeldeten Anbieter erneut und ruft den Dienst-RPC `pay_assert_account_email_change` vor einer neuen Auth-Änderung auf. Dieser RPC muss vor dem Code-Deployment installiert sein. Ein fehlender oder ablehnender Familienabgleich verhindert die Mutation; es gibt keinen unsicheren Fallback. Bereits bestehende historische Consent-/Stripe-Personen-E-Mails werden dadurch nicht überschrieben.

Die Bestätigung verwendet den festen Rückweg `/auth/callback?next=/app-home/settings/payments`. Solange Auth die neue Adresse nicht frisch als bestätigt zurückgibt, bleibt die alte Adresse die Rechnungs-E-Mail. Eine bereits ausstehende identische Änderung wird nicht nochmals angefordert. Throttling oder eine unbestätigte Antwort werden nicht als Erfolg angezeigt. Bei erneutem Öffnen der Zahlungsübersicht sowie bei einem eigenen `USER_UPDATED`-Ereignis wird der Stripe-Kontakt erneut abgeglichen.

## Rechnungsadresse

`POST /api/payments/account/billing` akzeptiert ausschließlich eine Rechnungsadresse:

- Feld ausgelassen: vorhandene Adresse unverändert lassen;
- `address:null`: Adresse ausdrücklich entfernen;
- vollständige deutsche Adresse: Straße, Postleitzahl, Ort und `country:"DE"` speichern, optionaler Zusatz;
- Name, E-Mail, Customer-ID und sonstige zusätzliche Felder: ablehnen.

Die Rechnungsadresse bleibt unabhängig von der verifizierten Anbieter-/Privatadresse. Eine Änderung übernimmt diese Anschrift nicht stillschweigend als Identitäts- oder Wohnadressnachweis. Kontakt und gespeicherte Adresse werden nach dem Stripe-Schreiben erneut geprüft. Bei einer ungewissen Antwort verwendet derselbe UI-Versuch denselben Operationsschlüssel.

## Belege und Branding

„Zahlungen und Belege“ enthält einen beschrifteten, visuell nur als Icon dargestellten Aktualisieren-Button am Kopf. Der Button ist ein eigenständiges Bedienelement und klappt den Verlauf nicht versehentlich zu. Fehlende Finanzdaten führen zu einem sichtbaren Fehler statt einem erfundenen leeren Verlauf.

Echte Zahlungsbelege, gehostete Rechnungen und PDFs behalten die von Stripe zurückgegebenen, streng geprüften Dokument-URLs. Die Checkout-Domain darf nicht einfach in diese URLs eingesetzt werden. Stripe dokumentiert eigene Domains für Checkout, Payment Links und Customer Portal; Belege und Rechnungen bieten stattdessen eigene Branding-Einstellungen. Die E-Mail-Sendedomain ist wiederum eine getrennte Einstellung. Sie wird durch einen Customer-Kontaktabgleich nicht geändert.

Quellen: [Stripe: Checkout-Anpassung](https://docs.stripe.com/payments/checkout/customization), [Hosted Invoice Page](https://docs.stripe.com/invoicing/hosted-invoice-page), [Zahlungsbelege](https://docs.stripe.com/receipts), [eigene E-Mail-Sendedomain](https://docs.stripe.com/get-started/account/email-domain), [Supabase: Konto aktualisieren](https://supabase.com/docs/reference/javascript/auth-updateuser).

Die zugehörigen Server-, Routen- und UI-Tests verwenden synthetische Daten. Eine gesonderte echte Stripe-Sandboxrunde hat am bereits vorhandenen synthetischen Customer Namen-/E-Mail-Abgleich, Adressschreiben, frische Rücklesung und explizites Entfernen geprüft und den ursprünglichen Customer anschließend exakt wiederhergestellt. Sie hat keine Zahlung, Auszahlung, neue Identität oder Bestätigungs-E-Mail ausgelöst. Der Auth-E-Mail-Bestätigungsweg ist mit simulierten Antworten geprüft; tatsächliche Zustellung und Bestätigung sind damit nicht behauptet.
