# Workfare

Webplattform für lokale Alltagshilfe und Taschengeldjobs. Jobsuchende von 14 bis 20 Jahren und private oder gewerbliche Jobanbieter nutzen dieselben drei Bereiche: Jobs, Nachrichten und Einstellungen.

## Aktueller Produktstand

- Die erste erfolgreiche Bewerbung reserviert einen offenen Job atomar. Ein Anbieter kann die Zusammenarbeit ablehnen; der Job wird wieder verfügbar. Es gibt keine neue Jobwarteliste und kein automatisches Nachrücken.
- Reservierung, Vereinbarung, einzelne Termine und Abschluss bleiben nachvollziehbare Zustände. Die Datenbank prüft die folgenreichen Übergänge; die Oberfläche ersetzt diese Prüfungen nicht.
- Ein Gespräch ist der gemeinsame Ort für Nachrichten, Terminabsprachen, Auftragsdetails und Meldungen. Profile verwenden eine gemeinsame öffentliche Ansicht mit begrenzter Datenprojektion.
- Anbieter benötigen für die Joberstellung einen bestätigten Prüfstatus und den zugehörigen Prüfzeitpunkt. Bewerbungen setzen nach der aktuellen Produktregel eine aktive Elternfreigabe voraus; eine andere Regel für Volljährige ist eine gesonderte Produktentscheidung.
- Das Benachrichtigungszentrum verwendet gespeicherte, empfängergebundene Ereignisse. Interne Prioritäten sind vorbereitet. Die externe Zustellung über Push, SMS und weitere E-Mail-Abläufe ist separat zu implementieren und freizuschalten.
- Workfare Pay / JobBridge Pay, Treueprogramm und Freundeseinladungen sind Planungsgegenstände, keine fertigen Zahlungs- oder Sozialfunktionen. Das installierte Stripe-SDK ist keine aktive Zahlungsintegration.

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
| Weiterentwicklung und Prioritäten | [Plattform-Roadmap](./docs/planning/platform-roadmap.md) |
| Zahlungsmodell und Freigaben | [JobBridge Pay](./docs/planning/jobbridge-pay.md) |
| Technischer Durchgang vom 24.10.2026 | [Code-Audit](./docs/releases/2026-10-24-platform-code-audit.md) |
| Auftrags-, Chat- und Terminmodell | [Aktivitäten](./docs/architecture/activities-domain.md) |
| Exklusive Reservierung | [Reservierungsmodell](./docs/exclusive-job-reservations.md) |
| Benachrichtigungen und Zustellvorbereitung | [Benachrichtigungsmodell](./docs/architecture/notifications.md) |
| Datenbankänderungen | [Migrationskatalog](./infrastructure/database/README.md) und [Rollout](./docs/operations/database-rollout.md) |
| E-Mail-Vorlagen | [E-Mail-Dokumentation](./infrastructure/email/README.md) |

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
