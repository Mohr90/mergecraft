//! Focused, checked Git mutations. A preview never changes refs/index/worktree.
use crate::{
    gitcli::{Git, RawOut},
    model::*,
};
use std::{
    hash::{Hash, Hasher},
    io::{Read, Write},
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const STALE: &str = "Der Repository-Stand wurde geändert. Bitte aktualisieren und erneut prüfen.";

impl Git {
    pub fn git_path_exists(&self, name: &str) -> bool {
        self.run(["rev-parse", "--git-path", name])
            .ok()
            .is_some_and(|p| self.root.join(p.trim()).exists())
    }

    pub fn idle(&self) -> Result<(), String> {
        let s = self.snapshot()?;
        if s.merging || s.rebasing || s.cherry_picking || s.reverting {
            return Err("Schließe zuerst den laufenden Git-Vorgang ab.".into());
        }
        Ok(())
    }

    fn clean_branch(&self) -> Result<RepoSnapshot, String> {
        self.idle()?;
        let s = self.snapshot()?;
        if s.head_branch.is_none() || s.head.is_empty() {
            return Err("Wechsle zuerst auf einen lokalen Branch mit Commit.".into());
        }
        if !self.status()?.all.is_empty() {
            return Err("Es gibt lokale Änderungen. Committe oder verwerfe sie zuerst.".into());
        }
        Ok(s)
    }

    fn oid(&self, revision: &str) -> Result<String, String> {
        Ok(self
            .run([
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("{revision}^{{commit}}"),
            ])?
            .trim()
            .to_owned())
    }

    /// Include exact file bytes, index entries, branch identity and Git operation state.
    pub fn workflow_token(&self) -> Result<String, String> {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        self.root.hash(&mut h);
        let snap = self.snapshot()?;
        snap.head.hash(&mut h);
        snap.head_branch.hash(&mut h);
        (
            snap.merging,
            snap.rebasing,
            snap.cherry_picking,
            snap.reverting,
        )
            .hash(&mut h);
        self.run(["ls-files", "--stage", "-z"])?.hash(&mut h);
        let status = self.status()?;
        for entry in &status.all {
            entry.path.hash(&mut h);
            entry.index.hash(&mut h);
            entry.worktree.hash(&mut h);
            // hash-object handles filters consistently without printing file contents.
            self.raw(["hash-object", "--no-filters", "--", &entry.path])
                .stdout
                .hash(&mut h);
        }
        Ok(format!("{:016x}", h.finish()))
    }

    fn check_token(&self, expected: &str) -> Result<(), String> {
        if self.workflow_token()? != expected {
            return Err(STALE.into());
        }
        Ok(())
    }

    /// Run merge-tree off the GUI thread, draining both pipes while polling cancellation.
    fn analysis(&self, args: &[&str], cancelled: &AtomicBool) -> Result<RawOut, String> {
        let mut child = self
            .base_command()
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let read_out = std::thread::spawn(move || {
            let mut s = String::new();
            stdout.read_to_string(&mut s).map(|_| s)
        });
        let read_err = std::thread::spawn(move || {
            let mut s = String::new();
            stderr.read_to_string(&mut s).map(|_| s)
        });
        let start = Instant::now();
        let status = loop {
            if cancelled.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(60) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = read_out.join();
                let _ = read_err.join();
                return Err("Analyse abgebrochen. Du kannst sie erneut starten.".into());
            }
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        Ok(RawOut {
            code: status.code().unwrap_or(-1),
            stdout: read_out
                .join()
                .map_err(|_| "Analyse fehlgeschlagen")?
                .map_err(|e| e.to_string())?,
            stderr: read_err
                .join()
                .map_err(|_| "Analyse fehlgeschlagen")?
                .map_err(|e| e.to_string())?,
        })
    }

    pub fn merge_preview(
        &self,
        name: &str,
        cancelled: &AtomicBool,
    ) -> Result<MergePreview, String> {
        let snap = self.clean_branch()?;
        let source_oid = self.oid(name)?;
        let target_oid = snap.head.clone();
        let token = self.workflow_token()?;
        let incoming = self
            .run([
                "rev-list",
                "--count",
                &format!("{target_oid}..{source_oid}"),
            ])?
            .trim()
            .parse()
            .map_err(|_| "Analyse fehlgeschlagen")?;
        let kind;
        let mut tree_oid = target_oid.clone();
        let mut conflicts = vec![];
        let mut files = vec![];
        if self
            .raw(["merge-base", "--is-ancestor", &source_oid, &target_oid])
            .code
            == 0
        {
            kind = "up_to_date";
        } else {
            let out = self.analysis(
                &[
                    "merge-tree",
                    "--write-tree",
                    "--name-only",
                    "--no-messages",
                    "-z",
                    &target_oid,
                    &source_oid,
                ],
                cancelled,
            )?;
            if out.code != 0 && out.code != 1 {
                return Err(format!(
                    "Merge-Vorschau nicht verfügbar. Git 2.38 oder neuer erforderlich.\n{}",
                    out.stderr.trim()
                ));
            }
            let mut fields = out.stdout.split('\0');
            let tree = fields.next().ok_or("Analyse fehlgeschlagen")?.trim();
            if tree.len() < 40 || !tree.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Analyse fehlgeschlagen".into());
            }
            tree_oid = tree.into();
            conflicts = fields
                .take_while(|p| !p.is_empty())
                .map(str::to_owned)
                .collect();
            files = self.diff_files(&target_oid, tree, None)?;
            // Rename conflicts can affect a path that is absent from the result tree.
            for path in &conflicts {
                if !files.iter().any(|f| &f.path == path) {
                    files.push(FileChange {
                        status: "U".into(),
                        path: path.clone(),
                    });
                }
            }
            kind = if out.code == 1 {
                "conflicts"
            } else if self
                .raw(["merge-base", "--is-ancestor", &target_oid, &source_oid])
                .code
                == 0
            {
                "fast_forward"
            } else {
                "clean"
            };
        }
        self.check_token(&token)?;
        if self.oid(name)? != source_oid {
            return Err(STALE.into());
        }
        Ok(MergePreview {
            source: name.into(),
            target: snap.head_branch.unwrap(),
            source_oid,
            tree_oid,
            target_oid,
            token,
            kind: kind.into(),
            incoming,
            files,
            conflicts,
        })
    }

    pub fn merge_checked(
        &self,
        preview: &MergePreview,
        no_ff: bool,
    ) -> Result<MergeOutcome, String> {
        self.clean_branch()?;
        self.check_token(&preview.token)?;
        if self.oid(&preview.source)? != preview.source_oid
            || self.oid("HEAD")? != preview.target_oid
        {
            return Err(STALE.into());
        }
        let message = format!("Merge branch '{}' into {}", preview.source, preview.target);
        let out = self.raw([
            "merge",
            "--no-edit",
            if no_ff { "--no-ff" } else { "--ff" },
            "-m",
            &message,
            &preview.source_oid,
        ]);
        self.merge_outcome(out)
    }

    fn merge_outcome(&self, out: RawOut) -> Result<MergeOutcome, String> {
        Ok(MergeOutcome {
            ok: out.code == 0,
            completed: out.code == 0,
            conflicts: self
                .conflicted_files()?
                .into_iter()
                .map(|c| c.path)
                .collect(),
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }

    pub fn hunk_set(&self, path: &str, area: &str) -> Result<HunkSet, String> {
        let token = self.workflow_token()?;
        let unsupported = |reason: &str| {
            Ok(HunkSet {
                token: token.clone(),
                patches: vec![],
                blocks: vec![],
                reason: Some(reason.into()),
            })
        };
        let status = self.status()?;
        let entry = status.all.iter().find(|e| e.path == path).ok_or(STALE)?;
        let snap = self.snapshot()?;
        if snap.merging
            || snap.rebasing
            || snap.cherry_picking
            || snap.reverting
            || entry.conflict_code.is_some()
        {
            return unsupported("Während eines Git-Vorgangs nur ganze Dateien vormerken.");
        }
        if !["staged", "work"].contains(&area)
            || entry.orig_path.is_some()
            || matches!(entry.state, FileState::Untracked)
        {
            return unsupported("Für diese Änderung nur ganze Dateien vormerken.");
        }
        let mut args = vec![
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--no-indent-heuristic",
            "--diff-algorithm=myers",
            "--unified=0",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ];
        if area == "staged" {
            args.push("--cached");
        }
        args.extend(["--", path]);
        let patch = self.run(args)?;
        if patch.len() > 2_000_000
            || patch.contains("GIT binary patch")
            || patch.contains("Binary files ")
            || patch.contains("old mode ")
            || patch.contains("new mode ")
        {
            return unsupported("Für diese Änderung nur ganze Dateien vormerken.");
        }
        let (a, b) = if area == "staged" {
            (
                self.blob(&format!("HEAD:{path}")),
                self.blob(&format!(":0:{path}")),
            )
        } else {
            (self.blob(&format!(":0:{path}")), self.working_file(path))
        };
        if a.as_ref().is_some_and(|v| v.1) || b.as_ref().is_some_and(|v| v.1) {
            return unsupported("Für diese Änderung nur ganze Dateien vormerken.");
        }
        let starts: Vec<usize> = patch.match_indices("\n@@ ").map(|(i, _)| i + 1).collect();
        let mut patches = vec![];
        if let Some(first) = starts.first() {
            let header = &patch[..*first];
            for (i, start) in starts.iter().enumerate() {
                // New/deleted files have one complete hunk. Intent-to-add needs an existing empty index blob.
                let mut header = header.trim_end().to_owned();
                if area == "work" && header.contains("--- /dev/null") {
                    let destination = header
                        .lines()
                        .find_map(|l| l.strip_prefix("+++ "))
                        .unwrap_or("");
                    let source = destination.replacen("b/", "a/", 1);
                    header = header
                        .lines()
                        .filter(|l| !l.starts_with("new file mode "))
                        .collect::<Vec<_>>()
                        .join("\n")
                        .replace("--- /dev/null", &format!("--- {source}"));
                }
                patches.push(format!(
                    "{header}\n{}",
                    &patch[*start..starts.get(i + 1).copied().unwrap_or(patch.len())]
                ));
            }
        }
        self.check_token(&token)?;
        Ok(HunkSet {
            token,
            patches,
            blocks: crate::hunks::parse_unified(&patch),
            reason: None,
        })
    }

    pub fn apply_hunk(
        &self,
        path: &str,
        area: &str,
        index: usize,
        token: &str,
    ) -> Result<CommandResult, String> {
        self.idle()?;
        self.check_token(token)?;
        let set = self.hunk_set(path, area)?;
        if set.token != token {
            return Err(STALE.into());
        }
        let patch = set
            .patches
            .get(index)
            .ok_or("Änderungsblock nicht mehr verfügbar. Bitte aktualisieren.")?;
        let mut command = self.base_command();
        command.args(["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn"]);
        if area == "staged" {
            command.arg("--reverse");
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(patch.as_bytes())
            .map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        Ok(CommandResult {
            ok: out.status.success(),
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into(),
            stderr: String::from_utf8_lossy(&out.stderr).into(),
        })
    }

    pub fn revert_preview(&self, revision: &str) -> Result<RevertPreview, String> {
        let snap = self.clean_branch()?;
        let token = self.workflow_token()?;
        let commit = self.commit_info(revision)?;
        if commit.parents.len() != 1 {
            return Err(
                "Nur normale Commits mit einem Vorgänger können hier zurückgenommen werden.".into(),
            );
        }
        if self
            .raw(["merge-base", "--is-ancestor", &commit.hash, &snap.head])
            .code
            != 0
        {
            return Err("Der Commit gehört nicht zum aktuellen Branch.".into());
        }
        let files = self.diff_files(&commit.hash, &commit.parents[0], None)?;
        self.check_token(&token)?;
        Ok(RevertPreview {
            commit,
            target: snap.head_branch.unwrap(),
            token,
            files,
        })
    }

    pub fn revert_checked(&self, revision: &str, token: &str) -> Result<MergeOutcome, String> {
        self.check_token(token)?;
        let preview = self.revert_preview(revision)?;
        self.check_token(token)?;
        let out = self.raw(["revert", "--no-commit", &preview.commit.hash]);
        if out.code != 0 {
            return self.merge_outcome(out);
        }
        // git revert itself bypasses pre-commit hooks. Commit the prepared result
        // explicitly, retaining standard single-revert recovery state on failure.
        self.run(["update-ref", "REVERT_HEAD", &preview.commit.hash])?;
        let message = format!(
            "Revert \"{}\"\n\nThis reverts commit {}.\n",
            preview.commit.subject, preview.commit.hash
        );
        let msg_path = self.run(["rev-parse", "--git-path", "MERGE_MSG"])?;
        std::fs::write(self.root.join(msg_path.trim()), &message).map_err(|e| e.to_string())?;
        self.merge_outcome(self.raw(["commit", "--no-edit"]))
    }

    pub fn revert_control(&self, abort: bool, expected: &str) -> Result<CommandResult, String> {
        self.check_token(expected)?;
        if !self.snapshot()?.reverting {
            return Err("Kein laufender Revert.".into());
        }
        if !abort && !self.status()?.conflicts.is_empty() {
            return Err("Es sind noch Konflikte offen".into());
        }
        if abort {
            return Ok(self.run_result(["revert", "--abort"]));
        }
        // Explicit commit keeps hooks enabled, also after conflict resolution.
        let result = self.run_result(["commit", "--no-edit"]);
        if result.ok && self.git_path_exists("sequencer") {
            self.run(["revert", "--quit"])?;
        }
        Ok(result)
    }
}
