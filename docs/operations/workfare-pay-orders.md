# Workfare Pay: Terminzahlungen im Testbetrieb

Historische Grundlage des Testbetriebs. Der aktuelle Abschluss mit direktem Bezahlen nach der Arbeit ist unter [Abschluss und Bankauszahlung](workfare-pay-completion-payouts.md) dokumentiert.

Stand: 24.10.2026. Diese Grundlage ist ausschließlich für die isolierte lokale Demo und ausdrücklich freigeschaltete Stripe-Sandbox-Konten vorgesehen. Sie ist kein freigegebenes Echtgeld-, Lohn- oder Minderjährigen-Zahlungsprodukt.

## Ablauf und Oberfläche

Zahlungen gehören zu einem einzelnen Termin der bestehenden Zusammenarbeit. Der Chat und sein Auftragsstatus bleiben unverändert. Unter dem Termin in **Details** erscheint bei eingeschalteter Vorschau der passende Workfare-Pay-Schritt. Es gibt keinen zusätzlichen Haupttab und keinen automatischen Einzug beim Jobabschluss.

1. Der Anbieter schlägt den Terminpreis aus der gespeicherten Jobvergütung vor. Bei Stundenpreisen legt er ausdrücklich die vereinbarten, abzurechnenden Minuten fest; daraus wird ein fester Terminpreis. Eine unbegrenzt variable Arbeitszeit ist nicht implementiert.
2. Der Empfänger bestätigt genau diesen unveränderlichen Preisstand. Ein neuer Vorschlag nach Storno erhält eine eigene Quote-Version und benötigt eine neue Bestätigung.
3. Der Anbieter sieht Vergütung, Test-Servicegebühr und Gesamtbetrag. Erst seine gesonderte Zustimmung startet die Zahlungsfreigabe; eine erforderliche Bankbestätigung läuft über Stripe.js mit der zugeordneten eigenen Karte.
4. Der Server prüft das echte Stripe-Ergebnis. Eine Freigabe ist noch keine Abbuchung. Die tatsächliche Autorisierungsfrist wird aus der Stripe-Charge gelesen.
5. Nach dem Termin bestätigt der Anbieter die erledigte Arbeit und den vollständigen Einzug nochmals ausdrücklich. Der Jobabschluss selbst führt keine Geldaktion aus.
6. Storno und vollständige Erstattung haben eigene Bestätigungen und Status. Ein bezahlter Auftrag ist kein Nachweis einer erfolgten Bankauszahlung.

Die normale Plattform lädt keine Order-Daten. Die Vorschau lädt beim Öffnen der Chatdetails eine teilnehmergebundene Auftragsliste. Solange die Details sichtbar sind, wird deren Stand höchstens alle 20 Sekunden sowie beim erneuten Fokus aktualisiert. Stripe.js wird erst bei einer tatsächlichen Sandbox-Freigabe geladen.

## Testtarif und Freigaben

Neue lokale Testquotes verwenden `test-service-5-v1`: **5 % Brutto-Servicegebühr zusätzlich zur vereinbarten Vergütung**, kaufmännisch auf ganze Cent gerundet. Beispiel: 10,00 € Vergütung + 0,50 € Servicegebühr = 10,50 € Gesamtbetrag. Der Empfänger behält seinen vollständigen vereinbarten Anspruch von 10,00 €. Alte Quotes mit `local-zero-fee-v1` behalten dauerhaft ihre 0-Cent-Gebühr; ein Tarifwechsel verändert keine vorhandene Zustimmung.

Der eingefrorene Gebührensnapshot enthält Tarifversion, Satz, Bruttobetrag und ausdrücklich simulierte Steuerdaten: `simulation_vat_included`, 19 % und `sandbox-de-vat19-assumption-v1`. Im Beispiel sind das rechnerisch 0,08 € simulierte Steuer und 0,42 € vor Zahlungskosten. Das ist **keine festgelegte steuerliche Behandlung, Rechnungsvorgabe oder Produktionspreisregel**. 5 % Bruttogebühr sind auch nicht das wirtschaftliche Ziel von ungefähr 5 % verbleibendem Beitrag nach direkten Zahlungskosten.

Die Order-Migration legt `payment_private.order_configuration` mit `enabled=false` und `fee_policy=NULL` an. Sie schaltet keine vorhandenen Kohorten oder Zahlungsmodi um.

Die additive Gebührenmigration aktiviert ebenfalls nichts. Die bewussten lokalen Vorbereitungsskripte wählen `test-service-5-v1`; sie aktivieren den unabhängigen Terminzahlungsschalter nicht. Auf der bestehenden isolierten Demo wurde ausschließlich dieser lokale Tarifschlüssel nach Sicherung umgestellt, ohne alte Orders oder andere Freigaben zu ändern.

Zusätzlich zu den bestehenden Laufzeit-, Authentifizierungs- und Datenbankprüfungen sind für die Vorschau erforderlich:

- `WORKFARE_PAY_ORDER_PREVIEW=enabled`;
- im Stripe-Testbetrieb außerdem `WORKFARE_PAY_ORDER_SANDBOX=enabled`;
- eine gesonderte, bewusste private Datenbankfreigabe für den Testtarif;
- vor Autorisierung ein aktuell geeignetes Käufer-Zahlungsmittel und der genau diesem Termin zugeordnete, bereite Empfänger;
- in der echten Stripe-Sandbox volljährige Anbieter und Empfänger sowie die separate Erwachsenen-Modellfreigabe.

Die Registrierung wird dadurch nicht verändert. Eine Karte belegt keine Identität oder Wohnadresse. Eine Plattform-Elternfreigabe ersetzt keine Stripe-Modellfreigabe. Echtgeld bleibt unabhängig von diesen Testschaltern blockiert.

## API-Vertrag

Alle Browsermutationen benötigen dieselbe geprüfte Origin, JSON und die angemeldete eigene Rolle. Clientpreise, Customer-/Account-/PaymentIntent-Referenzen und fremde Nutzer-IDs werden nicht akzeptiert. Antworten sind `no-store`.

| Route | Funktion |
| --- | --- |
| `GET /api/payments/orders?applicationId=UUID` | `{orders, quoteFeePolicy}`: höchstens 50 eigene Terminaufträge und der aktuell erlaubte Tarif für einen neuen Vorschlag, aus einem teilnehmergebundenen Datenbank-Snapshot |
| `POST /api/payments/orders` | Preisvorschlag: `appointmentId`, `appointmentVersion`, angezeigte `quoteFeePolicy`, optional `plannedMinutes`, `consent:true`; optional UUID im `Idempotency-Key`-Header |
| `GET /api/payments/orders/UUID` | Teilnehmergebundener Vertrags- und Zahlungsstand |
| `POST /api/payments/orders/UUID/confirm` | Empfängerbestätigung: `termsVersion:"appointment-price-v1"`, `consent:true` |
| `POST /api/payments/orders/UUID/action` | Anbieteraktion: `action:"authorize"|"capture"|"cancel"|"refund"`, `consent:true`; optional UUID im `Idempotency-Key`-Header |
| `POST /api/payments/orders/UUID/sync` | Leerer JSON-Body; neue serverseitige Prüfung statt Vertrauen in den Client-Callback |
| `POST /api/payments/orders/webhook` | Unveränderte, begrenzte Rohbytes plus gültige Stripe-Signatur; eigene Order-Ereignisverarbeitung |

Autorisierung liefert in der Sandbox `{kind:"confirmation", order, clientSecret, publishableKey}`. Die Oberfläche bestätigt diesen bestehenden PaymentIntent über Stripe.js und synchronisiert anschließend den Server. In der lokalen Simulation antwortet die ausdrücklich gewählte Aktion mit `{kind:"local", order}`. Der Client erfindet niemals selbst einen bezahlten Status.

Secrets sind opake Strings und bleiben ausschließlich im anfordernden Browserbereich: kein Logging, keine URL, kein Local Storage und keine Persistenz in den Order-Tabellen.

Die Vorschlagsansicht benötigt den tatsächlich geladenen `quoteFeePolicy`-Wert und darf keinen Testtarif raten. Für neue Operationen vergleicht der Create-Wrapper diesen Schlüssel unter einer gemeinsamen Konfigurationssperre erneut. Hat sich der Tarif seit dem Anzeigen geändert, bricht `PAYMENT_ORDER_TARIFF_CHANGED` die Anlage ab; die Oberfläche lädt den aktuellen Stand und verlangt eine erneute Zustimmung. Exakte Wiederholungen bereits erstellter eigener Operationen liefern dagegen deren Originalquote auch nach einem Tarifwechsel zurück. Dieselbe Operation mit verändertem Tarif oder Vertragsparametern führt zu `PAYMENT_ORDER_OPERATION_CONFLICT`. Die Policy ist eine Vorbedingung, kein frei wählbarer Preis. Der ältere interne Listen-/Create-RPC bleibt für bestehende Integrationen unverändert.

## Daten und Wiederholbarkeit

Die private Persistenz führt unveränderliche EUR-Cent-Quotes, beide Teilnehmer, konkrete Terminversion, Quote-Version, Gebührenversion und gesonderte Operationen/Ereignisse. Öffentliche Projektionen enthalten keine PSP-Referenzen oder Bankdaten. Finanzielle Tabellen haben RLS und keine direkten Tabellenrechte für Browserrollen oder `service_role`; die kontrollierten öffentlichen RPCs sind Security Invoker.

Neue Quotes speichern zusätzlich den damaligen Beschreibungstext des Jobs und die Terminnote als unveränderlichen privaten Leistungsumfang. Spätere Jobänderungen überschreiben diesen Beleg nicht. Die kompakte Chatliste lädt diese Texte nicht mit. Für vor dieser Erweiterung angelegte Quotes bleibt der fehlende historische Text ausdrücklich leer. Neue Terminfingerprints werden unabhängig von der Verbindungszeitzone in UTC berechnet; aktive Altquotes behalten ihre bisherige Fingerprint-Version.

Jede Order-Aktion behält ihren ursprünglichen serverseitig gespeicherten Operationsschlüssel. Bei vorhandener PaymentIntent-Referenz wird dieses Objekt geladen, statt nach Ablauf von Stripes Idempotenzaufbewahrung ein weiteres anzulegen. Eine über 20 Stunden ungeklärte Autorisierungsanlage ohne gespeicherte Referenz erfordert Prüfung.

Webhook- und Rückkehrprüfungen vergleichen Eigentum, Metadaten, Betrag, Währung, manuelle Capture-Methode, zugeordneten Empfänger, Servicegebühr und ausdrücklichen Testmodus. Die Serverprojektion berechnet Gebühren und simulierte Steuerdaten aus der bekannten Tarifversion erneut und verwirft abweichende Centwerte. Der Client kann weder Tarif noch Gebührenbetrag vorgeben.

Bei Destination Charges wird der Gesamtbetrag zunächst zum verbundenen Konto transferiert und die `application_fee_amount` anschließend an die Plattform zurückgeführt. Die Plattform trägt ihre Stripe-Kosten; die ausgewiesene Gebühr ist daher kein Nettogewinn. Ein bezahlter neuer Gebührenauftrag verlangt frische, exakt zugeordnete Transfer- und Application-Fee-Belege. Externe Teilrückabwicklungen führen zur Prüfung.

Ein Refund besitzt selbst kein `livemode`-Feld; seine frisch geprüfte PaymentIntent-/Charge-Zuordnung liefert die Modusgrenze. Vollerstattungen neuer Gebührenaufträge erstatten den gesamten Anbieterbetrag und setzen `reverse_transfer=true` sowie `refund_application_fee=true`. Erst wenn vollständiger Customer-Refund, zugehörige Transfer-Rückbuchung und vollständiger Application-Fee-Refund frisch nachgewiesen sind, erscheint die Order als erstattet. Fehlende oder noch nicht vollständige Belege bleiben ungeklärt statt einen Erfolg vorzutäuschen. Doppelte oder verspätete Events dürfen bestätigte Zahlung/Erstattung nicht zurücksetzen.

Aktive finanzielle Freigaben blockieren eine heimliche Verschiebung oder Absage des Termins. Sie müssen zuerst ausdrücklich abgewickelt werden. Historische Vertragsdaten werden nicht mit einer gewöhnlichen Profil-/Joblöschung kaskadiert entfernt. Der isolierte Demo-Cleanup behandelt solche Besuche gesondert; Sandbox-PSP-Objekte werden nicht automatisch gelöscht.

## Prüfen

```sh
npx vitest run src/__tests__/paymentOrder*.test.ts src/__tests__/paymentFeeTariff.test.ts src/__tests__/paymentQuote.test.ts src/__tests__/AppointmentPayment.test.tsx src/__tests__/paymentChatReturnPath.test.ts
node scripts/database/test-payment-orders.mjs
```

Der Datenbanktest legt ausschließlich eine kurzlebige Datenbank im zuvor verifizierten lokalen Demo-Dockerprojekt an und entfernt sie im `finally`. Er nimmt keine externe Datenbank-URL entgegen. Die Prüfungen umfassen echte Sperrkonkurrenz bei Kartenentfernung und Terminverschiebung, Eigentum, private Projektionen, unveränderliche Preise, Einmaligkeit, Erwachsenen-Gates, Termin-/Autorisierungsfristen und verspätete Statusantworten. Die Adaptertests verwenden SDK-Mocks und echte lokale Signaturprüfungen, keine Stripe-Anfragen.

## Vor Echtgeld noch offen

- Nachweis des konkreten zulässigen Tätigkeits-, Betreiber-, Empfänger-, Guardian-/Bankmodells und Zahlungsflusses für den geplanten Live-Start einschließlich 14–17-Jähriger;
- veröffentlichter, rechtlich und steuerlich geprüfter Produktionspreis;
- Regeln für veränderte Arbeitszeit, Preisstreit, Nichtreaktion, Storno, Erstattung und Supportentscheidungen;
- verantwortliche, berechtigte Erstattungsfreigabe und Dispute-Prozess; der Testknopf ist kein verabschiedetes Käufer-Selbstbedienungsmodell;
- dauerhafte Reconciliation, Eskalation ungeklärter Zustände und finanzielle Buchführung;
- tatsächliche Stripe-Sandbox-Endabnahme des gesamten Autorisierungs-/Capture-/Refund-Flusses und der nachgelagerten Bankauszahlung;
- Aufbewahrung, Pseudonymisierung, Löschung und gegebenenfalls Steuer-/Meldepflichten.

Quellen: [Stripe: Autorisierung und Einzug trennen](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [Destination Charges](https://docs.stripe.com/connect/destination-charges), [Erstattungen](https://docs.stripe.com/api/refunds/create). Diese technischen Schnittstellen ersetzen keine Modell- oder Rechtsfreigabe.
