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

    let regions = merge_regions(
        &split_lines(&base),
        &split_lines(&ours),
        &split_lines(&theirs),
    );
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
    assert!(
        !st.head_subject.is_empty(),
        "Kopf-Commit muss gemeldet werden"
    );

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

#[test]
fn whole_side_resolution_preserves_binary_bytes_and_deletion() {
    for deleted in [false, true] {
        let dir = tmp_repo(if deleted {
            "side-delete"
        } else {
            "side-binary"
        });
        let g = setup(&dir);
        let path = "asset.bin";
        std::fs::write(dir.join(path), [0, 255, 1, 2]).unwrap();
        g.run(["add", "--", path]).unwrap();
        g.run(["commit", "-qm", "base"]).unwrap();
        g.run(["checkout", "-qb", "feature"]).unwrap();
        if deleted {
            g.run(["rm", "--", path]).unwrap();
        } else {
            std::fs::write(dir.join(path), [0, 254, 3]).unwrap();
            g.run(["add", "--", path]).unwrap();
        }
        g.run(["commit", "-qm", "feature"]).unwrap();
        g.run(["checkout", "-q", "main"]).unwrap();
        std::fs::write(dir.join(path), [0, 253, 4]).unwrap();
        g.run(["add", "--", path]).unwrap();
        g.run(["commit", "-qm", "ours"]).unwrap();
        assert_ne!(g.raw(["merge", "feature", "--no-edit"]).code, 0);
        assert!(g.resolve_side(path, "theirs").unwrap().ok);
        assert!(g.status().unwrap().conflicts.is_empty());
        if deleted {
            assert!(!dir.join(path).exists());
        } else {
            assert_eq!(std::fs::read(dir.join(path)).unwrap(), vec![0, 254, 3]);
        }
    }
}

#[test]
fn branch_checkout_reuses_local_tracking_branch_and_rejects_options() {
    let dir = tmp_repo("tracking");
    let g = setup(&dir);
    std::fs::write(dir.join("a"), "base").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    g.run(["update-ref", "refs/remotes/origin/feature", "HEAD"])
        .unwrap();
    g.run(["config", "remote.origin.url", "."]).unwrap();
    g.run([
        "config",
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
    ])
    .unwrap();
    assert!(
        g.checkout_branch("origin/feature", Some("feature"), false, true)
            .unwrap()
            .ok
    );
    g.run(["checkout", "main"]).unwrap();
    assert!(
        g.checkout_branch("origin/feature", Some("feature"), false, true)
            .unwrap()
            .ok
    );
    assert_eq!(
        g.snapshot().unwrap().head_branch.as_deref(),
        Some("feature")
    );
    assert!(g.create_branch("--bad", None, true).is_err());
    assert!(g.checkout_branch("--detach", None, false, false).is_err());
    g.run(["checkout", "main"]).unwrap();
    // A same-named local branch with a different upstream must not be selected silently.
    g.run(["config", "branch.feature.merge", "refs/heads/other"])
        .unwrap();
    assert!(g
        .checkout_branch("origin/feature", Some("feature"), false, true)
        .is_err());
    assert_eq!(g.snapshot().unwrap().head_branch.as_deref(), Some("main"));
}

#[test]
fn file_comparison_preserves_unusual_paths_and_detects_non_utf8() {
    let dir = tmp_repo("unusual-paths");
    let g = setup(&dir);
    std::fs::write(dir.join("base"), "base").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    let before = g.snapshot().unwrap().head;
    let unusual = "name\twith\nlines.txt";
    std::fs::write(dir.join(unusual), "text").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "new path"]).unwrap();
    let files = g.diff_files(&before, "HEAD", None).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, unusual);
    std::fs::write(dir.join("bytes"), [255, 254, 253]).unwrap();
    assert!(
        g.working_file("bytes").unwrap().1,
        "invalid UTF-8 must not enter the text editor"
    );
    g.run(["add", "bytes"]).unwrap();
    assert!(g.blob(":0:bytes").unwrap().1);
}

#[test]
fn tags_resolve_annotated_lightweight_and_non_commit_objects() {
    let dir = tmp_repo("tags");
    let g = setup(&dir);
    assert!(g.tags().unwrap().is_empty());
    std::fs::write(dir.join("base"), "base").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    let base = g.snapshot().unwrap().head;
    g.run(["tag", "-a", "v1.0", "-m", "Release notes"]).unwrap();
    g.run(["tag", "plain"]).unwrap();
    g.run(["tag", "-a", "nested", "v1.0", "-m", "Nested release"])
        .unwrap();
    let blob = g.run(["hash-object", "-w", "base"]).unwrap();
    g.run(["tag", "blob-only", blob.trim()]).unwrap();
    std::fs::write(dir.join("base"), "next").unwrap();
    g.run(["commit", "-am", "next"]).unwrap();
    g.run(["branch", "v1.0"]).unwrap();
    let tags = g.tags().unwrap();
    assert_eq!(tags.len(), 4);
    let release = tags.iter().find(|t| t.name == "v1.0").unwrap();
    assert!(release.is_annotated);
    assert_eq!(release.subject, "Release notes");
    assert_eq!(release.commit.as_deref(), Some(base.as_str()));
    assert_eq!(
        tags.iter()
            .find(|t| t.name == "nested")
            .unwrap()
            .commit
            .as_deref(),
        Some(base.as_str())
    );
    assert!(
        !tags
            .iter()
            .find(|t| t.name == "plain")
            .unwrap()
            .is_annotated
    );
    assert!(tags
        .iter()
        .find(|t| t.name == "blob-only")
        .unwrap()
        .commit
        .is_none());
    assert_eq!(g.commit_info(&release.full_name).unwrap().hash, base);
    assert!(
        g.create_branch("from-tag", Some(&release.full_name), true)
            .unwrap()
            .ok
    );
    assert_eq!(
        g.snapshot().unwrap().head,
        base,
        "branch/tag name collision must use the tag"
    );
}

#[test]
fn rollback_restores_only_selected_files_without_creating_stashes() {
    let dir = tmp_repo("rollback");
    let g = setup(&dir);
    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    std::fs::write(dir.join("bin"), [0, 255, 1]).unwrap();
    std::fs::write(dir.join("other.txt"), "other").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    let head = g.snapshot().unwrap().head;
    std::fs::write(dir.join("a.txt"), "manual stash").unwrap();
    g.save_stash("existing manual stash").unwrap();
    let stashes: Vec<_> = g.stashes().unwrap().into_iter().map(|s| s.oid).collect();
    std::fs::write(dir.join("a.txt"), "staged\n").unwrap();
    g.run(["add", "a.txt"]).unwrap();
    std::fs::write(dir.join("a.txt"), "working\n").unwrap();
    std::fs::write(dir.join("bin"), [0, 254, 2]).unwrap();
    std::fs::write(dir.join("other.txt"), "keep this change").unwrap();
    std::fs::write(dir.join("keep.txt"), "untracked").unwrap();
    assert!(
        g.rollback(&["a.txt".into(), "bin".into()], &head)
            .unwrap()
            .ok
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "base\n"
    );
    assert_eq!(g.blob(":0:a.txt").unwrap().0, "base\n");
    assert_eq!(std::fs::read(dir.join("bin")).unwrap(), vec![0, 255, 1]);
    assert_eq!(
        std::fs::read_to_string(dir.join("other.txt")).unwrap(),
        "keep this change"
    );
    assert!(dir.join("keep.txt").exists());
    assert_eq!(g.snapshot().unwrap().head, head);
    assert_eq!(
        g.stashes()
            .unwrap()
            .into_iter()
            .map(|s| s.oid)
            .collect::<Vec<_>>(),
        stashes,
        "rollback must not change the stash list"
    );
}

#[test]
fn rollback_validates_targets_and_handles_renames_and_staged_additions() {
    let dir = tmp_repo("rollback-targets");
    let g = setup(&dir);
    std::fs::write(dir.join("old.txt"), "base").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    let head = g.snapshot().unwrap().head;
    g.run(["mv", "old.txt", "new.txt"]).unwrap();
    std::fs::write(dir.join("added.txt"), "new content").unwrap();
    g.run(["add", "added.txt"]).unwrap();
    std::fs::write(dir.join("untouched"), "keep").unwrap();
    assert!(g.rollback(&[], &head).is_err());
    assert!(g.rollback(&["../outside".into()], &head).is_err());
    assert!(g.rollback(&["untouched".into()], &head).is_err());
    assert!(g.rollback(&["new.txt".into()], "wrong-head").is_err());
    assert!(
        g.stashes().unwrap().is_empty(),
        "validation must happen before backup or mutation"
    );
    assert!(
        g.rollback(&["new.txt".into(), "added.txt".into()], &head)
            .unwrap()
            .ok
    );
    assert!(dir.join("old.txt").exists());
    assert!(!dir.join("new.txt").exists());
    assert!(!dir.join("added.txt").exists());
    assert_eq!(
        std::fs::read_to_string(dir.join("untouched")).unwrap(),
        "keep"
    );
    assert!(
        g.stashes().unwrap().is_empty(),
        "rollback must not create an automatic stash"
    );
}

#[test]
fn stash_parks_untracked_files_and_refuses_dirty_restore_or_merge_rollback() {
    let dir = tmp_repo("stash-parking");
    let g = setup(&dir);
    std::fs::write(dir.join("a"), "base").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    std::fs::write(dir.join("a"), "changed").unwrap();
    std::fs::write(dir.join("new"), "new").unwrap();
    assert!(g.save_stash("Before switching branches").unwrap().ok);
    assert!(g.status().unwrap().all.is_empty());
    let stash = g.stashes().unwrap().remove(0);
    std::fs::write(dir.join("extra"), "keep").unwrap();
    assert!(g.apply_stash(&stash.oid).is_err());
    std::fs::remove_file(dir.join("extra")).unwrap();
    assert!(g.apply_stash("not-a-stash").is_err());
    assert!(g.apply_stash(&stash.oid).unwrap().ok);
    assert_eq!(std::fs::read_to_string(dir.join("new")).unwrap(), "new");
    let conflict_dir = tmp_repo("rollback-merge");
    let conflict = make_conflict(&conflict_dir);
    let head = conflict.snapshot().unwrap().head;
    assert!(conflict.rollback(&["src/main.rs".into()], &head).is_err());
    assert!(conflict.save_stash("during merge").is_err());
}

#[test]
fn rollback_and_untracked_deletion_use_literal_paths() {
    let dir = tmp_repo("rollback-literal");
    let g = setup(&dir);
    let special = ":(glob)*.txt";
    std::fs::write(dir.join(special), "base").unwrap();
    std::fs::write(dir.join("other.txt"), "other").unwrap();
    g.run(["--literal-pathspecs", "add", "."]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    let head = g.snapshot().unwrap().head;
    std::fs::write(dir.join(special), "changed").unwrap();
    std::fs::write(dir.join("other.txt"), "keep change").unwrap();
    assert!(g.rollback(&[special.into()], &head).unwrap().ok);
    assert_eq!(std::fs::read_to_string(dir.join(special)).unwrap(), "base");
    assert_eq!(
        std::fs::read_to_string(dir.join("other.txt")).unwrap(),
        "keep change"
    );
    assert!(g.discard_untracked(&["other.txt".into()]).is_err());
    let untracked = ":(glob)other*";
    std::fs::write(dir.join(untracked), "delete me").unwrap();
    assert!(g.discard_untracked(&[untracked.into()]).unwrap().ok);
    assert!(!dir.join(untracked).exists());
    assert!(dir.join("other.txt").exists());
}

#[test]
fn file_history_follows_renames_and_treats_paths_literally() {
    let dir = tmp_repo("file-history");
    let g = setup(&dir);
    std::fs::write(dir.join("old.txt"), "base\n").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "first file"]).unwrap();
    g.run(["mv", "old.txt", "new.txt"]).unwrap();
    g.run(["commit", "-qm", "rename file"]).unwrap();
    std::fs::write(dir.join("other.txt"), "unrelated\n").unwrap();
    g.run(["add", "."]).unwrap();
    g.run(["commit", "-qm", "other file"]).unwrap();
    let history = g.file_history("new.txt", 100).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].subject, "rename file");
    assert_eq!(history[1].subject, "first file");
    assert!(
        g.file_history("*.txt", 100).unwrap().is_empty(),
        "file history must not interpret glob syntax"
    );
}

#[test]
fn tracking_status_distinguishes_unpushed_incoming_and_missing_upstream() {
    let dir=tmp_repo("tracking-status");let g=setup(&dir);
    g.run(["commit","--allow-empty","-qm","base"]).unwrap();
    g.run(["remote","add","origin",dir.to_str().unwrap()]).unwrap();
    g.run(["update-ref","refs/remotes/origin/main","HEAD"]).unwrap();
    g.run(["branch","--set-upstream-to=origin/main","main"]).unwrap();
    let current=||g.branches().unwrap().into_iter().find(|b|b.is_current).unwrap();
    assert!(current().tracking_known);assert_eq!((current().ahead,current().behind),(0,0));
    g.run(["commit","--allow-empty","-qm","local"]).unwrap();
    assert_eq!((current().ahead,current().behind),(1,0));
    g.run(["update-ref","refs/remotes/origin/main","HEAD"]).unwrap();
    assert_eq!((current().ahead,current().behind),(0,0));
    let tree=g.run(["rev-parse","HEAD^{tree}"]).unwrap();let head=g.run(["rev-parse","HEAD"]).unwrap();
    let remote=g.run(["commit-tree",tree.trim(),"-p",head.trim(),"-m","remote change"]).unwrap();
    g.run(["update-ref","refs/remotes/origin/main",remote.trim()]).unwrap();
    assert_eq!((current().ahead,current().behind),(0,1));
    g.run(["commit","--allow-empty","-qm","diverged"]).unwrap();
    assert_eq!((current().ahead,current().behind),(1,1));
    g.run(["update-ref","-d","refs/remotes/origin/main"]).unwrap();assert!(!current().tracking_known);
    g.run(["branch","--unset-upstream","main"]).unwrap();assert!(current().upstream.is_none());assert!(!current().tracking_known);
}

#[test]
fn pull_tracking_confirmation_preserves_staged_work_and_pulls_remote() {
    let dir = tmp_repo("pull-tracking");
    let remote = tmp_repo("pull-tracking-remote");
    Git::new(remote.clone()).run(["init", "--bare", "-q"]).unwrap();
    let g = setup(&dir);
    std::fs::write(dir.join(".gitignore"), "base\n").unwrap();
    g.run(["add", ".gitignore"]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    g.run(["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
    g.run(["push", "-q", "origin", "main"]).unwrap();
    g.run(["checkout", "-qb", "remote-update"]).unwrap();
    std::fs::write(dir.join("remote.txt"), "remote update\n").unwrap();
    g.run(["add", "remote.txt"]).unwrap();
    g.run(["commit", "-qm", "remote update"]).unwrap();
    g.run(["push", "-q", "origin", "HEAD:main"]).unwrap();
    g.run(["checkout", "-q", "main"]).unwrap();
    std::fs::write(dir.join(".gitignore"), "base\nmy local change\n").unwrap();
    g.run(["add", ".gitignore"]).unwrap();
    let staged = g.run(["diff", "--cached", "--binary"]).unwrap();
    let head = g.run(["rev-parse", "HEAD"]).unwrap();
    assert!(g.prepare_pull(Some("main"), false).is_err());
    assert!(g.prepare_pull(Some("other"), true).is_err());
    assert!(g.branches().unwrap().iter().find(|b| b.is_current).unwrap().upstream.is_none());
    g.prepare_pull(Some("main"), true).unwrap();
    assert_eq!(g.run(["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(g.run(["diff", "--cached", "--binary"]).unwrap(), staged);
    g.run(["pull", "--ff-only"]).unwrap();
    assert!(dir.join("remote.txt").exists());
    assert_eq!(g.run(["diff", "--cached", "--binary"]).unwrap(), staged);
    g.prepare_pull(Some("main"), false).unwrap();
}

#[test]
fn pull_tracking_does_not_guess_missing_or_ambiguous_remotes() {
    let dir = tmp_repo("pull-tracking-ambiguous");
    let g = setup(&dir);
    std::fs::write(dir.join("base"), "base\n").unwrap();
    g.run(["add", "base"]).unwrap();
    g.run(["commit", "-qm", "base"]).unwrap();
    assert!(g.prepare_pull(Some("main"), true).is_err());
    for remote in ["origin", "second"] {
        g.run(["remote", "add", remote, "/unused-local-remote"]).unwrap();
        g.run(["update-ref", &format!("refs/remotes/{remote}/main"), "HEAD"]).unwrap();
    }
    assert!(g.prepare_pull(Some("main"), true).is_err());
    assert!(g.branches().unwrap().iter().find(|b| b.is_current).unwrap().upstream.is_none());
    g.run(["checkout", "--detach", "-q"]).unwrap();
    assert!(g.prepare_pull(None, true).is_err());
}

#[test]
fn remote_checkout_update_preserves_local_work_and_never_discards_commits() {
    let dir=tmp_repo("remote-checkout-update");
    let g=setup(&dir);
    std::fs::write(dir.join("file"),"base\n").unwrap();
    g.run(["add","file"]).unwrap();
    g.run(["commit","-qm","base"]).unwrap();
    g.run(["branch","feature"]).unwrap();
    let base=g.snapshot().unwrap().head;
    g.run(["remote","add","origin","/unused-local-remote"]).unwrap();
    g.run(["switch","-c","remote-source"]).unwrap();
    std::fs::write(dir.join("file"),"remote update\n").unwrap();
    g.run(["commit","-qam","remote update"]).unwrap();
    let remote=g.snapshot().unwrap().head;
    g.run(["update-ref","refs/remotes/origin/feature",&remote]).unwrap();
    g.run(["switch","main"]).unwrap();
    std::fs::write(dir.join("file"),"unsaved local change\n").unwrap();
    assert!(g.checkout_remote_update("origin/feature","feature",&base,&remote).is_err());
    assert_eq!(g.snapshot().unwrap().head_branch.as_deref(),Some("main"));
    assert_eq!(std::fs::read_to_string(dir.join("file")).unwrap(),"unsaved local change\n");
    g.run(["restore","file"]).unwrap();
    assert!(g.checkout_remote_update("origin/feature","feature",&base,&base).is_err());
    assert_eq!(g.snapshot().unwrap().head_branch.as_deref(),Some("main"));
    assert!(g.checkout_remote_update("origin/feature","feature",&base,&remote).unwrap().ok);
    assert_eq!(g.snapshot().unwrap().head,remote);
    assert_eq!(g.snapshot().unwrap().head_branch.as_deref(),Some("feature"));
    assert_eq!(g.branches().unwrap().iter().find(|b|b.is_current).unwrap().upstream.as_deref(),Some("origin/feature"));
    std::fs::write(dir.join("local.txt"),"local commit\n").unwrap();
    g.run(["add","local.txt"]).unwrap();
    g.run(["commit","-qm","own local commit"]).unwrap();
    let own=g.snapshot().unwrap().head;
    g.run(["switch","main"]).unwrap();
    assert!(g.checkout_remote_update("origin/feature","feature",&own,&remote).is_err());
    assert_eq!(g.run(["rev-parse","feature"]).unwrap().trim(),own);
    assert_eq!(g.snapshot().unwrap().head_branch.as_deref(),Some("main"));
    assert!(g.checkout_remote_update("-bad","feature",&base,&remote).is_err());
}
