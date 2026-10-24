# Workfare Pay: Abschluss und Bankauszahlung

Stand: 25.10.2026. Dieser Vertrag ergänzt den bestehenden, rollen- und modusgebundenen Zahlungsbetrieb. Er ersetzt den früheren sichtbaren Ablauf mit separater Kartenvormerkung vor der Arbeit. Eine veröffentlichte UI ersetzt keine von Stripe verlangte Empfängerprüfung.

## Ein verständlicher Abschluss

1. Der Anbieter legt im Chat den Termin fest. „Job freigeben“ bleibt eine nachgeordnete Aktion in Details.
2. Nach der Arbeit öffnet „Abschließen“ direkt den Preisvorschlag. Bei Stundenlohn werden die tatsächlich abzurechnenden Minuten angegeben; der Server berechnet die Vergütung.
3. Der Jugendliche bestätigt den unveränderlichen Endpreis. Vorschlag und Bestätigung erscheinen als anklickbare Systemhinweise im Chat und führen zur zugehörigen Zahlung in Details.
4. Der Anbieter sieht Vergütung, Servicegebühr und Gesamtbetrag und klickt ausdrücklich auf „… bezahlen“. Eine gegebenenfalls notwendige Bankbestätigung bleibt erhalten. Es ist kein zweiter Freigabeklick erforderlich.
5. Erst ein geprüftes Stripe-Ergebnis einschließlich Gebühren- und Transferbeleg markiert die Zahlung als bezahlt. Der bestehende Datenbankabschluss schließt dann den einmaligen Auftrag und Chat. Eine ungeklärte Antwort bleibt ausstehend.

Die bereits geltende Servicegebühr beträgt **5 % zusätzlich zur Vergütung**, auf ganze Cent gerundet: 17,00 € + 0,85 € = 17,85 €. Der Empfänger erhält 17,00 €. Die Plattformgebühr ist kein Nettogewinn; Stripe-Kosten gehen davon ab. Dieses Update verändert keine bestehenden Tarif- oder Preiszustimmungen.

Technisch bleibt der bewährte manuelle PaymentIntent-Einzug erhalten. Eine neue private `completion_payments`-Zeile dokumentiert ausschließlich die ausdrückliche Anbieteraktion `pay`, den Preisstand und zwei stabile Operationsschlüssel. Nach erfolgreicher Bankbestätigung setzen Server-Synchronisierung und signierte Webhooks genau diesen Auftrag fort. Ein älterer Hold ohne diesen Eintrag wird niemals automatisch eingezogen. Auch ein früher fertiggestellter Auftrag darf bezahlt werden, wenn der geplante Termin noch in der Zukunft liegt; alle Teilnehmer-, Zustimmungs-, Status- und Empfängerprüfungen bleiben bestehen.

## Verfügbare Vergütung und Auszahlung

- Verfügbar und in Bearbeitung stammen aus dem tatsächlichen EUR-Saldo des zugeordneten Stripe-Empfängers. Eine erfolgreiche Kartenzahlung ist kein Nachweis sofort verfügbarer oder bereits eingegangener Bankmittel.
- Neu eingerichtete Empfänger erhalten monatliche automatische Bankauszahlung am **1.** über die Balance Settings API. Bestehende Pläne werden korrekt angezeigt und nicht durch ein Update überschrieben.
- In Workfare Pay kann der Nutzer einen monatlichen Tag von 1 bis 31 speichern. Der tatsächliche, erneut geladene Stripe-Plan bestätigt den Erfolg.
- „Jetzt auszahlen“ benötigt eine eigene Bestätigung. Es verwendet den bestätigten verfügbaren Betrag, die eigene hinterlegte EUR-Bankverbindung und eine eindeutige verfügbare Zahlungsquelle. Vorgemerkte Beträge und unklare Quellen werden nicht ausgezahlt.
- Es entsteht kein Workfare-Bankkonto und keine dauerhafte manuelle Guthabenhaltung. Für einen Einzelauftrag wird der automatische Plan vorübergehend pausiert und anschließend wiederhergestellt.

Private `payout_operations` speichern unveränderlich Nutzer, Modus, Konto, Betrag, Bankziel, Quelle, ursprünglichen Plan und Request-ID. Eine Datenbanksperre erlaubt nur einen aktiven Vorgang pro Empfänger. Die Execution-Lease und stabile Stripe-Idempotenz sichern Wiederholungen ab. Ungewisse Providerantworten werden zuerst anhand der gespeicherten Referenz oder Metadaten abgeglichen. Nach 23 Stunden wird eine unbekannte Auszahlung nicht neu angelegt. Der Browser behält eine unbestätigte Anfrage einschließlich derselben UUID und Payload auch nach einem Seitenneuladen; es werden keine Bankdaten oder Secrets dafür gespeichert. Ein eigener, ausschließlich serverseitiger Lookup löst genau diesen früheren Auftrag auf, auch wenn ein anderer Tab inzwischen neuere Aufträge abgeschlossen hat. Bereits erledigte Aufträge werden dadurch nicht erneut ausgeführt.

## Betrieb und Wiederherstellung

`POST /api/payments/recipient/payout-recovery` akzeptiert nur einen zweckgebundenen HMAC-Token aus der privaten Serverkonfiguration. Der Worker stellt automatische Pläne wieder her und gleicht bereits bestehende Auszahlungen ab. **Er erstellt keine Auszahlung.** Pro Lauf bearbeitet er höchstens 20 Vorgänge mit fairer Rotation und denselben Ausführungsleases.

Im App-Container ausführen:

```sh
node scripts/payments/recover-recipient-payouts.mjs
```

Der Produktionshost ruft den Worker alle fünf Minuten auf; die Betriebssicherung verwendet `flock` gegen überlappende Läufe. Die Vorlage des Host-Wrappers liegt unter `infrastructure/operations/workfare-payout-recovery.sh`, der installierte Wrapper unter `/usr/local/sbin/workfare-payout-recovery`, der Auftrag unter `/etc/cron.d/workfare-payout-recovery`. Ausgegeben werden nur Zeitpunkt und Ergebniszähler; das private Log `/var/log/workfare-payout-recovery.log` rotiert wöchentlich. Keine Schlüssel oder Authorization-Header protokollieren. Nach jedem Deployment müssen Scriptverfügbarkeit, signierter Aufruf und Cron-Eintrag geprüft werden. Ein fehlgeschlagener Lauf oder ein dauerhaft offener Vorgang benötigt Betreiberprüfung; ein HTTP-Erfolg allein bedeutet keinen Bankeingang.

Die bestehende Connect-Snapshot-Destination benötigt zusätzlich `payout.created`, `payout.updated`, `payout.paid`, `payout.failed` und `payout.canceled`. Signatur, Modus, Connected Account, interne Operation, Bankziel, Betrag, Quelle und frisch geladenes Payout werden abgeglichen. Historische oder fremde Ereignisse erzeugen keinen eigenen Auftrag.

## Verifikation

```sh
npm run test:all
npm run typecheck
npm run lint
node --test scripts/payments/*.test.mjs
node scripts/database/test-direct-completion-payment.mjs
node scripts/database/test-payment-chat-notices.mjs
node scripts/database/test-recipient-payout-settings.mjs
node scripts/database/test-payout-attempt-replay.mjs
node scripts/database/test-payment-production-rollout.mjs
npm run build
```

Die Datenbankprüfungen verwenden ausschließlich kurzlebige lokale Datenbanken und synthetische Daten. Browserfixtures prüfen responsive Bedienung, keine echten Zahlungs- oder Auszahlungserfolge. Echtgeldabnahme erfordert die ausdrücklichen Nutzeraktionen mit tatsächlich geeigneten Konten; ein Deployment führt diese nicht aus.

Technische Referenzen: [Stripe: Autorisierung und Einzug](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [Auszahlungsplan](https://docs.stripe.com/connect/manage-payout-schedule), [manuelle Auszahlungen](https://docs.stripe.com/connect/manual-payouts).
