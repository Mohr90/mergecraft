//! Diagnose ohne GUI: Repository-Zustand, Branches, Konflikte und die
//! Bereichsaufteilung der Merge-Engine. Nützlich, wenn kein Fenster verfügbar
//! ist (Server, Tests, Fehlersuche).

use crate::commands::{self, StandaloneMerge};
use mergecraft_core::gitcli::Git;
use mergecraft_core::merge::Kind;
use mergecraft_core::model::ConflictData;

fn json_on() -> bool {
    std::env::var("MERGECRAFT_DIAG_JSON")
        .map(|v| v == "1")
        .unwrap_or(false)
}
fn write_on() -> bool {
    std::env::var("MERGECRAFT_DIAG_WRITE")
        .map(|v| v == "1")
        .unwrap_or(false)
}

pub fn run(args: &[String], standalone: Option<StandaloneMerge>) -> i32 {
    if let Some(sm) = standalone {
        return dump_standalone(&sm);
    }
    let rest: Vec<&String> = args
        .iter()
        .filter(|a| !a.starts_with('-') && a.as_str() != "--diag")
        .collect();
    let Some(repo) = rest.first() else {
        eprintln!("--diag braucht einen Pfad:  mergecraft --diag /pfad/zum/repo [datei]");
        return 2;
    };
    let file = rest.get(1).map(|s| s.to_string());
    dump_repo(repo, file.as_deref())
}

fn dump_repo(path: &str, file: Option<&str>) -> i32 {
    let root = match Git::discover(&commands::expand_path(path)) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    let g = Git::new(root.clone());
    println!("Repository: {}", root.display());

    match g.snapshot() {
        Ok(s) => {
            println!(
                "HEAD:       {}  ({})",
                s.head.get(..12).unwrap_or(&s.head),
                s.head_branch.clone().unwrap_or_else(|| "detached".into())
            );
            println!(
                "Kopf-Commit: {}",
                g.status().map(|st| st.head_subject).unwrap_or_default()
            );
            println!(
                "Zustand:    merge={} rebase={} cherry-pick={}",
                s.merging, s.rebasing, s.cherry_picking
            );
        }
        Err(e) => println!("HEAD:       nicht lesbar ({e})"),
    }

    match g.branches() {
        Ok(bs) => {
            println!(
                "Branches:   {} ({} lokal, {} remote)",
                bs.len(),
                bs.iter().filter(|b| !b.is_remote).count(),
                bs.iter().filter(|b| b.is_remote).count()
            );
            for b in bs.iter().filter(|b| !b.is_remote) {
                println!(
                    "  {}{}  {}{}{}",
                    if b.is_current { "* " } else { "  " },
                    b.name,
                    b.short_hash,
                    b.upstream
                        .as_ref()
                        .map(|u| format!("  → {u}"))
                        .unwrap_or_default(),
                    if b.ahead + b.behind > 0 {
                        format!("  ↑{} ↓{}", b.ahead, b.behind)
                    } else {
                        String::new()
                    }
                );
            }
        }
        Err(e) => println!("Branches:   nicht lesbar ({e})"),
    }

    match g.status() {
        Ok(st) => {
            println!(
                "Arbeitskopie: {} gestaged, {} geändert, {} unversioniert, {} ungelöst",
                st.staged.len(),
                st.changed.len(),
                st.untracked.len(),
                st.conflicts.len()
            );
            for c in &st.conflicts {
                println!(
                    "  KONFLIKT  {:<4} {}",
                    c.conflict_code.clone().unwrap_or_default(),
                    c.path
                );
            }
        }
        Err(e) => println!("Arbeitskopie: nicht lesbar ({e})"),
    }

    match file {
        Some(f) => dump_conflict(&g, f),
        None => {
            if let Ok(cs) = g.conflicted_files() {
                for c in cs.iter() {
                    println!("\n=== {} ===", c.path);
                    dump_conflict(&g, &c.path);
                }
            }
        }
    }
    0
}

fn dump_conflict(g: &Git, path: &str) {
    let data = match commands::merge_context(g, path) {
        Ok(d) => d,
        Err(e) => {
            println!("  nicht lesbar: {e}");
            return;
        }
    };
    print_regions(&data);
    if json_on() {
        match serde_json::to_string_pretty(&data) {
            Ok(s) => println!("{s}"),
            Err(e) => println!("JSON nicht möglich: {e}"),
        }
    }
}

fn dump_standalone(sm: &StandaloneMerge) -> i32 {
    let data = match commands::standalone_context(sm) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    println!("Standalone-Merge: {}", data.path);
    println!(
        "  lokal={} ({} Zeilen)  basis={} ({} Zeilen)  eingehend={} ({} Zeilen)",
        data.ours.exists,
        data.ours.lines,
        data.base.exists,
        data.base.lines,
        data.theirs.exists,
        data.theirs.lines
    );
    print_regions(&data);
    if json_on() {
        match serde_json::to_string_pretty(&data) {
            Ok(s) => println!("{s}"),
            Err(e) => println!("JSON nicht möglich: {e}"),
        }
    }
    if write_on() {
        match std::fs::write(&sm.merged, &data.result_text) {
            Ok(_) => println!("Ergebnis geschrieben: {}", sm.merged.display()),
            Err(e) => {
                eprintln!("Schreiben fehlgeschlagen: {e}");
                return 1;
            }
        }
    }
    0
}

fn print_regions(data: &ConflictData) {
    let mut counts = [0usize; 5];
    for r in &data.regions {
        let idx = match r.kind {
            Kind::Unchanged => 0,
            Kind::OursOnly => 1,
            Kind::TheirsOnly => 2,
            Kind::BothSame => 3,
            Kind::Conflict => 4,
        };
        counts[idx] += 1;
    }
    println!(
        "  Bereiche: {} gesamt | {} unverändert | {} nur lokal | {} nur eingehend | {} gleich | {} KONFLIKT{}",
        data.regions.len(), counts[0], counts[1], counts[2], counts[3], counts[4],
        if data.guarded { "  (Wächter: git sieht einen Konflikt, den die Analyse nicht erkennt)" } else { "" }
    );
    for (i, r) in data.regions.iter().enumerate() {
        if r.kind == Kind::Unchanged {
            continue;
        }
        let tag = match r.kind {
            Kind::Unchanged => "unverändert",
            Kind::OursOnly => "nur lokal",
            Kind::TheirsOnly => "nur eingehend",
            Kind::BothSame => "beide gleich",
            Kind::Conflict => "KONFLIKT",
        };
        println!(
            "   #{i:<3} {tag:<13} basis {:>4}+{:<3} lokal {:>4}+{:<3} eingehend {:>4}+{:<3}",
            r.base.0 + 1,
            r.base.1,
            r.ours.0 + 1,
            r.ours.1,
            r.theirs.0 + 1,
            r.theirs.1
        );
    }
    if data.ours.binary || data.theirs.binary {
        println!("  (Binärdatei – Bereiche nur eingeschränkt aussagekräftig)");
    }
}
