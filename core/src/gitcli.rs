//! Git-Anbindung über die echte `git`-CLI.
//!
//! Bewusst kein libgit2: damit sind Merge-Strategien, Konfliktmarker, Hooks und
//! Credential-Helper exakt so wie auf der Kommandozeile, und der Build braucht
//! keine C-Bibliotheken.

use crate::model::*;
use std::path::{Path, PathBuf};
use std::process::Command;

const SEP: char = '\u{1f}';
const REC: char = '\u{1e}';

pub struct Git {
    pub root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct RawOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Git {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Git { root: root.into() }
    }

    /// Wurzel des Repositories zu einem beliebigen Pfad darin.
    pub fn discover(path: &Path) -> Result<PathBuf, String> {
        let out = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .arg("-C")
            .arg(path)
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .map_err(|e| format!("git nicht ausführbar: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(PathBuf::from(
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        ))
    }

    fn base_command(&self) -> Command {
        let mut c = Command::new("git");
        c.current_dir(&self.root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_PAGER", "cat")
            .env("LC_ALL", "C")
            .arg("-c")
            .arg("core.quotepath=false")
            .arg("-c")
            .arg("advice.detachedHead=false");
        c
    }

    pub fn raw<I, S>(&self, args: I) -> RawOut
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let mut c = self.base_command();
        c.args(args);
        match c.output() {
            Ok(o) => RawOut {
                code: o.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&o.stdout).to_string(),
                stderr: String::from_utf8_lossy(&o.stderr).to_string(),
            },
            Err(e) => RawOut {
                code: -1,
                stdout: String::new(),
                stderr: format!("git nicht ausführbar: {e}"),
            },
        }
    }

    pub fn run<I, S>(&self, args: I) -> Result<String, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let o = self.raw(args);
        if o.code != 0 {
            let msg = if o.stderr.trim().is_empty() {
                o.stdout.clone()
            } else {
                o.stderr.clone()
            };
            return Err(msg.trim().to_string());
        }
        Ok(o.stdout)
    }

    pub fn run_result<I, S>(&self, args: I) -> CommandResult
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let o = self.raw(args);
        CommandResult {
            ok: o.code == 0,
            code: o.code,
            stdout: o.stdout.trim_end().to_string(),
            stderr: o.stderr.trim_end().to_string(),
        }
    }

    pub fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    // ------------------------------------------------------- Zustand & Liste

    pub fn snapshot(&self) -> Result<RepoSnapshot, String> {
        let head = self
            .run(["rev-parse", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let head_branch = self
            .run(["symbolic-ref", "--quiet", "--short", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let merge_head = self
            .run(["rev-parse", "--quiet", "--verify", "MERGE_HEAD"])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let name = self
            .root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| self.root.display().to_string());
        let remote_name = self
            .run(["remote"])
            .ok()
            .map(|s| s.lines().next().unwrap_or("").trim().to_string())
            .filter(|s| !s.is_empty());
        let remote_url = remote_name
            .as_deref()
            .and_then(|r| self.run(["remote", "get-url", r]).ok())
            .map(|s| s.trim().to_string());
        Ok(RepoSnapshot {
            root: self.root.display().to_string(),
            name,
            head,
            head_branch,
            merging: self.root.join(".git/MERGE_HEAD").exists() || merge_head.is_some(),
            rebasing: self.root.join(".git/rebase-merge").exists()
                || self.root.join(".git/rebase-apply").exists(),
            cherry_picking: self.root.join(".git/CHERRY_PICK_HEAD").exists(),
            merge_head,
            remote_url,
            remote_name,
        })
    }

    pub fn branches(&self) -> Result<Vec<BranchInfo>, String> {
        let fmt = format!(
            "%(refname:short){s}%(refname){s}%(objectname:short){s}%(upstream:short){s}%(committerdate:unix){s}%(subject){s}%(HEAD){s}%(symref){r}",
            s = SEP,
            r = REC
        );
        let out = self.run([
            "for-each-ref",
            &format!("--format={fmt}"),
            "--sort=-committerdate",
            "refs/heads",
            "refs/remotes",
        ])?;
        let mut v: Vec<BranchInfo> = Vec::new();
        for rec in out.split(REC) {
            let rec = rec.trim_start_matches('\n').trim_end();
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.split(SEP).collect();
            if f.len() < 8 {
                continue;
            }
            let full = f[1].to_string();
            let is_remote = full.starts_with("refs/remotes/");
            if is_remote && full.ends_with("/HEAD") {
                continue;
            }
            let name = f[0].to_string();
            // "origin/feature/x" -> lokal als "feature/x" auschecken
            let checkout_name = if is_remote {
                name.split_once('/').map(|(_, b)| b.to_string()).unwrap_or(name.clone())
            } else {
                name.clone()
            };
            v.push(BranchInfo {
                name,
                full_name: full,
                is_remote,
                is_current: f[6] == "*",
                upstream: Some(f[3].to_string()).filter(|s| !s.is_empty()),
                short_hash: f[2].to_string(),
                timestamp: f[4].parse().unwrap_or(0),
                subject: f[5].to_string(),
                ahead: 0,
                behind: 0,
                checkout_name,
            });
        }
        // Vor/nach dem Upstream für lokale Branches mit Upstream
        for b in v.iter_mut() {
            if b.is_remote {
                continue;
            }
            if let Some(up) = b.upstream.clone() {
                if let Some((ahead, behind)) = self.ahead_behind(&up, &b.name) {
                    b.ahead = ahead;
                    b.behind = behind;
                }
            }
        }
        Ok(v)
    }

    /// (voraus, zurück) gegenüber einem Upstream.
    pub fn ahead_behind(&self, upstream: &str, branch: &str) -> Option<(i32, i32)> {
        let out = self
            .run([
                "rev-list",
                "--left-right",
                "--count",
                &format!("{upstream}...{branch}"),
            ])
            .ok()?;
        let mut it = out.split_whitespace();
        let behind: i32 = it.next()?.parse().ok()?;
        let ahead: i32 = it.next()?.parse().ok()?;
        Some((ahead, behind))
    }

    pub fn status(&self) -> Result<RepoStatus, String> {
        let out = self.raw(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        let mut st = RepoStatus::default();
        let mut it = out.stdout.split('\0');
        while let Some(entry) = it.next() {
            if entry.len() < 4 {
                continue;
            }
            let index = entry[0..1].to_string();
            let wtree = entry[1..2].to_string();
            let path = entry[3..].to_string();
            let mut orig = None;
            if index == "R" || index == "C" || wtree == "R" || wtree == "C" {
                orig = it.next().map(|s| s.to_string());
            }
            let xy = format!("{index}{wtree}");
            let conflict = matches!(xy.as_str(), "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU");
            let state = if conflict {
                FileState::Conflicted
            } else if index == "?" && wtree == "?" {
                FileState::Untracked
            } else if index != " " && index != "?" {
                FileState::Staged
            } else if wtree == "D" {
                FileState::Deleted
            } else {
                FileState::Modified
            };
            let ext = Path::new(&path)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let e = StatusEntry {
                path,
                orig_path: orig,
                index: index.clone(),
                worktree: wtree.clone(),
                state: state.clone(),
                conflict_code: if conflict { Some(xy) } else { None },
                ext,
            };
            st.all.push(e.clone());
            match state {
                FileState::Conflicted => st.conflicts.push(e),
                FileState::Untracked => st.untracked.push(e),
                _ => {
                    if index != " " && index != "?" {
                        st.staged.push(e.clone());
                    }
                    if wtree != " " {
                        st.changed.push(e);
                    }
                }
            }
        }
        st.merging = self.merge_state();
        if let Ok(head) = self.log(1, false, None) {
            if let Some(c) = head.first() {
                st.head_subject = c.subject.clone();
                st.head_author = c.author.clone();
                st.head_timestamp = c.timestamp;
            }
        }
        Ok(st)
    }

    pub fn conflicted_files(&self) -> Result<Vec<ConflictFile>, String> {
        let out = self.raw(["ls-files", "-u", "-z"]);
        let mut seen: Vec<ConflictFile> = Vec::new();
        for line in out.stdout.split('\0') {
            if line.is_empty() {
                continue;
            }
            let (_, path) = match line.split_once('\t') {
                Some(x) => x,
                None => continue,
            };
            if !seen.iter().any(|c| c.path == path) {
                seen.push(ConflictFile {
                    path: path.to_string(),
                    code: String::new(),
                    has_base: false,
                });
            }
        }
        let st = self.status()?;
        for c in seen.iter_mut() {
            if let Some(e) = st.conflicts.iter().find(|e| e.path == c.path) {
                c.code = e.conflict_code.clone().unwrap_or_default();
            }
            c.has_base = self
                .raw(["cat-file", "-e", &format!(":1:{}", c.path)])
                .code
                == 0;
        }
        Ok(seen)
    }

    pub fn log(
        &self,
        limit: usize,
        all: bool,
        path: Option<&str>,
    ) -> Result<Vec<CommitInfo>, String> {
        let fmt = format!("%H{s}%h{s}%an{s}%ae{s}%at{s}%P{s}%D{s}%s{r}", s = SEP, r = REC);
        let mut args: Vec<String> = vec![
            "log".into(),
            format!("--pretty=format:{fmt}"),
            format!("-n{limit}"),
            "--date-order".into(),
        ];
        if all {
            args.push("--all".into());
        }
        if let Some(p) = path {
            args.push("--".into());
            args.push(p.to_string());
        }
        let out = self.raw(args);
        if out.code != 0 {
            // Ein frisches Repository hat noch keinen Commit - das ist kein Fehler.
            if self.raw(["rev-parse", "--verify", "HEAD"]).code != 0 {
                return Ok(Vec::new());
            }
            return Err(out.stderr.trim().to_string());
        }
        let mut v = Vec::new();
        for rec in out.stdout.split(REC) {
            let rec = rec.trim_start_matches('\n').trim_end_matches('\n');
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.split(SEP).collect();
            if f.len() < 8 {
                continue;
            }
            v.push(CommitInfo {
                hash: f[0].to_string(),
                short_hash: f[1].to_string(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                timestamp: f[4].parse().unwrap_or(0),
                parents: f[5].split_whitespace().map(|s| s.to_string()).collect(),
                refs: f[6]
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                subject: f[7].to_string(),
            });
        }
        Ok(v)
    }

    pub fn commit_files(&self, hash: &str) -> Result<Vec<FileChange>, String> {
        let out = self.run([
            "show",
            "--name-status",
            "--format=",
            "-M",
            "--first-parent",
            hash,
        ])?;
        let mut v = Vec::new();
        for line in out.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let status = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            let path = if status.starts_with('R') || status.starts_with('C') {
                parts.next().unwrap_or(&path).to_string()
            } else {
                path
            };
            if !path.is_empty() {
                v.push(FileChange { status, path });
            }
        }
        Ok(v)
    }

    pub fn diff_files(
        &self,
        spec_a: &str,
        spec_b: &str,
        path: Option<&str>,
    ) -> Result<Vec<FileChange>, String> {
        let mut args = vec!["diff", "--name-status", "-M"];
        if !spec_a.is_empty() {
            args.push(spec_a);
        }
        if !spec_b.is_empty() {
            args.push(spec_b);
        }
        if let Some(p) = path {
            args.push("--");
            args.push(p);
        }
        let out = self.run(args)?;
        let mut v = Vec::new();
        for line in out.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let status = parts.next().unwrap_or("").to_string();
            let first = parts.next().unwrap_or("").to_string();
            let p = if status.starts_with('R') || status.starts_with('C') {
                parts.next().unwrap_or(&first).to_string()
            } else {
                first
            };
            if !p.is_empty() {
                v.push(FileChange { status, path: p });
            }
        }
        Ok(v)
    }

    // ------------------------------------------------------------- Inhalten

    /// Inhalt einer Stage (":1:Pfad" = Basis, ":2:" = lokal, ":3:" = eingehend)
    /// oder einer Revision ("REV:Pfad").
    pub fn blob(&self, spec: &str) -> Option<(String, bool)> {
        let o = self.raw(["show", spec]);
        if o.code != 0 {
            return None;
        }
        Some((o.stdout.clone(), o.stdout.contains('\u{0}')))
    }

    pub fn working_file(&self, rel: &str) -> Option<(String, bool)> {
        let data = std::fs::read(self.path(rel)).ok()?;
        let binary = data.contains(&0);
        Some((String::from_utf8_lossy(&data).to_string(), binary))
    }

    pub fn write_working_file(&self, rel: &str, text: &str) -> Result<(), String> {
        let p = self.path(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, text).map_err(|e| format!("{}: {e}", p.display()))
    }

    pub fn merge_state(&self) -> bool {
        self.raw(["rev-parse", "--quiet", "--verify", "MERGE_HEAD"])
            .code
            == 0
    }
}
