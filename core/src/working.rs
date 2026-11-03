//! Local rollback and explicitly requested stash operations.
use crate::gitcli::Git;
use crate::model::{CommandResult, FileState, MergeOutcome, StashInfo};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

impl Git {
    fn ensure_idle(&self) -> Result<(), String> {
        let git_dir = PathBuf::from(self.run(["rev-parse", "--absolute-git-dir"])?.trim());
        if [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "rebase-merge",
            "rebase-apply",
            "sequencer",
        ]
        .iter()
        .any(|name| git_dir.join(name).exists())
            || !self.status()?.conflicts.is_empty()
        {
            return Err("Schließe zuerst den laufenden Git-Vorgang und alle Konflikte ab.".into());
        }
        Ok(())
    }

    pub fn stashes(&self) -> Result<Vec<StashInfo>, String> {
        let text = self.run(["stash", "list", "--format=%H%x1f%gd%x1f%gs%x1f%ct%x1e"])?;
        Ok(text
            .split('\x1e')
            .filter_map(|record| {
                let fields: Vec<_> = record.trim_matches('\n').split('\x1f').collect();
                if fields.len() < 4 {
                    return None;
                }
                Some(StashInfo {
                    oid: fields[0].into(),
                    selector: fields[1].into(),
                    message: fields[2].into(),
                    timestamp: fields[3].parse().unwrap_or(0),
                })
            })
            .collect())
    }

    /// Only actual changed paths reported by Git are accepted. Pathspec syntax stays literal.
    pub fn rollback(&self, paths: &[String], expected_head: &str) -> Result<CommandResult, String> {
        if paths.is_empty() {
            return Err("Wähle mindestens eine Datei für den Rollback aus.".into());
        }
        self.ensure_idle()?;
        let head = self.run(["rev-parse", "--verify", "HEAD"])?;
        if head.trim() != expected_head {
            return Err("Der aktuelle Commit hat sich geändert. Bitte aktualisieren und den Rollback erneut öffnen.".into());
        }
        let status = self.status()?;
        let mut selected = BTreeSet::new();
        for path in paths {
            if path.is_empty()
                || !Path::new(path)
                    .components()
                    .all(|part| matches!(part, Component::Normal(_)))
            {
                return Err(format!("Ungültiger Dateipfad: {path}"));
            }
            let entry = status
                .all
                .iter()
                .find(|entry| entry.path == *path)
                .ok_or_else(|| format!("Die Datei ist nicht mehr als geändert erfasst: {path}"))?;
            if matches!(entry.state, FileState::Untracked | FileState::Conflicted) {
                return Err(
                    "Unversionierte Dateien und Konflikte werden nicht per Rollback entfernt."
                        .into(),
                );
            }
            selected.insert(path.clone());
            if let Some(original) = &entry.orig_path {
                selected.insert(original.clone());
            }
        }
        // A Git submodule needs its own rollback inside that repository.
        for path in &selected {
            let index = self.run(["--literal-pathspecs", "ls-files", "--stage", "--", path])?;
            let tree = self.run(["--literal-pathspecs", "ls-tree", expected_head, "--", path])?;
            if index
                .lines()
                .chain(tree.lines())
                .any(|line| line.starts_with("160000 "))
            {
                return Err(format!(
                    "Untermodul „{path}“ bitte in seinem eigenen Repository zurücksetzen."
                ));
            }
        }
        let mut args = vec![
            "--literal-pathspecs".into(),
            "restore".into(),
            format!("--source={expected_head}"),
            "--staged".into(),
            "--worktree".into(),
            "--".into(),
        ];
        args.extend(selected);
        let mut result = self.run_result(args);
        if result.ok {
            result.stdout = if paths.len() == 1 {
                format!("{} auf den letzten Commit zurückgesetzt.", paths[0])
            } else {
                format!(
                    "{} Dateien auf den letzten Commit zurückgesetzt.",
                    paths.len()
                )
            };
        }
        Ok(result)
    }

    pub fn save_stash(&self, message: &str) -> Result<CommandResult, String> {
        self.ensure_idle()?;
        self.run(["rev-parse", "--verify", "HEAD"]).map_err(|_| {
            "Erstelle zuerst den ersten Commit, bevor du Änderungen zwischenparkst.".to_string()
        })?;
        if self.status()?.all.is_empty() {
            return Err("Keine lokalen Änderungen zum Zwischenparken.".into());
        }
        let message = if message.trim().is_empty() {
            "Mergecraft · Zwischenstand"
        } else {
            message.trim()
        };
        Ok(self.run_result(["stash", "push", "--include-untracked", "-m", message]))
    }

    pub fn apply_stash(&self, oid: &str) -> Result<MergeOutcome, String> {
        self.ensure_idle()?;
        if !self.status()?.all.is_empty() {
            return Err("Die Arbeitskopie ist nicht leer. Committe oder parke diese Änderungen zuerst zwischen.".into());
        }
        if !self.stashes()?.iter().any(|stash| stash.oid == oid) {
            return Err(
                "Diese Zwischenablage ist nicht mehr vorhanden. Bitte aktualisieren.".into(),
            );
        }
        let out = self.raw(["stash", "apply", "--index", oid]);
        let conflicts = self
            .conflicted_files()?
            .into_iter()
            .map(|file| file.path)
            .collect();
        Ok(MergeOutcome {
            ok: out.code == 0,
            completed: out.code == 0,
            conflicts,
            stdout: out.stdout.trim_end().into(),
            stderr: out.stderr.trim_end().into(),
        })
    }

    pub fn discard_untracked(&self, paths: &[String]) -> Result<CommandResult, String> {
        if paths.is_empty() {
            return Err("Keine Dateien ausgewählt.".into());
        }
        let status = self.status()?;
        for path in paths {
            if !status.untracked.iter().any(|entry| entry.path == *path) {
                return Err(format!(
                    "Nur unversionierte Dateien können hier gelöscht werden: {path}"
                ));
            }
        }
        let mut args = vec![
            "--literal-pathspecs".into(),
            "clean".into(),
            "-f".into(),
            "--".into(),
        ];
        args.extend(paths.iter().cloned());
        Ok(self.run_result(args))
    }
}
