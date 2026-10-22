# Einfache Jobreservierung

Produktentscheidung vom 23. Oktober 2026: Die erste Bewerbung reserviert den Job exklusiv. Es gibt keine Job-Warteliste und kein automatisches Nachrücken. Die regionale Freischaltung im Onboarding ist ein eigener Ablauf.

## Status und nächste Handlung

| Job | Bewerbung | Sichtbar im Marktplatz | Nächster Schritt |
| --- | --- | --- | --- |
| Offen | Noch keine aktive Bewerbung | Ja | Jobsuchende Person bewirbt sich. |
| Reserviert | Reserviert, primäres Gespräch offen | Nein | Beide stimmen den Termin ab. Der Anbieter kann die Bewerbung ablehnen und den Job freigeben. |
| Vergeben | In Zusammenarbeit, Termin bestätigt | Nein | Auftrag durchführen; Termine bei Bedarf bearbeiten oder neu vereinbaren. |
| Geschlossen | Abgeschlossen | Nein | Verlauf im Archiv lesen. |

„Reserviert“ ist eine exklusive Vormerkung. Erst die Terminbestätigung des Anbieters startet die verbindliche Zusammenarbeit. Jobsuchende behalten währenddessen ein direktes Gespräch zu ihrem Vorgang. Anbieter öffnen die reservierte Person direkt aus „Meine Jobs“.

## Freigeben und Wiederöffnen

Der Anbieter darf die reservierte Bewerbung ohne Pflichtbegründung ablehnen. Ein freiwilliger kurzer Hinweis bleibt möglich. Die jobsuchende Person darf ihre Bewerbung zurückziehen. In beiden Fällen schließen Bewerbung und Gespräch, und der Job wird in derselben Transaktion wieder offen. Niemand rückt nach.

Eine laufende Zusammenarbeit wird ausdrücklich abgesagt; dabei werden vorhandene Termine und offene Terminänderungsanfragen geschlossen. Der Verlauf bleibt erhalten. Ein abgeschlossener Auftrag und ein abgelehnter beziehungsweise zurückgezogener Vorgang sind klar unterscheidbar.

Eine Wiederöffnung darf einen inzwischen reservierten oder vergebenen Job niemals übernehmen. Berechtigung, aktueller Jobstatus und konkurrierende Reservierungen werden beim Ausführen erneut geprüft. Der aktuelle Gesprächsverlauf wird wiederverwendet; es entsteht keine zweite Bewerbung derselben Person auf denselben Job.

## Datenbankvertrag

Bewerbung und Reservierung bilden eine atomare Operation. Bei zwei gleichzeitigen Bewerbungen gewinnt genau eine; die andere erhält den Hinweis auf die bestehende Reservierung. Job- und Bewerbungszeilen werden in einheitlicher Reihenfolge gesperrt. Ein eindeutiger Index und zusätzliche Statusgrenzen sichern genau eine aktive primäre Bewerbung pro Job. Direktes Anlegen neuer Wartelisteneinträge ist gesperrt.

Vorhandene offene Wartelisteneinträge werden geschlossen archiviert, ohne Nachrichtentexte, IDs oder frühere Ereignisse zu löschen und ohne jemanden anzunehmen. Bestätigte Zusammenarbeiten bleiben bestehen. Alte Wartelistenfelder und Enumwerte bleiben vorerst ausschließlich für historische Daten und Kompatibilität erhalten. Benachrichtigungseinstellungen bieten keine neue Job-Wartelistenoption mehr an.

## Prüfungen

Zu prüfen sind beide Rollen, normale Bewerbung, gleichzeitige Bewerbung, Ablehnen/Freigeben, Rückzug, Terminbestätigung, Terminänderungen, Absage, Abschluss, Wiederöffnen gegen einen freien und gegen einen bereits reservierten Job sowie gesperrte Zugriffe fremder Personen. Browserprüfungen verwenden synthetische Daten. Produktionsmigration und tatsächliche Datenbestände werden separat überprüft.
