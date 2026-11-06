use mergecraft_core::gitcli::{Git, RawOut};
use mergecraft_core::merge::{self, pair_highlights, split_lines, WordSpan};
use mergecraft_core::model::*;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;

/// Wurde in dieser Sitzung ein Mergeergebnis geschrieben? (Rückgabewert als
/// externes Merge-Tool: 0 = gespeichert, 1 = abgebrochen.)
pub static SAVED: AtomicBool = AtomicBool::new(false);

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;

/// Dateien für einen Standalone-3-Wege-Merge (Aufruf als externes Merge-Tool).
#[derive(Debug, Clone)]
pub struct StandaloneMerge {
    pub ours: PathBuf,
    pub base: PathBuf,
    pub theirs: PathBuf,
    pub merged: PathBuf,
    pub label_ours: String,
    pub label_theirs: String,
}

pub struct AppState {
    pub root: Mutex<Option<PathBuf>>,
    pub recent: Mutex<Vec<String>>,
    pub standalone: Mutex<Option<StandaloneMerge>>,
}

fn recent_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".config")
        });
    base.join("mergecraft").join("recent.json")
}

pub fn load_recent() -> Vec<String> {
    std::fs::read_to_string(recent_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn save_recent(v: &[String]) {
    let p = recent_path();
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(p, serde_json::to_string_pretty(v).unwrap_or_default());
}

/// `~` am Anfang wie in der Shell auflösen.
fn expand(path: &str) -> PathBuf {
    if path == "~" {
        return PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(path)
}

/// Öffentliche Hülle für die Pfadauflösung (Diagnose-Modus).
pub fn expand_path(path: &str) -> PathBuf {
    expand(path)
}

fn git_of(state: &State<AppState>) -> Result<Git, String> {
    let root = state
        .root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Kein Repository geöffnet".to_string())?;
    Ok(Git::new(root))
}

fn utf8(o: RawOut) -> CommandResult {
    CommandResult {
        ok: o.code == 0,
        code: o.code,
        stdout: o.stdout.trim_end().to_string(),
        stderr: o.stderr.trim_end().to_string(),
    }
}

fn read_side(p: &Path, label: &str) -> SideText {
    match std::fs::read(p) {
        Err(_) => SideText {
            label: label.to_string(),
            text: String::new(),
            exists: false,
            lines: 0,
            binary: false,
        },
        Ok(data) => {
            let binary = data.contains(&0) || std::str::from_utf8(&data).is_err();
            let text = String::from_utf8_lossy(&data).to_string();
            SideText {
                label: label.to_string(),
                lines: split_lines(&text).len(),
                exists: true,
                binary,
                text,
            }
        }
    }
}

fn side_text(g: &Git, rev: &str, path: &str, label: &str) -> SideText {
    let got = match rev {
        "" => None,
        "WORK" => g.working_file(path),
        "INDEX" => g.blob(&format!(":0:{path}")),
        other => g.blob(&format!("{other}:{path}")),
    };
    match got {
        None => SideText {
            label: label.to_string(),
            text: String::new(),
            exists: false,
            lines: 0,
            binary: false,
        },
        Some((text, binary)) => {
            let binary = binary || text.len() > MAX_FILE_BYTES;
            let text = if text.len() > MAX_FILE_BYTES {
                format!("(Datei zu groß für die Anzeige: {} Bytes)\n", text.len())
            } else {
                text
            };
            SideText {
                label: label.to_string(),
                lines: split_lines(&text).len(),
                exists: true,
                binary,
                text,
            }
        }
    }
}

// ---------------------------------------------------------------- Repository

/// Repository als geöffnet merken (zuletzt benutzte nach vorn, höchstens 12).
pub fn remember_path(recent: &mut Vec<String>, root: &Path) {
    let path = root.display().to_string();
    recent.retain(|p| p != &path);
    recent.insert(0, path);
    recent.truncate(12);
    save_recent(recent);
}

fn remember(state: &State<AppState>, root: &Path) {
    remember_path(&mut state.recent.lock().unwrap(), root);
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_repo(state: State<AppState>, path: String) -> Result<RepoSnapshot, String> {
    let root = Git::discover(&expand(&path))?;
    let g = Git::new(root.clone());
    let snap = g.snapshot()?;
    *state.root.lock().unwrap() = Some(root.clone());
    remember(&state, &root);
    Ok(snap)
}

#[tauri::command(rename_all = "snake_case")]
pub fn recent_repos(state: State<AppState>) -> Vec<String> {
    state.recent.lock().unwrap().clone()
}

#[tauri::command(rename_all = "snake_case")]
pub fn snapshot(state: State<AppState>) -> Result<RepoSnapshot, String> {
    git_of(&state)?.snapshot()
}

#[tauri::command(rename_all = "snake_case")]
pub fn init_repo(state: State<AppState>, path: String) -> Result<RepoSnapshot, String> {
    let p = expand(&path);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Git::new(p.clone()).run(["init", "-b", "main"])?;
    let root = Git::discover(&p)?;
    let g = Git::new(root.clone());
    *state.root.lock().unwrap() = Some(root.clone());
    remember(&state, &root);
    g.snapshot()
}

// ---------------------------------------------------------------- Lesen

#[tauri::command(rename_all = "snake_case")]
pub fn branches(state: State<AppState>) -> Result<Vec<BranchInfo>, String> {
    git_of(&state)?.branches()
}

#[tauri::command(rename_all = "snake_case")]
pub fn tags(state: State<AppState>) -> Result<Vec<TagInfo>, String> {
    git_of(&state)?.tags()
}

#[tauri::command(rename_all = "snake_case")]
pub fn commit_info(state: State<AppState>, revision: String) -> Result<CommitInfo, String> {
    git_of(&state)?.commit_info(&revision)
}

#[tauri::command(rename_all = "snake_case")]
pub fn status(state: State<AppState>) -> Result<RepoStatus, String> {
    git_of(&state)?.status()
}

#[tauri::command(rename_all = "snake_case")]
pub fn history(
    state: State<AppState>,
    limit: Option<usize>,
    all: Option<bool>,
    path: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    git_of(&state)?.log(limit.unwrap_or(300), all.unwrap_or(false), path.as_deref())
}

#[tauri::command(rename_all = "snake_case")]
pub fn commit_files(state: State<AppState>, hash: String) -> Result<Vec<FileChange>, String> {
    git_of(&state)?.commit_files(&hash)
}

#[tauri::command(rename_all = "snake_case")]
pub fn conflicts(state: State<AppState>) -> Result<Vec<ConflictFile>, String> {
    git_of(&state)?.conflicted_files()
}

fn build_file_diff(g: &Git, ra: &str, rb: &str, path: &str, la: &str, lb: &str) -> FileDiff {
    build_file_diff_paths(g, ra, rb, path, path, la, lb)
}

fn build_file_diff_paths(
    g: &Git,
    ra: &str,
    rb: &str,
    a_path: &str,
    path: &str,
    la: &str,
    lb: &str,
) -> FileDiff {
    let a = side_text(g, ra, a_path, la);
    let b = side_text(g, rb, path, lb);
    let a_lines = split_lines(&a.text);
    let b_lines = split_lines(&b.text);
    let blocks = if a.binary || b.binary {
        Vec::new()
    } else {
        merge::diff_blocks(&a_lines, &b_lines)
    };
    // Wort-Hervorhebung nur bei gleich langen Abschnitten (wie im WebStorm-Diff)
    let mut highlight_a: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    let mut highlight_b: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    if !a.binary && !b.binary {
        for blk in &blocks {
            if blk.a_len == 0 || blk.b_len == 0 || blk.a_len != blk.b_len {
                continue;
            }
            let sa = a_lines[blk.a_start..blk.a_start + blk.a_len].to_vec();
            let sb = b_lines[blk.b_start..blk.b_start + blk.b_len].to_vec();
            let (ha, hb) = pair_highlights(&sa, &sb, blk.a_start, blk.b_start);
            highlight_a.extend(ha);
            highlight_b.extend(hb);
        }
    }
    FileDiff {
        path: path.to_string(),
        a_label: la.to_string(),
        b_label: lb.to_string(),
        a_text: a.text,
        b_text: b.text,
        blocks,
        binary: a.binary || b.binary,
        a_missing: !a.exists,
        b_missing: !b.exists,
        highlight_a,
        highlight_b,
    }
}

fn default_label(rev: &str) -> String {
    match rev {
        "" => "—".to_string(),
        "WORK" => "Arbeitskopie".to_string(),
        "INDEX" => "Index".to_string(),
        other => other.to_string(),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn working_diff(
    state: State<AppState>,
    path: String,
    area: String,
) -> Result<FileDiff, String> {
    let g = git_of(&state)?;
    let status = g.status()?;
    let entry = status
        .all
        .iter()
        .find(|entry| entry.path == path)
        .ok_or("Die Datei ist nicht mehr geändert. Bitte aktualisieren.")?;
    if matches!(entry.state, FileState::Conflicted) {
        return Err("Öffne diese Datei im Merge-Editor.".into());
    }
    let (a, b, label_a, label_b) = match area.as_str() {
        "staged" if entry.index != " " && entry.index != "?" => {
            ("HEAD", "INDEX", "Letzter Commit", "Für Commit vorgemerkt")
        }
        "work" if entry.worktree != " " && !matches!(entry.state, FileState::Untracked) => {
            ("INDEX", "WORK", "Für Commit vorgemerkt", "Arbeitskopie")
        }
        "untracked" if matches!(entry.state, FileState::Untracked) => {
            ("", "WORK", "Noch nicht versioniert", "Neue Datei")
        }
        _ => {
            return Err(
                "Dieser Änderungsstand ist nicht mehr vorhanden. Bitte aktualisieren.".into(),
            )
        }
    };
    let original = if area == "staged" {
        entry.orig_path.as_deref().unwrap_or(&path)
    } else {
        &path
    };
    Ok(build_file_diff_paths(
        &g, a, b, original, &path, label_a, label_b,
    ))
}

#[tauri::command(rename_all = "snake_case")]
pub fn file_history(state: State<AppState>, path: String) -> Result<Vec<CommitInfo>, String> {
    git_of(&state)?.file_history(&path, 200)
}

#[tauri::command(rename_all = "snake_case")]
pub fn file_diff(
    state: State<AppState>,
    rev_a: Option<String>,
    rev_b: Option<String>,
    path: String,
    label_a: Option<String>,
    label_b: Option<String>,
) -> Result<FileDiff, String> {
    let g = git_of(&state)?;
    let ra = rev_a.unwrap_or_default();
    let rb = rev_b.unwrap_or_default();
    let la = label_a.unwrap_or_else(|| default_label(&ra));
    let lb = label_b.unwrap_or_else(|| default_label(&rb));
    Ok(build_file_diff(&g, &ra, &rb, &path, &la, &lb))
}

#[tauri::command(rename_all = "snake_case")]
pub fn versions_diff(
    state: State<AppState>,
    rev_a: String,
    rev_b: String,
    path: String,
    label_a: String,
    label_b: String,
) -> Result<FileDiff, String> {
    let g = git_of(&state)?;
    Ok(build_file_diff(
        &g, &rev_a, &rev_b, &path, &label_a, &label_b,
    ))
}

#[tauri::command(rename_all = "snake_case")]
pub fn commit_file_diff(
    state: State<AppState>,
    hash: String,
    path: String,
) -> Result<FileDiff, String> {
    let g = git_of(&state)?;
    let parent = g
        .run(["rev-parse", &format!("{hash}^")])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| EMPTY_TREE.to_string());
    let short = hash.chars().take(7).collect::<String>();
    Ok(build_file_diff(
        &g,
        &parent,
        &hash,
        &path,
        &format!("{short}^"),
        &short,
    ))
}

#[tauri::command(rename_all = "snake_case")]
pub fn compare_files(
    state: State<AppState>,
    rev_a: String,
    rev_b: String,
) -> Result<Vec<FileChange>, String> {
    if rev_a.starts_with('-') || rev_b.starts_with('-') {
        return Err("Ungültige Revision".into());
    }
    git_of(&state)?.diff_files(&rev_a, &rev_b, None)
}

/// Vergleich zweier Commits (Historie: Commit gegen Vorgänger).
#[tauri::command(rename_all = "snake_case")]
pub fn compare_diff(
    state: State<AppState>,
    rev_a: String,
    rev_b: String,
    path: String,
) -> Result<FileDiff, String> {
    let g = git_of(&state)?;
    let sa = rev_a.chars().take(7).collect::<String>();
    let sb = rev_b.chars().take(7).collect::<String>();
    Ok(build_file_diff(&g, &rev_a, &rev_b, &path, &sa, &sb))
}

// ---------------------------------------------------------------- Konflikte

fn theirs_label_of(g: &Git) -> String {
    g.run(["name-rev", "--name-only", "MERGE_HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_start_matches("remotes/").to_string())
        .unwrap_or_else(|| "eingehend".to_string())
}

/// Alles, was der Merge-Editor für eine Konfliktdatei braucht.
pub fn merge_context(g: &Git, path: &str) -> Result<ConflictData, String> {
    let snap = g.snapshot()?;
    let theirs_label = theirs_label_of(g);
    let ours_label = snap
        .head_branch
        .clone()
        .unwrap_or_else(|| "HEAD".to_string());

    let base = side_text(g, ":1", path, "Basis");
    let ours = side_text(g, ":2", path, "Lokal");
    let theirs = side_text(g, ":3", path, "Eingehend");
    let merged = side_text(g, "WORK", path, "Arbeitskopie");

    let trailing_newline = if ours.exists {
        ours.text.ends_with('\n')
    } else if theirs.exists {
        theirs.text.ends_with('\n')
    } else {
        true
    };

    let base_lines = split_lines(&base.text);
    let our_lines = split_lines(&ours.text);
    let their_lines = split_lines(&theirs.text);
    let regions = merge::merge_regions(&base_lines, &our_lines, &their_lines);

    // Wächter: vor einem stillen Auto-Merge git selbst fragen
    let guarded = !regions.iter().any(|r| r.kind == merge::Kind::Conflict)
        && mergecraft_core::verify::git_reports_conflict(&base_lines, &our_lines, &their_lines)
            .unwrap_or(false);

    let mut highlight_ours: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    let mut highlight_theirs: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    if !ours.binary && !theirs.binary {
        for r in &regions {
            if r.kind != merge::Kind::Conflict {
                continue;
            }
            let o = merge::slice(&our_lines, r.ours);
            let t = merge::slice(&their_lines, r.theirs);
            let (ho, ht) = pair_highlights(&o, &t, r.ours.0, r.theirs.0);
            highlight_ours.extend(ho);
            highlight_theirs.extend(ht);
        }
    }

    let result_text = merge::render(
        &regions,
        &base_lines,
        &our_lines,
        &their_lines,
        &HashMap::new(),
        &ours_label,
        &theirs_label,
        trailing_newline,
    );

    // AUTO_MERGE contains the untouched conflict file produced by Git's ort strategy.
    // If unavailable, conservatively preserve a different working result in text mode.
    let original = g.blob(&format!("AUTO_MERGE:{path}")).map(|(text, _)| text);
    let working_modified = merged.exists
        && !merged.binary
        && original
            .as_ref()
            .map_or(merged.text != result_text, |text| text != &merged.text);

    Ok(ConflictData {
        path: path.to_string(),
        root: snap.root,
        base,
        ours,
        theirs,
        merged,
        regions,
        trailing_newline,
        ours_label,
        theirs_label,
        result_text,
        working_modified,
        guarded,
        highlight_ours,
        highlight_theirs,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn conflict_data(state: State<AppState>, path: String) -> Result<ConflictData, String> {
    merge_context(&git_of(&state)?, &path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_conflict(
    state: State<AppState>,
    path: String,
    text: String,
    mark_resolved: bool,
    expected_working: Option<String>,
    expected_sources: Option<Vec<String>>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if expected_working.as_ref().is_some_and(|expected| {
        g.working_file(&path)
            .map(|(text, _)| text)
            .unwrap_or_default()
            != *expected
    }) || expected_sources.as_ref().is_some_and(|expected| {
        let actual: Vec<String> = ["1", "2", "3"]
            .iter()
            .map(|stage| {
                g.blob(&format!(":{stage}:{path}"))
                    .map(|(text, _)| text)
                    .unwrap_or_default()
            })
            .collect();
        *expected != actual
    }) {
        return Err("Datei wurde außerhalb des Editors geändert. Lade den Konflikt erneut, bevor du speicherst.".into());
    }
    if ["2", "3"].iter().any(|stage| {
        g.blob(&format!(":{stage}:{path}"))
            .is_some_and(|(text, binary)| binary || text.len() > MAX_FILE_BYTES)
    }) {
        return Err("Binärdateien können nur als vollständige Seite übernommen werden".into());
    }
    if mark_resolved
        && text.lines().any(|line| {
            ["<<<<<<<", "=======", ">>>>>>>", "|||||||"]
                .iter()
                .any(|marker| line.starts_with(marker))
        })
    {
        return Err("Die Ergebnisdatei enthält noch Konfliktmarker".into());
    }
    g.write_working_file(&path, &text)?;
    if !mark_resolved {
        return Ok(CommandResult {
            ok: true,
            code: 0,
            stdout: format!("{path} gespeichert"),
            stderr: String::new(),
        });
    }
    let mut r = if g.path(&path).exists() {
        utf8(g.raw(["add", "--", &path]))
    } else {
        utf8(g.raw(["update-index", "--force-remove", "--", &path]))
    };
    if r.ok {
        r.stdout = format!("{path} als gelöst markiert");
    }
    Ok(r)
}

/// Konflikt komplett mit einer Seite auflösen (ohne Editor).
#[tauri::command(rename_all = "snake_case")]
pub fn resolve_with_side(
    state: State<AppState>,
    path: String,
    side: String,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    g.resolve_side(&path, &side)
}

// ------------------------------------------------- Standalone (Merge-Tool)

/// Daten für den Merge-Editor im Standalone-Betrieb.
pub fn standalone_context(sm: &StandaloneMerge) -> Result<ConflictData, String> {
    let base = read_side(&sm.base, "Basis");
    let ours = read_side(&sm.ours, "Lokal");
    let theirs = read_side(&sm.theirs, "Eingehend");
    let merged = if sm.merged.exists() {
        read_side(&sm.merged, "Arbeitskopie")
    } else {
        read_side(&sm.ours, "Arbeitskopie")
    };
    let base_lines = split_lines(&base.text);
    let our_lines = split_lines(&ours.text);
    let their_lines = split_lines(&theirs.text);
    let regions = merge::merge_regions(&base_lines, &our_lines, &their_lines);
    let trailing_newline = ours.text.ends_with('\n');
    let guarded = !regions.iter().any(|r| r.kind == merge::Kind::Conflict)
        && mergecraft_core::verify::git_reports_conflict(&base_lines, &our_lines, &their_lines)
            .unwrap_or(false);
    let mut highlight_ours: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    let mut highlight_theirs: BTreeMap<usize, Vec<WordSpan>> = BTreeMap::new();
    for r in &regions {
        if r.kind != merge::Kind::Conflict {
            continue;
        }
        let o = merge::slice(&our_lines, r.ours);
        let t = merge::slice(&their_lines, r.theirs);
        let (ho, ht) = pair_highlights(&o, &t, r.ours.0, r.theirs.0);
        highlight_ours.extend(ho);
        highlight_theirs.extend(ht);
    }
    let result_text = merge::render(
        &regions,
        &base_lines,
        &our_lines,
        &their_lines,
        &HashMap::new(),
        &sm.label_ours,
        &sm.label_theirs,
        trailing_newline,
    );
    let working_modified =
        merged.exists && !merged.binary && merged.text != result_text && merged.text != ours.text;

    Ok(ConflictData {
        path: sm.merged.display().to_string(),
        root: std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        base,
        ours,
        theirs,
        merged,
        regions,
        trailing_newline,
        ours_label: sm.label_ours.clone(),
        theirs_label: sm.label_theirs.clone(),
        result_text,
        working_modified,
        guarded,
        highlight_ours,
        highlight_theirs,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn standalone_data(state: State<AppState>) -> Result<Option<ConflictData>, String> {
    let sm = state.standalone.lock().unwrap().clone();
    let Some(sm) = sm else { return Ok(None) };
    standalone_context(&sm).map(Some)
}

#[tauri::command(rename_all = "snake_case")]
pub fn standalone_save(state: State<AppState>, text: String) -> Result<CommandResult, String> {
    let sm = state
        .standalone
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Kein Standalone-Merge aktiv".to_string())?;
    let complete = !text.lines().any(|line| {
        ["<<<<<<<", "=======", ">>>>>>>", "|||||||"]
            .iter()
            .any(|marker| line.starts_with(marker))
    });
    std::fs::write(&sm.merged, text).map_err(|e| e.to_string())?;
    SAVED.store(complete, Ordering::SeqCst);
    Ok(CommandResult {
        ok: true,
        code: 0,
        stdout: format!("{} geschrieben", sm.merged.display()),
        stderr: String::new(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn standalone_side(state: State<AppState>, side: String) -> Result<CommandResult, String> {
    let sm = state
        .standalone
        .lock()
        .unwrap()
        .clone()
        .ok_or("Kein Standalone-Merge aktiv")?;
    let source = match side.as_str() {
        "ours" => sm.ours,
        "theirs" => sm.theirs,
        _ => return Err("Unbekannte Seite".into()),
    };
    std::fs::copy(source, &sm.merged).map_err(|e| e.to_string())?;
    SAVED.store(true, Ordering::SeqCst);
    Ok(CommandResult {
        ok: true,
        code: 0,
        stdout: "Dateiseite unverändert übernommen".into(),
        stderr: String::new(),
    })
}

// ---------------------------------------------------------------- Branches

#[tauri::command(rename_all = "snake_case")]
pub fn checkout_branch(
    state: State<AppState>,
    name: String,
    local_name: Option<String>,
    force: Option<bool>,
    track: Option<bool>,
    update_from_remote: Option<bool>,
    expected_local: Option<String>,
    expected_remote: Option<String>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if update_from_remote.unwrap_or(false) {
        return g.checkout_remote_update(
            &name,
            local_name.as_deref().ok_or("Lokaler Branch fehlt")?,
            expected_local.as_deref().ok_or("Lokaler Stand fehlt")?,
            expected_remote.as_deref().ok_or("Remote-Stand fehlt")?,
        );
    }
    g.checkout_branch(
        &name,
        local_name.as_deref(),
        force.unwrap_or(false),
        track.unwrap_or(false),
    )
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_branch(
    state: State<AppState>,
    name: String,
    start: Option<String>,
    checkout: Option<bool>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    g.create_branch(&name, start.as_deref(), checkout.unwrap_or(true))
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_branch(
    state: State<AppState>,
    name: String,
    force: Option<bool>,
    remote: Option<bool>,
    expected: Option<String>,
    expected_head: Option<String>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if remote.unwrap_or(false) {
        let (remote_name, branch) = name
            .split_once('/')
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .ok_or_else(|| "Remote-Branch als <remote>/<branch> angeben".to_string())?;
        return Ok(utf8(g.raw(["push", &remote_name, "--delete", &branch])));
    }
    if let Some(head) = expected_head {
        if g.snapshot()?.head != head {
            return Err("Repository oder aktueller Commit wurde geändert. Aufräumen gestoppt.".into());
        }
    }
    g.delete_local_branch(&name, force.unwrap_or(false), expected.as_deref())
}

#[tauri::command(rename_all = "snake_case")]
pub fn rename_branch(
    state: State<AppState>,
    name: String,
    new_name: String,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    Ok(utf8(g.raw(["branch", "-m", &name, &new_name])))
}

/// Merge in den aktuellen Branch; liefert die entstandenen Konflikte.
#[tauri::command(rename_all = "snake_case")]
pub fn merge_branch(
    state: State<AppState>,
    name: String,
    no_ff: Option<bool>,
    squash: Option<bool>,
    message: Option<String>,
) -> Result<MergeOutcome, String> {
    let g = git_of(&state)?;
    let mut args: Vec<String> = vec!["merge".into(), "--no-edit".into()];
    if no_ff.unwrap_or(true) {
        args.push("--no-ff".into());
    }
    if squash.unwrap_or(false) {
        args.push("--squash".into());
    }
    if let Some(m) = message.filter(|m| !m.is_empty()) {
        args.push("-m".into());
        args.push(m);
    }
    args.push(name);
    let out = g.raw(args);
    let conflicts = g
        .conflicted_files()
        .unwrap_or_default()
        .into_iter()
        .map(|c| c.path)
        .collect();
    Ok(MergeOutcome {
        ok: out.code == 0,
        conflicts,
        stdout: out.stdout.trim_end().to_string(),
        stderr: out.stderr.trim_end().to_string(),
        completed: out.code == 0,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn merge_abort(state: State<AppState>) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    let r = g.raw(["merge", "--abort"]);
    Ok(utf8(r))
}

#[tauri::command(rename_all = "snake_case")]
pub fn merge_continue(
    state: State<AppState>,
    message: Option<String>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if !g.status()?.conflicts.is_empty() {
        return Err("Es sind noch Konflikte offen".into());
    }
    let args: Vec<String> = match message.filter(|m| !m.is_empty()) {
        Some(m) => vec!["commit".into(), "--no-edit".into(), "-m".into(), m],
        None => vec!["commit".into(), "--no-edit".into()],
    };
    Ok(utf8(g.raw(args)))
}

// ---------------------------------------------------------------- Remote

#[tauri::command(rename_all = "snake_case")]
pub async fn fetch_remote(
    state: State<'_, AppState>,
    remote: Option<String>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    let args: Vec<String> = match remote.filter(|r| !r.is_empty()) {
        Some(r) => vec!["fetch".into(), r],
        None => vec!["fetch".into(), "--all".into(), "--prune".into()],
    };
    tauri::async_runtime::spawn_blocking(move || utf8(g.raw(args)))
        .await
        .map_err(|e| format!("Git-Auftrag fehlgeschlagen: {e}"))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pull(
    state: State<'_, AppState>,
    expected_branch: Option<String>,
    track_same_name: Option<bool>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        g.prepare_pull(expected_branch.as_deref(), track_same_name.unwrap_or(false))?;
        Ok(utf8(g.raw(["pull", "--no-edit"])))
    })
    .await
    .map_err(|e| format!("Git-Auftrag fehlgeschlagen: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn push(
    state: State<'_, AppState>,
    set_upstream: Option<bool>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if g.merge_state() {
        return Err("Noch nicht gepusht: Zuerst den Merge unter Änderungen abschließen. Dabei entsteht der Merge-Commit.".into());
    }
    let mut args = vec!["push".to_string()];
    if set_upstream.unwrap_or(false) {
        let snap = g.snapshot()?;
        args.push("--set-upstream".into());
        args.push(snap.remote_name.clone().unwrap_or_else(|| "origin".into()));
        if let Some(b) = snap.head_branch {
            args.push(b);
        }
    }
    tauri::async_runtime::spawn_blocking(move || utf8(g.raw(args)))
        .await
        .map_err(|e| format!("Git-Auftrag fehlgeschlagen: {e}"))
}

#[tauri::command(rename_all = "snake_case")]
pub fn stashes(state: State<AppState>) -> Result<Vec<StashInfo>, String> {
    git_of(&state)?.stashes()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rollback(
    state: State<'_, AppState>,
    paths: Vec<String>,
    expected_head: String,
) -> Result<CommandResult, String> {
    let git = git_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || git.rollback(&paths, &expected_head))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_stash(
    state: State<'_, AppState>,
    message: String,
) -> Result<CommandResult, String> {
    let git = git_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || git.save_stash(&message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn apply_stash(state: State<'_, AppState>, oid: String) -> Result<MergeOutcome, String> {
    let git = git_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || git.apply_stash(&oid))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- Arbeitskopie

#[tauri::command(rename_all = "snake_case")]
pub fn stage(state: State<AppState>, paths: Vec<String>) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    let mut args = vec!["add".to_string(), "-A".to_string(), "--".to_string()];
    args.extend(paths);
    Ok(utf8(g.raw(args)))
}

#[tauri::command(rename_all = "snake_case")]
pub fn unstage(state: State<AppState>, paths: Vec<String>) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.clone());
    let r = g.raw(args);
    if r.code == 0 {
        return Ok(utf8(r));
    }
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(paths);
    Ok(utf8(g.raw(args)))
}

#[tauri::command(rename_all = "snake_case")]
pub fn discard(state: State<AppState>, paths: Vec<String>) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    g.discard_untracked(&paths)
}

#[tauri::command(rename_all = "snake_case")]
pub fn commit(
    state: State<AppState>,
    message: String,
    amend: Option<bool>,
    sign: Option<bool>,
    all: Option<bool>,
) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    if message.trim().is_empty() && !amend.unwrap_or(false) {
        return Err("Commit-Nachricht ist leer".into());
    }
    if !amend.unwrap_or(false)
        && !all.unwrap_or(false)
        && !g.merge_state()
        && g.status()?.staged.is_empty()
    {
        return Err(
            "Keine Dateien zum Commit vorgemerkt. Hake zuerst die gewünschten Änderungen an."
                .into(),
        );
    }
    let mut args: Vec<String> = vec!["commit".into()];
    if amend.unwrap_or(false) {
        args.push("--amend".into());
    }
    if all.unwrap_or(false) {
        args.push("-a".into());
    }
    if sign.unwrap_or(false) {
        args.push("-S".into());
    }
    if !message.trim().is_empty() {
        args.push("-m".into());
        args.push(message);
    } else {
        args.push("--no-edit".into());
    }
    Ok(utf8(g.raw(args)))
}

#[tauri::command(rename_all = "snake_case")]
pub fn git_raw(state: State<AppState>, args: Vec<String>) -> Result<CommandResult, String> {
    let g = git_of(&state)?;
    Ok(utf8(g.raw(args)))
}

// ------------------------------------------------------------ Ordnerauswahl

// GTK hält einen `NativeDialog` nicht selbst am Leben: fällt die Rust-Variable
// weg, verschwindet das Fenster samt `response`-Handler. Der Dialog liegt
// deshalb thread-lokal (GTK darf nur auf dem Haupt-Thread benutzt werden).
thread_local! {
    static DIALOG_SLOT: std::cell::RefCell<Option<gtk::FileChooserNative>> =
        const { std::cell::RefCell::new(None) };
}

/// Native Ordnerauswahl über GTK auf dem Haupt-Thread.
///
/// Nicht über rfd/`tauri-plugin-dialog`: dessen GTK-Backend startet einen
/// eigenen Thread mit `gtk_init_check` und hängt sich am globalen Main-Context
/// einer GTK-Host-App auf - der Aufruf endet dann weder mit Ergebnis noch mit
/// Fehler. Hier läuft der Dialog im Haupt-Event-Loop, das Ergebnis kommt über
/// einen Kanal.
///
/// Wichtig: `async`. Ein synchroner Befehl läuft in Tauri auf dem Haupt-Thread;
/// `run_on_main_thread` schiebt den Dialog dann in eine Warteschlange, die der
/// Haupt-Thread erst abarbeitet, wenn er mit Warten auf die Antwort fertig ist -
/// der Dialog erscheint nie und die Oberfläche steht. Als asynchroner Befehl
/// läuft das Warten auf einem Arbeits-Thread.
#[tauri::command(rename_all = "snake_case")]
pub async fn pick_folder(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    use gtk::prelude::*;

    let title = title.unwrap_or_else(|| "Ordner wählen".into());

    // Prüfhaken: Antwort ohne Mausklick vorgeben. Auf Systemen ohne
    // Eingabewerkzeug (xdotool/wmctrl) lässt sich damit die Kette
    // Klick -> Befehl -> Kanal -> geöffnetes Repository nachweisen.
    if let Ok(vorgabe) = std::env::var("MERGECRAFT_PICK_AUTO") {
        return Ok(if vorgabe.is_empty() {
            None
        } else {
            Some(vorgabe)
        });
    }

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

    app.run_on_main_thread(move || {
        let dialog = gtk::FileChooserNative::new(
            Some(&title),
            None::<&gtk::Window>,
            gtk::FileChooserAction::SelectFolder,
            Some("Öffnen"),
            Some("Abbrechen"),
        );
        dialog.set_modal(true);
        if let Ok(home) = std::env::var("HOME") {
            let _ = dialog.set_current_folder(home);
        }
        dialog.connect_response(move |d, response| {
            let picked = if response == gtk::ResponseType::Accept {
                d.file()
                    .and_then(|f| f.path())
                    .map(|p| p.display().to_string())
            } else {
                None
            };
            d.hide();
            let _ = tx.send(picked);
        });
        dialog.show();
        DIALOG_SLOT.with(|slot| *slot.borrow_mut() = Some(dialog));
    })
    .map_err(|e| format!("Haupt-Thread nicht erreichbar: {e}"))?;

    match rx.recv_timeout(std::time::Duration::from_secs(180)) {
        Ok(Some(p)) => Ok(Some(p)),
        Ok(None) => Ok(None),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            Err("Ordnerauswahl ohne Antwort beendet".into())
        }
        Err(_) => Err("Ordnerauswahl konnte nicht angezeigt werden".into()),
    }
}

/// Fenstertitel setzen (Repository, Branch, Konfliktzahl).
#[tauri::command(rename_all = "snake_case")]
pub fn set_title(window: tauri::Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

/// Start only after the frontend has finished booting, independent of runner speed.
#[tauri::command]
pub fn start_selftest(window: tauri::WebviewWindow) -> Result<(), String> {
    if let Some(file) = std::env::var_os("MERGECRAFT_SELFTEST") {
        eprintln!("SELFTEST: frontend ready; injecting test script");
        let script = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
        window.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Selbsttest: nimmt das Ergebnis eines injizierten Skripts entgegen.
/// Der Pfad kommt aus MERGECRAFT_SELFTEST_OUT.
#[tauri::command(rename_all = "snake_case")]
pub fn selftest_report(text: String, finish: Option<bool>) -> Result<(), String> {
    let path = std::env::var("MERGECRAFT_SELFTEST_OUT").unwrap_or_default();
    if path.is_empty() {
        return Err("MERGECRAFT_SELFTEST_OUT fehlt".into());
    }
    std::fs::write(&path, &text).map_err(|e| e.to_string())?;
    if finish == Some(false) {
        return Ok(());
    }
    // Kurz Zeit zum Schreiben geben, dann beenden.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::process::exit(0);
    });
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
