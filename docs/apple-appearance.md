# Apple-inspirierte Desktop-Gestaltung

Mergecraft bleibt eine Linux/Tauri-App. Die Gestaltung übersetzt macOS-Prinzipien
in CSS und vorhandene semantische Bedienelemente. Native Fensterdekorationen bleiben
beim Betriebssystem; keine nachgebauten macOS-Fensterknöpfe.

## Designvertrag

Aufgabe: Repository und Branch-Zustand sofort erfassen, dann gezielt wechseln,
vergleichen oder Konflikte lösen. Signatur: eine ruhige Seitenleiste mit dem
Branch-Symbol und dem dreispaltigen, deckenden Merge-Arbeitsbereich.
Eine blaue Hauptaktion je Ansicht; Listenaktionen sind zurückhaltender gestaltet.

Regulär:
```
Repository · aktueller Branch                 Öffnen · Fetch · Pull · Push
Mergecraft       | Branches                         Neuer Branch
Navigation       | Suche / Filter / Sortierung
                 | Lokale Branches · Remote-Branches
```
Kompakt: Toolbar → beschriftete Navigation → gesamte Arbeitsfläche. Gleiche Aktionen,
umgebrochene Dateizeilen, separate Scrollbereiche für lange Codezeilen.

## Tokens und Kontrast

Rollen: Inhalt #202127 / #f2f3f7, Oberfläche #ffffff / #25272d,
Sekundärtext #626977 / #a7aebb, Akzent #0067d9 / #8ab9ff,
Erfolg #287541 / #a0d5ac, Konflikt #b52b34 / #ffb4b9.
Hell / dunkel folgen zunächst der Systemeinstellung. Die Auswahl über den Schalter
unten links wird lokal gespeichert und überschreibt sie anschließend.

Berechnete WCAG-Kontraste auf den jeweiligen deckenden Oberflächen:
- Haupttext hell 16,05:1; dunkel 13,46:1.
- Sekundärtext hell 5,52:1; dunkel 6,69:1.
- Akzent hell auf Auswahlfläche 4,69:1; dunkel 5,56:1.
- Erfolg / Konflikt auf hellen Statusflächen 5,16:1 / 5,65:1.

Systemschrift: 13 px Fließtext, 28 px Seitentitel, 12 px Listen und Aktionen,
11 px Metadaten, 10 px Statusleiste. Monospace für Branch-Namen und Code.
Keine externen Schriftdateien. Bestehende CSS-Tokens behalten ihre Bedeutung.

## Material und Zugänglichkeit

Nur Toolbar, Seitenleiste und vorübergehende Dialoge/Popover verwenden Blur.
Branch-Listen, Diff und Merge-Code sind deckend. Es gibt keine manuelle Transparenzoption. Systempräferenzen für hohen
Kontrast, reduzierte Bewegung und reduzierte Transparenz werden berücksichtigt.
Kein notwendiger Inhalt wird ausschließlich durch Farbe vermittelt.

Die vorhandenen Funktionen und Tastenkürzel bleiben bestehen. Eine dauerhafte
Darstellungseinstellung ist optional; die Betriebssystemdarstellung bleibt maßgeblich.

## Quellen des verwendeten Skills

- accessibility.md › Vision: „Strive to meet color contrast minimum standards.“
- typography.md › Ensuring legibility: „Use font sizes that most people can read easily.“
- materials.md › Liquid Glass: „Use Liquid Glass effects sparingly.“
- toolbars.md › Actions: eine prominente Hauptaktion.
- sidebars.md › Best practices: vertraute Symbole, klare Hierarchie.
- references/cross-platform.md: Übersetzung in Tauri/CSS.

Quelle: Apple Human Interface Guidelines (https://developer.apple.com/design/human-interface-guidelines/)..

## Prüfung

TypeScript, Web-Build und Browser-Regressionen. Hell/dunkel und Layouts bei
320/768/1024/1440 px, Tastaturfokus und gespeicherte Hell-/Dunkel-Auswahl.
Nativer Release-/Debian-Build und Git-/Merge-Ende-zu-Ende-Test.
