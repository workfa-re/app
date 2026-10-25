# Workfare Plan: DE-19-%-Freigabe

Freigabe: **25. Oktober 2026, 15:13:03 MEZ** (`2026-10-25T14:13:03.938137Z`). Der Betreiber hat reguläre deutsche Umsatzsteuer von 19 % ausdrücklich bestätigt. Dies ist die spätere Freigabe der zuvor vorbereiteten und gesperrten Konfiguration; keine Änderung vorhandener Verträge.

## Aktive Konfiguration

| Einstellung | Stand |
| --- | --- |
| Workfare Plan | 5,90 € monatlicher Endpreis |
| Netto / enthaltene Umsatzsteuer | 4,96 € / 0,94 € |
| Steuerbehandlung | `vat19`, manueller aktiver inklusiver DE-Steuersatz |
| Stripe-Steuersatz | `txr_1UUS85Cnn9FsZa9SpxCmazwN` |
| Live-Verkauf | Eingeschaltet |
| Preis | `price_1UUQIBCnn9FsZa9S4HVsqs6d`, weiterhin 590 Cent, EUR, monatlich, steuerinklusiv |
| Neuer Jobtarif | `workfare-service-regular-v2`: 12 % + 0,49 € brutto, zwei unabhängig gerundete 6-%-Anteile |
| Tarif mit bezahltem aktivem Plan | `workfare-service-member-v1`: 6 % + 0,49 € brutto |

Steuersatz und Live-Preis wurden direkt zurückgelesen. `automatic_tax` bleibt ausgeschaltet; es wurden weder eine Steuerregistrierung erfunden noch ein internationales Steuermodell oder ein automatischer Steuererklärungsdienst aktiviert. Die feste Rate gilt für den aktuellen deutschen Betrieb. Aktuell vorhandene Anbieterprofile sind privat und in Deutschland.

Abo-Freigabe und Tarifstart wurden in **einer Datenbanktransaktion** mit Zeilensperren und Prüfung des erwarteten Ausgangsstands gesetzt. Der Startzeitpunkt wird bei einer Wiederholung nicht neu vergeben. Vor diesem Zeitpunkt erstellte Jobs behalten ihren bisherigen Tarif. Alle drei vorhandenen Jobs wurden danach über die tatsächliche Tarifauswahl weiterhin als 5-%-Tarif gelesen. Die unveränderlichen Beträge und Tarifdaten der drei vorhandenen Zahlungsaufträge haben vor und nach der Freigabe denselben Fingerprint.

## Verifikation

- Eine tatsächliche bezahlte Stripe-Sandbox-Rechnung mit inklusiver DE-19-%-Rate weist 496 Cent netto, 94 Cent Umsatzsteuer und 590 Cent Gesamtbetrag auf. Der aktuelle App-Prüfer akzeptiert den echten Rechnung-/InvoicePayment-/PaymentIntent-/Charge-Nachweis ohne Klärstatus. Kündigung zum Periodenende erhält den bezahlten Zeitraum.
- Der Testbetrag wurde vollständig erstattet, das Testabo beendet, Rate/Preis/Produkt archiviert und der synthetische Kunde gelöscht. Keine App-Datenbank oder Live-Zahlung wurde für diesen Test verwendet.
- Eine reine Rechnungsvorschau im Live-Konto mit dem tatsächlichen Preis und Steuersatz zeigt ebenfalls 590 Cent Gesamtbetrag und 496 Cent ohne Steuer. Keine Live-Subscription oder Kundenregistrierung und keine Zahlung wurden dadurch abgeschlossen.
- Die tatsächlich eingesetzte App-Version `6c23aac` unterstützt den Steuersatz bereits. Ein Anbieter-Record liest Verkaufsfreigabe und `vat19` korrekt zurück. Vorhandene Zahlungszustände, Jugendvergütungen und Auszahlungen wurden nicht verändert.

## Abgrenzung und offene Ausstellerangabe

Im Stripe-Rechnungskopf ist noch keine Steuernummer/USt-ID als Standard hinterlegt. Diese wird nicht erfunden. Der Betreiber ergänzt sie in den [Stripe-Rechnungseinstellungen](https://dashboard.stripe.com/settings/billing/invoice); die automatische Anzeige von Konto-Steuer-IDs ist [von Stripe dokumentiert](https://docs.stripe.com/invoicing/taxes/account-tax-ids).

Diese Prüfung bestätigt die Abo-Steuerberechnung, keine vollständige Automatisierung der Steuerbuchhaltung für sämtliche Jobgebühren. Die gespeicherten Job-Tarife sind Brutto-Preiszusagen. Ihre unveränderlichen Null-Steuerfelder werden nicht rückwirkend als Steuerberechnung umgedeutet. Für eine eigene Gebührenrechnung oder ein Steuerjournal muss ausschließlich der Workfare-Gebührenbetrag getrennt aufgeteilt werden, nicht die Vergütung der Jobsuchenden. Beispiel: 2,53 € Gebühr entsprechen bei 19 % enthaltenem Satz 2,13 € netto und 0,40 € Umsatzsteuer. Erstattungen müssen dazu passend gespiegelt werden. Eine Stripe-PaymentIntent-Quittung wird nicht als zusätzliche vollständige Workfare-Gebührenrechnung ausgegeben.
