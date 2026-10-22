# Vollständiges Rebrand des Onboardings

Stand: 22. Oktober 2026. Dieses Release gestaltet den gesamten öffentlichen
Einstieg von Workfare neu: Willkommen, Anmeldung und Registrierung,
E-Mail-Bestätigung, Stadtwahl, Rollenwahl, Profil und Organisation,
Zusammenfassung, Warteliste, Passwort-Wiederherstellung sowie Rechtliches.

## Gestaltung und Bedienung

| Bisher | Neuer Stand |
| --- | --- |
| Unterschiedliche Schriften, Farben und Komponenten im Einstieg | Inter als gemeinsame Schrift, neutrale Schwarz-Weiß-Palette und einheitliche Formulare. |
| Herkömmliche Kopf-/Fußbereiche und zusätzliche Hinweise im Formular | Gemeinsamer Rahmen mit Logo, Zurück, Farbschema, kontextueller Hilfe und direktem Zugang zu Rechtlichem. |
| Uneinheitliche Logo-Größe und experimentelle Bildvarianten | Originales transparentes Brückenzeichen, im Onboarding kompakt in einem runden Glasrahmen; dazu korrigierte Browser- und App-Icons. |
| Statisches bzw. sichtbar geschnittenes Hero-Motiv | Acht Sekunden langer Brückenfilm mit nahtlos vorbereitetem Loop und eigenem abgerundetem Bildbereich. |
| Uneinheitliche helle und dunkle Ansichten | Systemvorgabe und gespeicherte manuelle Auswahl; die Filmhelligkeit folgt dem Farbschema, ohne den Film neu zu starten. |
| Überzeichnete Klick- und Schrittbewegung | Dezente Lichtreflexe und Übergänge ohne Verkleinern beim Klick oder verzögerten Seitenwechsel. |
| Hilfefenster mit getrenntem Seitengefühl | Nicht modale Hilfe, die sich am Fragezeichen öffnet; Support per E-Mail, FAQs und begleitete Registrierung sichtbar als noch nicht verfügbar. |
| Unruhige Profil- und Kontrollansicht | Klare Feldabstände, zurückhaltende Beschriftungen und eine kompakte Zusammenfassung mit einzeln erreichbaren Bearbeitungsaktionen. |
| „Trust Center“, Seitenleiste und zusätzliche Rechtliches-Fenster | `/legal` als direkte Übersicht mit Impressum, Datenschutz, AGB und Cookies im selben Design. |

Desktop zeigt Inhalt und Film nebeneinander. Auf schmalen Geräten steht der Film
über dem Formular. Der Willkommensinhalt ist vertikal zentriert, längere Formulare
bleiben scrollbar. Alle Schritte verwenden den gemeinsamen Zurück-Button; es gibt
keine zusätzlichen Konto-Wechsel- oder Zurück-Links unter den Formularen.

Der Film hat einen eigenen Wiedergabeschalter. Reduzierte Bewegung, Datensparmodus,
Hintergrund-Tabs und unsichtbare Bildbereiche unterbrechen die automatische
Wiedergabe. Ein Poster bleibt bei Ladefehlern verfügbar. Dieses Release verwendet
das vorhandene Kling-generierte Film-Asset; für den abschließenden Schliff wurde
keine weitere kostenpflichtige Mediengenerierung gestartet.

## Ablauf und Daten

- Registrierung beginnt mit der Stadtwahl; Anmeldung bleibt direkt erreichbar.
- Explizite Einstiegsparameter haben Vorrang vor einem lokal gespeicherten Entwurf.
  Entwürfe verfallen nach 14 Tagen und enthalten kein Passwort.
- E-Mail-Bestätigung, erneuter Codeversand, Fehlermeldungen und Passwort-Hilfe
  verwenden denselben Rahmen und zugängliche Statusmeldungen.
- Geburtsdatum und Altersgrenzen werden als Kalenderdatum geprüft. Unvollständige
  und unmögliche Daten können keinen zuvor gültigen Wert versteckt beibehalten.
- Profil- und Organisationsangaben werden vor dem Speichern zusammengefasst und
  können einzeln bearbeitet werden. Wiederholte Aktionen während laufender
  Anfragen werden abgefangen.
- Stadtverfügbarkeit, Warteliste, Eltern-Einladungslinks und sichere interne
  Weiterleitungen bleiben an die vorhandenen serverseitigen Verträge angebunden.
- Die vorhandenen vier Rechtstexte werden vollständig dargestellt. Diese
  Überarbeitung ersetzt keine rechtliche Inhaltsprüfung.
- Es sind keine Datenbankmigrationen oder Änderungen an Auth-Richtlinien,
  Konten, E-Mail-Templates oder SMTP-Einstellungen Bestandteil dieses Releases.

## Prüfung und Veröffentlichung

| Prüfung vor Veröffentlichung | Ergebnis |
| --- | --- |
| Hauptsuite, Offers, Demo-Verträge und Dependency-Kompatibilität | 381 Tests bestanden. |
| TypeScript, ESLint und Next.js 16.4.2 Produktions-Build | Bestanden. ESLint umfasst die vorhandene JS/MJS/CJS-Konfiguration; TS/TSX wird durch TypeScript und den Build geprüft. |
| Profil, Organisation und Zusammenfassung | 24 Ansichten in beiden Farbschemata bei 1440, 393 und 320 Pixeln auf dem Produktions-Build geprüft; kein horizontaler Überlauf, Bearbeitungsaktionen mindestens 44 × 44 Pixel. |
| Willkommen und Film | 22 Größen-/Farbschema-Kombinationen geprüft; Zentrierung, schmale Ansichten, laufender Film beim Themenwechsel, Pause und Bild-Fallback bestehen. |
| Hilfe und Einstiegswechsel | Tastatur/Fokus, Escape, Klick außerhalb, deaktivierte Zukunftsfunktionen, gemeinsamer Zurück-Weg und Übergang ohne Schrumpfen geprüft. |
| Vollständige simulierte Abläufe | Elf Funktionsgruppen: drei Rollen, vier Bearbeitungswege, Datums-/Altersfälle in mehreren Zeitzonen, Code-Bestätigung, Anfragen während Ladezuständen sowie Speicherfehler, Wiederholung, Erfolg, Nutzdaten und Entwurfsbereinigung. |
| Nebenrouten | 28 Ansichten und sechs Interaktionsgruppen für alle Rechtsseiten, Passwort-Hilfe und Warteliste geprüft; keine Laufzeitfehler oder ungeplanten Anfragen. |
| Produktionsabhängigkeiten | `npm audit --package-lock-only --omit=dev`: keine Funde am 22.10.2026. |

Next.js und eslint-config-next wurden kompatibel auf 16.4.2 aktualisiert,
Vitest auf 4.1.12, Vite auf 6.4.5; der Lockstand enthält Sharp 0.35.5 und
source-map-js 1.2.2. React bleibt bei 19.2.0.

Das Gesamtaudit meldet weiterhin fünf als hoch eingestufte Pakete aus **einer
ungepatchten Entwicklungswerkzeug-Kette**: eslint-config-next →
@next/eslint-plugin-next → fast-glob → micromatch → braces 3.0.3.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
betrifft den rekursiven Parser bei tief verschachtelten fremden Glob-Mustern.
Die Kette ist hier dem Lint-Werkzeug zugeordnet und fehlt im Produktionsaudit.
Der bestehende CI-Audit bleibt aktiv und meldet diesen Rest; es gibt weder eine
Pauschalausnahme noch einen inkompatiblen Next-Downgrade zum Ausblenden des Funds.
Das ist keine vollständige Anwendungssicherheitsprüfung.

Browser-Funktionsprüfungen verwenden synthetische Daten und simulierte
API-Antworten. Sie belegen keine echte E-Mail-Zustellung oder erfolgreiche
Profilspeicherung in der Produktionsdatenbank. Der erste Folgepunkt bleibt daher
ein kontrollierter vollständiger Kontodurchlauf.

Der Rollout verwendet die bestehende Dokploy-Anwendung und `main` unter
`https://app.workfa.re`. Die Live-Abnahme muss einen abgeschlossenen neuen
Deployment-Eintrag, die Git-Revision im laufenden Container und die entsprechende
Build-ID im frisch geladenen öffentlichen HTML abgleichen. Ein Push allein ist
kein Nachweis einer aktualisierten Live-Version. Es sind keine neuen Dienste,
Domains oder Datenbankmigrationen erforderlich.

## Nächste Schritte

1. **Kontrollierter vollständiger Kontodurchlauf:** Mit freigegebenen Testkonten
   Registrierung, Zustellung/Bestätigung, Profilspeicherung und Zielseite für
   Jobsuchende, private Anbieter und Organisationen im Produkt prüfen. Auch die
   Eltern-Einladung einschließlich Freigabe vollständig durchspielen. Erfolg
   bedeutet gespeicherte Daten und einen bestätigten Rollenpfad, nicht nur eine
   sichtbare Vorschau.
2. **Design in der angemeldeten Plattform fortführen:** Zuerst gemeinsame
   Navigation und Konto-Menüs, dann Jobs/Angebote, Aktivitäten und Einstellungen.
   Bestehende Funktionen beibehalten, mobile Bedienung und beide Farbschemata
   pro Bereich abnehmen. Den angemeldeten Inhalt ruhig und lesbar halten.
3. **Hilfe inhaltlich ausbauen:** Häufige Fragen aus den tatsächlichen
   Registrierungsschritten ableiten, Supportweg und Zuständigkeit festlegen.
   Begleitete Registrierung erst aktivieren, wenn Ablauf, Verfügbarkeit und
   Datenschutz technisch und organisatorisch stehen.
4. **Release-Prüfung dauerhaft absichern:** Die geprüften öffentlichen
   Einstiege, Geburtsdatumsfälle, Bearbeitungsrückwege, Farbschemata und mobilen
   Layouts in wiederholbare UI-Prüfungen übernehmen. Deployment-Auslösung und
   ausgelieferte Git-Revision nach jedem Release nachvollziehbar prüfen.

Mailgun-Domain und Admin-Hostname bleiben separate Infrastrukturaufgaben aus
`docs/operations/workfare-rebrand.md`; sie werden durch dieses UI-Release nicht
als erledigt gewertet.
