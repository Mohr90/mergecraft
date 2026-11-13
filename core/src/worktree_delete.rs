//! Explicit removal of one linked worktree followed by its local branch.
use crate::{gitcli::Git, model::*};
use std::path::Path;

impl Git {
    pub fn worktree_branch_preview(
        &self,
        name: &str,
    ) -> Result<Option<WorktreeBranchDeletion>, String> {
        self.idle()?;
        let branch = self
            .branches()?
            .into_iter()
            .find(|b| !b.is_remote && (b.name == name || b.full_name == name))
            .ok_or("Branch nicht gefunden.")?;
        let records = self.run(["worktree", "list", "--porcelain", "-z"])?;
        let wanted = format!("branch {}", branch.full_name);
        let records: Vec<_> = records.split("\0\0").filter(|r| !r.is_empty()).collect();
        let matching: Vec<_> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.split('\0').any(|field| field == wanted))
            .collect();
        let Some((position, record)) = matching.first() else {
            return Ok(None);
        };
        let fields: Vec<_> = record.split('\0').collect();
        let path = fields
            .iter()
            .find_map(|f| f.strip_prefix("worktree "))
            .ok_or("Worktree-Pfad fehlt.")?;
        let oid = fields
            .iter()
            .find_map(|f| f.strip_prefix("HEAD "))
            .ok_or("Worktree-Stand fehlt.")?;
        let mut blocked = None;
        if matching.len() != 1 {
            blocked = Some(
                "Der Branch ist in mehreren Worktrees geöffnet. Schließe sie zuerst einzeln."
                    .into(),
            );
        } else if *position == 0 || self.root.starts_with(Path::new(path)) {
            blocked=Some("Der Haupt-Worktree und der aktuell geöffnete Worktree können hier nicht entfernt werden.".into());
        } else if fields
            .iter()
            .any(|f| f.starts_with("locked") || f.starts_with("prunable"))
        {
            blocked =
                Some("Der Worktree ist gesperrt oder nicht erreichbar. Prüfe ihn zuerst.".into());
        }
        let other = Git::new(path);
        let mut token = String::new();
        if blocked.is_none() {
            if std::fs::symlink_metadata(path)
                .map_or(true, |m| !m.is_dir() || m.file_type().is_symlink())
            {
                blocked = Some(
                    "Der Worktree ist gesperrt oder nicht erreichbar. Prüfe ihn zuerst.".into(),
                );
            } else if other.idle().is_err() {
                blocked =
                    Some("Im Worktree läuft noch ein Git-Vorgang. Schließe ihn zuerst ab.".into());
            } else {
                // Git's default worktree removal can discard ignored files. Be stricter.
                let status = other.run([
                    "status",
                    "--porcelain=v1",
                    "--untracked-files=all",
                    "--ignored=matching",
                ])?;
                if !status.is_empty() {
                    blocked=Some("Der Worktree enthält lokale Änderungen, unversionierte oder ignorierte Dateien. Räume ihn zuerst auf; es wurde nichts entfernt.".into());
                }
                if blocked.is_none()
                    && other
                        .run(["ls-files", "--stage", "-z"])?
                        .split('\0')
                        .any(|entry| entry.starts_with("160000 "))
                {
                    blocked=Some("Der Worktree enthält Submodule. Entferne diese Verknüpfung außerhalb von Mergecraft.".into());
                }
                token = other.workflow_token()?;
            }
        }
        Ok(Some(WorktreeBranchDeletion {
            branch: branch.full_name,
            path: path.into(),
            branch_oid: oid.into(),
            caller_head: self.snapshot()?.head,
            token,
            blocked,
        }))
    }

    pub fn remove_worktree_branch(
        &self,
        preview: &WorktreeBranchDeletion,
        force: bool,
    ) -> Result<CommandResult, String> {
        let current = self
            .worktree_branch_preview(&preview.branch)?
            .ok_or("Die Worktree-Zuordnung wurde geändert. Bitte erneut prüfen.")?;
        if let Some(reason) = current.blocked {
            return Err(reason);
        }
        if &current != preview {
            return Err(
                "Die Worktree-Zuordnung oder der Branch-Stand wurde geändert. Bitte erneut prüfen."
                    .into(),
            );
        }
        if !force {
            if self
                .raw([
                    "merge-base",
                    "--is-ancestor",
                    &preview.branch_oid,
                    &preview.caller_head,
                ])
                .code
                != 0
            {
                return Err(
                    "Der Branch enthält eigene Commits. Bestätige das Löschen ausdrücklich.".into(),
                );
            }
        }
        // No --force: Git must recheck its own locks, worktree and submodule guards.
        let removal = self.run_result(["worktree", "remove", "--", &preview.path]);
        if !removal.ok {
            return Ok(removal);
        }
        let deletion = self.delete_local_branch(
            preview
                .branch
                .strip_prefix("refs/heads/")
                .ok_or("Ungültiger Branch-Verweis.")?,
            // We already proved reachability from the caller's HEAD, or the
            // user explicitly approved unique commits. Do not let Git's separate
            // upstream-based -d policy fail only after removing the directory.
            true,
            Some(&preview.branch_oid),
        );
        match deletion {
            Ok(result) if result.ok => Ok(result),
            other => {
                let error = match other {
                    Err(e) => e,
                    Ok(r) => format!("{}\n{}", r.stderr, r.stdout),
                };
                Ok(CommandResult {ok:false,code:1,stdout:String::new(),stderr:format!("Worktree entfernt; der Branch wurde nicht gelöscht. Prüfe den Branch und versuche es erneut.\n{error}")})
            }
        }
    }
}
