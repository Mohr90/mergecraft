use mergecraft_core::gitcli::Git;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Repo {
    git: Git,
    dir: PathBuf,
    linked: PathBuf,
}
impl Repo {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mergecraft-wt-remove-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.join("main");
        std::fs::create_dir(&root).unwrap();
        let git = Git::new(root);
        git.run(["init", "-qb", "main"]).unwrap();
        git.run(["config", "user.name", "Test"]).unwrap();
        git.run(["config", "user.email", "test@example.com"])
            .unwrap();
        std::fs::write(git.path("file"), "base\n").unwrap();
        std::fs::write(git.path(".gitignore"), "ignored\n").unwrap();
        git.run(["add", "."]).unwrap();
        git.run(["commit", "-qm", "base"]).unwrap();
        let linked = dir.join("linked worktree");
        git.run(["worktree", "add", "-b", "cleanup", linked.to_str().unwrap()])
            .unwrap();
        Self { git, dir, linked }
    }
    fn other(&self) -> Git {
        Git::new(&self.linked)
    }
    fn exists(&self) -> bool {
        self.git
            .raw(["show-ref", "--verify", "refs/heads/cleanup"])
            .code
            == 0
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
#[test]
fn removes_confirmed_clean_linked_worktree_and_branch_only() {
    let r = Repo::new();
    let before = r.git.snapshot().unwrap().head;
    r.git
        .run(["update-ref", "refs/remotes/origin/cleanup", &before])
        .unwrap();
    let preview = r
        .git
        .worktree_branch_preview("refs/heads/cleanup")
        .unwrap()
        .unwrap();
    assert!(preview.blocked.is_none());
    assert_eq!(preview.path, r.linked.to_str().unwrap());
    assert!(r.git.remove_worktree_branch(&preview, false).unwrap().ok);
    assert!(!r.linked.exists());
    assert!(!r.exists());
    assert_eq!(r.git.snapshot().unwrap().head, before);
    assert_eq!(
        r.git
            .raw(["show-ref", "--verify", "refs/remotes/origin/cleanup"])
            .code,
        0
    );
}
#[test]
fn protects_changes_untracked_ignored_and_staged_files() {
    for kind in ["modified", "staged", "untracked", "ignored"] {
        let r = Repo::new();
        let other = r.other();
        let path = if kind == "ignored" {
            "ignored"
        } else if kind == "untracked" {
            "new"
        } else {
            "file"
        };
        std::fs::write(other.path(path), "keep my work\n").unwrap();
        if kind == "staged" {
            other.run(["add", "file"]).unwrap();
        }
        let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
        assert!(p.blocked.is_some(), "{kind}");
        assert!(r.git.remove_worktree_branch(&p, true).is_err());
        assert!(r.exists());
        assert_eq!(
            std::fs::read_to_string(other.path(path)).unwrap(),
            "keep my work\n"
        );
    }
}
#[test]
fn protects_locked_current_main_and_stale_worktrees() {
    let r = Repo::new();
    r.git
        .run(["worktree", "lock", r.linked.to_str().unwrap()])
        .unwrap();
    let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(p.blocked.is_some());
    assert!(r.git.remove_worktree_branch(&p, true).is_err());
    r.git
        .run(["worktree", "unlock", r.linked.to_str().unwrap()])
        .unwrap();
    let current = r
        .other()
        .worktree_branch_preview("cleanup")
        .unwrap()
        .unwrap();
    assert!(current.blocked.is_some());
    let main = r.other().worktree_branch_preview("main").unwrap().unwrap();
    assert!(main.blocked.is_some());
    let preview = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    std::fs::write(r.other().path("ignored"), "new external data").unwrap();
    assert!(r.git.remove_worktree_branch(&preview, true).is_err());
    assert!(r.linked.exists());
    std::fs::remove_file(r.other().path("ignored")).unwrap();
    let mut wrong = preview.clone();
    wrong.path = r.git.root.display().to_string();
    assert!(r.git.remove_worktree_branch(&wrong, true).is_err());
    assert!(r.git.root.exists());
}
#[test]
fn requires_separate_confirmation_for_own_commits_and_rechecks_head() {
    let r = Repo::new();
    let other = r.other();
    std::fs::write(other.path("file"), "own commit\n").unwrap();
    other.run(["commit", "-qam", "own"]).unwrap();
    let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(r.git.remove_worktree_branch(&p, false).is_err());
    assert!(r.linked.exists());
    std::fs::write(r.git.path("extra"), "caller commit").unwrap();
    r.git.run(["add", "."]).unwrap();
    r.git.run(["commit", "-qm", "caller changed"]).unwrap();
    assert!(r.git.remove_worktree_branch(&p, true).is_err());
    let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(r.git.remove_worktree_branch(&p, true).unwrap().ok);
    assert!(!r.exists());
}

#[test]
fn refuses_running_merge_and_reports_partial_git_failure() {
    use std::os::unix::fs::PermissionsExt;
    let r = Repo::new();
    let other = r.other();
    std::fs::write(other.path("file"), "ours\n").unwrap();
    other.run(["commit", "-qam", "ours"]).unwrap();
    r.git.run(["switch", "-c", "incoming"]).unwrap();
    std::fs::write(r.git.path("file"), "theirs\n").unwrap();
    r.git.run(["commit", "-qam", "theirs"]).unwrap();
    r.git.run(["switch", "main"]).unwrap();
    assert_ne!(other.raw(["merge", "incoming", "--no-edit"]).code, 0);
    let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(p.blocked.unwrap().contains("Git-Vorgang"));
    assert!(r.linked.exists());
    other.run(["merge", "--abort"]).unwrap();
    let hook = r.git.path(".git/hooks/reference-transaction");
    std::fs::write(&hook,"#!/bin/sh\nif [ \"$1\" = prepared ]; then\n while read old new ref; do\n  if [ \"$ref\" = refs/heads/cleanup ] && [ \"$new\" = 0000000000000000000000000000000000000000 ]; then exit 1; fi\n done\nfi\nexit 0\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let p = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    let result = r.git.remove_worktree_branch(&p, true).unwrap();
    assert!(!result.ok);
    assert!(result
        .stderr
        .starts_with("Worktree entfernt; der Branch wurde nicht gelöscht."));
    assert!(!r.linked.exists());
    assert!(r.exists());
}

#[test]
fn merged_into_current_branch_is_removable_even_if_upstream_is_behind() {
    let r = Repo::new();
    let base = r.git.snapshot().unwrap().head;
    r.git
        .run(["remote", "add", "origin", "/unused-local-remote"])
        .unwrap();
    r.git
        .run(["update-ref", "refs/remotes/origin/cleanup", &base])
        .unwrap();
    r.git
        .run(["branch", "--set-upstream-to=origin/cleanup", "cleanup"])
        .unwrap();
    let other = r.other();
    std::fs::write(other.path("file"), "merged local commit\n").unwrap();
    other.run(["commit", "-qam", "local"]).unwrap();
    r.git.run(["merge", "--ff-only", "cleanup"]).unwrap();
    let preview = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(r.git.remove_worktree_branch(&preview, false).unwrap().ok);
    assert!(!r.exists());
    assert!(!r.linked.exists());
}

#[test]
fn explicit_discard_removes_dirty_files_but_never_bypasses_structural_guards() {
    for kind in ["modified", "staged", "untracked", "ignored"] {
        let r = Repo::new();
        let file = match kind { "untracked" => "new", "ignored" => "ignored", _ => "file" };
        std::fs::write(r.other().path(file), "discard me\n").unwrap();
        if kind == "staged" { r.other().run(["add", "file"]).unwrap(); }
        let preview = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
        assert!(preview.discardable);
        assert!(r.git.remove_worktree_branch(&preview, true).is_err());
        assert!(r.git.remove_worktree_branch_discard(&preview, true, true).unwrap().ok);
        assert!(!r.linked.exists()); assert!(!r.exists());
    }
    let r = Repo::new();
    std::fs::write(r.other().path("ignored"), "first").unwrap();
    let preview = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    std::fs::write(r.other().path("ignored"), "other").unwrap();
    assert!(r.git.remove_worktree_branch_discard(&preview,true,true).is_err());
    r.git.run(["worktree", "lock", r.linked.to_str().unwrap()]).unwrap();
    let locked = r.git.worktree_branch_preview("cleanup").unwrap().unwrap();
    assert!(!locked.discardable);
    assert!(r.git.remove_worktree_branch_discard(&locked,true,true).is_err());
    assert!(r.linked.exists()); assert!(r.exists());
    let main = r.git.worktree_branch_preview("main").unwrap().unwrap();
    assert!(!main.discardable);
    assert!(r.git.remove_worktree_branch_discard(&main,true,true).is_err());
}
