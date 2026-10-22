# Termine einer laufenden Zusammenarbeit

Ein Termin gehört zu einer angenommenen Bewerbung mit aktivem Engagement.
Ein abgesagter Termin beendet weder den Job noch das Gespräch. Der allgemeine
Status heißt deshalb „In Zusammenarbeit“; eine tatsächlich geplante Zeit steht
zusätzlich im Chat.

Der Anbieter kann einen geplanten Termin auswählen, Beginn, optionales Ende und
Hinweis bearbeiten oder den Termin absagen. Bei regelmäßigen Jobs lassen sich
weitere Termine hinzufügen. Bei einem einmaligen Job ist nur ein geplanter
Termin vorgesehen; nach dessen Absage kann ein Ersatztermin angelegt werden.

Jobsuchende können eine Änderung oder bei regelmäßigen Jobs einen Zusatztermin
anfragen. Der bisherige Termin gilt, bis der Anbieter den Vorschlag annimmt.
Ablehnen und Zurückziehen ändern den verbindlichen Termin nicht. Es gibt
höchstens eine offene Anfrage pro Gespräch. Anbieteränderungen ersetzen offene
Anfragen zum betroffenen Termin. Eine gespeicherte Terminversion verhindert,
dass eine inzwischen veraltete Anfrage einen neueren Termin überschreibt.
Wird das Gespräch geschlossen oder die Bewerbung beendet, werden offene
Terminvorschläge automatisch hinfällig; sie können bei einer späteren Öffnung
nicht versehentlich angenommen werden.

Die erste verbindliche Jobvergabe verwendet weiterhin `confirm_job_engagement`.
Anfragen führen keine Annahme einer Bewerbung oder Freigabe privater Daten aus.

## Datenbank und Veröffentlichung

Die additive Migration liegt unter
`infrastructure/database/migrations/20261022181830_appointment_requests.sql`.
Sie ergänzt `job_appointment_requests` mit SELECT-RLS für Beteiligte und eine
`manage_job_appointment`-RPC. Die öffentliche Funktion ist SECURITY INVOKER;
ihre private Implementierung prüft Anmeldung, Beteiligung, Anbieterrolle,
Gesprächs- und Engagementstatus unter Sperren. Direkte Browser-Schreibrechte
auf die neue Tabelle werden nicht erteilt. Jede Änderung erzeugt ein
Anwendungsereignis und eine Systemnachricht; die andere Person erhält eine
Benachrichtigung über den vorhandenen Benachrichtigungspfad.

Das lokale Demo-Setup lädt dieselbe Migration vor seiner Isolationsschicht.
Die neue Tabelle bekommt dieselbe Besuchsgrenze; die private Schreibfunktion
läuft dort unter `demo_executor` mit eingeschalteter RLS. Neue Anfragen werden
über die Eltern-Fremdschlüssel bei der Besuchsbereinigung entfernt.
Ein bestehendes Demo-Datenbankschema wird durch `demo:setup` nicht automatisch
überschrieben oder zurückgesetzt: Die geänderte Prüfsumme verlangt weiterhin
ein separat geprüftes Vorwärtsupdate.

Vor Ausrollen der Oberfläche muss die Migration auf dem tatsächlich verwendeten
Ziel angewandt und deren RPC-/RLS-Vertrag geprüft werden. Solange sie fehlt,
bleibt für Anbieter die bestehende Terminvereinbarung erreichbar. Jobsuchende
erhalten keine wirkungslosen Anfrage-Schaltflächen.

Am 22. Oktober 2026 wurde die additive Migration im verifizierten produktiven
Supabase-Projekt angewandt und unter Version `20261022181830` mit dem Namen
`appointment_requests` registriert. Die anschließende Prüfung bestätigt RLS,
gesperrte anonyme Lese-/RPC-Zugriffe, gesperrte direkte Schreibzugriffe für
angemeldete Browser, die SECURITY-INVOKER-Eigenschaft der öffentlichen RPC
und die Aufnahme in Realtime. Es bestehen noch keine Terminanfragen. Die
vorhandenen Job-, Bewerbungs-, Nachrichten- und Terminbestände blieben
unverändert; es wurden keine echten Anfragen oder Nachrichten zum Testen
angelegt. Die Oberfläche wurde separat lokal geprüft; diese Datenbankprüfung
belegt keine Veröffentlichung des Frontends.

## Isolierte Datenbankprüfung

`scripts/database/test-appointments.mjs` führt die Migration und die echte
bestehende `confirm_job_engagement`-Funktion in einer frischen PostgreSQL-WASM-
Instanz aus. Der Test akzeptiert keine Datenbank-URL und kann weder die
Produktionsdatenbank noch einen anderen Netzwerkserver beschreiben.

```sh
npm install --prefix /tmp/workfare-appointment-validation --no-audit --no-fund @electric-sql/pglite@0.3.14
WORKFARE_PGLITE_MODULE=/tmp/workfare-appointment-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/database/test-appointments.mjs
npm test -- --run src/__tests__/appointments.test.ts
```

Die Prüfungen decken Rollen und RLS, geschlossene Gespräche, ungültige Zeiten,
fremde Termine, Anfrageannahme und Wiederholung, Zurückziehen, Ablehnen,
Konfliktversionen, Absage und einmalige bzw. regelmäßige Termine ab. Das ist
ein Datenbankvertragstest; es ersetzt keinen vollständigen End-to-End-Lauf
gegen eine isolierte Supabase-Installation mit Realtime und Auth.
