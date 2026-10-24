# Technischer Durchgang der Plattform

Stand: 24.10.2026. Ausgangsrevision: `f454c9d34bf7f9217b60f4a8bd3eac3d85f49ee3`.

Dieser Durchgang verbessert konkrete Ladepfade, Sitzungsprüfung, Chat-Synchronisation und Formularspeicherung. Er ergänzt die bestehenden Prüfungen und den aktuellen Entwicklungsplan. Er ist kein vollständiger Sicherheitstest aller möglichen Produktionsabläufe. In diesem Durchgang wurden keine Produktionsdaten geschrieben, Datenbankmigrationen ausgeführt oder Änderungen veröffentlicht.

## Geprüfte Bereiche

| Bereich | Schwerpunkt und Ergebnis |
| --- | --- |
| Anmeldung und Onboarding | Verifizierte Auth-Identität als Grundlage der Sitzung; E-Mail-Bestätigung getrennt von allgemeiner Bestätigung; interne Navigation und kleine Lint-Korrekturen |
| App-Shell und Berechtigungen | Request-Caching, Rollenwechsel, Prüfstatus und Seitenabhängigkeiten; keine nutzerübergreifenden Caches eingeführt |
| Jobs und Bewerbungen | Datenprojektionen, abgefragte Bewerbungsmenge, vollständige Historie bei API-Limits, Anbieterfreigabe und Fehlerpfade |
| Chat und Termine | Nachladen nach Verbindungsunterbrechung, konkurrierende Realtime-Ereignisse, Löschungen, Lesebestätigungen und fortlaufende Terminzeit |
| Benachrichtigungen | Bestehende Store-/Ladegrenzen geprüft; unnötige Abhängigkeit der Einstellungsseite vom vollständigen Header-Snapshot entfernt. Externe Zustellung bleibt eine gesonderte Aufgabe |
| Profile und Einstellungen | Bestehende gemeinsame Profilansicht und Zugriffsgrenzen beibehalten; geschützte Einstellungsseiten laden nur ihren benötigten Kontext |
| Jobformular | Speichern, Wiederherstellen, leere Standardwerte, wiederholte Änderungen und Storage-Fehler |
| Qualität und Betrieb | Tatsächlich wirksame TypeScript-/React-Lint-Prüfung, vollständige Tests, Build, Abhängigkeitsprüfung und read-only Datenbankprüfung |

## Umgesetzte Änderungen

### Sitzungen und Anbieterfreigabe

- `getUser()` liefert die geprüfte Identität. Cookiebasierte Sitzungsdaten liefern anschließend die benötigten Tokens, aber keine ungeprüfte Benutzeridentität oder Profilmetadaten.
- Fehlerhafte oder zur geprüften Identität abweichende Sitzungen werden abgelehnt. Profile und Systemrollen werden anhand der geprüften Benutzer-ID geladen.
- Eine allgemeine oder telefonische Kontobestätigung wird nicht mehr als bestätigte E-Mail behandelt.
- Die Joberstellung verlangt sowohl den Status `verified` als auch einen Prüfzeitpunkt. Diese Bedingung entspricht dem bereits vorhandenen Datenbank-Trigger; ein widersprüchlicher Teilstatus reicht im Frontend und in der Server Action nicht mehr.

### Datenzugriffe und Ladepfade

- Nachrichten, Anbieterjobs und die beiden Einstellungsunterseiten warten mit ihren fachlichen Abfragen nicht mehr auf den vollständigen Header-Snapshot einschließlich Benachrichtigungen.
- Anbieterjobs, zugehörige Zusammenfassungen, Markt und Zugriffsprüfung werden abhängigkeitsgerecht gestartet. Fehler bleiben Fehlerzustände.
- Die neue Jobseite verwendet den vorhandenen requestbezogenen Kontext, die gemeinsame Zugriffsprüfung und den gecachten Markt-Lookup.
- Wenn der Kontotyp bereits bekannt ist, entfällt eine zusätzliche Profilabfrage für den effektiven Ansichtsmodus.
- Jobkarten laden 18 konkret benötigte Jobfelder statt `select("*")`. Koordinaten und Jobs sowie anschließend Anreicherung und Bewerbungsstatus werden parallel gelesen.
- Der Bewerbungsstatus im Marktplatz wird nur für die tatsächlich zurückgegebenen Jobs gelesen. Alle Lesevorgänge bleiben sitzungsgebunden; keine RLS-Umgehung und kein globaler Auth-Cache.
- Die eigene Bewerbungshistorie bleibt vollständig, einschließlich beendeter Bewerbungen. Paginierung berücksichtigt auch niedrigere API-Zeilenlimits. Spätere Abfragefehler werden nicht als vollständige Historie ausgegeben.

Das sind nachweisbare Reduktionen von Abfragen, übertragenen Feldern und seriellen Abhängigkeiten. Es wurde kein belastbarer Produktionsbenchmark für eine prozentuale Beschleunigung durchgeführt.

### Chat und Termine

- Nach Realtime-Wiederverbindung, Rückkehr in einen sichtbaren Tab und erneutem Online-Status wird der Nachrichtenverlauf nachgeladen.
- Eine serielle Warteschlange bündelt Refresh-Ereignisse; überholte Antworten werden nicht veröffentlicht. Aufräumen beim Gesprächswechsel verhindert späte Aktualisierungen eines alten Gesprächs.
- Frische Serverdaten ersetzen veraltete lokale Zeilen. Während der Abfrage eingetroffene Realtime-Änderungen haben anschließend Vorrang; bereits geladene ältere Seiten und optimistische Nachrichten bleiben erhalten.
- Lesebestätigungen und Löschmarkierungen werden bei verspäteten Payloads nicht zurückgenommen. Löschmarkierungen bleiben intern als Schutz gegen Wiederauftauchen erhalten; gelöschte Nachrichten fehlen in Verlauf und Suche.
- Lesebestätigungen werden ebenfalls gebündelt. Ein Nachladen setzt weder Eingabeentwurf noch Detailansicht zurück.
- Terminauswahl und -beschriftung verwenden eine aufgeräumte Minutenuhr. Sie aktualisieren sich auch bei geöffnetem, ansonsten ruhendem Gespräch.

Die Wiederherstellung liest das bestehende jüngste Nachrichtenfenster. Sie ist kein neuer vollständiger Offline-Client und ändert weder die Zustellarchitektur noch die Auftragszustände.

### Entwürfe und kleinere Bereinigungen

- Browser-Storage wird außerhalb von React-State-Updatern verändert. Identische serialisierte Entwürfe erzeugen keine weiteren Schreibvorgänge oder neuen Snapshots.
- Fehler beim Lesen, Schreiben und Entfernen werden abgefangen; ein fehlgeschlagener Schreibvorgang kann erneut versucht werden.
- Unberührte Standardformulare erzeugen keinen leeren Wiederherstellungsentwurf. Der Hinweis erscheint nur nach tatsächlichem Laden eines gespeicherten Entwurfs.
- Die initiale Wiederherstellung wird einmal angewendet. Späteres Autospeichern setzt aktuelle Formulareingaben nicht auf alte Werte zurück.
- Unbenutzte Imports/Variablen und überholte Lint-Ausnahmen wurden gezielt entfernt, ein fehlendes Standard-`alt` ergänzt und der Onboarding-Home-Link auf den vorhandenen Next-Router umgestellt.
- Die offene Branding-Korrektur ist enthalten: Städtenamen in Inter, 14 px, normale Schreibweise und ruhiger Abstand statt sehr kleiner, weit gesperrter Schrift.
- Das README beschreibt den aktuellen Reservierungsablauf und trennt vorhandene Funktionen von Planungen. Bestehende Lizenzbedingungen bleiben erhalten.

Die lokale Entwurfsablage ist weiterhin gerätebezogen und noch nicht nach Benutzerkonten getrennt. Kontobezogene Schlüssel, Migration und Verhalten beim Abmelden gehören in die nächste Qualitätsrunde; diese Änderung behauptet keine neue Datenschutzgrenze der Storage-Ablage.

## Prüfungsergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| `npm run test:all` | 896 Tests bestanden: 872 Hauptsuite, 14 Anbieterjobs, 8 Demo-Verträge, 2 Abhängigkeitsverträge |
| `npm run typecheck` | Bestanden |
| `npm run build` | Produktionsbuild bestanden; 39 Seiten generiert |
| `npm run lint` | 289 Dateien geprüft, 0 Fehler, 42 Warnungen |
| `npm run security:audit` | 0 bekannte Schwachstellen im aktuellen Lockfile laut npm Audit |
| `git diff --check` | Bestanden |

Der bisherige ESLint-Aufbau erfasste TypeScript-Dateien nicht wirksam. Jetzt werden die offiziellen Next-/TypeScript-Konfigurationen verwendet. Ein Regressionstest belegt, dass TypeScript-Dateien geprüft, echte Regelverletzungen gefunden und ungültige Hook-Aufrufe abgelehnt werden. Es wurden keine Produktdateien von der Prüfung ausgeschlossen und keine neuen Abhängigkeiten installiert.

Verbleibende 42 Warnungen: 29 Hinweise zu Zustandsänderungen in Effects, 8 native Bild-Elemente, 3 unbenutzte Parameter und 2 Hinweise zu Generation-Refs beim Effect-Cleanup. Der Compiler ist nicht aktiviert; `set-state-in-effect` bleibt eine sichtbare Optimierungswarnung. `no-explicit-any` ist für die vorhandenen RPC-Grenztypen ausdrücklich deaktiviert. Das ist eine dokumentierte Grenze der Prüfung, kein Nachweis vollständiger Typstrenge. Die Generation-Refs invalidieren asynchrone Antworten beim Aufräumen bewusst; eine automatische Ersetzung durch eingefangene Werte würde dieses Verhalten ändern.

### Browserprüfung

Isolierter lokaler Prüfaufbau mit echten Komponenten und synthetischen Daten; schreibende Serveraktionen sind dabei abgefangen. Kein Nachrichtenversand, keine Joberstellung und keine echte Zahlung.

- Mobiles Jobformular, 393 px: alten synthetischen Entwurf verworfen; nach Neuladen kein leerer Wiederherstellungshinweis; Kategorie, Titel und Beschreibung eingegeben; nach Neuladen korrekt wiederhergestellt; Titel geändert und erneut korrekt wiederhergestellt. Anschließend Testentwurf verworfen.
- Mobiler Chat in dunkler Darstellung, 393 px: vorhandene Nachrichten und Terminstatus sichtbar; Detailansicht und Suche geöffnet; Suchtreffer führt zur Nachricht; nicht versandter Eingabeentwurf bleibt erhalten.
- Heller Desktop-Chat, 1440 px: Verlauf und Detailansicht geprüft. Keine horizontalen Überläufe auf diesen beiden geprüften Breiten; keine Browser-Konsolenfehler auf dem geprüften Weg.
- Die Städtenamen wurden zusätzlich im vorangegangenen Branding-Schritt bei 320/393/901/1151/1440 px in beiden Farbmodi geprüft. Browsergrößen ersetzen keinen physischen Safari-/iPhone-Test.

### Datenbankprüfung

Read-only im verbundenen Supabase-Projekt geprüft: RLS und SELECT-Berechtigungen auf Jobs/Bewerbungen, die Eindeutigkeit von `(job_id, user_id)` und die betroffenen Projektionen/Filter. Keine Migration und keine Testdatensätze in Produktion angelegt. Die Datenbank-Advisors wurden als Diagnose gelesen, nicht automatisch umgesetzt.

Offene Punkte aus dieser Diagnose:

- Schutz gegen bekannte kompromittierte Passwörter ist in Supabase Auth derzeit deaktiviert. Aktivierung und Registrierungs-/Passwortwechselprüfung gesondert durchführen.
- 2 anonyme und 16 authentifiziert aufrufbare bestehende `SECURITY DEFINER`-RPCs benötigen eine funktionsbezogene Berechtigungsprüfung. Ein aufrufbares RPC ist nicht automatisch eine nachgewiesene Sicherheitslücke; pauschales Entziehen würde Kernabläufe beschädigen.
- 5 RLS-Hinweise ohne Policy betreffen nach Architektur absichtlich nur serverseitig genutzte Tabellen. Berechtigungsgrenzen gezielt prüfen und nicht mit allgemeinen Client-Policies öffnen.
- 35 Hinweise zu unbenutzten Indizes sind kein hinreichender Löschgrund. Nutzungszeitraum, Constraints und seltene Abläufe vor einer Änderung prüfen.

## Nächste technische Arbeit

1. Kontoisolierte Entwürfe, Auth-Härtung, RPC-Berechtigungsmatrix und isolierte Rollen-/RLS-Tests als eigenes Paket umsetzen.
2. Staging, definierte mobile/desktop Ende-zu-Ende-Flows und einen tatsächlich ausgeführten Wiederherstellungstest etablieren.
3. Die verbleibenden Effect-/Typisierungsstellen nach messbarem Risiko bearbeiten. Große Komponenten nicht nur zur Verringerung ihrer Zeilenzahl zerlegen.
4. Den Zahlungsentwurf zuerst auf Geschäftsmodell, minderjährige Empfänger und PSP-Freigabe prüfen; danach einen vollständig getrennten Sandbox-Pilot bauen.

Produktprioritäten und Platzierung stehen in der [Plattform-Roadmap](../planning/platform-roadmap.md), das Finanzmodell in [Workfare Pay](../planning/workfare-pay.md).
