use mergecraft_core::gitcli::Git;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    dir: PathBuf,
    local: Git,
    peer: Git,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mergecraft-pull-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.join("local");
        std::fs::create_dir(&root).unwrap();
        let local = Git::new(&root);
        local.run(["init", "-qb", "main"]).unwrap();
        Self::identity(&local);
        std::fs::write(local.path("file"), "base\n").unwrap();
        local.run(["add", "."]).unwrap();
        local.run(["commit", "-qm", "base"]).unwrap();
        let remote = dir.join("remote.git");
        local
            .run(["clone", "--bare", ".", remote.to_str().unwrap()])
            .unwrap();
        local
            .run(["remote", "add", "origin", remote.to_str().unwrap()])
            .unwrap();
        local.run(["push", "-u", "origin", "main"]).unwrap();
        let peer_root = dir.join("peer");
        local
            .run([
                "clone",
                remote.to_str().unwrap(),
                peer_root.to_str().unwrap(),
            ])
            .unwrap();
        let peer = Git::new(peer_root);
        Self::identity(&peer);
        Self { dir, local, peer }
    }
    fn identity(g: &Git) {
        g.run(["config", "user.name", "Test"]).unwrap();
        g.run(["config", "user.email", "test@example.com"]).unwrap();
    }
    fn commit(g: &Git, path: &str, text: &str) {
        std::fs::write(g.path(path), text).unwrap();
        g.run(["add", "."]).unwrap();
        g.run(["commit", "-qm", text.trim()]).unwrap();
    }
    fn publish(&self, path: &str, text: &str) {
        Self::commit(&self.peer, path, text);
        self.peer.run(["push"]).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
#[test]
fn diverged_pull_requires_confirmation_preserves_commits_and_config() {
    let r = Fixture::new();
    r.local.run(["config", "pull.rebase", "true"]).unwrap();
    r.publish("remote", "remote\n");
    Fixture::commit(&r.local, "local", "local\n");
    let before = r.local.snapshot().unwrap().head;
    let result = r.local.pull_checked(Some("main"), false, None).unwrap();
    let plan = result.plan.unwrap();
    assert_eq!((plan.ahead, plan.behind), (1, 1));
    assert_eq!(before, r.local.snapshot().unwrap().head);
    assert!(!r.local.merge_state());
    let result = r
        .local
        .pull_checked(Some("main"), false, Some(&plan))
        .unwrap();
    assert!(result.result.ok, "{}", result.result.stderr);
    assert!(result.conflicts.is_empty());
    let head = r.local.commit_info("HEAD").unwrap();
    assert_eq!(head.parents.len(), 2);
    assert_eq!(head.parents[0], before);
    assert!(r.local.path("local").exists() && r.local.path("remote").exists());
    assert_eq!(
        r.local.run(["config", "pull.rebase"]).unwrap().trim(),
        "true"
    );
    assert!(!r.peer.path("local").exists());
    assert!(r.local.run_result(["push"]).ok);
}
#[test]
fn conflicting_pull_returns_files_for_existing_merge_editor() {
    let r = Fixture::new();
    r.publish("file", "remote\n");
    Fixture::commit(&r.local, "file", "local\n");
    let before = r.local.snapshot().unwrap().head;
    let plan = r
        .local
        .pull_checked(Some("main"), false, None)
        .unwrap()
        .plan
        .unwrap();
    let result = r
        .local
        .pull_checked(Some("main"), false, Some(&plan))
        .unwrap();
    assert!(!result.result.ok);
    assert_eq!(result.conflicts, vec!["file"]);
    assert!(r.local.merge_state());
    r.local.run(["merge", "--abort"]).unwrap();
    assert_eq!(before, r.local.snapshot().unwrap().head);
    assert_eq!(r.local.blob("HEAD:file").unwrap().0, "local\n");
}
#[test]
fn fast_forward_preserves_unrelated_staged_and_untracked_work() {
    let r = Fixture::new();
    r.publish("remote", "remote\n");
    std::fs::write(r.local.path("draft"), "staged\n").unwrap();
    r.local.run(["add", "draft"]).unwrap();
    std::fs::write(r.local.path("notes"), "untracked").unwrap();
    let result = r.local.pull_checked(Some("main"), false, None).unwrap();
    assert!(result.result.ok);
    assert!(result.plan.is_none());
    assert!(r
        .local
        .status()
        .unwrap()
        .staged
        .iter()
        .any(|f| f.path == "draft"));
    assert_eq!(
        std::fs::read_to_string(r.local.path("notes")).unwrap(),
        "untracked"
    );
    assert!(r.local.path("remote").exists());
}
#[test]
fn confirmation_is_invalidated_by_external_commits_and_ref_updates() {
    let r = Fixture::new();
    r.publish("remote", "remote\n");
    Fixture::commit(&r.local, "local", "local\n");
    let plan = r
        .local
        .pull_checked(Some("main"), false, None)
        .unwrap()
        .plan
        .unwrap();
    Fixture::commit(&r.local, "more", "new local commit\n");
    assert!(r
        .local
        .pull_checked(Some("main"), false, Some(&plan))
        .is_err());
    let plan = r
        .local
        .pull_checked(Some("main"), false, None)
        .unwrap()
        .plan
        .unwrap();
    r.publish("another", "new remote commit\n");
    r.local.run(["fetch"]).unwrap();
    assert!(r
        .local
        .pull_checked(Some("main"), false, Some(&plan))
        .is_err());
    assert!(!r.local.merge_state());
}
