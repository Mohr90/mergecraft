//! Änderungsblöcke aus gits eigenem Diff (xdiff). Wird im Test als zweite
//! Quelle gegen die Engine geprüft.

use crate::merge::Block;
use std::path::Path;
use std::process::Command;

/// Parst einen Unified Diff ohne Kontext in Basis->Seite-Blöcke.
pub fn parse_unified(text: &str) -> Vec<Block> {
    let mut out = Vec::new();
    for line in text.lines() {
        if !line.starts_with("@@") {
            continue;
        }
        let hdr: Vec<&str> = line.split("@@").collect();
        if hdr.len() < 2 {
            continue;
        }
        let toks: Vec<&str> = hdr[1].split_whitespace().collect();
        if toks.len() < 2 {
            continue;
        }
        let parse = |t: &str| -> Option<(usize, usize)> {
            let t = t.trim_start_matches(['-', '+']);
            let (s, c) = match t.split_once(',') {
                Some((s, c)) => (s, c),
                None => (t, "1"),
            };
            Some((s.parse().ok()?, c.parse().ok()?))
        };
        let (as_, ac) = match parse(toks[0]) {
            Some(v) => v,
            None => continue,
        };
        let (bs_, bc) = match parse(toks[1]) {
            Some(v) => v,
            None => continue,
        };
        // bei Länge 0 ist die Zahl die Zeile, *vor* der eingefügt wird
        let a_start = if ac == 0 { as_ } else { as_ - 1 };
        let b_start = if bc == 0 { bs_ } else { bs_ - 1 };
        out.push(Block {
            a_start,
            a_len: ac,
            b_start,
            b_len: bc,
        });
    }
    out.sort_by_key(|b| (b.a_start, b.a_len));
    out
}

/// Blöcke zwischen zwei Dateien auf der Platte, wie git sie berechnet.
pub fn git_blocks(a: &Path, b: &Path, indent_heuristic: bool) -> Result<Vec<Block>, String> {
    let dir = a.parent().unwrap_or(Path::new("."));
    let mut args: Vec<String> = vec!["diff".into(), "--no-index".into(), "-U0".into()];
    if !indent_heuristic {
        args.push("--no-indent-heuristic".into());
    }
    args.push("--".into());
    args.push(a.display().to_string());
    args.push(b.display().to_string());
    let out = Command::new("git")
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .args(&args)
        .output()
        .map_err(|e| format!("git nicht ausführbar: {e}"))?;
    if out.status.code().unwrap_or(1) > 1 {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(parse_unified(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_insertions_and_replacements() {
        let text = "diff --git a/x b/y\n--- a/x\n+++ b/y\n@@ -1,0 +2,3 @@\n+a\n+b\n+c\n@@ -5,2 +8,1 @@\n-x\n-y\n+z\n";
        let b = parse_unified(text);
        assert_eq!(b.len(), 2);
        assert_eq!(
            (b[0].a_start, b[0].a_len, b[0].b_start, b[0].b_len),
            (1, 0, 1, 3)
        );
        assert_eq!(
            (b[1].a_start, b[1].a_len, b[1].b_start, b[1].b_len),
            (4, 2, 7, 1)
        );
    }

    #[test]
    fn parses_whole_file_insert_at_start() {
        let b = parse_unified("@@ -0,0 +1,2 @@\n");
        assert_eq!(
            (b[0].a_start, b[0].a_len, b[0].b_start, b[0].b_len),
            (0, 0, 0, 2)
        );
    }
}
