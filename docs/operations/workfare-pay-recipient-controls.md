# Empfänger: Browser-Fallback und Auszahlungssteuerung

Historische Grundlage des Testbetriebs. Die aktuelle monatliche Auszahlung und der ausdrücklich bestätigte Einzelauftrag stehen unter [Abschluss und Bankauszahlung](workfare-pay-completion-payouts.md).

Stand: 24.10.2026. Implementiert ist ausschließlich der bereits begrenzte lokale Stripe-Sandboxbetrieb. Diese Ergänzung aktiviert weder einen Live-Modus noch eine manuelle Auszahlung und ersetzt keine Freigabe des deutschen Jugendjob-/Zahlungsmodells.

## Einrichtung im normalen Browser fortsetzen

`POST /api/payments/recipient/hosted` akzeptiert `{consent:true, returnTo?: string|null}` und optional einen UUID-`Idempotency-Key`. `returnTo` darf ausschließlich der vorhandene exakte Rückweg `/app-home/jobs?job=<UUID>` sein. Ein bestehendes eigenes Empfängerkonto ist zwingend; der Endpoint legt weder ein Konto an noch eine Kohorte an. Die private Datenbankfunktion prüft erneut die aktive synthetische Adult-Persona und die explizite Sandboxkohorte. Anschließend prüft der Adapter frisch die Accounts-v2-Kontozuordnung, Testmodus, Empfängerkonfiguration, Deutschland, natürliche Person und das vereinbarte Plattformmodell.

Der Server erstellt einen offiziellen Accounts-v2-AccountLink mit `use_case.type=account_onboarding`, `collection_options.fields=currently_due` und `future_requirements=omit`. Antwort: `{kind:'sandbox',url,expiresAt,requiresExternalBrowser:true}`. Die Antwort bleibt `no-store`. Nur eine kurzlebige HTTPS-URL auf `connect.stripe.com/setup/` wird akzeptiert. Sie ist ein Einmal-Zugang zum eigenen Konto und darf weder in Logs, Analytics noch dauerhaftem Browserspeicher landen.

Ein zehn Minuten gültiges, zweckgebunden signiertes HttpOnly-/SameSite-Lax-Cookie bindet die vorherige ausdrückliche Zustimmung an Auth-Nutzer, Hash der Kontozuordnung und erlaubten Rückweg. `GET /api/payments/recipient/hosted/refresh` authentifiziert erneut, prüft die gleiche aktuelle Zuordnung und erstellt nur innerhalb dieses ursprünglichen Fensters einen Ersatzlink. Der Refresh verlängert die Zustimmung nicht. Stripe darf den Endpoint durch eine normale Navigation aufrufen; ein browserseitiger Cross-Site-Fetch wird abgewiesen. Nach Ablauf beginnt der Nutzer mit einer neuen bewussten Aktion.

Rückkehrziel ist immer die lokale Workfare-Pay-Seite mit `recipientHosted=returned`, gegebenenfalls ergänzt um den erlaubten Jobrückweg. Dieses URL-Merkmal ist **kein Erfolgsnachweis**. Nur ein tatsächlicher serverseitiger Stripe-Abgleich darf den gespeicherten Status ändern; eine Bewerbung erfolgt anschließend weiterhin bewusst.

Stripe Hosted Onboarding unterstützt normale Webbrowser, ausdrücklich keine eingebetteten WebViews in Desktop-/Mobil-Apps. Der Ausweichweg ändert diese Browseranforderung nicht. Ein Authentifizierungsfenster bleibt erforderlich, wenn Stripe es verlangt. Es werden keine Authentifizierungsprüfungen abgeschaltet. [Stripe Hosted Onboarding](https://docs.stripe.com/connect/hosted-onboarding), [installierter offizieller Stripe-Node-SDK](https://github.com/stripe/stripe-node).

## Tatsächliche Auszahlungsmöglichkeiten anzeigen

`GET /api/payments/recipient/payouts` liefert ausschließlich dem angemeldeten eigenen Adult-Sandboxempfänger:

- `kind:'sandbox'`, `currency:'eur'`, `availableCents` und `pendingCents` aus einer neuen Stripe-Balance-Abfrage;
- `schedule:'daily'|'weekly'|'monthly'|'manual'|'unknown'` aus der Balance Settings API mit explizitem Connected-Account-Kontext;
- `stripePayoutsEnabled`, ein frisch geprüftes `hasPayoutMethod` und `checkedAt`;
- derzeit immer `canRequestPayout:false`, `canRetainBalance:false`, `maxHoldingDays:90`;
- den zutreffenden Grund `recipient_setup_required`, `currency_not_supported` oder `retention_monitor_required`.

Es werden keine PSP-IDs, IBANs, Personendaten oder Geheimnisse zurückgegeben. Verfügbare und vorgemerkte Beträge werden getrennt; negative Salden bleiben sichtbar. Fremdwährungen werden nicht in einen Eurobetrag umgerechnet. Fehler führen zu einer Fehlermeldung, niemals zu einem erfundenen Nullsaldo. Der Endpoint akzeptiert keine Zielkonto-ID, Währung, Betrags- oder Erfolgsparameter und besitzt keine POST-Aktion.

Die vorhandenen eingebetteten Saldo-/Verlaufskomponenten bleiben ebenfalls ohne Standard-/Sofortauszahlung und ohne Bearbeitung des Auszahlungsplans. Kein neuer Endpoint erstellt einen Payout oder verändert den Plan. Deshalb wird kein konkurrierender Saldo-Schnappschuss als Auszahlungszusage verwendet und kein wiederholbarer HTTP-Aufruf kann Geld auslösen.

## Technische Möglichkeit und derzeitige Sperre

Stripe unterstützt Standardauszahlungen über die eingebettete `payouts`-Komponente. Eine frei wählbare Standardauszahlung verlangt jedoch einen Auszahlungsplan mit `interval=manual`; `standard_payouts` und `edit_payout_schedule` sind gesonderte Berechtigungen. Für Accounts v2 wird der Plan über die **Balance Settings API** verwaltet. Die Payouts API bewegt Gelder vom Guthaben des verbundenen Kontos auf dessen externes Auszahlungskonto; sie ist keine Überweisung zwischen Plattform und Empfänger. [Embedded Payouts](https://docs.stripe.com/connect/supported-embedded-components/payouts?platform=web), [Auszahlungsplan](https://docs.stripe.com/connect/manage-payout-schedule).

In Deutschland dürfen manuell zurückgehaltene Gelder laut Stripe höchstens **90 Tage** auf dem verbundenen Konto verbleiben. Stripe bietet damit keinen Treuhand-/Escrow-Dienst an. Vor einer Aktivierung fehlen insbesondere ein tatsächlich laufender, überwachter Fristwächter mit Alterszuordnung der gehaltenen Gelder, Wiederholungs-/Ausfallbehandlung, rechtzeitiger erzwungener Auszahlungs- oder Rückfallregel, Auditspur und verantwortlicher Betriebsfreigabe. Ein Konfigurationsschalter oder ein Hinweistext ersetzt diesen Betrieb nicht. Deshalb wird derzeit weder automatisch auf `manual` umgestellt noch eine nutzbare Betragwahl behauptet. Ein bereits extern gesetzter manueller Plan wird wahrheitsgemäß angezeigt und nicht heimlich geändert. [Stripe Manual Payouts](https://docs.stripe.com/connect/manual-payouts).

Bei einer späteren freigegebenen Umsetzung darf ausschließlich der dann tatsächliche verfügbare Gesamtsaldo der richtigen Währung ausgezahlt werden. Vorgemerkte Beträge sind ausgeschlossen. Stripe muss die endgültigen Betragsgrenzen, verfügbare Mittel und konkurrierende Payouts atomar prüfen. Falls dafür eine eigene Payout-API statt Stripe-Komponenten entsteht, benötigt sie zusätzlich dauerhaft gespeicherte ownergebundene Operationen, feste unveränderliche Parameter, Idempotenz und eine Wiederherstellung unklarer Providerergebnisse; ein abgelaufener Stripe-Idempotenzschlüssel darf keine neue Doppelzahlung auslösen. Diese noch fehlende Operation wird nicht durch einen vorbereitenden Button ersetzt.

Die technische Unterstützung bedeutet keine regulatorische, vertragliche oder arbeitsrechtliche Freigabe. Vor Produktion bleiben unter anderem Plattformmodell, Gebühren, Verbraucherinformationen, Minderjährigen-/Elternmodell, Erstattungen, negative Salden, Datenschutz, Stripe-Verträge und zulässige Zahlungsabwicklung gesondert zu klären. Es gibt keine Umleitung minderjähriger Vergütungen auf Elternkonten und keine Zusage eines Workfare-Bankkontos. Im aktuellen Testbetrieb wird ausschließlich das eigene Stripe-Testguthaben angezeigt.
