//! Ende-zu-Ende gegen ein echtes Repository: einen echten Merge-Konflikt
//! erzeugen, die drei Index-Stages lesen, über die Engine auflösen, `git add`
//! und den Merge abschließen.

use mergecraft_core::gitcli::Git;
use mergecraft_core::merge::{merge_regions, open_conflicts, render, split_lines, Choice, Kind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn tmp_repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("mergecraft-flow").join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn setup(dir: &Path) -> Git {
    let g = Git::new(dir.to_path_buf());
    g.run(["init", "-q", "-b", "main"]).unwrap();
    g.run(["config", "user.email", "test@example.com"]).unwrap();
    g.run(["config", "user.name", "Test"]).unwrap();
    g
}

const BASE: &str = "use std::collections::HashMap;\n\nfn main() {\n    let mut map = HashMap::new();\n    map.insert(\"a\", 1);\n    map.insert(\"b\", 2);\n    println!(\"{:?}\", map);\n}\n\nfn helper() -> i32 {\n    42\n}\n";

fn make_conflict(dir: &Path) -> Git {
    let g = setup(dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/main.rs"), BASE).unwrap();
    std::fs::write(dir.join("README.md"), "# Demo\n").unwrap();
    g.run(["add", "-A"]).unwrap();
    g.run(["commit", "-qm", "Basis"]).unwrap();

    g.run(["checkout", "-q", "-b", "feature"]).unwrap();
    let theirs = BASE
        .replace("map.insert(\"b\", 2);", "map.insert(\"b\", 22);")
        .replace("    42", "    43");
    std::fs::write(dir.join("src/main.rs"), theirs).unwrap();
    g.run(["add", "-A"]).unwrap();
    g.run(["commit", "-qm", "Feature"]).unwrap();

    g.run(["checkout", "-q", "main"]).unwrap();
    let ours = BASE.replace("map.insert(\"b\", 2);", "map.insert(\"c\", 3);");
    std::fs::write(dir.join("src/main.rs"), ours).unwrap();
    g.run(["add", "-A"]).unwrap();
    g.run(["commit", "-qm", "Main"]).unwrap();

    let merge = g.raw(["merge", "feature", "-m", "Merge feature"]);
    assert_ne!(merge.code, 0, "der Merge muss einen Konflikt erzeugen");
    g
}

#[test]
fn stages_blobs_and_resolution() {
    let dir = tmp_repo("resolve");
    let g = make_conflict(&dir);

    let st = g.status().unwrap();
    assert_eq!(st.conflicts.len(), 1);
    assert_eq!(st.conflicts[0].path, "src/main.rs");
    assert_eq!(st.conflicts[0].conflict_code.as_deref(), Some("UU"));
    assert!(st.merging, "laufender Merge muss erkannt werden");
    assert_eq!(st.conflicts[0].ext, "rs");

    let cf = g.conflicted_files().unwrap();
    assert_eq!(cf.len(), 1);
    assert!(cf[0].has_base);

    let base = g.blob(":1:src/main.rs").expect("Basis-Stage").0;
    let ours = g.blob(":2:src/main.rs").expect("lokale Stage").0;
    let theirs = g.blob(":3:src/main.rs").expect("eingehende Stage").0;
    assert_eq!(split_lines(&base).len(), 12);
    assert!(ours.contains("map.insert(\"c\", 3);"));
    assert!(theirs.contains("map.insert(\"b\", 22);"));
    assert!(theirs.contains("    43"));

    let regions = merge_regions(&split_lines(&base), &split_lines(&ours), &split_lines(&theirs));
    let conflicts = regions.iter().filter(|r| r.kind == Kind::Conflict).count();
    assert_eq!(conflicts, 1, "genau ein Konfliktbereich erwartet");
    assert_eq!(open_conflicts(&regions, &HashMap::new()), 1);

    let auto = render(
        &regions,
        &split_lines(&base),
        &split_lines(&ours),
        &split_lines(&theirs),
        &HashMap::new(),
        "main",
        "feature",
        true,
    );
    assert!(auto.contains("<<<<<<< main"));
    assert!(
        auto.contains("    43"),
        "unkritische Änderung muss automatisch übernommen werden"
    );

    let mut choices = HashMap::new();
    let idx = regions
        .iter()
        .position(|r| r.kind == Kind::Conflict)
        .unwrap();
    choices.insert(idx, Choice::Theirs);
    let text = render(
        &regions,
        &split_lines(&base),
        &split_lines(&ours),
        &split_lines(&theirs),
        &choices,
        "main",
        "feature",
        true,
    );
    assert!(!text.contains("<<<<<<<"));
    g.write_working_file("src/main.rs", &text).unwrap();
    g.run(["add", "--", "src/main.rs"]).unwrap();

    let st2 = g.status().unwrap();
    assert!(st2.conflicts.is_empty());
    assert!(st2.staged.iter().any(|e| e.path == "src/main.rs"));

    g.run(["commit", "--no-edit"]).unwrap();
    assert_eq!(g.log(10, false, None).unwrap().len(), 4);
    let head = std::fs::read_to_string(dir.join("src/main.rs")).unwrap();
    assert!(head.contains("map.insert(\"b\", 22);"));
}

#[test]
fn identical_edit_on_both_sides_merges_cleanly() {
    let dir = tmp_repo("same");
    let g = setup(&dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/a.txt"), "eins\nzwei\ndrei\nvier\nfuenf\n").unwrap();
    g.run(["add", "-A"]).unwrap();
    g.run(["commit", "-qm", "Basis"]).unwrap();
    for branch in ["links", "rechts"] {
        g.run(["checkout", "-q", "main"]).unwrap();
        g.run(["checkout", "-q", "-b", branch]).unwrap();
        std::fs::write(dir.join("src/a.txt"), "eins\nzwei\nDREI\nvier\nfuenf\n").unwrap();
        g.run(["add", "-A"]).unwrap();
        g.run(["commit", "-qm", branch]).unwrap();
    }
    g.run(["checkout", "-q", "main"]).unwrap();
    g.run(["merge", "links", "-m", "Merge links"]).unwrap();
    let out = g.raw(["merge", "rechts", "--no-edit"]);
    assert_eq!(out.code, 0, "identische Änderung: {}", out.stderr);
    assert_eq!(
        std::fs::read_to_string(dir.join("src/a.txt")).unwrap(),
        "eins\nzwei\nDREI\nvier\nfuenf\n"
    );
}

#[test]
fn branch_listing_reports_state() {
    let dir = tmp_repo("branches");
    let g = make_conflict(&dir);
    let br = g.branches().unwrap();
    let names: Vec<String> = br.iter().map(|b| b.name.clone()).collect();
    assert!(names.contains(&"main".to_string()), "{names:?}");
    assert!(names.contains(&"feature".to_string()), "{names:?}");
    let current = br.iter().find(|b| b.is_current).unwrap();
    assert_eq!(current.name, "main");
    let snap = g.snapshot().unwrap();
    assert_eq!(snap.head_branch.as_deref(), Some("main"));
    assert_eq!(snap.name, "branches");

    G::abort(&g);
    assert!(g.status().unwrap().conflicts.is_empty());
    assert!(!g.snapshot().unwrap().merging);
}

struct G;
impl G {
    fn abort(g: &Git) {
        g.run(["merge", "--abort"]).unwrap();
    }
}

#[test]
fn status_sections_are_separated() {
    let dir = tmp_repo("status");
    let g = setup(&dir);
    std::fs::write(dir.join("a.txt"), "a\n").unwrap();
    std::fs::write(dir.join("b.txt"), "b\n").unwrap();
    g.run(["add", "-A"]).unwrap();
    g.run(["commit", "-qm", "Basis"]).unwrap();

    std::fs::write(dir.join("a.txt"), "a geändert\n").unwrap();
    g.run(["add", "a.txt"]).unwrap();
    std::fs::write(dir.join("b.txt"), "b geändert\n").unwrap();
    std::fs::write(dir.join("neu.txt"), "neu\n").unwrap();

    let st = g.status().unwrap();
    assert!(st.staged.iter().any(|e| e.path == "a.txt"));
    assert!(st.changed.iter().any(|e| e.path == "b.txt"));
    assert!(st.untracked.iter().any(|e| e.path == "neu.txt"));
    assert!(st.conflicts.is_empty());
    assert!(!st.head_subject.is_empty(), "Kopf-Commit muss gemeldet werden");

    g.run(["restore", "--staged", "--", "a.txt"]).unwrap();
    assert!(g
        .status()
        .unwrap()
        .changed
        .iter()
        .any(|e| e.path == "a.txt"));
    g.run(["checkout", "--", "a.txt"]).unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a\n");
}
