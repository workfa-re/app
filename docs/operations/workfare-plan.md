# Workfare Plan: Betrieb und Kündigungsbearbeitung

Stand: 25.10.2026. Workfare Plan ist ein monatliches Anbieter-Abo für 5,90 €. Es ist kein Bankkonto. Eine Veröffentlichung der Seite schaltet den Verkauf nicht frei. Maßgeblich sind die tatsächlich ausgerollte Migration, die private Angebotskonfiguration und bestätigte Stripe-Ergebnisse.

**Aktuelle Freigabe:** Seit 25.10.2026, 15:13:03 MEZ ist der Live-Verkauf mit bestätigter deutscher Regelbesteuerung und inklusiver 19-%-Rate aktiv: 5,90 € = 4,96 € netto + 0,94 € Umsatzsteuer. Gleichzeitig wurde der neue Jobtarif aktiviert; bestehende Jobs und Preisstände bleiben geschützt. Die [Freigabe mit Prüfnachweisen](../releases/2026-10-25-workfare-plan-vat-release.md) dokumentiert die tatsächliche Konfiguration, den einmaligen Startzeitpunkt und die noch fehlende Standard-Aussteller-Steuer-ID. Die folgenden abgeschalteten Werte beschreiben den sicheren Erstzustand neuer Installationen, nicht den heutigen Live-Verkaufsstatus.

## Freigabe und Konfiguration

`payment_private.membership_configuration` trennt `live` und `sandbox`. Neue Zeilen beginnen mit `enabled=false` und `tax_treatment='pending'`. In diesem Zustand darf kein Checkout entstehen. Produkt, monatlicher EUR-Preis, Steuerbehandlung und gegebenenfalls inklusive deutsche 19-%-Steuerrate müssen vor der gesonderten Freigabe übereinstimmen. Die steuerliche Einordnung `small_business` oder `vat19` entscheidet ein verantwortlicher Betreiber mit steuerlicher Beratung; `pending` wird nicht automatisch ersetzt. Eine vorhandene Stripe-Steuerregistrierung wird nicht angenommen und `automatic_tax` nicht ungeprüft aktiviert.

Serverseitig bleiben die bestehende Workfare-Pay-Live-Konfiguration, Modusprüfung, eigene Kundenreferenz und signierte Webhooks erforderlich. Checkout verwendet den serverseitigen Preis und getrennte Zustimmungen zu Bedingungen und sofortigem Beginn. Kein Browser-Rücksprung aktiviert einen Plan. Die Berechtigung verlangt einen aktiven, tatsächlich bezahlten Zeitraum mit passender Rechnung, Rechnungszeile, InvoicePayment, PaymentIntent und nicht erstattetem oder strittigem Charge. Ein Testabo ist kein Echtgeldnachweis.

Der Abo-Vorteil gilt für entsprechend angebotene **neue Jobs**. Bereits eingefrorene Gebühren eines bestehenden Jobs werden weder beim Abschluss eines Abos noch bei dessen Kündigung rückwirkend geändert. Gebühren- und Abo-Preisänderungen benötigen einen eigenen Tarif- und Zustimmungsprozess.

Die Angebotsfreigabe ist ein eigener Betreiberentscheid. Eine deaktivierte Verkaufsfreigabe beendet keine bestehenden Stripe-Abos und stoppt nicht automatisch deren Verlängerung.

## Öffentliche Erklärungen bleiben erreichbar

- `/membership/cancel`: Kündigung ohne Anmeldung; frühestmöglich, gewünschter Termin oder aus wichtigem Grund.
- `/membership/withdraw`: Widerruf ohne Anmeldung oder vorgeschaltete Fristprüfung.
- `/api/payments/membership/cancellation`: speichert die Erklärung dauerhaft vor Stripe-Aufrufen und liefert nur Eingangsreferenz und Eingangszeit.

Vertragsreferenz und Konto-E-Mail ordnen eine Erklärung zu. Die öffentliche Antwort verrät nicht, ob ein Vertrag existiert. Eine gespeicherte Eingangsbestätigung ist keine Bestätigung des Vertragsendes oder einer Erstattung. Der Nutzer kann seine Erklärung samt Zeit und Referenz herunterladen. Ein Offlinefehler oder fehlgeschlagener Datenbankzugriff darf nicht als Eingang bestätigt werden.

Der Erklärungseingang ist von der Verkaufsfreigabe und Stripe-Zahlungs-API-Schlüsseln getrennt. Er benötigt weiterhin eine gültige private App-/Datenbankkonfiguration sowie `WORKFARE_PAY_HOSTED_STATE_SECRET` mit mindestens 32 Zeichen. Für E-Mail-Belege muss der bestehende private Mailversand verfügbar sein; fehlgeschlagene Zustellung bleibt wiederholbar. Keine Secrets, E-Mail-Inhalte oder Authorization-Header protokollieren.

Support kann einen Nutzer auf diese öffentlichen Formulare verweisen und bei ausdrücklicher Beauftragung dessen Erklärung dort aufnehmen. Dafür benötigt Support keinen Stripe-API-Schlüssel und kein Stripe-Konto des Nutzers. Die vollständige Eingangsreferenz gehört in den geschützten Supportvorgang. Bei ausgefallener Zahlungs-API bleibt der Eingang gespeichert, der technische Verlängerungsstopp muss jedoch noch durch den Worker oder einen berechtigten Betreiber bestätigt werden. Kein Supportmitarbeiter darf einen ungeprüften Zahlungs- oder Vertragsstatus zusagen.

## Wiederherstellung und manuelle Prüfung

`scripts/payments/recover-memberships.mjs` läuft im privaten App-Container. Es signiert einen zweckgebundenen HMAC und ruft ausschließlich `http://127.0.0.1:$PORT/api/payments/membership/recovery` auf; Standardport 3000, Redirects gesperrt, Request-Timeout 240 Sekunden. Es bearbeitet höchstens zehn vorhandene Erklärungen pro Lauf, legt keine Abos an und führt keine Zahlungen, Auszahlungen oder Erstattungen aus. Die Datenbank vergibt Bearbeitungsleases von 180 Sekunden. Wiederholungen verwenden denselben erklärungsbezogenen Stripe-Idempotenzschlüssel.

Eine zugeordnete ordentliche Kündigung zum frühesten Zeitpunkt stoppt die Verlängerung nach erneutem Stripe-Abgleich. Außerordentliche Kündigung, gewünschter Termin und Widerruf bleiben zusätzlich in der Prüfqueue. Widerruf und außerordentliche Kündigung sollen eine weitere Verlängerung verhindern; ein anderes gewünschtes Vertragsende und mögliche Erstattungsansprüche benötigen Betreiberprüfung. Der Worker entscheidet diese Ansprüche nicht. `complete` beschreibt die technische Bearbeitung und Mailzustellung, nicht den Abschluss einer rechtlichen Prüfung.

Das Ergebnis enthält nur `at`, `ok`, `complete`, `pending` und `reviews`. `reviews` zählt alle offenen Prüffälle des Modus, nicht nur den aktuellen Batch. Anhaltendes `pending`, neue Prüffälle oder ein fehlgeschlagener Cron-Lauf benötigen Betreiberprüfung. Überwacht werden müssen außerdem die signierten Subscription-/Invoice-Webhooks sowie Rückerstattungs- und Dispute-Ereignisse; ein funktionierender Worker ersetzt sie nicht.

### Nur lesende Betriebsabfragen

Nur in einer bereits freigegebenen privaten Datenbanksitzung ausführen. Normale Nutzer und der öffentliche Browser erhalten keinen Tabellenzugriff. Keine Ergebnisse mit Personenbezug in öffentliche Logs übernehmen.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT mode, enabled, tax_treatment, monthly_cents, terms_version,
       product_ref IS NOT NULL AS product_present,
       price_ref IS NOT NULL AS price_present,
       portal_ref IS NOT NULL AS portal_present,
       tax_rate_ref IS NOT NULL AS tax_rate_present
FROM payment_private.membership_configuration
ORDER BY mode;

SELECT id AS receipt_reference, contract_reference, kind, received_at,
       requested_end, state, confirmed_until, receipt_sent_at, mail_sent_at
FROM payment_private.membership_cancellations
WHERE mode = 'live' AND review_required AND review_resolved_at IS NULL
ORDER BY received_at
LIMIT 100;

SELECT state, count(*) AS requests, min(received_at) AS oldest_received_at
FROM payment_private.membership_cancellations
WHERE mode = 'live' AND (
  state = 'pending' OR (state = 'complete' AND mail_sent_at IS NULL)
)
GROUP BY state;

SELECT contract_reference, status, paid_until, period_end,
       cancel_at_period_end, checked_at
FROM payment_private.memberships
WHERE mode = 'live' AND review_required
ORDER BY checked_at NULLS FIRST
LIMIT 100;

COMMIT;
```

Ein berechtigter Betreiber prüft auffällige Erklärungen anhand des geschützten Supportvorgangs, des betroffenen Vertrags und der aktuellen Stripe-Daten. Für eine endgültige Prüfung, Sonderkündigung oder Erstattung besteht noch keine eigene Supportoberfläche. Daher hier bewusst kein pauschales SQL-Update zum Abhaken und kein automatischer Refund: Datum, Anspruch, Zuordnung und tatsächliche Umsetzung müssen einzeln nachvollziehbar dokumentiert werden. Eine unbekannte oder nicht zuordenbare Erklärung wird nicht öffentlich mit einer Vertragsauskunft beantwortet.

## Host-Worker nach dem App-Deployment installieren

Die geprüften Vorlagen liegen versioniert unter `infrastructure/operations/workfare-membership-recovery.{sh,cron,logrotate}`. Die Installation erfolgt **nach** Migration und Deployment des passenden App-Images auf `jobbridge-01`. Die App muss `/app/scripts/payments/recover-memberships.mjs` enthalten. Der Docker-Swarm-Service heißt derzeit `app-apefld`; vor einer Übernahme in andere Umgebungen erneut prüfen. Die folgenden Befehle im Repository-Verzeichnis ausführen.

```sh
scp infrastructure/operations/workfare-membership-recovery.sh \
    infrastructure/operations/workfare-membership-recovery.cron \
    infrastructure/operations/workfare-membership-recovery.logrotate \
    jobbridge-01:/tmp/

ssh jobbridge-01 sudo install -o root -g root -m 0755 \
    /tmp/workfare-membership-recovery.sh /usr/local/sbin/workfare-membership-recovery
ssh jobbridge-01 sudo install -o root -g root -m 0644 \
    /tmp/workfare-membership-recovery.logrotate /etc/logrotate.d/workfare-membership-recovery
ssh jobbridge-01 sudo touch /var/log/workfare-membership-recovery.log
ssh jobbridge-01 sudo chown root:root /var/log/workfare-membership-recovery.log
ssh jobbridge-01 sudo chmod 0600 /var/log/workfare-membership-recovery.log
```

Diese Befehle erhalten vorhandene Logeinträge. Vor dem Einrichten des Cron-Auftrags einmal ausführen:

```sh
ssh jobbridge-01 sudo /usr/bin/flock -n /run/lock/workfare-membership-recovery.lock \
    /usr/bin/timeout 270 /usr/local/sbin/workfare-membership-recovery
ssh jobbridge-01 sudo logrotate --debug /etc/logrotate.d/workfare-membership-recovery
ssh jobbridge-01 sudo install -o root -g root -m 0644 \
    /tmp/workfare-membership-recovery.cron /etc/cron.d/workfare-membership-recovery
ssh jobbridge-01 sudo cat /etc/cron.d/workfare-membership-recovery
```

Der manuelle Worker-Lauf verarbeitet tatsächlich vorhandene Erklärungen und kann deren Verlängerungsstopp sowie Belegversand nachholen. Er ist kein reiner Healthcheck. Bei Fehlern Cron noch nicht aktivieren. Bei mehreren laufenden App-Containern während eines Rollouts verweigert der Wrapper den Lauf; der nächste Cron-Termin versucht es erneut. Alle fünf Minuten verhindert `flock` überlappende Hostläufe. Das private Log `/var/log/workfare-membership-recovery.log` rotiert wöchentlich mit acht komprimierten Vorgängern und Modus 0600.

Für eine vorübergehende Betriebspause ausschließlich den neuen Cron-Eintrag entfernen; öffentliche Kündigungs- und Widerrufsseiten bleiben erreichbar. Das stoppt weder bestehende Abos noch Stripe-Verlängerungen. Offene Eingänge danach über die Prüfqueue überwachen und die Verarbeitung zeitnah wiederherstellen. Bestehende Payout-Recovery-Konfiguration nicht verändern.

## Abnahme

```sh
node --test scripts/payments/recover-memberships.test.mjs
node scripts/database/test-memberships.mjs
node scripts/database/test-membership-tariffs.mjs
```

Die Datenbanktests laufen ausschließlich gegen isolierte lokale Testdatenbanken. Zusätzlich nach Deployment beide öffentlichen Formulare ohne Session, Fehlerrückmeldung bei Netzfehlern, referenzierte Bestätigung, Mailwiederholung und Betriebszähler prüfen. Eine Live-Kaufabnahme benötigt eine gesonderte ausdrückliche Bestellung; Deployment und Workerinstallation lösen keinen Testkauf aus.
