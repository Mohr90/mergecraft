use mergecraft_core::gitcli::Git;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Repo {
    g: Git,
    dir: PathBuf,
}
impl Repo {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mergecraft-v140-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let g = Git::new(&dir);
        g.run(["init", "-qb", "work"]).unwrap();
        g.run(["config", "core.autocrlf", "false"]).unwrap();
        g.run(["config", "user.name", "Test"]).unwrap();
        g.run(["config", "user.email", "test@example.com"]).unwrap();
        let repo = Self { g, dir };
        repo.write("file.txt", "base\n");
        repo.commit("base");
        repo
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.dir.join(path), text).unwrap();
    }
    fn commit(&self, msg: &str) {
        self.g.run(["add", "-A"]).unwrap();
        self.g.run(["commit", "-qm", msg]).unwrap();
    }
    fn head(&self) -> String {
        self.g.run(["rev-parse", "HEAD"]).unwrap().trim().into()
    }
    fn preview(&self, name: &str) -> mergecraft_core::model::MergePreview {
        self.g.merge_preview(name, &AtomicBool::new(false)).unwrap()
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn merge_preview_is_read_only_and_checked() {
    let r = Repo::new();
    assert_eq!(r.preview("work").kind, "up_to_date");
    r.g.run(["switch", "-qc", "source"]).unwrap();
    r.write("file.txt", "incoming\n");
    r.commit("incoming");
    r.g.run(["switch", "work"]).unwrap();
    let before = r.head();
    let index = r.g.run(["ls-files", "-s"]).unwrap();
    let preview = r.preview("source");
    assert_eq!(preview.kind, "fast_forward");
    assert_eq!(preview.incoming, 1);
    assert_eq!(r.head(), before);
    assert_eq!(r.g.run(["ls-files", "-s"]).unwrap(), index);
    assert_eq!(
        std::fs::read_to_string(r.dir.join("file.txt")).unwrap(),
        "base\n"
    );
    assert!(r.g.merge_checked(&preview, false).unwrap().ok);
    assert_ne!(r.head(), before);
    r.g.run(["switch", "-qc", "other"]).unwrap();
    r.write("other", "other\n");
    r.commit("other");
    r.g.run(["switch", "work"]).unwrap();
    let stale = r.preview("other");
    r.g.run(["update-ref", "refs/heads/other", &before])
        .unwrap();
    assert!(r.g.merge_checked(&stale, true).is_err());
    r.write("file.txt", "dirty\n");
    assert!(r
        .g
        .merge_preview("source", &AtomicBool::new(false))
        .is_err());
}

#[test]
fn merge_preview_covers_content_delete_add_rename_and_binary_conflicts() {
    for case in ["content", "delete", "add", "rename", "binary"] {
        let r = Repo::new();
        r.g.run(["switch", "-qc", "source"]).unwrap();
        match case {
            "delete" => {
                r.g.run(["rm", "file.txt"]).unwrap();
            }
            "add" => r.write("new.txt", "theirs\n"),
            "rename" => {
                r.g.run(["mv", "file.txt", "theirs.txt"]).unwrap();
            }
            "binary" => {
                std::fs::write(r.dir.join("file.txt"), b"\0theirs").unwrap();
            }
            _ => r.write("file.txt", "theirs\n"),
        };
        r.commit("incoming");
        r.g.run(["switch", "work"]).unwrap();
        match case {
            "add" => r.write("new.txt", "ours\n"),
            "rename" => {
                r.g.run(["mv", "file.txt", "ours.txt"]).unwrap();
            }
            "binary" => {
                std::fs::write(r.dir.join("file.txt"), b"\0ours").unwrap();
            }
            _ => r.write("file.txt", "ours\n"),
        };
        r.commit("ours");
        let before = r.head();
        let preview = r.preview("source");
        assert_eq!(preview.kind, "conflicts", "{case}");
        assert!(!preview.conflicts.is_empty(), "{case}");
        assert!(!r.g.snapshot().unwrap().merging);
        assert_eq!(r.head(), before);
        let actual = r.g.merge_checked(&preview, true).unwrap();
        assert!(!actual.ok);
        assert!(!actual.conflicts.is_empty());
        r.g.run(["merge", "--abort"]).unwrap();
    }
}

#[test]
fn clean_divergent_preview_result_keeps_both_sides_and_can_cancel() {
    let r = Repo::new();
    r.g.run(["switch", "-qc", "source"]).unwrap();
    r.write("incoming", "theirs\n");
    r.commit("incoming");
    r.g.run(["switch", "work"]).unwrap();
    r.write("ours", "ours\n");
    r.commit("ours");
    assert!(r.g.merge_preview("source", &AtomicBool::new(true)).is_err());
    let p = r.preview("source");
    assert_eq!(p.kind, "clean");
    assert!(r.g.blob(&format!("{}:ours", p.tree_oid)).is_some());
    assert!(r.g.blob(&format!("{}:incoming", p.tree_oid)).is_some());
    assert!(r.g.merge_checked(&p, true).unwrap().ok);
    assert_eq!(r.g.commit_info("HEAD").unwrap().parents.len(), 2);
}

#[test]
fn hunks_stage_only_selected_content_and_reject_stale_changes() {
    for newline in ["\n", "\r\n"] {
        let r = Repo::new();
        let base = (0..20)
            .map(|i| format!("line {i}{newline}"))
            .collect::<String>();
        r.write("file.txt", &base);
        r.commit("lines");
        let changed = base
            .replace("line 1", "first 1")
            .replace("line 18", "last 18");
        r.write("file.txt", &changed);
        let p = r.g.hunk_set("file.txt", "work").unwrap();
        assert!(p.patches.len() >= 2);
        assert!(r.g.apply_hunk("file.txt", "work", 0, &p.token).unwrap().ok);
        let index = r.g.blob(":0:file.txt").unwrap().0;
        assert!(index.contains("first 1"));
        assert!(index.contains("line 18"));
        assert_eq!(
            std::fs::read_to_string(r.dir.join("file.txt")).unwrap(),
            changed
        );
        assert!(r.g.apply_hunk("file.txt", "work", 0, &p.token).is_err());
        let staged = r.g.hunk_set("file.txt", "staged").unwrap();
        assert!(
            r.g.apply_hunk("file.txt", "staged", 0, &staged.token)
                .unwrap()
                .ok
        );
        assert_eq!(r.g.blob(":0:file.txt").unwrap().0, base);
        let p = r.g.hunk_set("file.txt", "work").unwrap();
        r.write("file.txt", &(changed + "external"));
        assert!(r.g.apply_hunk("file.txt", "work", 0, &p.token).is_err());
    }
}

#[test]
fn hunks_handle_add_delete_no_final_newline_and_literal_paths() {
    let r = Repo::new();
    r.write("[new].txt", "hello\nworld");
    r.g.run(["add", "--intent-to-add", "--", "[new].txt"])
        .unwrap();
    let p = r.g.hunk_set("[new].txt", "work").unwrap();
    assert_eq!(p.patches.len(), 1);
    let applied = r.g.apply_hunk("[new].txt", "work", 0, &p.token).unwrap();
    assert!(applied.ok, "{}", applied.stderr);
    assert_eq!(r.g.blob(":0:[new].txt").unwrap().0, "hello\nworld");
    r.commit("added");
    std::fs::remove_file(r.dir.join("[new].txt")).unwrap();
    let p = r.g.hunk_set("[new].txt", "work").unwrap();
    let result = r.g.apply_hunk("[new].txt", "work", 0, &p.token).unwrap();
    assert!(result.ok, "{}", result.stderr);
    assert!(
        r.g.blob(":0:[new].txt").is_none(),
        "{:?}\n{}",
        p.patches,
        r.g.run(["ls-files", "-s"]).unwrap()
    );
    let p = r.g.hunk_set("[new].txt", "staged").unwrap();
    let result = r.g.apply_hunk("[new].txt", "staged", 0, &p.token).unwrap();
    assert!(result.ok, "{}", result.stderr);
    assert_eq!(r.g.blob(":0:[new].txt").unwrap().0, "hello\nworld");
    r.write("binary", "\0bin");
    r.g.run(["add", "binary"]).unwrap();
    assert!(r.g.hunk_set("binary", "staged").unwrap().reason.is_some());
}

#[test]
fn revert_preserves_history_and_guards_input() {
    let r = Repo::new();
    assert!(r.g.revert_preview("HEAD").is_err());
    r.write("file.txt", "fix\n");
    r.commit("fix");
    let original = r.head();
    r.g.run(["update-ref", "refs/remotes/origin/work", &original])
        .unwrap();
    let p = r.g.revert_preview("HEAD").unwrap();
    assert_eq!(r.head(), original);
    assert!(r.g.revert_checked(&original, &p.token).unwrap().ok);
    assert_eq!(
        r.g.commit_info("HEAD").unwrap().parents,
        vec![original.clone()]
    );
    assert_eq!(r.g.blob("HEAD:file.txt").unwrap().0, "base\n");
    assert_eq!(
        r.g.run(["rev-parse", "refs/remotes/origin/work"])
            .unwrap()
            .trim(),
        original
    );
    let p = r.g.revert_preview("HEAD").unwrap();
    r.write("dirty", "work");
    assert!(r.g.revert_checked(&p.commit.hash, &p.token).is_err());
    assert_eq!(
        std::fs::read_to_string(r.dir.join("dirty")).unwrap(),
        "work"
    );
    r.g.run(["switch", "-qc", "elsewhere"]).unwrap();
    std::fs::remove_file(r.dir.join("dirty")).unwrap();
    r.write("other", "other");
    r.commit("other");
    let other = r.head();
    r.g.run(["switch", "work"]).unwrap();
    assert!(r.g.revert_preview(&other).is_err());
}

#[test]
fn revert_conflicts_continue_abort_empty_and_hooks() {
    use std::os::unix::fs::PermissionsExt;
    let r = Repo::new();
    r.write("file.txt", "first\n");
    r.commit("first");
    let first = r.head();
    r.write("file.txt", "later\n");
    r.commit("later");
    let before = r.head();
    let p = r.g.revert_preview(&first).unwrap();
    let out = r.g.revert_checked(&first, &p.token).unwrap();
    assert_eq!(out.conflicts, vec!["file.txt"]);
    assert!(r.g.snapshot().unwrap().reverting);
    r.write("file.txt", "resolved\n");
    r.g.run(["add", "file.txt"]).unwrap();
    let token = r.g.workflow_token().unwrap();
    assert!(r.g.revert_control(true, &token).unwrap().ok);
    assert_eq!(r.head(), before);
    assert_eq!(r.g.blob("HEAD:file.txt").unwrap().0, "later\n");
    let p = r.g.revert_preview(&first).unwrap();
    r.g.revert_checked(&first, &p.token).unwrap();
    r.write("file.txt", "resolved\n");
    r.g.run(["add", "file.txt"]).unwrap();
    let token = r.g.workflow_token().unwrap();
    assert!(r.g.revert_control(false, &token).unwrap().ok);
    assert!(!r.g.snapshot().unwrap().reverting);
    let hook = r.dir.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho blocked-by-test >&2\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let p = r.g.revert_preview("HEAD").unwrap();
    let out = r.g.revert_checked(&p.commit.hash, &p.token).unwrap();
    assert!(!out.ok);
    assert!(out.stderr.contains("blocked-by-test"));
    assert!(
        r.g.snapshot().unwrap().reverting,
        "hook failure must remain recoverable"
    );
    let token = r.g.workflow_token().unwrap();
    assert!(r.g.revert_control(true, &token).unwrap().ok);
}

#[test]
fn empty_revert_remains_abortable_and_external_edits_block_continue() {
    let r = Repo::new();
    r.write("file.txt", "fix\n");
    r.commit("fix");
    let fix = r.head();
    let p = r.g.revert_preview(&fix).unwrap();
    assert!(r.g.revert_checked(&fix, &p.token).unwrap().ok);
    let before = r.head();
    let p = r.g.revert_preview(&fix).unwrap();
    let empty = r.g.revert_checked(&fix, &p.token).unwrap();
    assert!(!empty.ok);
    assert!(r.g.snapshot().unwrap().reverting);
    let stale = r.g.workflow_token().unwrap();
    r.write("file.txt", "external\n");
    assert!(r.g.revert_control(false, &stale).is_err());
    r.g.run(["restore", "--", "file.txt"]).unwrap();
    let token = r.g.workflow_token().unwrap();
    assert!(r.g.revert_control(true, &token).unwrap().ok);
    assert_eq!(before, r.head());
    assert!(!r.g.snapshot().unwrap().reverting);
}
