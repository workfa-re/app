# Workfare Pay: klare Geldübersicht und kompakte Einrichtung

Die Pay-Seite und das Startseiten-Widget stellen den tatsächlich für eine
Bankauszahlung verfügbaren Betrag in den Mittelpunkt. Gesamtverdienst,
erfolgreiche Auszahlungen und Beträge in Bearbeitung bleiben getrennt.
Terminzahl und Auszahlungen unterwegs stehen nachgeordnet. Die sichtbare
Stand-Zeit und das Erklärungs-Accordion entfallen. Fehlende Daten sind keine
Nullbeträge; Auszahlungsverfügbarkeit ist kein frei verwendbares Wallet.

Die eigenen Stripe-Auszahlungen werden begrenzt über maximal zehn Seiten
mit je 100 Einträgen gelesen. Erst ein vollständiges Ergebnis bestätigt
Gesamtsummen; angezeigt werden höchstens zehn einzelne Vorgänge. Die Prüfung
des Kontoinhabers und der aktiven Umgebung erfolgt weiterhin vor dem Abruf.

Zurück-Navigation, Jobs-entdecken und andere Pay-Aktionen verwenden die
bestehenden neutralen Glasflächen mit Pointer-Reflexion. Die ruhige Animation
und die Wortmarke bilden eine gemeinsame Hero-Fläche. Während der Einrichtung
tritt sie zurück; der äußere Stripe-Bereich nutzt die verfügbare Seitenbreite.
Stripes eigener Formularaufbau bleibt providerverwaltet. Seine Felder werden
nicht per CSS gestreckt oder durch ein eigenes Kartenformular ersetzt.

Anbieter sehen nur die notwendige nächste Aktion. Die zusätzliche
Zahlungsarten-Disclosure entfällt. Vor der Einrichtung benennt eine kurze,
ausdrücklich anzukreuzende Erklärung Stripe und die Speicherung für kommende
Workfare-Aufträge. Dadurch wird keine Zahlung ausgelöst und keine pauschale
Vertragsannahme durch die Anwendung erklärt.

Rechnungsdaten benennen ihren Zweck und bleiben mit dem eigenen Stripe
Customer synchronisiert. Name und Rechnungs-E-Mail können ohne Adresse
geändert werden. Eine weggelassene Adresse bleibt erhalten, auch wenn sie
ausländisch oder unvollständig ist. Nur eine vollständige deutsche Adresse
ersetzt sie; Entfernen ist eine eigene Auswahl mit anschließendem Speichern.
Der frische Abgleich nach der Änderung, Eigentumsprüfung und derselbe
Operationsschlüssel bei unsicherer Wiederholung bleiben erhalten. Die
geprüfte Profiladresse und die Anmelde-E-Mail werden nicht überschrieben.

Aktualisieren steht nach dem Belegverlauf und bleibt bei offenen
Rechnungsentwürfen deaktiviert. Die Navigationsicons werden nicht mehr vom
Flex-Layout gestaucht; das Zahnrad ist optisch an die anderen Symbole angepasst.

Es gibt keine Migration, Änderung von Zahlungsfreigaben oder zusätzliche
Videogenerierung.

## Prüfung

Der vollständige automatisierte Prüflauf mit 2.331 Tests, TypeScript und der
Produktionsbuild sind erfolgreich. Der Lint-Lauf meldet keine Fehler und 40
bestehende Warnungen.
Die zusätzliche Regression zum Ersetzen einer ausländischen Adresse bestätigt,
dass auch die frühere Region ausdrücklich geleert wird.

Die Produktionsvorschau wurde bei 1440, 820, 390 und 320 Pixeln in Hell und
Dunkel geprüft. Acht Hero-/Navigationsansichten und 54 Prüfungen für Pay- und
Startseitenstatistik bestätigen Seitenidentität, Inhalte, Farbmodus, fehlenden
horizontalen Überlauf und ausbleibende Browserfehler. Pause, Fortsetzen und
Zurück funktionieren. Rechnungsdaten wurden mit 18 Browserprüfungen unter
eigenen, gekennzeichneten Antwortfixtures getestet, einschließlich unsicherer
Wiederholung, optionaler Adresse, ausdrücklichem Entfernen und Erhalt einer
ausländischen Adresse. Diese Fixtures führen keine Stripe-Änderung aus.

Der echte Stripe-Sandbox-Embed wurde bei 1440, 390 und 320 Pixeln geprüft.
Sein Frame nutzt die äußere Kartenbreite; Neuladen verwendet denselben
Customer und dieselbe offene Checkout-Einrichtung. Keine Karte wurde
eingegeben oder bestätigt. Es gab keine Echtgeldzahlung oder Bankauszahlung.
Die lokalen HTTP-/Apple-Pay-Hinweise von Stripe werden nicht als Nachweis der
produktiven Zahlartenfreigabe gewertet.

Für die Browserprüfung wurde der installierte Chrome mit Playwright verwendet,
weil der dedizierte Browser-Testplugin nicht verfügbar ist. Private Sessions,
Testbilder und Runner bleiben außerhalb des Repositorys.
