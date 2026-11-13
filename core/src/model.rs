//! Datenstrukturen zwischen Backend und Oberfläche.

use crate::merge::{Region, WordSpan};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub full_name: String,
    pub is_remote: bool,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub short_hash: String,
    pub timestamp: i64,
    pub subject: String,
    /// True only when comparison with the upstream succeeded.
    #[serde(default)]
    pub tracking_known: bool,
    /// Commits, die nur lokal existieren
    pub ahead: i32,
    /// Commits, die nur beim Upstream existieren
    pub behind: i32,
    /// Schlüssel für das Auschecken (bei Remote-Branches ohne Remote-Präfix)
    pub checkout_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashInfo {
    pub oid: String,
    pub selector: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub name: String,
    pub full_name: String,
    pub commit: Option<String>,
    pub short_hash: String,
    pub is_annotated: bool,
    pub timestamp: i64,
    pub subject: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileState {
    Conflicted,
    Staged,
    Modified,
    Untracked,
    Renamed,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub state: FileState,
    pub conflict_code: Option<String>,
    /// Dateiendung, damit die Oberfläche das Symbol wählen kann
    pub ext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoStatus {
    pub conflicts: Vec<StatusEntry>,
    pub staged: Vec<StatusEntry>,
    pub changed: Vec<StatusEntry>,
    pub untracked: Vec<StatusEntry>,
    pub all: Vec<StatusEntry>,
    /// Branch-spezifisch: läuft gerade ein Merge/Amend?
    pub merging: bool,
    pub head_subject: String,
    pub head_author: String,
    pub head_timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSnapshot {
    pub root: String,
    pub name: String,
    pub head: String,
    pub head_branch: Option<String>,
    pub merging: bool,
    pub rebasing: bool,
    pub cherry_picking: bool,
    pub reverting: bool,
    pub merge_head: Option<String>,
    pub remote_url: Option<String>,
    pub remote_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub code: String,
    pub has_base: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub num: usize,
    pub text: String,
    /// Wortweise Hervorhebung innerhalb der Zeile (leer = keine)
    pub spans: Vec<WordSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SideText {
    pub label: String,
    pub text: String,
    pub exists: bool,
    pub lines: usize,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictData {
    pub path: String,
    pub root: String,
    pub base: SideText,
    pub ours: SideText,
    pub theirs: SideText,
    pub merged: SideText,
    pub regions: Vec<Region>,
    pub trailing_newline: bool,
    pub ours_label: String,
    pub theirs_label: String,
    pub result_text: String,
    #[serde(default)]
    pub working_modified: bool,
    /// git meldet einen Konflikt, die Analyse nicht -> alles einzeln bestätigen
    pub guarded: bool,
    /// Wort-Hervorhebungen je Seite (Schlüssel = 0-basierter Zeilenindex)
    pub highlight_ours: BTreeMap<usize, Vec<WordSpan>>,
    pub highlight_theirs: BTreeMap<usize, Vec<WordSpan>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub a_label: String,
    pub b_label: String,
    pub a_text: String,
    pub b_text: String,
    pub blocks: Vec<crate::merge::Block>,
    pub binary: bool,
    pub a_missing: bool,
    pub b_missing: bool,
    pub highlight_a: BTreeMap<usize, Vec<WordSpan>>,
    pub highlight_b: BTreeMap<usize, Vec<WordSpan>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Fortschritt/Ergebnis eines Merge-Versuchs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeOutcome {
    pub ok: bool,
    pub conflicts: Vec<String>,
    pub stdout: String,
    pub stderr: String,
    /// true, wenn der Merge einen Commit erzeugt hat (bereits abgeschlossen)
    pub completed: bool,
}

/// Immutable preview identity is rechecked immediately before a mutation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePreview {
    pub source: String,
    pub target: String,
    pub source_oid: String,
    pub tree_oid: String,
    pub target_oid: String,
    pub token: String,
    pub kind: String,
    pub incoming: usize,
    pub files: Vec<FileChange>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkSet {
    pub token: String,
    pub patches: Vec<String>,
    pub blocks: Vec<crate::merge::Block>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevertPreview {
    pub commit: CommitInfo,
    pub target: String,
    pub token: String,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorktreeBranchDeletion {
    pub branch: String,
    pub path: String,
    pub branch_oid: String,
    pub caller_head: String,
    pub token: String,
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullPlan {
    pub branch: String,
    pub upstream: String,
    pub upstream_oid: String,
    pub head: String,
    pub ahead: i32,
    pub behind: i32,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    #[serde(flatten)]
    pub result: CommandResult,
    pub plan: Option<PullPlan>,
    pub conflicts: Vec<String>,
}
