//! Mergecraft – Einstiegspunkt.
//!
//! Drei Betriebsarten:
//!   mergecraft [repo]                                  Fenster mit Repository
//!   mergecraft --merge lokal basis eingehend ergebnis   externes Merge-Tool
//!   mergecraft --diag [repo] [datei]                    Diagnose ohne Fenster

mod commands;
mod diag;

use commands::{AppState, StandaloneMerge};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return;
    }

    let standalone = parse_standalone(&args);
    let standalone_mode = standalone.is_some();

    if args.iter().any(|a| a == "--diag") {
        std::process::exit(diag::run(&args, standalone));
    }

    // Im Merge-Modus sind die Positionsargumente Dateien, kein Repository.
    let repo_arg = if standalone_mode {
        None
    } else {
        args.iter()
            .find(|a| !a.starts_with('-'))
            .map(|a| commands::expand_path(a))
    };
    let root = repo_arg.as_ref().and_then(|p| {
        mergecraft_core::gitcli::Git::discover(p)
            .map_err(|e| eprintln!("Hinweis: {e}"))
            .ok()
    });

    let state = AppState {
        root: Mutex::new(root),
        recent: Mutex::new(commands::load_recent()),
        standalone: Mutex::new(standalone),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            // Selbsttest: Skript aus MERGECRAFT_SELFTEST in die Oberfläche
            // injizieren (Ergebnis über den Befehl selftest_report).
            // Nötig, weil sich das Fenster auf Wayland nicht abfotografieren lässt.
            if let Some(file) = std::env::var("MERGECRAFT_SELFTEST").ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    match std::fs::read_to_string(&file) {
                        Ok(script) => {
                            use tauri::Manager;
                            if let Some(w) = handle.get_webview_window("main") {
                                if let Err(e) = w.eval(&script) {
                                    eprintln!("Selbsttest-Skript fehlgeschlagen: {e}");
                                    std::process::exit(3);
                                }
                            } else {
                                eprintln!("Selbsttest: kein Fenster 'main'");
                                std::process::exit(3);
                            }
                        }
                        Err(e) => {
                            eprintln!("Selbsttest-Skript {file} nicht lesbar: {e}");
                            std::process::exit(3);
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Repository
            commands::open_repo,
            commands::recent_repos,
            commands::snapshot,
            commands::init_repo,
            commands::branches,
            commands::tags,
            commands::commit_info,
            commands::status,
            commands::history,
            commands::commit_files,
            commands::conflicts,
            // Diffs
            commands::file_diff,
            commands::working_diff,
            commands::file_history,
            commands::versions_diff,
            commands::commit_file_diff,
            commands::compare_diff,
            commands::compare_files,
            // Merge/Konflikte
            commands::conflict_data,
            commands::save_conflict,
            commands::resolve_with_side,
            commands::standalone_data,
            commands::standalone_save,
            commands::standalone_side,
            // Branches
            commands::checkout_branch,
            commands::create_branch,
            commands::delete_branch,
            commands::rename_branch,
            commands::merge_branch,
            commands::merge_abort,
            commands::merge_continue,
            // Remote
            commands::fetch_remote,
            commands::pull,
            commands::push,
            // Arbeitskopie
            commands::stage,
            commands::unstage,
            commands::discard,
            commands::stashes,
            commands::rollback,
            commands::save_stash,
            commands::apply_stash,
            commands::commit,
            commands::git_raw,
            // System
            commands::pick_folder,
            commands::open_path,
            commands::set_title,
            commands::selftest_report,
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("Mergecraft konnte nicht starten: {error}");
            std::process::exit(2);
        }
    };
    // Builder::run exits the process directly. run_return lets the external
    // merge-tool contract distinguish a saved result from cancellation.
    let exit_code = app.run_return(|_, _| {});
    if standalone_mode {
        let saved = commands::SAVED.load(Ordering::SeqCst);
        std::process::exit(if saved { 0 } else { 1 });
    }
    std::process::exit(exit_code);
}

/// `--merge <lokal> <basis> <eingehend> <ergebnis> [label-lokal] [label-eingehend]`
fn parse_standalone(args: &[String]) -> Option<StandaloneMerge> {
    let pos = args.iter().position(|a| a == "--merge")?;
    let rest: Vec<&String> = args[pos + 1..]
        .iter()
        .filter(|a| !a.starts_with("--"))
        .collect();
    if rest.len() < 4 {
        eprintln!("--merge braucht 4 Dateien: lokal basis eingehend ergebnis");
        return None;
    }
    let label = |i: usize, fallback: &str| -> String {
        rest.get(i)
            .map(|s| s.to_string())
            .unwrap_or_else(|| fallback.to_string())
    };
    Some(StandaloneMerge {
        ours: PathBuf::from(rest[0]),
        base: PathBuf::from(rest[1]),
        theirs: PathBuf::from(rest[2]),
        merged: PathBuf::from(rest[3]),
        label_ours: label(4, "lokal"),
        label_theirs: label(5, "eingehend"),
    })
}

fn print_help() {
    println!(
        "Mergecraft – Git-Client mit 3-Wege-Merge-Editor

Aufruf:
  mergecraft [REPO]                                    Repository im Fenster öffnen
  mergecraft --merge LOKAL BASIS EINGEHEND ERGEBNIS    als externes Merge-Tool
                        [LABEL-LOKAL] [LABEL-EINGEHEND]
  mergecraft --diag [REPO] [DATEI]                     Diagnose auf der Konsole

Umgebungsvariablen für --diag:
  MERGECRAFT_DIAG_JSON=1     zusätzlich JSON ausgeben
  MERGECRAFT_DIAG_WRITE=1    bei --diag --merge: Ergebnis in ERGEBNIS schreiben

Als Merge-Tool wird Mergecraft aufgerufen mit
  --merge \"$LOCAL\" \"$BASE\" \"$REMOTE\" \"$MERGED\" \"$MERGED\" \"$REMOTE\"
Rückgabewert 0 = Ergebnis gespeichert, 1 = abgebrochen."
    );
}
