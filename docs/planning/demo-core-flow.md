# Workfare: einfacher Kernablauf

Stand: 24. Oktober 2026. Dieser Plan hält den neuen Ablauf und seine Abnahme fest. Er ersetzt keine früheren Betriebsnachweise und behauptet keine erfolgreich getestete Echtgeldzahlung oder bestätigte deutsche Minderjährigenfreigabe durch Stripe.

## Ein Konto, klare nächste Schritte

| Person | Einstieg | Nötige Einrichtung | Weiterführung |
| --- | --- | --- | --- |
| Jobanbieter | Normale Registrierung | Profil und private Auftragsadresse im Onboarding; Zahlungsmittel vor der Veröffentlichung, das Veröffentlichungs-Gate ist aktiviert | Meine Jobs → Gespräch → Abschließen und bezahlen |
| Jobsuchende Person ab 18 | Normale Registrierung | Profil; Adresse bleibt optional; eigene Auszahlungseinrichtung über Stripe | Job reservieren → Termin vereinbaren → Vergütung bestätigen → Zahlungsstand ansehen |
| Jobsuchende Person von 14–17 | Normale Registrierung | Profil und ausdrückliche Elternfreigabe; eigene Bankverbindung direkt in Workfare Pay; erforderliche Stripe-Angaben der gesetzlichen Vertretung bleiben separat | Derselbe Job- und Gesprächsablauf; Freigabe und finanzielle Bereitschaft werden getrennt geprüft |
| Elternteil | Einladungslink → E-Mail und Passwort | Verifizierte eigene E-Mail; bekannte Angaben wiederverwenden, fehlenden Namen und echtes Geburtsdatum zusammen mit der ausdrücklichen Freigabe erfassen | Familienkonto; optional dasselbe Konto zum privaten Anbieterprofil vervollständigen |

Es gibt keinen getrennten Elternlogin. Eine Familienverknüpfung allein macht niemanden zum Jobanbieter. Eine hinterlegte Adresse oder Karte ist kein Ausweisnachweis. Für die Demo entfällt die manuelle Wartefreigabe der Anbieteradresse; daraus wird keine geprüfte Identität abgeleitet.

## Elternfreigabe ohne Auswahlwand

1. Die jugendliche Person erstellt ihren eigenen, befristeten Einladungslink.
2. Der Elternteil öffnet direkt die normale Anmeldung/Registrierung. Bestehende Konten können sich im selben Formular anmelden; E-Mail-Bestätigung und Passwortwiederherstellung erhalten den Rückweg zur Einladung.
3. Nach der Anmeldung folgt ein gemeinsames Formular: das konkrete Kind, gegebenenfalls fehlender Name/Geburtstag, Beziehung und eine zunächst nicht aktivierte Zustimmung. Der vollständige Erklärungstext bleibt vor dem Absenden aufklappbar.
4. Die Datenbank bestätigt die tatsächliche Person, das konkrete Kind, die aktuelle Erklärung und den gültigen Link. Erst danach erscheint die gespeicherte Freigabe.
5. Die Bestätigungsmail nennt das Kind, den Umfang, den privaten Widerrufslink und den normalen Zugang zur Familie. Der zufällige Beleg steht im URL-Fragment; die Datenbank speichert ausschließlich seinen Hash. Eine Wiederholung erzeugt keine zweite Erklärung oder Doppelmail.
6. Ein Versandfehler wird offen angezeigt und setzt eine bereits gespeicherte Freigabe nicht zurück. Widerruf bleibt im eigenen Familienkonto möglich. Ein alter Widerrufslink darf keine spätere neue Erklärung oder Freigabe eines anderen Elternteils aufheben.

Der Familienbereich zeigt nur berechtigte eigene Verbindungen. Die optionale spätere Anbieterregistrierung ergänzt dasselbe Konto und erhält die bisherigen Freigaben. Alte reine E-Mail-Freigaben und ihre Widerrufslinks bleiben kompatibel; sie konkurrieren nicht mehr als zusätzlicher Hauptweg mit der normalen Anmeldung.

## Workfare Pay und tatsächliche Stripe-Anforderungen

Workfare-Elternfreigabe und Stripe-Auszahlungsbereitschaft sind unterschiedliche Zustände. Der eingebettete Stripe-Bereich bleibt innerhalb des Workfare-Layouts und übernimmt vorhandene, tatsächlich bekannte Angaben. Er fragt zunächst die aktuell erforderlichen Informationen ab. Diese Begrenzung beseitigt keine Identitäts-, Vertrags- oder späteren Nachweispflichten: Stripe beschreibt hierfür ein [schrittweises Onboarding](https://docs.stripe.com/connect/marketplace/tasks/onboard) und die [erforderlichen Verifizierungsinformationen](https://docs.stripe.com/connect/required-verification-information).

Für Minderjährige bleibt die konkrete Konfiguration in Deutschland mit Stripe zu bestätigen: zulässiges Konto-/Vertretermodell, wer die Bedingungen annimmt und auf wessen Bankkonto ausgezahlt werden darf. Die vorbereitete Supportanfrage wird vom Betreiber versendet. Die eigene Bankverbindung kann bereits über ein eingebettetes Stripe-IBAN-Feld hinterlegt werden. Das allein bedeutet keine Freigabe von Zahlungen oder Auszahlungen; ein Ablauf mit garantiert ausschließlich einer IBAN oder ohne möglichen Ausweisnachweis wird nicht versprochen. Die implementierten Prüfungen dürfen keine falschen Altersdaten, stellvertretend angenommene Bedingungen oder ein Erwachsenenkonto als Ersatz für das Konto des Kindes verwenden.

Jugendliche hinterlegen ihr Bankkonto im eigenen Workfare Pay. Das IBAN-Feld gehört Stripe; die Anwendung erhält ausschließlich einen einmal verwendbaren Bank-Token. Der Server prüft den angemeldeten Jugendlichen, die aktuell gültige Elternfreigabe, den gebundenen Empfänger sowie Modus, Typ und Währung des Tokens. Die erste Bankverbindung wird idempotent gespeichert; bestehende Banken werden über diesen Schritt nicht ersetzt. Eine verlorene Antwort wird mit demselben Token und Vorgang abgeglichen. Bank hinterlegt und Auszahlung bereit sind getrennte Zustände. Benötigte Angaben des Elternteils erscheinen als eigener nächster Schritt. Im Familienbereich steht die erteilte Genehmigung im Vordergrund. Unter „Auszahlung begleiten“ öffnet „Auszahlung freigeben“ ein kurzes Workfare-Formular. Eltern brauchen keinen eigenen Stripe-Zugang; die eigene Bankverbindung bleibt beim Jugendlichen.

Die Zahlungsvertretung wird direkt in Workfare bestätigt: tatsächliche bekannte Namen und Geburtsdaten anzeigen, nur aktuell von Stripe benötigte Anschriften ergänzen und die Stripe-Vereinbarung ausdrücklich neu annehmen. Die alte Workfare-Erlaubnis umfasst diese Vertragsannahme nicht. Die erste echte Annahme bleibt mit Vorgang, unveränderter Eltern-/Kind-/Consent-Zuordnung, Annahmedatum, IP, Browserkennung und Hash des bestätigten Inhalts in einer privaten Audit-Tabelle erhalten. Rohadressen werden dort nicht gespeichert. Verlorene Antworten verwenden dieselbe Annahme; parallele Änderungen und widerrufene Freigaben sperren weitere Schreibvorgänge.

Ein API-Formular beseitigt keine Stripe-Pflichten. Erforderliche Daten gehen transparent an Stripe. Dokumente und andere nicht vom eigenen Formular abgedeckte Anforderungen öffnen erst auf ausdrücklichen Klick eine zusätzliche, eingebettete Prüfung. Dieser Elternschritt erfasst keine Bankverbindung und verlangt keinen separaten Stripe-Login. Empfänger bleibt der Jugendliche; es wird kein Eltern-Auszahlungskonto angelegt.

Eine alte, abgebrochene Einrichtung mit ungültig gewordener Elternbindung darf ausschließlich nach ausdrücklicher Bestätigung neu begonnen werden. Die Datenbank verlangt gültige aktuelle Zustimmung, unveränderte Referenz und Generation sowie einen höchstens 60 Sekunden alten Stripe-Nachweis. Bankverbindung, KYC-/Vertragsnachweis, frühere Verifizierung, Guthaben oder irgendeine Zahlungshistorie sperren den automatischen Neustart. Das alte Stripe-Konto wird weder gelöscht noch übernommen; der alte Bezug bleibt in einer privaten Audit-Tabelle erhalten.

Ein Rücksprung aus Stripe und das Schließen des eingebetteten Formulars sind kein Bereitschaftsnachweis. Der Server liest den aktuellen Stripe-Stand, prüft die zugeordnete Identität, gegebenenfalls die tatsächliche Guardian-Person und deren Vertragsannahme sowie Transfer-/Auszahlungsfähigkeiten. Beim Kontowechsel werden alte Browser-Sessions verworfen; normale Bereichswechsel melden die Person nicht unnötig bei Stripe ab.

## Einmaliger Job: erledigt, bezahlt, geschlossen

Neue Jobs sind zunächst ausschließlich einmalig. Bestehende wiederkehrende Aufträge werden nicht stillschweigend in andere Verträge umgeschrieben.

| Schritt | Was die Oberfläche zeigt | Verbindliche Bedingung |
| --- | --- | --- |
| Offen | Job ist verfügbar | Ein gültiges Angebot ist veröffentlicht |
| Reserviert | Eine Person ist zugeordnet | Erste zulässige Bewerbung reserviert; Ablehnen/Zurückziehen öffnet den Job wieder |
| Vereinbart | Termin und Vergütung stehen fest | Beide Beteiligten bestätigen denselben unveränderlichen Vergütungsstand |
| Abschließen und bezahlen | Ein klarer Einstieg neben Details; Vergütung, Servicegebühr und Gesamtbetrag zusammen | Anbieter bestätigt bewusst den Einzug; eine erforderliche Bankbestätigung bleibt sichtbar |
| Zahlung läuft/Handlung nötig | Aktueller Zahlungsstand und genau passende nächste Aktion | Autorisierung, Client-Callback oder Rückkehr gelten noch nicht als Zahlung |
| Abgeschlossen | Zahlung bestätigt; gemeinsamer Verlauf und Belege bleiben erreichbar, Composer geschlossen | Server bestätigt den tatsächlich bezahlten, diesem Auftrag/Termin zugeordneten Vorgang und beendet die Zusammenarbeit idempotent |

Für den geltenden 5-%-Bruttotarif sind beispielsweise 10,00 € Vergütung + 0,50 € Servicegebühr = 10,50 € Gesamtbetrag. Die vereinbarte Vergütung bleibt 10,00 €. Die Plattformgebühr ist kein garantierter Nettogewinn nach Stripe-Kosten und Steuern. Tarif und Betrag stammen aus dem gespeicherten bestätigten Preisstand; eine neue Gebühr darf nicht nachträglich in alte Zustimmungen eingeschoben werden.

Abbruch, fehlgeschlagene Bestätigung und ausstehende Zahlung schließen den Chat nicht. Doppelklick, erneute Zustellung und verlorene Antworten lösen keinen zweiten Einzug aus. Erstattung, Storno und Streitfälle bleiben eigene Finanzzustände. „Bezahlt“ bedeutet nicht, dass die Bankauszahlung bereits angekommen ist. Historische unbezahlte Jobs werden durch einen Rollout nicht nachträglich als bezahlt ausgegeben.

## Abnahme vor dem nächsten Demo-Termin

1. Beide neuen Registrierungen auf Mobilgerät/Desktop durchgehen: Anbieteradresse im Onboarding, Jugendliche ohne Pflichtadresse; keine manuelle Adress-Warteschleife.
2. Neuer Elternteil und bestehendes Konto: Einladung, E-Mail-Bestätigung, Passwort-Recovery, klare Zustimmung, Familienkonto und optionaler Anbieter-Ausbau. Ungültiger/verbrauchter Link und falsches Konto müssen verständlich abgefangen werden.
3. Widerruf und erneute Freigabe prüfen; Bestätigungsmail nur bei ausdrücklich autorisiertem echten Empfänger testen. Lokale Prüfungen verwenden Attrappen oder isolierte Datenbanken und senden keine Mails.
4. Stripe-Abbruch, Laden, Reload, erforderliche Zusatzangaben, Kontowechsel und Rückkehr prüfen. Oberfläche und Server dürfen aus dem Formularende keinen Erfolg erfinden.
5. Einen bewusst freigegebenen realen Benutzerablauf separat abnehmen: tatsächlich erlaubte Empfängereinrichtung → Preisbestätigung → Zahlung/gegebenenfalls SCA → bestätigter Einzug/Gebührenzuordnung → geschlossener Chat auf beiden Konten. Signierte Webhooks und Wiederholungen gehören zur Abnahme.
6. Fehler-/Rückabwicklungsfälle prüfen: keine Doppelzahlung, kein Schließen bei `processing`/`requires_action`/Fehler, korrekte Erstattung und nachvollziehbare Belege. Erst danach den realen Erfolg dokumentieren; Bankauszahlung gesondert nachweisen.

Visuelle Tests erfolgen in Light/Dark und schmalen Viewports mit dem vorhandenen neutralen Liquid-Glass-System. Wesentliche Aktionen bleiben an derselben Stelle; Zusatzinformationen erscheinen erst bei Bedarf. Keine produktiven Nutzerdaten, Auth-Konten oder gesetzlichen Zustimmungen werden für automatisierte Demo-Belege erfunden.
