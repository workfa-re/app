# Vollständige Plattformdemo

Die Website bettet die eigentliche Plattform ein. `/demo?role=seeker`,
`private-provider` oder `company` eröffnet eine besuchergebundene Sitzung und
leitet auf die normalen App-Seiten weiter. Navigation, Profile, Einstellungen
und Aktionen verwenden denselben Anwendungscode wie die Plattform.

Die Demo besitzt eine eigene Supabase-Instanz und ausschließlich synthetische
Beispieldaten. Server und Browser müssen beide ausdrücklich auf Demo stehen.
Ein Produktionsprojekt oder widersprüchliche Aktivierungsflags wird abgewiesen.
Die Demo-Anmeldecookies heißen `wf-demo-auth`; der private Besuchercookie heißt
`wf-demo-visitor`. Sie überschreiben keine normale Plattform-Anmeldung.

## Darstellung folgt der Website

Die Website übergibt den aufgelösten Modus beim Einstieg als
`/demo?role=seeker&theme=dark` beziehungsweise `theme=light`. Ausschließlich diese
beiden Werte werden akzeptiert; leere, unbekannte oder mehrfach angegebene Werte
werden vor dem Anlegen einer Sitzung abgewiesen. Fehlt der Parameter, gilt ein
vorhandenes gültiges `wf-demo-theme`-Cookie, ansonsten Dunkelmodus. Das kosmetische
Cookie gilt für 24 Stunden und enthält weder Identität noch Zugriffsrechte.

Das Layout verwendet den Modus schon im serverseitigen HTML und im frühen
Theme-Bootstrap. Ein anderer Systemmodus oder eine frühere Profilfarbe bestimmt
damit nicht den Start der eingebetteten Demo. Die normale Plattform verwendet
weiter ihre bisherige Profil-/Systemeinstellung.

Bei einer späteren Website-Umschaltung empfängt die Demo
`{ type: "workfare:demo-theme", theme: "dark" | "light" }`. Akzeptiert werden nur
Nachrichten des direkten Elternfensters mit dessen zuvor erlaubter, exakter
Herkunft. Der Listener wird vor `workfare:demo-ready` installiert. Er aktualisiert
nur den lokalen ThemeProvider und das Farb-Cookie, ohne Anmeldung, Rollenwechsel,
Neuladen oder Datenbankänderung. Ein später installiertes Elternfenster kann
`workfare:demo-ready-request` senden; die Demo bestätigt daraufhin erneut ihre
Bereitschaft. Das deckt auch eine vor der Website-Hydration fertig geladene Demo
ab. Farbmeldungen beantworten diese Bereitschaft nicht und erzeugen keine Schleife.

| Before | After |
| --- | --- |
| Die Demo übernimmt System-/Profilfarbe unabhängig von der Website. | Explizites `theme=dark`/`theme=light` bestimmt den Start; ohne Wert gilt Demo-Cookie oder Dunkelmodus. |
| Das Demo-HTML startet fest mit dunkler Klasse und nachträglicher Profilauflösung. | Klasse, früher Bootstrap und ThemeProvider verwenden von Beginn an dieselbe geprüfte Demo-Farbe. |
| Die Einbettung meldet ausschließlich Bereitschaft. | Der bereits installierte, herkunftsgebundene Listener übernimmt spätere Website-Farbwechsel ohne Neuladen und ohne Profiländerung. |
| Ein frühes `demo-ready` konnte vor der Website-Hydration verloren gehen. | Ein zusätzlicher, genauso herkunftsgeprüfter `demo-ready-request` beantwortet späte Bereitschaftsanfragen ohne Nachrichtenschleife. |
| Eine Farbwahl wird nicht getrennt gespeichert. | `wf-demo-theme` speichert ausschließlich die gültige Farbe für 24 Stunden und erhält sie beim Rollenwechsel. |

## Lokal starten

Voraussetzungen: installiertes Node.js mit `process.loadEnvFile` (ab 20.12),
Docker Desktop beziehungsweise ein lokaler Docker-Daemon mit Unix-Socket und
installierte npm-Abhängigkeiten. Der vorhandene App-Start wurde mit Node 24 und
Next 16 geprüft. Die Werkzeuge unterstützen keine entfernten Docker-Kontexte,
keine Cloud-Datenbankadresse und keine Reset-Option.

```sh
npm run demo:setup
npm run demo:dev
```

Das Setup erwartet diese geprüften Dateien in `infrastructure/demo/schema/`:
`platform.sql`, `isolation.sql`, `service-api.sql`, `auth-guard.sql`, `seed.sql`
und danach verpflichtend `cleanup-schedule.sql`.
`platform.sql` ist ein Schemaexport einschließlich der benötigten Auth-Trigger;
er enthält keine Produktivdaten. Die übrigen Dateien installieren die
Besuchertrennung, die ausschließlich serverseitig verwendeten Demo-Funktionen,
die Auth-Grenzen, synthetische Beispieldaten und die automatische Bereinigung.
Der aktive Cron-Job `workfare-demo-expired-visits` muss alle fünf Minuten laufen;
ohne diesen Zeitplan gilt die Datenbank für das Setup als unvollständig.

Die Supabase-CLI wird fest als Version **2.109.1** über die offizielle npm-Registry
aufgerufen. Statusdaten und Schlüssel werden im Speicher verarbeitet und nicht
auf dem Terminal ausgegeben. Die Runtime-Konfiguration liegt unter
`~/.cache/workfare-website-demo/`. Die bereits manuell gestartete lokale Instanz
wurde mit `/private/tmp/workfare-demo-runtime/` eingerichtet. Das Setup prüft
diese laufenden Container über ihre Projektzuordnung und verschiebt oder
überschreibt den bisherigen temporären Runtime-Ordner nicht. Docker verwendet das feste Projekt
`workfare-website-demo`. Das Setup schreibt `.env.demo.local` mit Dateirechten
`0600`. `.env.local` wird nicht verändert; `.env*` ist bereits von Git ausgeschlossen.
Eine vorhandene Demo-Umgebungsdatei wird geprüft und erhalten.

| Dienst | Lokale Adresse |
| --- | --- |
| Website | `http://localhost:3000` |
| Echte Demo-App | `http://localhost:3001/demo?role=seeker` |
| Demo-Supabase/API | `http://127.0.0.1:55321` |
| Demo-Postgres | `127.0.0.1:55322` |
| Lokaler Mail-Eingang | `http://127.0.0.1:55324` |

Website und iframe müssen lokal denselben Hostnamen verwenden, damit ihre
`SameSite=Lax`-Cookies funktionieren: bei der vorhandenen Website beide
`localhost`. Der Website-Standard ist `http://localhost:3000`, ihr Demo-Fallback
`http://localhost:3001/demo`. `localhost` und `127.0.0.1` in den beiden
Browseradressen nicht mischen. Die Netzwerkbindung des Servers bleibt unabhängig
davon ausschließlich `127.0.0.1`. Normale Supabase-Dienste auf `54321`
werden nicht angesprochen. Studio und externe E-Mail-Zustellung sind nicht Teil
dieses Setups. Der Mail-Eingang fängt lokale Auth-Mails ab. Globale Registrierung
bleibt gesperrt (`auth.enable_signup=false`); der E-Mail-Anmeldeanbieter bleibt
aktiv (`auth.email.enable_signup=true`), damit bestehende serverseitig angelegte
Demo-Konten ihre Einmalanmeldung verifizieren können. Beide Einstellungen werden
auch am tatsächlich laufenden Auth-Container geprüft, ohne andere Umgebungswerte
auszugeben.

`demo:dev` lädt die Datei im Node-Wrapper und startet Next mit Webpack auf
`127.0.0.1:3001`. Ein direktes `node --env-file=... next dev` wird vermieden:
Next 16 kann dieses Argument in `NODE_OPTIONS` für Worker übernehmen und dadurch
unter Node 24 den Start verhindern. Exportierte Supabase-/Demo-Variablen werden
vor dem Laden entfernt, damit eine Shell mit Produktionswerten die explizite
Demo-Datei nicht überstimmt.

## Bestehende Daten und lokale Portgrenze

Ein Erststart legt das kanonische CLI-Netz
`supabase_network_workfare-website-demo` mit Docker-Loopback-Vorgabe an. Danach
werden die tatsächlichen veröffentlichten Ports aller eigenen Demo-Container
geprüft. Eine falsche Bindung wird gestoppt; vor dieser Prüfung werden weder
Schema noch Zugangsdaten freigegeben. Das bereits manuell eingerichtete lokale
Demo-Netz darf bestehen bleiben, wenn seine tatsächlichen Bindungen korrekt sind.

Falls eine CLI-/Docker-Kombination dennoch breite Hostbindungen erzeugt, beendet
das Setup den Vorgang. Für genau die drei eigenen veröffentlichenden Container
gibt es eine gesonderte Reparatur:

```sh
node scripts/demo/rebind-loopback.mjs
npm run demo:setup
```

Sie erhält Images, Konfiguration, Volume-Daten, Neustartregeln und Netzwerk-Aliase
und ändert die Hostbindung auf `127.0.0.1`. Bei Fehlern bleiben alte Volumes und der
ursprüngliche Container erhalten; ein unsicher gebundener Container wird beim
Rollback nicht wieder gestartet. Die Werkzeuge verändern keine fremden Container.

Schema-Dateien werden nur auf eine leere lokale Datenbank angewendet. Eine
bestehende Datenbank wird auf den aktiven Bereinigungsjob, die verzögerte
Auth-Bindungsprüfung, alle 23 restriktiven Besuchergrenzen und beide Rollen mit
NOLOGIN/NOBYPASSRLS geprüft;
sie wird weder zurückgesetzt noch automatisch mit neueren SQL-Dateien überschrieben.
Bei einer vom Setup angelegten Datenbank wird zusätzlich der SHA-256-Stand der
installierten Dateien verglichen. Für eine zuvor manuell eingerichtete Datenbank
ist die Strukturprüfung kein Nachweis eines identischen Installationsstands.

```sh
npm run demo:cleanup
```

Dieser Aufruf entfernt höchstens 100 abgelaufene Demo-Besuche einschließlich ihrer
zugehörigen Demo-Konten und Daten. Aktive Besuche bleiben erhalten. Es handelt
sich weder um einen Datenbankreset noch um das Stoppen anderer lokaler Projekte.

## Spätere gehostete Demo

Geplant ist eine eigene Demo-Adresse unter derselben Site, beispielsweise
`demo.workfa.re`, mit separatem Supabase-Projekt und eigenem Deployment.
Produktive Plattform und Demo werden aus derselben Quellcodeversion **separat
gebaut**, weil Next die `NEXT_PUBLIC_*`-Werte beim Build fest einbindet. Ein bereits
für Produktion gebautes Image wird nicht durch geänderte Runtime-Werte zur Demo.

Für Hosting sind noch die tatsächliche Domain/DNS-/TLS-Konfiguration, der
separate Supabase-Zielnachweis, private Serverkeys, ausbleibende externe
Mailzustellung, feste Reverse-Proxy-Vertrauensregeln, regelmäßige Ablaufbereinigung
und die Deploy-Verknüpfung beider Builds einzurichten und zu prüfen. Diese lokalen
Werkzeuge führen kein Hosting-Deployment durch. Produktionsportfreigaben oder
Produktivdaten werden dafür nicht wiederverwendet.

Die Demo erlaubt Einbettung ausschließlich von `https://workfa.re` und
`https://www.workfa.re`; im Entwicklungsbetrieb zusätzlich die expliziten lokalen
Website-Adressen auf Port 3000. Die produktive App bleibt gegen Einbettung gesperrt.
Besuchertrennung muss weiterhin mit echten getrennten Sitzungen und Datenbanktests
geprüft werden; grüne Skript-/Komponententests ersetzen diesen Nachweis nicht.

Prüfstand der Werkzeuge: acht reine Vertragstests (`node --test
scripts/demo/contracts.test.mjs`), Syntaxprüfungen und ESLint sind bestanden.
`npm run demo:setup` wurde am bestehenden lokalen Stack erfolgreich mit Exitcode
0 ausgeführt: sechs Dienste verifiziert, vorhandene Datenbankstruktur nur gelesen,
Demo-Umgebungsdatei erhalten. Die sechs finalen SQL-Artefakte liegen im Repository;
die vollständigen Plattformtests (253/253) und der Demo-Produktionsbuild sind
bestanden. Ein vollständiger frischer Setup-Durchlauf auf leerer Datenbank und die
gehostete Konfiguration bleiben noch ungeprüft.

Quellen: [Supabase CLI v2.109.1 – Netz-/Containererzeugung](https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/internal/utils/docker.go),
[Next.js – Build- und Runtime-Umgebungsvariablen](https://nextjs.org/docs/app/guides/self-hosting#environment-variables).
