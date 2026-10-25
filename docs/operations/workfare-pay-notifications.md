# Workfare Pay: Benachrichtigungen und Chatverlauf

Stand: 25. Oktober 2026. Neue Zustandsübergänge werden in derselben Datenbanktransaktion wie der Geschäftsstatus protokolliert. Es gibt keinen historischen Versand und keine nachträgliche Änderung gelesener Hinweise.

## Ereignisse

P1 bedeutet Handlungsbedarf, P2 einen wichtigen Fortschritt, P3 eine ruhige Information. Diese Einstufung ist intern.

| Ereignis | Empfänger | Chat | Benachrichtigungszentrum | Ziel | Priorität | Dauerhafte Identität |
| --- | --- | --- | --- | --- | --- | --- |
| Endpreis vorgeschlagen | Jobsuchender | Ein vorhandener Systemhinweis | Vergütung bestätigen | Exakter Preisstand am Termin | P1 | Auftrag + `payment_price_proposed` |
| Endpreis bestätigt | Anbieter | Ein vorhandener Systemhinweis | Preis bestätigt, jetzt bezahlen | Exakter Preisstand am Termin | P1 | Auftrag + `payment_price_confirmed` |
| Vergütung bezahlt | Beide Beteiligten | Ein Systemhinweis | Individuelle Zahlungsbestätigung | Exakter bezahlter Auftrag, auch im geschlossenen Chat | P2 | Auftrag + `payment_paid` |
| Zahlung fehlgeschlagen | Beide Beteiligten | Ein Systemhinweis | Zahlung nicht bestätigt | Betroffener Preisstand | P1 | Auftrag + `payment_failed` |
| Zahlungsauftrag storniert | Beide Beteiligten | Ein Systemhinweis | Zahlungsauftrag storniert | Betroffener Preisstand | P3 | Auftrag + `payment_canceled` |
| Erstattung angenommen | Beide Beteiligten | Ein Systemhinweis nach bestätigter Erstattungsreferenz | Erstattung veranlasst | Betroffene Zahlung | P2 | Auftrag + `payment_refund_pending` |
| Vollständige Erstattung bestätigt | Beide Beteiligten | Ein Systemhinweis | Zahlung erstattet | Betroffene Zahlung | P2 | Auftrag + `payment_refunded` |
| Zahlung benötigt Prüfung | Beide Beteiligten | Ein Systemhinweis | Zahlung wird geprüft | Betroffene Zahlung | P1 | Auftrag + `payment_review_required` |
| Bankauszahlung eingeleitet | Kontoinhaber | Keiner | Auszahlung veranlasst | Workfare Pay | P2 | Modus/Konto/Auszahlungsreferenz gehasht + `payout_started` |
| Bankauszahlung ausgeführt | Kontoinhaber | Keiner | Auszahlung ausgeführt | Workfare Pay | P2 | Auszahlungsidentität + `payout_paid` |
| Bankauszahlung fehlgeschlagen | Kontoinhaber | Keiner | Bankverbindung und Auszahlungsstand prüfen | Workfare Pay | P1 | Auszahlungsidentität + `payout_failed` |
| Bankauszahlung storniert | Kontoinhaber | Keiner | Auszahlung storniert | Workfare Pay | P3 | Auszahlungsidentität + `payout_canceled` |
| Monatlicher Auszahlungsplan geändert | Kontoinhaber | Keiner | Neuer bestätigter Auszahlungstag | Workfare Pay | P2 | Einstellungsoperation + `schedule` |
| Auszahlungsoperation benötigt Prüfung | Kontoinhaber | Keiner | Aktuellen Auszahlungsstand prüfen | Workfare Pay | P1 | Auszahlungsoperation + `review` |

Terminvorschläge, deren Antworten und Terminänderungen nutzen ihre vorhandenen transaktionalen Hinweise. Es wird kein zweiter Nachrichtenversand dafür eingeführt. Normale Chatnachrichten bleiben getrennte `message_received`-Ereignisse.

## Zahlung und Bankauszahlung

`payment_paid` entsteht aus dem serverseitig geprüften Zahlungsstatus. Es bestätigt die vereinbarte Vergütung und den Abschluss des Auftrags. Es behauptet weder verfügbare Auszahlungsmittel noch einen Bankeingang. Der bestehende Zahlungsverifikationspfad prüft unter anderem Zahlungsobjekt, Modus, Betrag, Empfänger sowie Gebühren-/Transfernachweise.

Eine Bankauszahlung kann Vergütung mehrerer Aufträge enthalten. Sie erhält deshalb keinen erfundenen Auftragsbezug und keine Nachricht in einem beliebigen Chat. Manuelle und automatische monatliche Auszahlungen werden anhand des tatsächlichen, frisch von Stripe gelesenen Payouts auf dem exakt zugeordneten Konto geprüft. Dabei wird keine Auszahlung neu angelegt. Ein `pending`-Status behauptet noch keinen Bankeingang; erst das gesonderte `payout_paid`-Ereignis meldet die ausgeführte Auszahlung. Eine später gemeldete Bankablehnung bleibt möglich und erzeugt den eigenen Fehlerhinweis.

Teil- oder außerhalb von Workfare ausgelöste Erstattungen werden gegenwärtig als Prüfbedarf behandelt. Das derzeitige Finanzmodell erlaubt ausschließlich vollständige Erstattungen (`refunded_cents` ist 0 oder der gesamte Zahlbetrag). Ein unbestätigter Teilbetrag wird weder als ausbezahlt noch als vollständig erstattet gemeldet.

## Navigation und Wiederholungen

Chat-Hinweise sind über ihre gespeicherte Nachrichten-ID und ein zugehöriges Auditereignis exakt mit Auftrag, Termin und Preisversion verbunden. Der Server prüft die aktuelle Teilnahme am Gespräch, Nachrichtenart, Löschstatus und Eindeutigkeit. Sichtbarer Text allein autorisiert keinen Link. Historische Preisstände bleiben lesbar; sie bieten keine Zahlungsaktion und fallen bei fehlenden Daten niemals auf einen neueren Preisstand zurück. Eine Benachrichtigung kann den passenden Abschnitt direkt öffnen, auch wenn der Chat bereits geschlossen ist. Beim expliziten Gesprächswechsel wird der alte Nachrichtentarget aus der URL entfernt.

Geschäftstransaktion und sichtbare Hinweise rollen gemeinsam zurück. Ereignisschlüssel deduplizieren pro Empfänger; der bestehende Auftrags-Lock serialisiert Zahlungsübergänge. Ein Webhook-Replay oder verspäteter älterer Zahlungsstatus erzeugt keine zweite Meldung. Die automatischen Payout-Hinweise werden ebenfalls über einen transaktionalen, auszahlungsgebundenen Lock und eine feste Ereignisidentität serialisiert. Nach bestätigter Auszahlung/Fehler/Storno dürfen verspätete Zwischenstände keine neue Vorbereitungsmeldung erzeugen; nach Fehler/Storno entsteht keine verspätete Erfolgsmeldung.

Zusätzlich schützt der gespeicherte Auszahlungsstatus gegen konkurrierend verspätete Beobachtungen: `in_transit` fällt nicht auf `pending` zurück; `paid` fällt nicht auf `pending` oder `in_transit` zurück; Fehler und Storno werden nicht nachträglich durch einen alten Erfolgsstatus ersetzt. Eine tatsächliche Bankablehnung nach `paid` bleibt zulässig. Bei einer verworfenen älteren Beobachtung bleibt auch das zugehörige Ankunftsdatum erhalten.

`public.notifications` ist das vorhandene dauerhafte Ereignis-Ledger. Lesen, Sehen und Ausblenden verändern keine Ereignisidentität. Die App erlaubt Nutzern keine Löschung. Es existiert keine automatische Ereignis-Retention. Vor einer späteren Einführung endgültiger Löschung müsste die Deduplizierung in ein unabhängiges dauerhaftes Ledger überführt werden. Kontolöschung und der abgesicherte lokale Demo-Cleanup sind davon getrennt.

## Tatsächliche Kanäle

Aktiv ist das Benachrichtigungszentrum mit bestehendem Realtime-/In-App-Verhalten. Die globale Benachrichtigungseinstellung wird respektiert; ausgeblendete Ereignisse bleiben gespeichert. Die interne Einstufung steht für spätere Kanäle bereit.

Die private Outbox kann nur nach separater Kanalkonfiguration, Präferenz und verifiziertem Einverständnis zustellen. Diese Änderung aktiviert keinen E-Mail-, Push- oder SMS-Versand. Mailgun-Nachrichten des Familien-/Freigabeablaufs sind ein eigener bestehender Prozess. Die beschriebenen Zahlungshinweise wurden ohne echte Zahlung oder externe Testnachricht in isolierten lokalen Datenbank- und Browser-Fixtures geprüft.
