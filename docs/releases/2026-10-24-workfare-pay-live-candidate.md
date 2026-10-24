# Workfare Pay und Familienzugang

Geprüfter und veröffentlichter Basisstand vom 24.10.2026, Commit `7c414e9b818cb58dcbb501fa94423ae717fd2d78`; die anschließende Betriebsvorbereitung und der noch nicht als veröffentlicht nachgewiesene Folgepatch sind unten gesondert ausgewiesen. Diese Prüfung belegt die Implementierung, das Deployment und die genannten Tests. Der Zahlungsmodus bleibt deaktiviert; eine ausgeführte Echtgeldzahlung oder ein tatsächlich abgeschlossenes deutsches Guardian-Onboarding wird nicht behauptet.

## Änderungen

- Gemeinsame Zahlungsverwaltung mit eingebettetem Checkout und Connect, Rechnungsdaten, Belegen, eigenem Verdienst, Stripe-Salden und tatsächlichem Auszahlungsverlauf. Helle und dunkle Darstellung verwenden das bestehende Glasdesign und passende dezente Videoassets.
- Getrennte Simulation, Sandbox und Live-Laufzeit. Live erfordert private Serverschlüssel, bestätigte Plattform-/Projektzuordnung und unabhängige Webhook-Signaturen. Der Folgepatch unterstützt Standard- und eingeschränkte Live-Schlüssel; eingeschränkte Schlüssel bleiben bevorzugt. Testhinweise erscheinen bei Testbetrieb; der echte Live-Modus trägt keine Testkennzeichnung.
- Zusätzliche versionierte Servicegebühr von 5 % im Live-Modus. Die vereinbarte Vergütung bleibt vollständig erhalten. Zahlungskosten reduzieren den Plattformbeitrag; simulierte Steuerannahmen werden nicht übernommen.
- Terminbezogene Preisbestätigung, Autorisierung, ausdrücklicher Einzug, Storno, vollständige Erstattung und wiederholbarer Abgleich. Ein Stopp neuer Verpflichtungen lässt die Bearbeitung bestehender Zahlungen und signierter Ereignisse offen.
- Minimaler Familienzugang, Einladungen in beide Richtungen, ausdrücklich versionierte Zustimmung, optionales Passwort und späterer eigener Anbieterzugang. Bestehende Elternverbindungen erhalten keine erfundene Unterschrift.
- Elternauthentifizierter Stripe-Einstieg für das eigene freigegebene Kind. Berechtigung hängt an aktueller Zustimmung, unveränderlicher Identität, echten Stripe-Guardian-/Vertragsnachweisen und tatsächlichen Fähigkeiten des Jugendkontos. Es gibt kein ersatzweises Elternkonto und kein eigenes Wallet.
- Server und Oberfläche verweigern veraltete Zahlungsaktionen nach einem Kontowechsel. Einrichtungsrückkehr, URL-Parameter und Client-Callbacks erteilen keine Zahlungsbereitschaft.
- Der neue Elternablauf startet nur bei vollständiger Schema-Bereitschaft. Diese ist in Produktion jetzt vorhanden. Der gezielte Legacy-Pfad bleibt für einen vollständig unveränderten Altbestand begrenzt; Teilmigrationen und Berechtigungsfehler werden geschlossen behandelt.

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
| Produktionsnaher Gesamtsatz | Alle 22 neuen Vorwärtsmigrationen einschließlich Fremdschlüsselindizes atomar angewendet und zurückgerollt, ohne Demo-Schema; inaktive Standards, private RLS und Indexabdeckung geprüft |
| Lokale Vorwärtsaktualisierung | Geschützte Sicherung, Dry-run und Anwendung; bisherige Aufträge, Empfänger, Familien und Zustimmungen erhalten |
| Secretprüfung | 606 Textdateien gegen 10 aktuell konfigurierte private Werte geprüft: keine Treffer; zwei Mustertreffer eindeutig künstliche Webhook-Testfixtures. Ein künstlicher API-Testwert wurde nach GitHubs Pushschutz durch einen kurzen Platzhalter ersetzt. |
| Diffprüfung | Erfolgreich |

## Produktionsrollout

Der Commit ist nach `main` gepusht und automatisch durch Dokploy veröffentlicht. Servercheckout und Release stimmen überein; `https://app.workfa.re/` antwortet extern mit HTTP 200. [Code-Quality-CI](https://github.com/workfa-re/app/actions/runs/40091753695) und [Sicherheitsaudit](https://github.com/workfa-re/app/actions/runs/40091753788) sind erfolgreich.

Das Produktionsprojekt `fqaditikccbxivpxukxp` enthält jetzt 51 kanonische Migrationen, zuletzt `20261024120114`. Payment-/Guardian-Schemas und vorgesehene RPCs sind vorhanden. Vorherige Daten und Katalog wurden privat gesichert; der Vergleich aller 24 betroffenen Tabellen bestätigt den Erhalt der bisherigen Zeilen und Spaltenwerte. 75 Profile und acht aktive Familienverbindungen bleiben erhalten. Es wurden keine Elternzustimmungen erzeugt und keine Zahlungsaufträge angelegt. Die neue Indexmigration beseitigt die drei noch fehlenden Payment-Fremdschlüsselindizes; der produktionsnahe Gesamttest und zwölf gezielte Demo-Vertragsprüfungen sind anschließend erfolgreich.

Der Stripe-Live-Connector bestätigt das aktivierte deutsche Plattformkonto und die registrierte Zahlungsdomain `app.workfa.re`. Öffentliche Live-Konfiguration, ein privater Hosted-State-Schlüssel, vier getrennte Webhook-Signaturen und auf ausdrücklichen Betreiberwunsch ein vollständiger Live-Serverschlüssel sind verschlüsselt in Dokploy gespeichert. Die Rotation wurde auf Betreiberwunsch zurückgestellt. Der veröffentlichte Basiscommit akzeptierte ausschließlich eingeschränkte Live-Schlüssel. Der Folgepatch dieser Runde unterstützt auf ausdrücklichen Betreiberwunsch Standard- und eingeschränkte Live-Serverschlüssel; eingeschränkte Schlüssel bleiben bevorzugt und die spätere Rotation steht offen. Konto-/Projektzuordnung, Signaturen sowie Datenbank-, Rollen-, Owner- und Zustimmungsprüfungen bleiben unverändert. Der Patch benötigt einen eigenen Deploymentnachweis; die aktuelle Anwendung verwendet bis zum nächsten Deployment ihre vorherige Konfiguration. Alle vier Live-Ereignisziele einschließlich Thin Connect sind angelegt und abschließend als deaktiviert geprüft; die Signaturen sind privat gespeichert. Der private authentifizierte Kontoabgleich bestätigt die vorgesehene deutsche Plattform und aktive Zahlungs-/Auszahlungsfähigkeiten. Deployment und Prüfung tatsächlich empfangener signierter Ereignisse stehen noch aus. Zahlungsmodus und finanzielle Gates bleiben geschlossen; SEPA und PayPal werden nicht als implementierte Zahlungswege angeboten.

Die [Betriebsdokumentation](../operations/workfare-pay-production.md) enthält Sicherungs-/Ledgernachweis, Konfigurationsstand und die noch offene Abnahme einschließlich Minderjährigen und tatsächlicher Bankauszahlung.

Die vollständige Wiederholungsprüfung des Folgepatches besteht aus 2.113 Haupttests in 122 Dateien sowie 14 Angebots-, 26 Demo- und zwei Abhängigkeitstests: **2.155 Tests bestanden**. Darin enthalten sind die 89 gezielten Backendprüfungen; sie werden nicht zusätzlich gezählt. Der produktionsnahe Apply-/Rollback-Test aller 22 Migrationen ist erneut erfolgreich. Die zusätzliche Secretmusterprüfung findet in 609 Textdateien keine langen Live-Schlüssel oder Webhook-Signaturen. Diese Prüfungen und die Fremdschlüssel-Indexmigration sind Nachfolgearbeiten zum oben genannten Basisrelease; dessen bereits bestätigtes Deployment wird damit nicht rückwirkend als Nachweis des Folgepatches ausgegeben.

Das Brückenmotiv aus dem freigegebenen Entwurf wird mit einer einzigen referenzgeführten Higgsfield-Generierung animiert: 2560 × 1440, fünf Sekunden, 50 Credits laut Angebot. Versionierte helle und dunkle Webassets, vorwärts laufende Überlappungsschleife und passende Standbilder ersetzen den vorherigen Entwurf. Der Film ist pausierbar und wird bei reduzierter Bewegung oder Datensparmodus zunächst nicht geladen. [Mediennachweis](../../public/media/pay/README.md).

Der optimierte Demo-Build einschließlich TypeScript und 63 Routen ist erfolgreich. Die gerenderte Pay-Seite wurde in Chromium mit 1440, 390 und 320 Pixel Breite jeweils hell und dunkel geprüft: kein horizontaler Überlauf, vollständiger Bogen mit beiden Füßen, 44-Pixel-Steuerung und funktionierende Pause/Wiedergabe. Zwei Schleifendurchläufe wurden in beiden Modi beobachtet; es traten keine Seitenfehler auf. Bei aktivierter reduzierter Bewegung blieb die Videoquelle leer und es gab keine MP4-Anfrage. Diese Viewportprüfung ersetzt keinen gesonderten Test auf einem physischen iPhone.
