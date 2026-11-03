# Branch- und Merge-Arbeitsabläufe

Ziel: Bestehende Tauri-App für lokale Arbeit mit GitLab-Repositories vervollständigen.
Git und vorhandene Credential-Helper bleiben die Backend-Schnittstelle.

Akzeptanz: Branches direkt filtern und mit sichtbaren Aktionen wechseln, erstellen,
vergleichen und mergen. Remote-Wechsel nutzt vorhandene lokale Tracking-Branches.
Ungemergte Branches werden standardmäßig nicht gelöscht. Merge-Konflikte werden
bereichsweise entschieden; manuelle Texte dürfen bei Ansichtwechseln nicht
verloren gehen. Ganze Konfliktseiten erhalten Binärbytes und Löschungen.
GUI: beschriftete Navigation und Remote-Aktionen, sichtbare Merge-Richtung,
verständliche Zustände, Tastaturbedienung und schmale Fenster.

Umsetzung: Branch-Abläufe → Merge-Sicherheit → GUI und Abschlussprüfung.
Tests in core/tests/ verwenden temporäre Git-Repositories. Browser-Regressionen
liegen in tests/. Keine Änderungen an echten Remote-Repositories im Test.
Bestehende Nutzeränderungen werden erhalten. Keine zusätzlichen Laufzeitabhängigkeiten.

Prüfung: npm run typecheck; npm run build:web; cargo test -p mergecraft-core;
cargo check -p mergecraft; Browserprüfung mit Demo-Backend und Regressionstests.
