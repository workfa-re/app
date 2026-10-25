# Familienübersicht und Workfare Plan

Stand: 25.10.2026. Die Migration ergänzt eine lesende Familienprojektion, ohne bestehende Zeilen, Tabellenrechte oder Zahlungsabläufe zu ändern.

## Oberfläche

- Pro Kind eine Karte mit Profilbild oder Initialen, aktiven und abgeschlossenen Jobs, Auftraggeber und Termin. Weitere Jobs werden seitenweise geladen.
- Freigabeaktionen bleiben bei fehlender Zustimmung sichtbar; Pay und Verbindungsverwaltung bleiben aufklappbar. Abmelden führt zur normalen Anmeldung zurück.
- Workfare Plan zeigt Produkttitel und Headline gemeinsam neben der Kartenanimation. Aktualisieren steht neben Zurück; der Gebührenrechner entfällt. Geplante Funktionen sind ausdrücklich keine derzeit verkauften Leistungen.

## Datenrechte

Jobmetadaten erfordern ein eigenes aktives Familienverhältnis zu einer 14–17-jährigen jobsuchenden Person und eine aktuelle, genau diesem Elternteil zugeordnete Zustimmung. Ohne diese Zustimmung und ab dem 18. Geburtstag bleiben nur Profildaten sichtbar. Fremde, widerrufene, ausstehende oder gelöschte Verbindungen werden abgewiesen.

Chattexte, Privatadressen, Telefonnummern, E-Mails und Zahlungsdaten gehören nicht zur neuen Projektion. Die vorhandene Finanzübersicht behält ihre eigenen Prüfungen.

## Abnahme

| Nachweis | Ergebnis |
| --- | --- |
| Anwendungstests einschließlich Offers, Demo und Operations | 3.313 bestanden |
| Isolierte PostgreSQL-Prüfungen | 45 bestanden: Berechtigungen, Zustimmung, Widerruf, Volljährigkeit, Soft Delete, Paginierung |
| Integrierte Familien-Browserprüfung | 447 Prüfungen: 16 Größen-/Farbszenarien und 14 zusätzliche Zustände; ausschließlich fiktive Daten |
| Plan-Browserprüfung | 234 Prüfungen einschließlich Vertrags- und Fehlerzuständen; ausschließlich fiktive Daten |
| Build, TypeScript und ESLint | Erfolgreich; keine neuen Lint-Warnungen |
| Produktionsschema | Alle 42 benötigten Spalten vorhanden; anonyme Funktionsausführung verweigert; neue Rollenrechte geprüft |
| Sicherheits-Advisors | Bestehende Befunde unverändert |

Die geschützte Hauptfunktion liegt in `guardian_private`, verwendet einen leeren Suchpfad und prüft den angemeldeten Akteur. Der öffentliche Wrapper ist `SECURITY INVOKER`; anonyme und Service-Role-Ausführung sind entzogen. Die API bindet zusätzlich den erwarteten UI-Besitzer, prüft den Aufrufursprung und liefert Antworten ausschließlich mit `private, no-store` aus.

## Migrationsnachweis

Datei und Produktionsledger stimmen überein: `20261025160812_guardian_child_overview.sql`, Name `guardian_child_overview`, ein Statement, 6.808 Bytes, MD5 `10b32b492c87f8e554a98d33d231566c`. Die beim Entwurf vom CLI erzeugte Zeitkennung wurde nach Byte-Abgleich an die tatsächlich von Supabase registrierte Kennung angepasst; der SQL-Inhalt wurde nicht verändert und nicht erneut ausgeführt.

Die Prüfungen bestätigen Oberfläche, Zugriffsgrenzen und Jobprojektion. Sie ersetzen keine gesonderte Abnahme einer echten Zahlung bis zum Bankeingang.
