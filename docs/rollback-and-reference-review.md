# Lokaler Rollback

Eine Datei wird nach kurzer Bestätigung auf den letzten Commit zurückgesetzt,
einschließlich Staging. Es wird kein Stash und keine automatische Sicherung
angelegt. Vorhandene Stashes, andere Dateien und Commit-Zeiger bleiben unverändert.
Der obere Rollback-Button bietet eine Dateiauswahl für mehrere Dateien.

Zwischenparken ist eine getrennte, ausdrücklich gewählte Aktion. Es wird nie
automatisch durch einen Rollback ausgelöst.

Die Umsetzung verwendet Git restore mit dem bestätigten Commit und literalen
Dateipfaden. Unversionierte Dateien bleiben erhalten; neue gestagte Dateien werden
entfernt. Laufende Git-Vorgänge, Konflikte und Untermodul-Änderungen sind ausgeschlossen.
Tests prüfen insbesondere, dass weder neue Stashes entstehen noch bestehende verändert
werden und nicht ausgewählte Dateien unberührt bleiben.

## Frühere Funktionsrecherche

- [Fork](https://git-fork.com/): Stashes und lokale Git-Aktionen.
- [Sublime Merge](https://www.sublimemerge.com/docs/getting_started): getrennte Arbeitskopie-/Staging-Aktionen.
- [WebStorm](https://www.jetbrains.com/help/webstorm/undo-changes.html): gezielter Rollback lokaler Änderungen.
