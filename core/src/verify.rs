//! Schutznetz für den einen Fall, in dem eine diffbasierte Engine von git
//! abweichen kann: Myers' Diff darf eine Änderung bei doppelten Zeilen
//! gleichwertig anders beschreiben. Vor einem *stillen* Auto-Merge fragt
//! Mergecraft deshalb `git merge-file` selbst und schaltet im Zweifel in den
//! Prüf-Modus, statt eine Änderung zu verwerfen.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn scratch_dir() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("mergecraft-verify-{}-{n}", std::process::id()))
}

fn write_lines(path: &PathBuf, lines: &[String]) {
    let mut t = lines.join("\n");
    if !t.is_empty() {
        t.push('\n');
    }
    let _ = std::fs::write(path, t);
}

/// `Some(true)` = git meldet Konflikt, `Some(false)` = git mergt sauber,
/// `None` = Prüfung nicht möglich.
pub fn git_reports_conflict(base: &[String], ours: &[String], theirs: &[String]) -> Option<bool> {
    let dir = scratch_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let (bp, op, tp) = (
        dir.join("base.txt"),
        dir.join("ours.txt"),
        dir.join("theirs.txt"),
    );
    write_lines(&bp, base);
    write_lines(&op, ours);
    write_lines(&tp, theirs);
    let out = Command::new("git")
        .current_dir(&dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "merge-file",
            "-p",
            "--no-diff3",
            "ours.txt",
            "base.txt",
            "theirs.txt",
        ])
        .output();
    let _ = std::fs::remove_dir_all(&dir);
    match out {
        Ok(o) => {
            let code = o.status.code()?;
            if !(0..=200).contains(&code) {
                return None;
            }
            Some(code != 0)
        }
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::split_lines;

    #[test]
    fn detects_git_conflict() {
        let b = split_lines("a\nb\nc\n");
        assert_eq!(
            git_reports_conflict(&b, &split_lines("a\nX\nc\n"), &split_lines("a\nY\nc\n")),
            Some(true)
        );
    }

    #[test]
    fn detects_clean_merge() {
        let b = split_lines("a\nb\nc\nd\ne\n");
        assert_eq!(
            git_reports_conflict(
                &b,
                &split_lines("a\nB\nc\nd\ne\n"),
                &split_lines("a\nb\nc\nD\ne\n")
            ),
            Some(false)
        );
    }

    #[test]
    fn handles_duplicated_lines() {
        let b = split_lines("l0\nl1\nl2\n");
        assert_eq!(
            git_reports_conflict(
                &b,
                &split_lines("l0\nl1\n"),
                &split_lines("l0\nnew2\nl1\nl1\nl2\n")
            ),
            Some(false)
        );
    }

    #[test]
    fn handles_empty_base() {
        let b: Vec<String> = Vec::new();
        assert_eq!(
            git_reports_conflict(&b, &split_lines("a\n"), &split_lines("b\n")),
            Some(true)
        );
    }
}
