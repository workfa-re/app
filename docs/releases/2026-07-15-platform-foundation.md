# Major-Change-Dokumentation: Plattformkern und Activities

## Einordnung

Diese Dokumentation beschreibt den vollständigen Änderungsumfang zwischen
`c9aa5b0` (`Polish navigation and job filtering experience`) und dem
Release-Commit, der diese Datei enthält.

| Kennzahl | Umfang vor dieser Dokumentationsdatei |
| --- | ---: |
| Betroffene Dateien | 209 |
| Neue Dateien | 42 |
| Überarbeitete Dateien | 67 |
| Entfernte Dateien | 100 |
| Ergänzte Zeilen | 19.696 |
| Entfernte Zeilen | 16.021 |

Der Stand ist als Major Change eingeordnet, weil nicht nur Oberflächen
überarbeitet wurden. Zentrale Job-, Bewerbungs- und Kommunikationsabläufe liegen
jetzt in einem transaktionalen Datenbankmodell; gleichzeitig wurden
Berechtigungen verschärft und die eingebetteten Admin-, Demo- und Jury-Bereiche
aus der Verbraucherplattform entfernt.

## Was sich für Nutzerinnen und Nutzer ändert

### Activities und Kommunikation

- Der Activities-Bereich wurde für beide Account-Typen neu geordnet, ohne die
  bestehende Produktsprache zu verlassen.
- Anbieter sehen Bewerbungen nach Job gebündelt: aktives Gespräch, Warteliste und
  abgeschlossene Verläufe bleiben fachlich zusammen.
- Jobsuchende sehen ihre Gespräche und nächsten Schritte in einer ruhigeren,
  chronologisch stabilen Inbox.
- Die Inbox-Steuerung ist auf `Aktiv` und `Alle` reduziert. Ungelesene
  Nachrichten und offene Wiederöffnungsanfragen werden innerhalb von `Aktiv`
  gebündelt, statt einen dritten Filter zu erzeugen.
- Die Suche ist als kompakte Aktion in den Inbox-Kopf integriert. Sie öffnet sich
  bei Bedarf, kann mit Escape geschlossen werden, leert dabei die Anfrage und
  stellt den Fokus zuverlässig wieder her.
- Nachrichten werden mit Datum, Uhrzeit, Systemereignissen, stabiler Reihenfolge
  und persönlichen Leseständen dargestellt.
- Persistierte Nachrichten und fachliche Zustände werden teilnehmerbezogen über
  Realtime aktualisiert. Der Tippindikator verwendet private,
  teilnehmergebundene Broadcast-Kanäle und speichert keine flüchtigen Tippdaten
  als Chatnachricht.
- Längere Verläufe können kontrolliert nachgeladen werden. Optimistisches Senden
  gibt unmittelbar Rückmeldung und stellt fehlgeschlagene Texte wieder her.
- Bewerbungsnachrichten, normale Chatnachrichten, Systemereignisse und
  Wiederöffnungsanfragen sind visuell sowie semantisch getrennt.
- Profile und Gesprächsdetails sind aus dem Verlauf erreichbar und zeigen nur
  freigegebene Profil-, Job-, Vergütungs-, Standort- und Termininformationen.
- Personen, einzelne Nachrichten, Wiederöffnungsanfragen oder der gesamte
  Gesprächskontext können mit eindeutigem Evidenzbezug gemeldet werden.
- Light Mode, Dark Mode, Desktop, Tablet und Mobile verwenden dieselben
  Oberflächenregeln. Ein älterer Mobile-CSS-Konflikt, der den Inbox-Kopf
  ausblendete, wurde entfernt.

### Bewerbungs-, Wartelisten- und Gesprächsstatus

- Die erste zulässige Bewerbung wird zum aktiven Gespräch; weitere Personen
  werden in einer deterministischen FIFO-Warteliste geführt.
- Wartelistenpositionen beruhen auf einem unveränderlichen Reihenschlüssel. Die
  sichtbare Position bleibt dennoch lückenlos und verrät keine fremden
  Wartelistendaten.
- Jobsuchende sehen ihre eigene Position und die relevante Gesamtzahl, nicht
  jedoch die Identität anderer Wartelistenpersonen oder des Hauptbewerbers.
- Wenn die aktive Person ausscheidet, wird die nächste berechtigte Person
  innerhalb derselben Transaktion nachgezogen. Systemnachricht,
  Benachrichtigung und Jobstatus werden dabei gemeinsam aktualisiert.
- Anbieter können eine Wartelistenperson nur als begründete Ausnahme vorziehen;
  die Entscheidung wird protokolliert.
- Ablehnen und Zurückziehen schließen den normalen Chat mit eindeutigem
  Verursacher, Grund und vorherigem Status.
- Die schließende Partei kann einen reversiblen Verlauf wieder öffnen. Die
  andere Partei darf pro Schließung genau eine gekennzeichnete
  Wiederöffnungsanfrage senden.
- Wiederöffnungsanfragen können angenommen, abgelehnt und als eigener
  Moderationskontext gemeldet werden, ohne den bisherigen Verlauf zu löschen.

### Vereinbarungen und wiederkehrende Jobs

- Anbieter können aus dem aktiven Gespräch einen Termin verbindlich bestätigen.
- Einmalige Jobs erhalten einen Engagement- und Terminablauf; wiederkehrende
  Jobs können mehrere Termine innerhalb derselben Zusammenarbeit verwalten.
- Die Bestätigung setzt den Job auf vergeben, markiert die ausgewählte Bewerbung
  als angenommen und beendet konkurrierende aktive Bewerbungen atomar.
- Abschluss und Stornierung aktualisieren Job, Bewerbung, Zusammenarbeit,
  Termine, Ereignisse und Benachrichtigungen konsistent.
- Workfare Pay ist ausschließlich als klar gekennzeichneter Zukunftsausblick
  berücksichtigt. Es existiert noch kein Zahlungsledger und keine produktive
  Zahlungsabwicklung.

### Jobsuche und Wartelistenansicht

- Offene und reservierte Jobs werden getrennt geladen und anschließend stabil
  zusammengeführt.
- Reservierte Jobs bleiben für andere geeignete Personen in der Wartelistenansicht
  sichtbar.
- Eigene aktuelle und frühere Bewerbungen werden nicht erneut als neu
  bewerbbarer Job angeboten; der weitere Verlauf liegt in Activities.
- Die Jobliste unterstützt kumulatives Nachladen mit klaren Obergrenzen, ohne
  bereits sichtbare Ergebnisse zu verlieren.
- Fehlermeldungen, Leerzustände, Entfernungsdaten und Anwendungsstatus wurden
  zwischen Serverdaten und Kartenansicht vereinheitlicht.
- Bewerbungsdialoge unterscheiden verständlich zwischen direkter Bewerbung und
  Wartelisteneintrag und bestätigen den tatsächlich erzeugten Status.

### Anbieterbereich und Jobverwaltung

- Die Anbieter-Startseite zeigt kompaktere Jobkarten mit klaren Status-,
  Vergütungs-, Reichweiten- und Bewerbungsinformationen.
- Primäraktionen unterscheiden korrekt zwischen Öffnen, Bearbeiten und
  Bewerbungen ansehen. Geschützte Lifecycle-Zustände werden beim Bearbeiten nicht
  versehentlich wieder geöffnet.
- Erstellen und Bearbeiten verwenden abgestimmte Grenzen für Titel,
  Beschreibung, Vergütung, Jobart und Wiederholungsregeln.
- Entwürfe können gespeichert, lokal zwischengespeichert und später
  wiederhergestellt beziehungsweise veröffentlicht werden.
- Leere, ungültige oder überhöhte Vergütungen werden verständlich abgelehnt,
  statt stillschweigend ersetzt zu werden.
- Ladefehler bei Bewerbungszahlen werden als Fehler dargestellt und nicht mit
  „keine Bewerbungen“ verwechselt.

### Persönliche Benachrichtigungen

- Popover, Übersichtsseite und Einstellungen verwenden dieselbe
  empfängergebundene Datenquelle.
- Abfragen, Lesestatus und Realtime-Abonnements sind auf die ID der angemeldeten
  Person begrenzt. Fremde Benachrichtigungen können nicht mehr in der eigenen
  Ansicht erscheinen.
- Einzelne oder alle Benachrichtigungen können über validierte RPCs als gelesen
  markiert werden. Optimistische UI-Updates werden bei einem Fehler
  zurückgerollt.
- Kategorien, Ruhezeiten, Zeitzone und Digest-Wahl werden konsistent modelliert.
  Systembenachrichtigungen bleiben von optionalen Kategorieabschaltungen
  ausgenommen.
- Navigation aus einer Benachrichtigung führt abhängig vom Ereignis zum
  passenden Job, Gespräch oder Einstellungsbereich.
- Popover und vollständige Übersicht besitzen belastbare Lade-, Leer- und
  Fehlerzustände; lange Listen lassen sich kumulativ erweitern.
- E-Mail-Präferenzen sind vorbereitet, stellen aber noch keinen E-Mail-Versand
  dar. Versanddienst, Wiederholungen und Digest-Worker bleiben eine separate
  Ausbaustufe.

### Profile, Onboarding, Guardian und Navigation

- Sichtbare Profildaten werden über zweckgebundene Projektionen geladen, statt
  vollständige fremde Profilzeilen im Browser freizugeben.
- Exakte Adressen, Koordinaten, Geburtsdaten, E-Mail-Adressen, Guardian-Daten und
  interne Rolleninformationen bleiben außerhalb fremder Consumer-Sitzungen.
- Onboarding-, Guardian-Einladungs- und Weiterleitungsabläufe wurden gegen
  ungültige oder fremde Ziele abgesichert.
- Die Profilerstellung wird atomar über einen validierten Onboarding-RPC
  abgeschlossen. Direkte Profil-Inserts aus Browser-Sitzungen sind entzogen.
- Der anonyme Guardian-Zugriff ist auf die Einladungsinformation begrenzt;
  Einlösung und Erstellung erfordern eine authentifizierte Identität.
- Bestätigte Guardian-Beziehungen werden aus der tatsächlichen Verknüpfung
  geladen und im Profil nachvollziehbar dargestellt.
- Standortsuche und private Jobstandorte verwenden engere Daten- und
  Berechtigungsgrenzen.
- Exakte Jobadressen sind nur im autorisierten Auftragskontext abrufbar;
  öffentliche Ansichten erhalten ausschließlich gröbere Standortinformationen.
- Anbieter-Verifizierung und Sicherheitsaktivitäten besitzen klare Status- und
  Fehlerzustände, ohne unnötige sensible Daten offenzulegen.
- Teammitglieder behalten im Profilmenü den Zugang zum Admin-Panel; der Link
  führt jetzt bewusst zur getrennten Anwendung unter
  `https://admin.jobbridge.team`.
- Alte Einstiege für App, Home, Messages und Benachrichtigungen leiten auf die
  aktuellen kanonischen Routen weiter.

## Datenbank und Sicherheitsarchitektur

### Kanonischer Migrationsstand

- Das frühere, manuell gepflegte `infrastructure/database/schema.sql` ist
  entfernt. Es enthielt veraltete Demo- und Rollen-Override-Strukturen und ist
  keine verlässliche Grundlage für neue Umgebungen.
- Dreizehn geordnete Supabase-Migrationen bilden den kanonischen Activities-
  Release-Slice ab. Dateiname, Ledger-Version, Statement und Prüfsumme sind in
  `infrastructure/database/README.md` dokumentiert.
- Im Release-Audit vom 15. Juli 2026 wurden alle dreizehn lokalen Dateien gegen
  das Produktionsledger geprüft. Version, Byte-Länge und MD5 stimmen überein.
- Vorhandene Auth-Identitäten, Profile, Launch-Waitlist-Daten,
  Guardian-Beziehungen und Systemrollen werden als geschützte Daten behandelt.

### Fachliches Datenmodell

Der Datenbankvertrag trennt die Verantwortlichkeiten eindeutig:

| Bereich | Führende Struktur |
| --- | --- |
| Job-Lifecycle | `jobs` |
| Bewerbung und Gespräch | `applications` |
| Nachrichtenverlauf | `messages` |
| Unveränderliche Ereignisse | `application_events` |
| Wiederöffnungsanfragen | `conversation_reopen_requests` |
| Zusammenarbeit | `job_engagements` |
| Termine | `job_appointments` |
| Persönliche Zustellung | `notifications` und `notification_preferences` |
| Moderation | `reports` mit Evidenz-Snapshot |

Konsequente Statusübergänge laufen über authentifizierte RPCs. Browserclients
können zentrale Bewerbungs-, Nachrichten-, Reporting-, Engagement- und
Termintabellen nicht direkt verändern.

### RLS, Datenschutz und Missbrauchsschutz

- Bewerbungen und Gespräche sind nur für die bewerbende Person und den Besitzer
  des zugehörigen Jobs sichtbar.
- Benachrichtigungen und Präferenzen sind ausschließlich für ihren Empfänger
  les- und änderbar.
- Consumer-Sitzungen erhalten keinen staff-weiten Profil- oder
  Bewerbungszugriff mehr.
- Begrenzte Profilprojektionen liefern nur die Daten, die eine konkrete sichtbare
  Job- oder Gesprächsansicht benötigt.
- Direkte Profil-Inserts und Änderungen an autoritativen Identitätsfeldern sind
  entzogen; Onboarding und geschützte Änderungen laufen über validierte RPCs.
- Meldungen können Nutzer, einzelne Nachrichten oder Wiederöffnungsanfragen
  betreffen. Ein serverseitiger Evidenz-Snapshot konserviert den relevanten
  Kontext zum Meldezeitpunkt.
- Moderations- und Sicherheitsdaten bleiben service-only; privilegierte
  Trigger-Helfer sind für Browserrollen gesperrt.
- Security-Definer-Funktionen besitzen festgelegte Suchpfade und explizite
  Ausführungsrechte.
- Private Realtime-Themen prüfen sowohl Teilnahme als auch Schreibberechtigung.

## Entfernte Altlasten

- Eingebettete `/admin`- und `/staff`-Oberflächen wurden entfernt. Privilegierte
  Administration gehört zur getrennten Admin-Anwendung und deren serverseitiger
  Autorisierungsgrenze.
- Jury-, Demo-, Rollen-Override- und Debug-Oberflächen sowie zugehörige
  Datenzugriffe wurden aus der Consumer-Anwendung entfernt.
- Veraltete Activity-, Bewerbungs-, Onboarding-, Profil- und Offer-Komponenten
  wurden durch die neuen konsolidierten Abläufe ersetzt.
- Nicht mehr verwendete Admin-DALs, serverseitige Admin-Actions und ein
  ungeschützter Legacy-Duplikathelfer wurden entfernt. Der kanonische
  Supabase-Admin-Client bleibt server-only erhalten.
- Das alte Jury-Flyer-Asset ist nicht länger Bestandteil des Produkt-Bundles.

## Qualitätssicherung

Der Release-Stand wurde vor der Veröffentlichung mit folgenden Gates geprüft:

| Prüfung | Ergebnis |
| --- | --- |
| Haupt-Test-Suite | 54 von 54 Tests bestanden |
| Offer-Test-Suite | 24 von 24 Tests bestanden |
| ESLint | bestanden |
| TypeScript `--noEmit` | bestanden |
| Next.js Produktions-Build | bestanden |
| Desktop Light Mode | visuell und interaktiv geprüft |
| Desktop Dark Mode | visuell geprüft |
| Mobile-Ansicht | visuell geprüft |
| Suche, Filter, Escape und Fokus | interaktiv geprüft |
| Browser-Konsole | keine Fehler oder Warnungen im geprüften Ablauf |
| Projektweiter Namensscan | keine unerwünschten Agentenbezeichnungen |

Die Tests decken unter anderem Chat-Reihenfolge, Wiederöffnungs-Aufmerksamkeit,
Wartelisten-Sichtbarkeit, persönliche Benachrichtigungen, Guardian-Einlösung,
Standortdatenschutz, sichere Weiterleitungen und Offer-Validierung ab.

## Deployment- und Breaking-Change-Hinweise

1. Vor dem App-Deployment muss der Zielstand des Supabase-Migrationsledgers mit
   den dreizehn kanonischen Dateien und ihren Prüfsummen verglichen werden.
2. Eine Migrationsdatei im Repository ist allein kein Beleg dafür, dass sie im
   Zielprojekt angewendet wurde.
3. Vor Datenbankänderungen sind Backup beziehungsweise Recovery Point sowie
   Zeilenzahlen und stabile IDs der geschützten Tabellen zu dokumentieren.
4. Die Migrationen sind ausschließlich in Dateireihenfolge anzuwenden. Bereits
   angewendete Dateien werden nicht verändert; Korrekturen erfolgen vorwärts
   durch eine neue Migration.
5. Nach dem Rollout müssen RLS, Realtime-Publikation, FIFO-Invarianten,
   Wiederöffnungsregeln, Benachrichtigungstrennung und ein vollständiger
   Bewerbung-bis-Abschluss-Ablauf geprüft werden.
6. Der Datenbankwechsel ist nicht ausschließlich additiv: Zeitstempel werden
   vereinheitlicht und bestehende Startnachrichten, FIFO-Positionen,
   Primärstatus, geschlossene Gespräche, Engagements, Termine und
   Benachrichtigungstexte können normalisiert oder ergänzt werden. Deshalb sind
   eine isolierte Probe sowie ein passendes Write-Window erforderlich.
7. App und Datenbank müssen koordiniert ausgerollt werden. Alte Clients mit
   direkten Mutationen auf Profile, Jobs, private Jobdaten, Bewerbungen,
   Nachrichten, Meldungen, Guardian- oder Launch-Waitlist-Tabellen sind nach dem
   Rollout nicht mehr kompatibel und müssen die validierten RPCs verwenden.
8. Entfernte Legacy-RPCs wie `create_job_atomic`, `accept_applicant` und
   `confirm_job_agreement` sowie frühere Rollen- und Demo-Helfer dürfen von
   keinem verbleibenden Client mehr aufgerufen werden.
9. Ein einfaches Zurücksetzen des App-Commits ist kein Datenbank-Rollback. Die
   vollständige Rollout- und Wiederherstellungsstrategie steht in
   `docs/operations/database-rollout.md`.
10. Durch das Entfernen der eingebetteten Admin-, Staff-, Jury- und Demo-Bereiche
   sowie des alten Schema-Bootstraps ist dieser Release nicht rückwärtskompatibel
   zu Abläufen, die diese Oberflächen oder Bootstrap-Datei noch voraussetzen.

## Weiterführende Dokumentation

- `docs/architecture/activities-domain.md`: Fachmodell, Lifecycle,
  Berechtigungen, Realtime und Moderation.
- `docs/operations/database-rollout.md`: Ledger-Prüfung, Deployment-Gates,
  Smoke-Tests und Rollback-Strategie.
- `infrastructure/database/README.md`: Kanonische Migrationen, Prüfsummen und
  geschützte Daten.
