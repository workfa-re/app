# Workfare

Webplattform für lokale Alltagshilfe und Taschengeldjobs. Jobsuchende von 14 bis 20 Jahren und private oder gewerbliche Jobanbieter nutzen dieselben drei Bereiche: Jobs, Nachrichten und Einstellungen.

## Aktueller Produktstand

- Die erste erfolgreiche Bewerbung reserviert einen offenen Job atomar. Ein Anbieter kann die Zusammenarbeit ablehnen; der Job wird wieder verfügbar. Es gibt keine neue Jobwarteliste und kein automatisches Nachrücken.
- Reservierung, Vereinbarung, einzelne Termine und Abschluss bleiben nachvollziehbare Zustände. Die Datenbank prüft die folgenreichen Übergänge; die Oberfläche ersetzt diese Prüfungen nicht.
- Ein Gespräch ist der gemeinsame Ort für Nachrichten, Terminabsprachen, Auftragsdetails und Meldungen. Profile verwenden eine gemeinsame öffentliche Ansicht mit begrenzter Datenprojektion.
- Anbieter benötigen für die Joberstellung einen bestätigten Prüfstatus und den zugehörigen Prüfzeitpunkt. Das neue Elternmodell verlangt für Minderjährige eine ausdrücklich erteilte aktuelle Zustimmung; Volljährige benötigen keine Elternfreigabe. Die Umstellung wird über eine geprüfte Schema-Bereitschaft ausgerollt.
- Das Benachrichtigungszentrum verwendet gespeicherte, empfängergebundene Ereignisse. Interne Prioritäten sind vorbereitet. Die externe Zustellung über Push, SMS und weitere E-Mail-Abläufe ist separat zu implementieren und freizuschalten.
- Workfare Pay bündelt Zahlungsmittel, eigene Belege/Rechnungsdaten sowie Auszahlungseinrichtung und Kontoverwaltung in den Einstellungen. Einrichtung, Veröffentlichung, Reservierung und tatsächliche Zahlungen haben getrennte serverseitige Freigaben. Die isolierte Simulation und Stripe-Sandbox bleiben vom zusätzlichen Live-Modus getrennt. Terminzahlungen unterstützen bestätigte Vergütung, Kartenautorisierung, ausdrücklichen Einzug, Storno und vollständige Erstattung. Der Live-Tarif weist 5 % zusätzlich zur vollständigen Vergütung aus; er übernimmt keine simulierte Steueraufteilung. Eine Installation aktiviert keine Zahlungen. Den tatsächlichen Produktionsstand und die verbleibenden Voraussetzungen dokumentiert der [Betriebsplan](./docs/operations/workfare-pay-production.md).
- Die persönliche Finanzübersicht trennt bestätigten Verdienst, verfügbare und ausstehende Stripe-Beträge sowie Bankauszahlungen. Eigene Statistiken sind auch vor der Auszahlungseinrichtung sichtbar. Fehlende Salden bleiben unbekannt; Minderjährigenstatistiken schalten keine Bankauszahlung frei. Die Startseite zeigt den eigenen bestätigten Verdienst und führt zur selben Zahlungsverwaltung.
- Minimaleltern erhalten zunächst ausschließlich Familienzugang. Der eigene vollständige Privat-Anbieterzugang wird ausdrücklich im bestehenden Onboarding ergänzt; Name, Geburtsdatum und Familiennachweise bleiben erhalten. Die Anmeldung unterstützt E-Mail-Code und ein freiwillig selbst gewähltes Passwort nach frischer Bestätigung. Treueprogramm, weitere Elternfunktionen, SMS und Freundeseinladungen bleiben im Backlog.

Der Chat verwendet HTTPS-Transportverschlüsselung. Eine Ende-zu-Ende-Verschlüsselung ist nicht implementiert. Eine gespeicherte Elternverknüpfung belegt den technischen Freigabeprozess; sie ist keine allgemeine Zusage rechtlicher Zulässigkeit eines Jobs.

## Technik

Next.js App Router, React, TypeScript, Supabase Auth/PostgreSQL/Realtime, Tailwind CSS und Framer Motion. Die verbindlichen Paketversionen stehen in [package.json](./package.json) und [package-lock.json](./package-lock.json).

Authentifizierte Serverdaten werden pro Request geteilt. Private Kontodaten dürfen weder global noch zwischen Nutzern gecacht werden. Datenbankzugriffe laufen mit den Berechtigungen der Sitzung; privilegierte Moderation und externe Zustellworker bilden eigene Grenzen.

## Lokal entwickeln

```sh
npm ci
npm run dev
```

Der Entwicklungsserver läuft standardmäßig auf `http://localhost:3000`. Es wird eine autorisierte Entwicklungs- oder Testumgebung benötigt. Die öffentliche Supabase-URL und der öffentliche Client-Schlüssel werden über `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` konfiguriert. Weitere serverseitige Werte gehören ausschließlich in die dafür vorgesehenen Umgebungen; niemals in Clientcode oder Git.

Für schreibende Tests eine isolierte Umgebung verwenden. Eine lokale Oberfläche kann sonst weiterhin mit einer produktiven Datenbank verbunden sein. Eine Vorschau mit synthetischen Daten ist kein Nachweis eines erfolgreichen Produktionsablaufs.

## Prüfungen

```sh
npm run test:all
npm run lint
npm run typecheck
npm run build
npm run security:audit
```

Verhaltensänderungen zusätzlich mit den betroffenen Rollen und Zuständen prüfen. Bei UI-Änderungen gehören mobile Breiten, helle/dunkle Darstellung, Tastaturbedienung und Fehlerzustände dazu. Echte Zahlungen, Nachrichten oder Kontoänderungen sind keine beliebigen Smoke-Tests.

## Dokumentation

| Thema | Dokument |
| --- | --- |
| Aktiver Fokus Workfare Pay und aufbewahrter Backlog | [Planungsindex](./docs/planning/README.md) |
| Registrierung, Stripe-Einrichtung und Chat-Integration | [Workfare Pay umsetzen](./docs/planning/workfare-pay-implementation.md) |
| Die nächsten Nutzerfunktionen, zuerst Elternansicht und Zustellung | [Feature-Übersicht](./docs/planning/feature-overview.md) |
| Zahlungsmodell einfach erklärt, Kosten und Anbieter | [Zahlungsanbieter-Vergleich](./docs/planning/payment-provider-comparison.md) |
| Technische Weiterentwicklung und Abhängigkeiten | [Detail-Roadmap](./docs/planning/platform-roadmap.md) |
| Zahlungsmodell und Freigaben | [Workfare Pay](./docs/planning/workfare-pay.md) |
| Technischer Durchgang vom 24.10.2026 | [Code-Audit](./docs/releases/2026-10-24-platform-code-audit.md) |
| Auftrags-, Chat- und Terminmodell | [Aktivitäten](./docs/architecture/activities-domain.md) |
| Exklusive Reservierung | [Reservierungsmodell](./docs/exclusive-job-reservations.md) |
| Benachrichtigungen und Zustellvorbereitung | [Benachrichtigungsmodell](./docs/architecture/notifications.md) |
| Datenbankänderungen | [Migrationskatalog](./infrastructure/database/README.md) und [Rollout](./docs/operations/database-rollout.md) |
| Lokale Payment-Vorschau und Prüfungen | [Workfare Pay lokal](./docs/operations/workfare-pay-local.md) |
| Nachweise und verbleibende Schritte für echte Zahlungen | [Workfare Pay Produktion](./docs/operations/workfare-pay-production.md) |
| E-Mail-Vorlagen | [E-Mail-Dokumentation](./infrastructure/email/README.md) |

Workfare Pay ist standardmäßig abgeschaltet. [`.env.payments.example`](./.env.payments.example) dokumentiert Modi, getrennte Freigaben und vier Webhook-Endpunkte. Private Schlüssel gehören ausschließlich in die Serverumgebung. Beide Testmodi verlangen die isolierte lokale Demo-Datenbank, eine Loopback-App-Origin und ausdrückliche Kohorten; ein Testschlüssel allein schaltet nichts frei. Der Live-Modus verlangt separat passende Live-Schlüssel, das bestätigte Plattformkonto und Produktionsprojekt sowie signierte HTTPS-Webhooks. Der ursprüngliche Offline-Client bleibt netzwerkfrei. Die [lokale Anleitung](./docs/operations/workfare-pay-local.md) beschreibt Simulation, Sandbox-Auswahl und sichere Listener. Fünf Prozent Brutto-Servicegebühr sind nach Abzug der Zahlungskosten weniger als fünf Prozent Plattformverdienst. Das Stripe-SDK benötigt Node.js 20 oder neuer; die bestehende CI verwendet Node.js 24.

Ältere Releaseberichte beschreiben ihren damaligen Stand. Für die heutige Reservierungslogik sind das aktuelle Domänenmodell und die nachfolgenden Migrationen maßgeblich.

## License and Legal Terms

> [!CAUTION]
> **STRICTLY PROPRIETARY AND CONFIDENTIAL**
>
> **Copyright (c) 2026 Rezan Aaron Yalçin. All rights reserved.**
>
> This software is governed by the **WORKFARE PROPRIETARY LICENSE**. No license is granted under any copyright, patent, trademark, trade secret, or other intellectual property right.
>
> You are explicitly forbidden to:
> - Copy, clone, mirror, or archive the Software.
> - Modify, adapt, or create derivative works.
> - Distribute, publish, sell, or use the Software in any commercial product or AI training dataset.
>
> **ENFORCEMENT**: The Licensor reserves the right to pursue all available legal remedies under the laws of the Federal Republic of Germany for any breach of these terms.
