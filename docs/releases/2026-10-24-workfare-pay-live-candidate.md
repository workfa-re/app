# Workfare Pay und Familienzugang

Geprüfter Releasekandidat vom 24.10.2026. Diese Prüfung belegt die Implementierung und die genannten Tests. Eine ausgeführte Echtgeldzahlung oder ein tatsächlich abgeschlossenes deutsches Guardian-Onboarding wird damit nicht behauptet.

## Änderungen

- Gemeinsame Zahlungsverwaltung mit eingebettetem Checkout und Connect, Rechnungsdaten, Belegen, eigenem Verdienst, Stripe-Salden und tatsächlichem Auszahlungsverlauf. Helle und dunkle Darstellung verwenden das bestehende Glasdesign und passende dezente Videoassets.
- Getrennte Simulation, Sandbox und Live-Laufzeit. Live erfordert eigene eingeschränkte Schlüssel, bestätigte Plattform-/Projektzuordnung und unabhängige Webhook-Signaturen. Testhinweise erscheinen bei Testbetrieb; der echte Live-Modus trägt keine Testkennzeichnung.
- Zusätzliche versionierte Servicegebühr von 5 % im Live-Modus. Die vereinbarte Vergütung bleibt vollständig erhalten. Zahlungskosten reduzieren den Plattformbeitrag; simulierte Steuerannahmen werden nicht übernommen.
- Terminbezogene Preisbestätigung, Autorisierung, ausdrücklicher Einzug, Storno, vollständige Erstattung und wiederholbarer Abgleich. Ein Stopp neuer Verpflichtungen lässt die Bearbeitung bestehender Zahlungen und signierter Ereignisse offen.
- Minimaler Familienzugang, Einladungen in beide Richtungen, ausdrücklich versionierte Zustimmung, optionales Passwort und späterer eigener Anbieterzugang. Bestehende Elternverbindungen erhalten keine erfundene Unterschrift.
- Elternauthentifizierter Stripe-Einstieg für das eigene freigegebene Kind. Berechtigung hängt an aktueller Zustimmung, unveränderlicher Identität, echten Stripe-Guardian-/Vertragsnachweisen und tatsächlichen Fähigkeiten des Jugendkontos. Es gibt kein ersatzweises Elternkonto und kein eigenes Wallet.
- Server und Oberfläche verweigern veraltete Zahlungsaktionen nach einem Kontowechsel. Einrichtungsrückkehr, URL-Parameter und Client-Callbacks erteilen keine Zahlungsbereitschaft.
- Der neue Elternablauf startet erst bei vollständiger Schema-Bereitschaft. Der gezielte Legacy-Pfad erhält einen noch vollständig unveränderten Produktionsbestand; Teilmigrationen und Berechtigungsfehler werden geschlossen behandelt.

## Abschließende Prüfung

| Prüfung | Ergebnis |
| --- | --- |
| Hauptsuite | 121 Dateien, 2.100 Tests bestanden |
| Angebote / Demo / Abhängigkeiten | 14 / 26 / 2 Tests bestanden |
| Automatisierte Suiten insgesamt | **2.142 Tests bestanden**, ohne doppelt gezählte gezielte Wiederholungen |
| ESLint | 0 Fehler, 40 bestehende Warnungen; Payment-/Guardian-Module ohne Befunde |
| Optimierter Produktionsbuild | Erfolgreich, einschließlich TypeScript; Demo deaktiviert, isolierte Fixture-Konfiguration |
| Dependency-Audit | Keine bekannten Schwachstellen im Lockfile |
| Live-Datenbanktests | 52 echte PostgreSQL-Prüfungen bestanden |
| Guardian-KYC-Datenbanktests | 66 echte PostgreSQL-Prüfungen einschließlich konkurrierender Sperren bestanden |
| Produktionsnaher Gesamtsatz | Alle 21 Vorwärtsmigrationen atomar angewendet und zurückgerollt, ohne Demo-Schema; inaktive Standards und private RLS geprüft |
| Lokale Vorwärtsaktualisierung | Geschützte Sicherung, Dry-run und Anwendung; bisherige Aufträge, Empfänger, Familien und Zustimmungen erhalten |
| Secretprüfung | 606 Textdateien gegen 10 aktuell konfigurierte private Werte geprüft: keine Treffer; zwei Mustertreffer eindeutig künstliche Webhook-Testfixtures. Ein künstlicher API-Testwert wurde nach GitHubs Pushschutz durch einen kurzen Platzhalter ersetzt. |
| Diffprüfung | Erfolgreich |

Der Live-Stripe-Connector bestätigt das aktivierte deutsche Plattformkonto und die registrierte Zahlungsdomain `app.workfa.re`. Beim letzten privaten Serverabgleich fehlen die vom Betreiber angekündigten Live-Schlüssel weiterhin in der gespeicherten Dokploy-Konfiguration und im laufenden Dienst. Zahlungs-Webhooks und tatsächliche Aktivierung werden erst nach dem privaten Konfigurationsabgleich als erledigt geführt. Die [Betriebsdokumentation](../operations/workfare-pay-production.md) hält diese Grenzen und den anschließenden Rollout fest.
