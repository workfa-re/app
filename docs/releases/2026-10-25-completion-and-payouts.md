# Klarer Jobabschluss und planbare Auszahlungen

## Verhalten

- Der Termin-Shortcut ist verständlich beschriftet. Datum und Uhrzeit werden getrennt eingegeben; eine Notiz bleibt optional. Der seltene Schritt „Job freigeben“ steht in Details. Der überflüssige Veröffentlichungshinweis entfällt.
- „Abschließen“ öffnet unmittelbar die Vergütung für erledigte Arbeit. Der Anbieter schlägt den Endpreis vor, der Jugendliche bestätigt ihn und der Anbieter bezahlt den sichtbaren Gesamtbetrag. Preisvorschlag und Bestätigung erscheinen als anklickbare Hinweise zur passenden Stelle in Details.
- Es gibt keinen zusätzlichen sichtbaren Schritt zur Kartenvormerkung. Eine erforderliche Bankbestätigung bleibt bestehen; danach setzt der Server ausschließlich den zuvor ausdrücklich angeforderten Einzug fort. Bereits bestehende Vormerkungen werden durch die Veröffentlichung nicht automatisch eingezogen.
- Die geltende Servicegebühr bleibt unverändert: 17 € Vergütung + 5 % = 17,85 € Anbieterbetrag, 17 € für den Empfänger. Die Plattform trägt ihre Stripe-Kosten aus der Gebühr.
- Neue Auszahlungskonten erhalten monatliche Auszahlung am 1. In Workfare Pay lässt sich ein Monatstag speichern oder eine verfügbare EUR-Vergütung ausdrücklich auf das eigene hinterlegte Bankkonto auszahlen. Bestehende Auszahlungspläne werden angezeigt und bleiben bis zu einer bewussten Änderung erhalten.
- Der automatische Plan wird nach einem manuellen Einzelauftrag wiederhergestellt. Dauerhafte Operationen, unveränderliche Parameter, stabile Provider-IDs und Ausführungsleases verhindern unsichere Wiederholungen. Ein signierter Wiederherstellungsworker gleicht vorhandene Vorgänge ab und stellt Pläne wieder her, ohne neue Auszahlungen zu erstellen.

## Geprüft

- 2.984 automatisierte Prüfungen: 2.939 Haupttests, 14 Angebots-, 26 Demo-, zwei Abhängigkeits- und drei Workerprüfungen. Produktionsbuild einschließlich TypeScript erfolgreich; vollständiger Lint ohne Fehler, 43 bestehende Warnungen. Abhängigkeitsaudit ohne bekannte Schwachstellen.
- 170 isolierte PostgreSQL-Prüfungen für direkte Zahlung, Preis-Hinweise und Auszahlungsvorgänge einschließlich exaktem Replay über mehrere Tabs. Zusätzlich vollständiger produktionsnaher Rollout mit 34 Migrationen einschließlich atomarem Rollback, privaten Tabellenrechten, RLS und inaktiven Installationsdefaults.
- Responsive Browserfixtures für Chat, Termin, Abschluss und Auszahlung in beiden Farbmodi, einschließlich 320-Pixel-Ansichten, Bankbestätigung, fremdem Kontowechsel und ungewissem POST mit Reload. Simulierte Backendantworten sind kein Finanznachweis.
- Tatsächlicher Stripe-Sandboxtest mit vorhandenen synthetischen Konten und dem echten App-Adapter: Autorisierung, gespeicherte Testkarte, Einzug und erneute Prüfung von Zahlung, Transfer und Application Fee. 17,85 € Anbieterbetrag, 0,85 € Gebühr vor Stripe-Kosten und 17 € Empfängervergütung bestätigt. Keine neue Identität und keine App-Datenbankschreibzugriffe dafür.
- Die vier Migrationen `20261024223953`, `20261024223958`, `20261024224259` und `20261024225056` sind im Produktionsledger installiert; kanonische Dateien enthalten dieselben SQL-Bytes. Nach den ersten drei waren die neuen Finanzoperationstabellen leer und der zuvor bestehende 17-Euro-Hold unverändert. Die vierte Migration ergänzt ausschließlich einen privaten lesenden Lookup.
- Die Accounts-v2-/BalanceSettings-Kompatibilität ist tatsächlich in Stripe Sandbox geprüft: gespeicherter synthetischer daily-Plan → monthly/[1] → frische Rücklesung → exakte Wiederherstellung des ursprünglichen daily-Plans. Keine Auszahlung und kein Top-up dabei.
- Die bestehende Connect-Snapshot-Destination umfasst nun auch die fünf Payout-Ereignisse. Ziel-URL, bisherige Ereignisse und Signing-Konfiguration bleiben erhalten.

Die Sandbox hatte nach dem Zahlungsnachweis 0 € verfügbaren und 27 € ausstehenden Saldo. Deshalb wurde keine manuelle Sandbox-Auszahlung und kein künstlicher Top-up ausgelöst. Eine tatsächliche Bankzustellung, ein echter Minderjährigen-Abschluss und eine echte Kundenzahlung sind durch diesen Prüfstand nicht belegt.

Der aktuelle Ablauf, die API-Sicherungen und der Betriebsworker sind unter [Abschluss und Bankauszahlung](../operations/workfare-pay-completion-payouts.md) beschrieben.
