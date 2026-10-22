# Exklusive Jobreservierungen

Verbindlicher Zielablauf vom 23. Oktober 2026:

1. Ein offener Job kann von einer Person angefragt werden.
2. Die erste erfolgreiche Bewerbung reserviert den Job atomar. Der Vorgang und
   sein Chat dienen zunächst der Terminabstimmung.
3. Weitere Bewerbungen sind während dieser Reservierung gesperrt. Der Job
   erscheint nicht mehr in der Suche nach offenen Jobs.
4. Ablehnen oder Zurückziehen beendet das Gespräch und gibt den Job wieder
   frei. Es gibt kein Nachrücken und keine neue Job-Warteliste.
5. Eine bestätigte Terminvereinbarung startet die verbindliche Zusammenarbeit.
6. Abschluss archiviert den Vorgang. Eine Absage nach der Bestätigung wird als
   `cancelled` / `engagement_cancelled` gespeichert, nicht als abgelehnte oder
   zurückgezogene Bewerbung.

## Datenbankvertrag

Die additive Migration liegt unter
`infrastructure/database/migrations/20261022224929_exclusive_job_reservations.sql`.
Bestehende öffentliche RPC-Signaturen bleiben erreichbar. Ihre Implementierungen
liegen mit festem leerem `search_path` in `activity_private`; die öffentlichen
Funktionen sind SECURITY INVOKER. Anmelde-, Rollen-, Elternfreigabe- und
Teilnehmerprüfungen bleiben erhalten. Wiederöffnung prüft die aktuelle
Teilnahme ausdrücklich vor einer Antwort mit Vorgangsdaten.

Alle konkurrierenden Änderungen sperren zuerst den Job, danach die Bewerbung,
Öffnungsanfrage, Zusammenarbeit oder Termine. Dies gilt auch für die bestehende
Terminfunktion `manage_job_appointment`. Ein Unique-Index sichert zusätzlich
höchstens eine aktive Hauptbewerbung je Job. Neue Checks und ein Trigger
verhindern offene beziehungsweise neu angelegte Wartelisteneinträge.

Die öffentliche Job-SELECT-Regel für `open` und `reserved` bleibt erhalten,
damit Realtime einen Wechsel zu `reserved` auch an andere Suchende ausliefern
kann. Die eigentliche Jobsuche filtert strikt auf `open`. Bewerbungen,
Nachrichten und genaue Adressen bleiben unter ihren bisherigen Zugriffsregeln.
Ein veralteter Browser kann einen inzwischen reservierten Job nicht erneut
beanspruchen: Die Schreibfunktion prüft den Zustand unter der Job-Sperre.

Eine Wiederöffnung belegt ausschließlich einen freien Platz. Hat inzwischen
jemand anderes den Job reserviert oder verbindlich übernommen, bleibt das alte
Gespräch geschlossen. Eine Öffnungsanfrage kann diesen Schutz nicht umgehen.
Ein zurückgenommener Abschluss stellt die bestehende Zusammenarbeit derselben
Person wieder her. Eine zuvor abgesagte Zusammenarbeit beginnt beim erneuten
Öffnen mit einer Reservierung und braucht eine neue Terminbestätigung.

Ablehnen benötigt keinen eingegebenen Grund. Die Datenbank setzt bei leerem
Grund sachliche Standardtexte entsprechend dem aktuellen Zustand. Beide Rollen
können eine verbindliche Zusammenarbeit absagen. Wiederholte eigene
Ablehnungen, Rücknahmen und Absagen sind idempotent und öffnen keinen inzwischen
anderweitig reservierten Job.

## Bestand und Demo

Die Migration löscht keine Bewerbung oder Nachricht. Noch offene historische
Wartelisteneinträge werden mit derselben ID als geschlossen archiviert und
bekommen den eigenen Systemabschluss `waitlist_retired` plus Auditereignis.
Es erfolgt keine Zusage und niemand rückt nach. Verbindliche Zusagen,
abgeschlossene Vorgänge sowie die separate Onboarding-/Stadt-Warteliste bleiben
erhalten. Historische Positionsfelder bleiben vorerst als Auditinformation
bestehen; sie steuern keine neue Warteliste.

Das lokale Demo-Setup lädt dieselbe Vorwärtsmigration vor der bestehenden
Isolationsschicht. Seine Beispieldaten zeigen offene Jobs, Reservierungen,
Zusammenarbeiten, abgeschlossene Vorgänge und frühere Ablehnungen. Sie legen
keine neuen Wartelisteneinträge mehr an. Die bestehende Demo wird nicht
automatisch zurückgesetzt oder mit einer veränderten Prüfsumme überschrieben.

## Isolierte Prüfung mit echten Paralleltransaktionen

Die Laufzeit wird außerhalb des Produktpakets installiert:

```sh
npm install --prefix /tmp/workfare-reservation-validation --no-audit --no-fund embedded-postgres@17.10.0-beta.17 pg@8.16.3
WORKFARE_EMBEDDED_PG_MODULE=/tmp/workfare-reservation-validation/node_modules/embedded-postgres/dist/index.js node scripts/database/test-reservations.mjs
```

Der Runner erzeugt einen eigenen kurzlebigen PostgreSQL-17-Cluster in einem
neuen temporären Ordner, bindet ausschließlich an `127.0.0.1` und verwendet
zufällige Zugangsdaten. Er nimmt keine Datenbank-URL an, legt keinen Systemuser
an, verändert keine vorhandene Datenbank und räumt seinen Cluster anschließend
auf. Es entsteht keine Abhängigkeit im Produktpaket.

Die Prüfung verwendet getrennte PostgreSQL-Verbindungen und hält jeweils eine
Transaktion offen, bis die zweite Verbindung nachweislich auf einer Datenbank-
Sperre wartet. Abgedeckt sind Claim gegen Claim, Wiederöffnung gegen Claim,
Ablehnen gegen Terminbestätigung und Terminbearbeitung in beiden Reihenfolgen,
Rückzug gegen neuen Claim sowie die Annahme einer Öffnungsanfrage gegen einen
neuen Claim. Sie prüft außerdem Rollen, Teilnehmer-RLS, archivierte Verläufe,
die Schließung offener Terminvorschläge, Absage- und Wiederöffnungsstatus und
die Verhinderung doppelter aktiver Bewerbungen.

Der PostgreSQL-Vertragstest ersetzt keinen End-to-End-Lauf mit Supabase Auth,
Realtime, Browserzuständen und der tatsächlichen Demo-Isolation.

## Ausgeführte Freigabe

Die Migration ist in der angebundenen Produktionsdatenbank als
`20261022224929_exclusive_job_reservations` eingespielt. Anschließend wurden
die Constraints, Funktionsrechte und Anmeldesperren direkt geprüft. Es gibt
keine offene Job-Warteliste, doppelte aktive Reservierung oder aktive Bewerbung
ohne Hauptzuordnung. Prüfsummen der bestehenden Jobs, Bewerbungen, Nachrichten,
Termine und Zusammenarbeiten sind vor und nach der Migration identisch.

Der aktuelle Quellstand besteht den Produktionsbuild, 533 Projektprüfungen,
94 PostgreSQL-Reservierungsprüfungen mit neun nachgewiesenen Sperrkonflikten
und 38 bestehende Terminprüfungen. Die Oberflächen wurden mit echten Komponenten
und isolierten Antworten in 38 Browserfällen sowie vier Rollen-Galerien auf
Desktop und Mobilgerät geprüft. Das ist kein Test einer echten Bewerbung mit
Produktionskonten. Die genannten Prüfbelege betreffen den lokalen Frontendstand;
eine Veröffentlichung des Frontends wird damit nicht belegt.
