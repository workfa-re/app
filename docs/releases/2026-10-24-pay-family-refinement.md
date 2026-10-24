# Workfare Pay und gemeinsamer Familienzugang

## Änderungen

- Workfare Pay erhält einen kompakten Kopf, zurückhaltende Animation und
  neutralen Glasaufbau. Während der Stripe-Einrichtung tritt die Animation
  zurück. Das Formular nutzt die äußere Kartenbreite; Neuladen und Schließen
  stehen direkt nebeneinander. Der gesunde Embed zeigt keine zusätzliche
  Hilfezeile. Fehlermeldungen bleiben sichtbar und wiederholbar.
- Zahlungen und Belege, Rechnungsdaten und Hilfe erscheinen nachgeordnet.
  Der leere Verlauf lautet nur „Noch keine Zahlung.“. Die Kennzeichnung
  „Stripe × Workfare Pay“ benennt die Zahlungsabwicklung, keine Zertifizierung.
- Neue Stripe-Kunden erhalten die bestätigte Account-E-Mail beim Anlegen.
  Bestehende Rechnungs-E-Mails werden bei späterer Einrichtung nicht mehr
  überschrieben. Rechnungsänderungen prüfen nach dem Schreiben den aktuellen
  eigenen Customer erneut; ein unsicherer Abgleich meldet keinen Erfolg.
  Ein identischer Wiederholungsversuch verwendet dieselbe Operation.
- Eltern verwenden die normale E-Mail-/Passwort-Anmeldung. Ein Familienkonto
  benötigt zunächst nur die notwendigen Angaben und kann später auf derselben
  Identität ein Anbieterprofil vervollständigen. Einladung, Bestätigung und
  Passwort-Recovery behalten das erlaubte Rückkehrziel.
- Reine Plattformfreigaben benötigen kein Elternkonto: eigener E-Mail-Code,
  ausdrücklich versionierte Erklärung und persönlicher Widerrufslink.
  Codes und Links sind gehasht und serverseitig begrenzt; der Receipt bleibt
  vor dem Submit im privaten URL-Fragment wiederherstellbar. Der neue Pfad
  erteilt keine Identitätsverifikation oder Stripe-Auszahlungsbereitschaft.
- Der Header bekommt mehr Abstand zwischen Wortmarke und Ortsnamen. Bestehende
  Familien-, Anbieter- und Zahlungsrechte bleiben getrennt.

## Prüfstand vor Veröffentlichung

- 2.310 automatisierte Tests bestanden: 2.268 Haupttests, 14 Angebots-,
  26 Demo- und zwei Abhängigkeitstests.
- Vollständiger Lint ohne Fehler; 40 bestehende Warnungen. Produktionsbuild
  einschließlich TypeScript erfolgreich.
- 183 echte, isolierte PostgreSQL-Prüfungen für Freigabe, Widerruf, neue
  Einladung, Rechte, Wiederholung und erhaltene Bestandsdaten bestanden.
- Jugendansicht: 20 Browserchecks und sechs Ansichten. Familienbereich und
  normale Familienregistrierung: 31 Checks im Produktionsbuild, zwölf
  Ansichten bei 1440, 390 und 320 Pixeln, jeweils hell/dunkel. Zwei lokale
  Guardian-Auszahlungsaufrufe liefern erwartungsgemäß 409, weil dieser
  getrennte Pfad echten Live-Modus voraussetzt.
- Echtes Stripe-Sandbox-Formular bei 390 und 320 Pixeln geprüft. Neuladen
  nutzt denselben Customer und Checkout; keine Karte eingegeben oder
  bestätigt. Kein Feldclip, keine Überbreite der Plattform. Stripes kleiner
  interner Containerüberstand beschneidet kein Eingabefeld. Ein bestehender
  Checkout behält seine beim Start gespeicherte Stripe-Farbe.
- Nach einem global hängenden lokalen Entwicklungsserver wurde die gebaute
  Vorschau neu gestartet und der Familienlauf darin erfolgreich wiederholt.
- In 67 geprüften Änderungsdateien keine langen privaten Stripe-Schlüssel
  oder Webhook-Signaturen gefunden. Private QA-Sitzungen bleiben außerhalb
  des Repositorys.

Die Migrationen `20261024175803` und `20261024180507` sind im Produktionsprojekt
installiert und byte-identisch zum kanonischen Ledger. Der Vorher-/Nachher-
Vergleich bestätigt unveränderte bisherige Werte in Profilen, Einladungen,
Consentlinks, Zustimmungen und Familienverbindungen. Es wurden keine realen
Zustimmungen oder Zahlungen erzeugt.

Der eigene Mailgun-SMTP-Transport benötigt private Serverkonfiguration. Seine
Zustellung ist durch diese Code-/Sandboxprüfungen nicht nachgewiesen. Ohne
Konfiguration bleibt die accountlose Bestätigung geschlossen; die normale
Familienanmeldung nutzt weiterhin Supabase Auth. Ein echter Zahlungs- oder
Minderjährigen-KYC-Abschluss wird durch dieses Release nicht behauptet.

Der weitere Funktionsplan steht unter
[Workfare Pay: Ablauf und Oberfläche](../planning/workfare-pay-ux.md#nächste-ausbauschritte),
die SMTP-/Familienverträge unter
[Familienzugang](../architecture/guardian-family-access.md).
