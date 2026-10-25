# Produktplanung und aktueller Fokus

Stand: **24.10.2026**. Aktiver Arbeitsbereich ist **Workfare Pay**. Die übrigen Produktideen sind festgehalten und werden anschließend in abgegrenzten Paketen priorisiert. Dieses Dokument ist keine Freischaltung oder Zusage bereits verfügbarer Funktionen.

**Aktuelle Ergänzung vom 25.10.2026:** [Workfare Plan und Treueprogramm](workfare-plan-and-loyalty.md) hält den neuen optionalen Monatstarif, Gebühren, Preisbeispiele und priorisierte nächste Funktionen fest. [Der Release-Nachweis](../releases/2026-10-25-workfare-plan.md) trennt vorbereitete Funktionen von der tatsächlichen Freischaltung.

**Spätere Freischaltung:** Nach bestätigter deutscher Regelbesteuerung sind Workfare Plan und der neue Bruttotarif seit 25.10.2026, 15:13:03 MEZ tatsächlich aktiv. Der [DE-19-%-Freigabenachweis](../releases/2026-10-25-workfare-plan-vat-release.md) ersetzt den früheren offenen Steuerstatus; bestehende Jobs behalten ihre Preise.

**Bisherige Ergänzung vom 25.10.2026:** Der folgende Einführungsplan ist historischer Stand. Für den aktuellen Zahlungs-/Auszahlungsbetrieb gelten die [Betriebsbeschreibung](../operations/workfare-pay-completion-payouts.md) und die [Release-Nachweise](../releases/2026-10-25-pay-account-refinement.md). Die neue [Konten- und Kartenplanung](workfare-account-card.md) beschreibt ein optionales zukünftiges Produkt mit lizenziertem Partner; sie aktiviert weder Konto noch Karte. Ein höherer allgemeiner Gesamttarif wird [zunächst kalkuliert](payment-provider-comparison.md#7-neue-preisentscheidung-vom-25102026), nicht stillschweigend eingeführt.

## Verbindlich festgehaltene Produktentscheidungen

| Thema | Entscheidung |
| --- | --- |
| Name | Das Zahlungsprodukt heißt **Workfare Pay**. Die bestehende Plattformmarke Workfare wird dadurch nicht umbenannt. |
| Zahlungsanbieter | Stripe Connect ist der Ausgangspunkt für die erste technische Vorbereitung und den isolierten Testbetrieb. Der Anbieter-/Kostenvergleich bleibt als Entscheidungsnachweis erhalten. |
| Registrierung | Ein Konto entsteht zunächst ohne Zahlungsdaten. Anmeldung, Profilpflege und normale App-Nutzung bleiben möglich. |
| Veröffentlichungsbereitschaft | Ein Jobanbieter hinterlegt vor Veröffentlichung ein Zahlungsmittel. Die vorhandene Adressprüfung bleibt getrennt bestehen; bei einer späteren Umsetzung müssen Oberfläche, Server und Datenbank dieselben Regeln durchsetzen. |
| Ausweisprüfung | Für Zahler nur bei konkret festgestelltem Bedarf. Eine hinterlegte Karte oder Rechnungsadresse wird nicht als bestätigte Identität ausgegeben. Gesetzliche Empfänger-/PSP-Prüfungen bleiben davon unabhängig. |
| Käufer und Empfänger | Ein Zahler braucht einen Kundenzahlungsablauf, kein Connect-Auszahlungskonto. Empfänger durchlaufen die separat freizugebende Auszahlungseinrichtung. Elternverknüpfung allein erzeugt keine finanzielle Vertretung. |
| Verdienst | Jugendliche erhalten die volle vereinbarte Vergütung. Anbieter bezahlen zusätzlich eine allgemeine, vorab verständliche Servicegebühr. |
| Wirtschaftliches Ziel | Etwa 5 % der Jobvergütung als Beitrag nach direkten Zahlungskosten. Kein festgelegter Gebührensatz und kein garantierter Gewinn nach Betrieb, Ausfällen und Steuern. |
| PayPal | Gewünschte Zahlart auf Käuferseite, unabhängig vom Empfängerbankkonto. Marktplatzfreigabe und Methodenablauf sind noch nicht bestätigt. |
| Produktplatzierung | Zahlung beim Auftrag/Termin und Verlauf unter Einstellungen → Zahlungen. Drei Haupttabs bleiben erhalten. |
| Freigabe | Technische Vorbereitung und Sandbox zuerst. Keine Echtgeldaktivierung, Minderjährigenfreigabe, Vertragsannahme oder Migration allein aufgrund dieses Plans. |

## Jetzt: Workfare Pay in kleinen, prüfbaren Schritten

1. **Grundlage:** getrennte Bereitschaftszustände, Geldbeträge in Cent, expliziter Gebühren-/Steuerstand und abgeschaltete Testkonfiguration. Keine Kartennummern oder Ausweisdokumente in unserer normalen Datenbank.
2. **Anbieter-Zahlungsmittel:** authentifizierte Stripe-Einrichtung ohne Jobbezahlung; eigener persistierter Test-Kundenbezug und signierte Ergebnisverarbeitung. Zurückkehren von Stripe ist kein Erfolgsbeweis.
3. **Veröffentlichung:** verständlicher Rückweg zum unversandten Jobentwurf; verbindlicher serverseitiger Check auch bei direktem RPC, Entwurfsveröffentlichung und erneutem Anbieten. Absage und Rückzug dürfen bei fehlendem Zahlungsmittel nicht scheitern.
4. **Empfänger:** zulässige Konten/Altersgruppen und Vertretungsnachweise mit Stripe klären; danach eingebettetes Connect-Onboarding und Auszahlungseinrichtung im Testbetrieb. Keine Elternkonto-Umgehung.
5. **Ein vollständiger Termin:** bestätigter Vergütungsstand → Zahlung bestätigen → Leistung abschließen → Einzug → Bankauszahlung; zusätzlich Absage, Erstattung, Dispute und Wiederholung testen. Finanzstatus bleibt vom Jobstatus getrennt.
6. **Echtbetrieb gesondert freigeben:** Betreiber-/Arbeitsmodell, Minderjährige, Gebühren, Verträge, Reserve, Support, Datenschutz und Steuerbetrieb tatsächlich abnehmen. Neue Bedingungen nicht rückwirkend auf alte Jobs anwenden.

Details stehen im [Implementierungsplan](workfare-pay-implementation.md) und im [fachlichen Zahlungsmodell](workfare-pay.md).

## Stand der lokalen Umsetzung

Unter Einstellungen → Workfare Pay sowie vor einer tatsächlichen Veröffentlichung sind die rollenabhängigen Einstiege implementiert. Ein neuer lokaler Entwurf wird vor dem Wechsel synchron gesichert; bestehende Entwürfe und archivierte Jobs werden mit ihren Änderungen nichtöffentlich gespeichert. Rückkehr veröffentlicht niemals automatisch. Die Datenbank schützt neue Veröffentlichungen und Wiederöffnungen; Absage/Rückzug bleibt auch nach Entzug eines Zahlungsmittels möglich.

Die kartendatenfreie lokale Simulation persistiert Einrichtung, Abbruch, Rückkehr und Entfernung. Daneben existiert ein getrennter Stripe-Testadapter mit Checkout `mode=setup`, Eigentümer-/Objektprüfung und signiertem Webhook. Ersetzungen, wiederholte Events und ausstehende Entfernungen bleiben durch Generationen, Sperren, eine wiederholbare Warteschlange und dauerhafte Detach-Marker konsistent. Die Centrechnung hält vereinbarte Vergütung, explizite Gebühr, Steuerbehandlung und direkte Kosten getrennt; daraus entsteht noch kein Zahlungsauftrag.

Geprüft am 24.10.2026: **1.117 automatisierte Tests**, TypeScript, Produktionsbuild und Sicherheitsprüfung erfolgreich. ESLint: null Fehler und 42 vorhandene Warnungen; neue Payment-Dateien ohne Warnungen. Die Datenbank wurde zusätzlich mit echten PostgreSQL-Aufrufen und beobachteten Sperrrennen geprüft. Die endgültige Zahl dieser separat ausgeführten Prüfungen steht im [lokalen Betriebsablauf](../operations/workfare-pay-local.md).

Nur die verifizierte lokale Demo wurde vorwärts migriert. Das Veröffentlichungs-Gate gilt dort für explizit eingeschaltete synthetische Anbieter; normale Demo-Besucher werden nicht eingeschlossen. Außerhalb der isolierten lokalen Umgebung bleiben diese Testmodi gesperrt. Keine Produktionsmigration, keine Stripe-Konfigurationsänderung und keine tatsächlichen Stripe-Aufrufe wurden ausgeführt. Der Hosted-Checkout-Adapter ist ohne freigegebene Sandbox-Zugangsdaten noch nicht praktisch gegen Stripe getestet.

Noch nicht implementiert: Empfänger-/Vertreter-Onboarding, tatsächlicher Einzug, Belege/Ledger, Erstattungen, Disputes, Transfers und Bankauszahlungen. Helfer und Eltern sehen deshalb keinen vorgetäuschten Einrichtungsabschluss. Diese Teile folgen als gesonderte Pakete nach der passenden Modell- und Methodenfreigabe; es gibt keinen Echtgeldmodus.

## Später: aufbewahrter Funktionsbacklog

| Funktion | Vorgesehener Ort | Voraussetzung |
| --- | --- | --- |
| Vollständige berechtigte Elternübersicht je Kind | Jobs-Tab der Elternrolle; Einstellungen/Familie | Klare Lese-/Handlungsrechte, Widerruf und Volljährigkeitsübergang. Keine pauschale Chatfreigabe |
| SMS für ausgewählte wichtige Ereignisse | Einstellungen/Benachrichtigungen | Verifizierte Telefonnummer, bewusste Kanalwahl, Versandprovider, Kosten-/Häufigkeitsgrenzen |
| Push auf dem eigenen Gerät | Einstellungen/Benachrichtigungen | Geräteregistrierung, Zustimmung, Abmeldung und echte Zustellprüfung |
| E-Mail-Zusammenfassungen | Benachrichtigungseinstellungen | Verifizierte Adresse, Präferenzen und betreuter Zustellprozess |
| Persönliche Vorteile | Einstellungen/Vorteile | Finanziertes Rabattmodell und verlässliche abgeschlossene Zahlungen samt Rückabwicklung |
| Freunde und Empfehlungen | Einstellungen/Freunde, Einladungslink | Beidseitige Zustimmung, Blockieren, Minderjährigenschutz und getrennte Bonusqualifikation |
| Komfort, Firmen und weitere Regionen | Bestehende Job-/Profil-/Einstellungsbereiche | Stabiler Kern und belegter Bedarf; eigene Freigabe je Ausbaupaket |

Die [23 Produktfunktionen](feature-overview.md) enthalten Nutzen und Einbauort. Der [98-Punkte-Detailkatalog](platform-roadmap.md) enthält technische Abhängigkeiten und Abnahmen. Sicherheits- und Betriebsaufgaben, die Workfare Pay benötigt, werden mit dem Zahlungspaket erledigt; sie sind keine auf unbestimmte Zeit verschobenen Voraussetzungen.

## Dokumente

- [Workfare Plan, transparente Gebühren und Treueprogramm](workfare-plan-and-loyalty.md)
- [Workfare Konto und eigene Karte: Partner, Jugendmodell und Ablauf](workfare-account-card.md)
- [Workfare Pay: konkreter Implementierungsplan](workfare-pay-implementation.md)
- [Workfare Pay: fachlicher Geldfluss und Freigaben](workfare-pay.md)
- [Anbieter- und Kostenvergleich mit Rechenbeispielen](payment-provider-comparison.md)
- [Nutzerfunktionen im Überblick](feature-overview.md)
- [Technischer Detailkatalog](platform-roadmap.md)
