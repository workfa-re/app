# Workfare Pay: klare Übersicht und vollständige Zahlungshinweise

## Verhalten

- „Für Auszahlung verfügbar“ und „Insgesamt verdient“ stehen gleichwertig oben. Bearbeitung und bereits ausgezahlte Beträge stehen darunter. Die Startseite zeigt ausschließlich die zwei Hauptwerte und den Einstieg zu Pay.
- „Guthaben ansehen“ öffnet eine lesende Liquid-Glass-Detailkarte mit tatsächlichen Beträgen, gegebenenfalls belegtem Freigabedatum, maskierter Bankverbindung und Zahlungsvorgängen. Fehlende Salden werden nicht als null ausgegeben. Kontowechsel und Abmeldung entfernen die vorherigen Finanzdaten.
- Die frühere Hilfezeile mit Glass-Icon ist zurück. Der losgelöste Monatlich-Hinweis entfällt; der konkrete Auszahlungstag bleibt unter Auszahlungen. Unter „Jetzt auszahlen“ hat der Hinweis einen eigenen Abstand.
- Das Drei-Punkte-Menü des Zahlungsmittels liegt vollständig über nachfolgenden Karten. Tastaturöffnung, Menünavigation, Escape, Tab und Rückfokus sind berücksichtigt. Das Entfernen benötigt weiterhin eine ausdrückliche Bestätigung.
- Neue Preisvorschläge, Preisbestätigung und bestätigte Zahlungs-/Erstattungsereignisse erzeugen passende Benachrichtigungen und strukturelle Chat-Hinweise. Der Hinweis öffnet die zugehörige Zahlung in den vorhandenen Details. Abgeschlossene Gespräche behalten den Zugriff; frühere Preisstände bleiben rein lesbar.
- Beim Nachladen eines Termins wartet der Sprung auf das vorhandene Ziel. Ein expliziter Gesprächswechsel entfernt den alten Zahlungslink. Übersetzter Nachrichtentext berechtigt niemals zum Zugriff auf einen Zahlungsauftrag.
- Automatische und manuelle Bankauszahlungen bekommen kontoweite Hinweise. Der Webhook liest den tatsächlichen Payout auf dem zugeordneten Stripe-Konto erneut und prüft Modus, Betrag, Währung und Eigentümer. Eine Bankauszahlung wird keinem beliebigen Jobchat zugeschrieben.
- Wiederholungen, gleichzeitige Bestätigungen und verspätete Stripe-Ereignisse erzeugen keine doppelten logischen Hinweise. Ein späterer Bankfehler bleibt sichtbar; ein altes Erfolgsereignis setzt ihn nicht zurück. Gelesene oder ausgeblendete Benachrichtigungen bleiben für die Deduplizierung erhalten.

Die [Ereignismatrix](../operations/workfare-pay-notifications.md) beschreibt Empfänger, Ziele, Prioritäten und Zustellgrenzen. Zahlungseingang, verfügbarer Saldo und Bankauszahlung sind getrennte Ereignisse. Die Änderung löst keine Zahlung, Auszahlung oder rückwirkende Benachrichtigungswelle aus.

## Zukünftiges Konto und Karte

Die [Partner- und Produktplanung](../planning/workfare-account-card.md) beschreibt ein optionales Workfare-Zahlungskonto mit gebrandeter Karte. Treezor ist der erste Prüfkandidat, weil deutsche Minderjährigenbedingungen und ein technisches Modell mit dem Jugendlichen als Kontoinhaber veröffentlicht sind. Die konkrete Freigabe, Vergütungsart, Kontoinhaber-/Vertreterprüfung, doppelte Dienstleisterprüfungen, Kartenauthentifizierung, Kosten und Support sind darin ausdrücklich offen ausgewiesen. Es wurde kein Konto- oder Kartenprogramm eingerichtet.

Der bestehende Tarif und die bisherigen Zahlungsfreigaben werden durch diese Überarbeitung nicht geändert. Die höhere allgemeine Servicegebühr bleibt Gegenstand der separaten Kalkulation.

## Prüfung und Veröffentlichung

- 3.142 automatisierte Anwendungstests: 3.088 Haupttests, 14 Angebots-, 26 Demo-, zwei Abhängigkeits- und zwölf Betriebs-/Kalkulationsprüfungen. Produktionsbuild mit TypeScript erfolgreich; Lint ohne Fehler und mit 42 bestehenden Warnungen.
- 67 isolierte PostgreSQL-Prüfungen: 53 Ereignis-/Berechtigungsprüfungen und 14 Prüfungen verspäteter Payout-Zustände. Der gesamte produktionsnahe Rollout mit 37 Migrationen lässt sich atomar installieren und zurückrollen; private Rechte, RLS und abgeschaltete Standardfreigaben bleiben erhalten.
- Browser-Fixtures mit tatsächlichen React-Komponenten und CSS, ausschließlich synthetischen Daten: 29 Empfängeransichten, acht Menü-/Hilfekombinationen und 80 Chat-/Zahlungsverlinkungsprüfungen. Größen von 320 bis 1440 Pixeln, beide Modi, Keyboard, Fokus, Kontowechsel, verspätete Daten und historische Preise sind enthalten. Keine horizontalen Überläufe oder Konsolenfehler. Das Browser-Plugin war nicht verfügbar; die Prüfung erfolgte mit Playwright.
- Die Migrationen `20261025114040_payment_lifecycle_notifications.sql` und `20261025114413_payout_status_ordering.sql` sind im gehosteten Projekt installiert. Versionsnummern stammen aus dem tatsächlichen Ledger. Die SQL-Prüfsummen stimmen exakt mit den kanonischen Dateien überein. Trigger und eingeschränkte Funktionsrechte wurden anschließend gelesen; die normalisierten Sicherheits-/Performancehinweise sind unverändert.
- Die Prüfungen haben keine echten Zahlungen, Bankauszahlungen, Konten, Zustimmungen, E-Mails, Pushnachrichten oder SMS erzeugt. Neue Produktivmeldungen entstehen erst bei tatsächlichen neuen Ereignissen.

Commit und automatisches Deployment folgen der gemeinsamen Abnahme. Eine vorhandene Migration oder ein erfolgreicher Build allein ist kein Nachweis einer durchgeführten Echtgeldzahlung.
