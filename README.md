# Mergecraft

Git-Client für Linux mit einem **3-Wege-Merge-Editor im Stil des WebStorm-Merge-Dialogs**.
Rust (Tauri v2) im Hintergrund, Oberfläche in TypeScript, Git über die echte `git`-CLI.

## Der Merge-Editor

```
 Kopfzeile   main.rs  src/   1 Konflikt · 4 automatisch · 0 von 1 aufgelöst
             ⌃  1/1 ⌄   Alle von lokal   Alle von eingehend   Roh-Modus
 ┌──────────────────┬────────────────────────────┬──────────────────┐
 │ Lokal (main)     │ Ergebnis (wird geschrieben)│ Eingehend (feat) │
 │ 1 use std::…     │ 1 use std::…               │ 1 use std::…     │
 │ 2 use std::fs;   │ 2 use std::fs;     lokal → │ 2 use std::fs;   │
 │ ╔══════════════╗ │ ╔════════════════════════╗ │ ╔══════════════╗ │
 │ ║ 7 map.insert ║ │ ║ KONFLIKT ◀ ▶ ⇄ ↺  offen║ │ ║ 6 map.insert ║ │
 │ ╚══════════════╝ │ ║  (editierbarer Text)   ║ │ ╚══════════════╝ │
 │ 8 println!…      │ 8 println!…                │ 7 println!…      │
 └──────────────────┴────────────────────────────┴──────────────────┘
 Fußzeile   1 Bereich braucht noch eine Entscheidung     [Speichern] [Speichern & als gelöst]
```

* Konfliktbereich öffnen: **jeder** Bereich wird einzeln entschieden –
  `◀` lokal, `▶` eingehend, `⇄` beide, `↺` zurücknehmen, oder den Text im
  Ergebnisbereich direkt editieren („eigene Fassung“).
* **Wortweise Hervorhebung** innerhalb geänderter Zeilen (wie im WebStorm-Diff):
  nur die tatsächlich geänderten Wörter sind markiert.
* Automatisch übernommene Bereiche sind gekennzeichnet (`lokal →`, `← eingehend`,
  grün/blau eingefärbt), damit man sieht, was ohne Zutun passiert ist.
* **Konflikt-Navigation**: `Alt+↑`/`Alt+↓` springt zum nächsten offenen Bereich,
  die Positionsanzeige öffnet eine Liste aller Konflikte mit Zeilennummer und Vorschau.
* **Roh-Modus**: die ganze Ergebnisdatei als Texteditor.
* **Speichern** schreibt die Datei; **Speichern & als gelöst markieren** macht
  zusätzlich `git add`. Offene Bereiche werden als git-Konfliktmarker geschrieben –
  es kann nichts verloren gehen.
* **Prüfmodus (Wächter)**: meldet `git merge-file` einen Konflikt, den die
  automatische Analyse nicht sieht (passiert bei doppelten Zeilen), wird kein
  Bereich stillschweigend übernommen – die Oberfläche verlangt für jeden
  geänderten Bereich eine Entscheidung.
* Binärdateien werden erkannt; dort nimmt man eine Seite komplett an.

## Erststart

Ohne Argument zeigt Mergecraft die Willkommensseite: Pfad eintippen (oder Ordner
wählen), Liste der zuletzt geöffneten Repositories, und – falls der Ordner noch
kein Repository ist – eine Schaltfläche **„Repository hier anlegen“** (`git init
-b main`). Wurde schon einmal ein Repository geöffnet, startet die App direkt
damit.

## Tastenkürzel

| Kürzel | Wirkung |
| --- | --- |
| `Strg+R`, `F5` | Aktualisieren |
| `Strg+1` … `Strg+4` | Änderungen / Branches / Historie / Konsole |
| `Strg+P` | Branch-Suche öffnen |
| `Alt+↑` / `Alt+↓` | vorheriger / nächster Konflikt im Merge-Editor |
| `Alt+←` / `Alt+→` / `Alt+B` | lokale / eingehende / beide Fassung übernehmen |
| `Alt+Enter` | speichern und als gelöst markieren |
| `Strg+Enter` | Commit aus dem Nachrichtenfeld |
| `Esc` | Popover, Rückfrage oder Editor schließen |

Ungespeicherte Änderungen im Merge-Editor gehen nicht verloren: beim Wechsel des
Bereichs, des Konflikts oder beim Schließen fragt Mergecraft nach.

## Branches suchen, wechseln, anlegen, mergen

* Branch-Chip in der Kopfzeile öffnet ein Popover mit **Suchfeld** (unscharfe
  Suche über Namen, zusätzlich Treffer in der Commit-Nachricht), gruppiert nach
  Lokal/Remote, mit Upstream, Voraus-/Zurück-Zählern, letztem Commit und Datum.
  Treffer werden in der Liste hervorgehoben.
* Tastatur: `↑`/`↓` wählen, `Enter` wechseln (Remote-Branches werden als
  lokaler Tracking-Branch angelegt), `Esc` schließen.
* Aktionen je Branch: wechseln, **mergen** (in den aktuellen Branch, `--no-ff`
  umschaltbar oder Fast-forward), neuen Branch hier starten, umbenennen, löschen
  (lokal und remote).
* Läuft ein Merge, zeigt die Kopfzeile das an, mit „Merge abbrechen“ /
  „Merge abschließen“ und dem direkten Sprung in die Konflikte.

## Arbeitskopie, Historie, Diffs, Remote

* Gruppen Konflikte / Gestaged / Änderungen / Unversioniert mit Aktionen je
  Datei (auflösen, lokal bzw. eingehend komplett nehmen, Diff, stagen, unstagen,
  verwerfen) und Sammelaktionen.
* Commit-Box mit `-a`, `--amend`, `-S` und den letzten Commit-Nachrichten zur
  Auswahl.
* Historie mit Ref-Chips (HEAD, Branch, Remote, Tag), Autor und relativem Datum;
  geänderte Dateien je Commit, Diff per Klick.
* Diff-Ansicht **nebeneinander** oder **vereint**, mit Zeilennummern,
  `+/−`-Statistik und wortweiser Hervorhebung.
* Fetch (`--all --prune`), Pull, Push, Git-Konsole für rohe Befehle,
  Statuszeile mit Branch-, Zähler- und Kopf-Commit-Information.

## Starten

```bash
cd ~/develop/mergecraft

npm run dev          # Entwicklung (Vite + Tauri-Fenster)
npm run dev:web      # nur Oberfläche im Browser, mit Demo-Daten
npm run build        # Release + Pakete (target/release/bundle/{deb,appimage})
bash packaging/install.sh   # für den eigenen Benutzer installieren (~/.local)
mergecraft /pfad/zum/repo   # Repo direkt öffnen
```

## Als externes Merge-Tool (gitconfig bleibt unverändert)

```bash
mergecraft --merge <lokal> <basis> <eingehend> <ergebnis> [label-lokal] [label-eingehend]
```

Zum Einhängen später:

```bash
git config --global merge.tool mergecraft
git config --global mergetool.mergecraft.cmd \
  'mergecraft --merge "$LOCAL" "$BASE" "$REMOTE" "$MERGED" "$MERGED" "$REMOTE"'
git config --global mergetool.mergecraft.trustExitCode true
```

## Diagnose ohne GUI

```bash
mergecraft --diag ~/develop/n4kit              # Status, Branches, Konflikte, Merge-Bereiche
mergecraft --diag ~/develop/n4kit src/main.rs  # einzelne Konfliktdatei
MERGECRAFT_DIAG_JSON=1 mergecraft --diag .     # zusätzlich JSON
MERGECRAFT_DIAG_WRITE=1 mergecraft --diag --merge ours base theirs merged main feat
```

## Selbsttest (Oberfläche ohne Bildschirmfoto prüfen)

Auf Wayland lässt sich das Fenster nicht abfotografieren (der Compositor zeichnet).
Mergecraft kann deshalb ein Skript in die Oberfläche injizieren und das Ergebnis
zurückmelden:

```bash
MERGECRAFT_SELFTEST=packaging/selftest-merge.js \
MERGECRAFT_SELFTEST_OUT=/tmp/ergebnis.txt mergecraft /pfad/zum/repo
```

Das Skript löst echte Klicks aus und beendet sich über den Befehl
`selftest_report`; geprüft wird anschließend am Ergebnis auf der Platte
(`git status`, Dateiinhalt). Zwei Beispiele liegen in `packaging/`.

## Aufbau

```
core/                 reine Rust-Bibliothek (kein GUI, schnell testbar)
  merge.rs            3-Wege-Engine: Regionen, Auflösung, Wort-Hervorhebung
  gitcli.rs           Git über die echte CLI
  hunks.rs            Änderungsblöcke aus `git diff` (Vergleichsquelle im Test)
  verify.rs           Wächter: fragt `git merge-file` vor einem stillen Auto-Merge
src-tauri/            Tauri-App: Befehle, GTK-Ordnerauswahl, --diag
  commands.rs         Repository, Branches, Status, Merge, Diffs, Konflikte
src/                  Oberfläche (kein Framework)
  main.ts             Rahmen: Kopfzeile, Aktivitätsleiste, Aktionen
  merge.ts            3-Pane-Merge-Editor
  diff.ts             Diff-Ansicht (nebeneinander/vereint)
  branchmenu.ts       Branch-Popover mit Suche
  panels.ts           Änderungen, Branch-Liste, Historie, Konsole
  ui.ts               Icons, Dialoge, Toasts, Fuzzy-Suche
  mock.ts             Demo-Backend für den Browser
  styles.css          Design-System
packaging/            Desktop-Eintrag + Installationsskript
```

Bewusste Entscheidung: **kein libgit2**, sondern die echte `git`-CLI – damit sind
Merge-Strategien, Konfliktmarker, Hooks und Credential-Helper identisch zur
Kommandozeile, und es gibt keine C-Abhängigkeit im Build.
Die Ordnerauswahl läuft über GTK auf dem Haupt-Thread (nicht über
`tauri-plugin-dialog`/rfd, dessen GTK-Backend sich in einer GTK-Host-App am
globalen Main-Context aufhängt).

## Wie die Merge-Engine abgesichert ist

```bash
cargo test -p mergecraft-core      # 26 Tests
```

* 3000 Zufallsfälle mit doppelten Zeilen (härtester Fall): Übereinstimmung mit
  `git merge-file` > 99 %, 0 Textabweichungen bei sauberen Merges
* SICHERHEITS-Invariante: kein Fall, in dem git einen Konflikt sieht und
  Mergecraft ungeschützt automatisch mergt (geprüft inkl. Wächter)
* 3000 Zufallsfälle ohne Duplikate: > 99 % Übereinstimmung, keine Textabweichung
* Praxis-Regressionsfälle (Imports, Refactoring vs. Edit, Löschen vs. Anhängen,
  gleiche Änderung auf beiden Seiten, überlappende Löschungen)
* Ende-zu-Ende gegen echte Repositories: Konflikt erzeugen, die drei
  Index-Stages lesen, auflösen, `git add`, Merge-Commit abschließen
