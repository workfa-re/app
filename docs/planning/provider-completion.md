# Anbieterprofil: Adresse, Zahlung und gezielte Prüfung

## Sofortiger Pilotablauf

Eine vollständig gespeicherte Adresse ermöglicht die Vorbereitung eigener
Jobs unmittelbar. Es gibt keine manuelle Adresswarteschlange. Anbieterrolle,
vollständige Adresse, gültige Koordinaten und bestehende Ablehnungen bleiben
serverseitig und in der Datenbank geschützt. Bestehende Verifizierungsstatus
werden nicht geändert und erzeugen kein neues Vertrauensbadge.

Zahlungsmittel und Zahlungsbereitschaft bleiben ein eigener Workfare-Pay-
Schritt. Eine bestätigte Karte ist kein Ausweis- oder Wohnadressnachweis.
Die bestehenden Zahlungsfreigaben werden durch den Adressfix nicht geändert.

## Nächster Ausbau

1. Adresse als kurzen Anbieter-Onboarding-Schritt integrieren; spätere Änderung
   im Profil ermöglichen. Nur der benötigte Einsatzort wird veröffentlicht.
2. Zahlungsmittel vor der ersten Veröffentlichung kontextbezogen ergänzen;
   Jobentwurf und Rückkehrziel erhalten. Nach frischem Stripe-Abgleich folgt
   eine ausdrückliche Veröffentlichung, keine automatische Abbuchung.
3. Manuelle Profilprüfung ausschließlich bei konkreten Risiken oder nötigem
   Identitätsnachweis. Vor einer verpflichtenden Warteschlange müssen Team-
   Oberfläche, Zuständigkeit, Benachrichtigung, Bearbeitung und Widerspruch
   verfügbar sein. Kein allgemeines Warten ohne bedienbare Freigabe.
4. Adressvollständigkeit, Zahlungsmittel und geprüfte Identität getrennt
   speichern und benennen. Ablehnung und Sperre bleiben gesonderte Zustände.
