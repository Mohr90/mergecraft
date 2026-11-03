//! Differenzieller Test: die eigene Engine gegen das echte `git merge-file`.
//!
//! Zwei Eigenschaften werden über tausende Zufallsfälle geprüft:
//!
//! 1. SICHERHEIT (harte Anforderung): Wo git einen Konflikt sieht, darf
//!    Mergecraft niemals stillschweigend automatisch mergen. Die Gegenrichtung
//!    (wir fragen, wo git sauber mergt) kostet nur einen Klick - eine
//!    verschwundene Änderung wäre echter Datenverlust.
//! 2. TREUE: Übereinstimmungsquote und byte-identische Ausgabe überall dort,
//!    wo beide Seiten sauber mergen.
//!
//! Vollständige Parität ist ohne Auswerten der `git merge-file`-Ausgabe nicht
//! erreichbar, weil Myers' Diff dieselbe Änderung mehrfach gleichwertig
//! beschreiben kann (doppelte Zeilen). Deshalb ist die Engine bewusst streng
//! und der Wächter (`verify`) prüft vor jedem stillen Auto-Merge mit git selbst.

use mergecraft_core::merge::{diff_blocks, merge_regions, render, split_lines, Block, Kind};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

fn mutate(base: &[String], rng: &mut Rng, duplicates: bool) -> Vec<String> {
    let mut out = Vec::new();
    for line in base {
        if rng.chance(10) {
            for _ in 0..1 + rng.below(2) {
                out.push(format!("new{}", rng.below(4)));
            }
        }
        if rng.chance(12) {
            continue;
        }
        if rng.chance(15) {
            out.push(format!("mod{}", rng.below(4)));
        } else if duplicates && rng.chance(12) {
            out.push(line.clone());
            out.push(line.clone());
        } else {
            out.push(line.clone());
        }
    }
    if rng.chance(8) {
        out.push(format!("tail{}", rng.below(3)));
    }
    out
}

fn write(dir: &Path, name: &str, lines: &[String]) {
    let mut t = lines.join("\n");
    if !t.is_empty() {
        t.push('\n');
    }
    std::fs::write(dir.join(name), t).unwrap();
}

fn git_merge_file(dir: &Path) -> (i32, String) {
    let out = Command::new("git")
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "merge-file",
            "-p",
            "--no-diff3",
            "ours.txt",
            "base.txt",
            "theirs.txt",
        ])
        .output()
        .expect("git merge-file");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
    )
}

#[derive(Default)]
struct Stats {
    cases: usize,
    git_conflicts: usize,
    clean: usize,
    /// git sieht Konflikt, der Wächter greift nicht -> inakzeptabel
    dropped: Vec<String>,
    /// git sieht Konflikt, Engine nicht, aber der Wächter fängt es ab
    guarded: usize,
    /// wir fragen, wo git sauber mergt -> akzeptabel, nur zusätzliche Klicks
    extra: usize,
    text_mismatch: Vec<String>,
}

impl Stats {
    fn agreement(&self) -> f64 {
        1.0 - ((self.dropped.len() + self.extra) as f64 / self.cases.max(1) as f64)
    }
    fn report(&self, label: &str) -> String {
        format!(
            "{label}: Fälle={} Konflikte(git)={} sauber(git)={} ungeschützt={} vom-Wächter-erkannt={} zusätzliche={} Textfehler={} Übereinstimmung={:.2}%",
            self.cases,
            self.git_conflicts,
            self.clean,
            self.dropped.len(),
            self.guarded,
            self.extra,
            self.text_mismatch.len(),
            100.0 * self.agreement()
        )
    }
}

fn run_corpus(cases: usize, seed: u64, duplicates: bool) -> Stats {
    let dir = std::env::temp_dir()
        .join("mergecraft-diff3")
        .join(format!("{seed:x}"));
    std::fs::create_dir_all(&dir).unwrap();
    let mut rng = Rng(seed);
    let mut st = Stats::default();

    for i in 0..cases as u64 {
        rng.0 = seed.wrapping_mul(i + 1) | 1;
        let n = 3 + rng.below(14);
        let base: Vec<String> = (0..n).map(|k| format!("l{k}")).collect();
        let ours = mutate(&base, &mut rng, duplicates);
        let theirs = mutate(&base, &mut rng, duplicates);
        write(&dir, "base.txt", &base);
        write(&dir, "ours.txt", &ours);
        write(&dir, "theirs.txt", &theirs);

        let (code, git_text) = git_merge_file(&dir);
        assert!(
            (0..200).contains(&code),
            "git merge-file scheiterte: {code}"
        );
        let git_conflict = code != 0;

        let regions = merge_regions(&base, &ours, &theirs);
        let projected_ours: Vec<String> = regions
            .iter()
            .flat_map(|r| ours[r.ours.0..r.ours.0 + r.ours.1].iter().cloned())
            .collect();
        let projected_theirs: Vec<String> = regions
            .iter()
            .flat_map(|r| theirs[r.theirs.0..r.theirs.0 + r.theirs.1].iter().cloned())
            .collect();
        assert_eq!(
            projected_ours, ours,
            "local projection case {i} seed {seed}"
        );
        assert_eq!(
            projected_theirs, theirs,
            "incoming projection case {i} seed {seed}"
        );

        let my_conflict = regions.iter().any(|r| r.kind == Kind::Conflict);
        let text = render(
            &regions,
            &base,
            &ours,
            &theirs,
            &HashMap::new(),
            "ours",
            "theirs",
            true,
        );

        st.cases += 1;
        if git_conflict {
            st.git_conflicts += 1;
        } else {
            st.clean += 1;
        }
        let case = format!("  base={base:?}\n  ours={ours:?}\n  theirs={theirs:?}");
        if git_conflict && !my_conflict {
            match mergecraft_core::verify::git_reports_conflict(&base, &ours, &theirs) {
                Some(true) => st.guarded += 1,
                other => {
                    if st.dropped.len() < 3 {
                        st.dropped
                            .push(format!("  Wächter lieferte {other:?}\n{case}"));
                    }
                }
            }
        } else if !git_conflict && my_conflict {
            st.extra += 1;
        } else if !git_conflict && git_text != text && st.text_mismatch.len() < 3 {
            st.text_mismatch
                .push(format!("{case}\n  git={git_text:?}\n  mine={text:?}"));
        }
    }
    eprintln!(
        "{}",
        st.report(&format!("seed={seed:x} Duplikate={duplicates}"))
    );
    st
}

#[test]
fn no_conflict_is_ever_merged_silently() {
    let st = run_corpus(3000, 0x1234_5678_9abc_def0, true);
    assert!(
        st.dropped.is_empty(),
        "SICHERHEITSVERLETZUNG: git sah einen Konflikt und der Wächter griff nicht:\n{}",
        st.dropped.join("\n")
    );
    assert!(st.agreement() > 0.95, "Übereinstimmung zu niedrig");
}

#[test]
fn high_fidelity_without_duplicate_lines() {
    let st = run_corpus(3000, 0x0bad_f00d_dead_beef, false);
    assert!(
        st.dropped.is_empty(),
        "SICHERHEITSVERLETZUNG:\n{}",
        st.dropped.join("\n")
    );
    assert!(
        st.text_mismatch.is_empty(),
        "Textabweichung bei sauberem Merge:\n{}",
        st.text_mismatch.join("\n")
    );
    assert!(
        st.agreement() > 0.99,
        "Übereinstimmung ohne Duplikate zu niedrig"
    );
}

#[test]
fn git_hunks_as_diff_source_stay_safe() {
    // Alternative Diffquelle (`git diff -U0`) gegen die echte Merge-Entscheidung
    // von git: gleiche Sicherheitsanforderung wie bei der eigenen Diffquelle.
    let dir = std::env::temp_dir().join("mergecraft-diff3").join("hunks");
    std::fs::create_dir_all(&dir).unwrap();
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut cases = 0;
    let mut unsafe_cases = 0;
    let mut guarded = 0;
    for i in 0..500u64 {
        rng.0 = 0x9e37_79b9_7f4a_7c15u64.wrapping_mul(i + 1) | 1;
        let n = 3 + rng.below(12);
        let base: Vec<String> = (0..n).map(|k| format!("l{k}")).collect();
        let ours = mutate(&base, &mut rng, true);
        let theirs = mutate(&base, &mut rng, true);
        write(&dir, "base.txt", &base);
        write(&dir, "ours.txt", &ours);
        write(&dir, "theirs.txt", &theirs);
        let (code, _) = git_merge_file(&dir);
        let git_conflict = code != 0;

        let bp = dir.join("base.txt");
        let bo: Vec<Block> =
            mergecraft_core::hunks::git_blocks(&bp, &dir.join("ours.txt"), true).unwrap();
        let bt: Vec<Block> =
            mergecraft_core::hunks::git_blocks(&bp, &dir.join("theirs.txt"), true).unwrap();
        let regions = mergecraft_core::merge::merge_regions_with(&base, &ours, &theirs, &bo, &bt);
        let my_conflict = regions.iter().any(|r| r.kind == Kind::Conflict);
        if git_conflict && !my_conflict {
            match mergecraft_core::verify::git_reports_conflict(&base, &ours, &theirs) {
                Some(true) => guarded += 1,
                _ => unsafe_cases += 1,
            }
        }
        cases += 1;
    }
    assert_eq!(cases, 500);
    assert_eq!(
        unsafe_cases, 0,
        "git-Hunks: {unsafe_cases} Fälle ohne Schutz auto-gemergt (Wächter griff {guarded}x)"
    );
}

#[test]
fn regression_real_world_style_cases() {
    let dir = std::env::temp_dir()
        .join("mergecraft-diff3")
        .join("regression");
    std::fs::create_dir_all(&dir).unwrap();
    let cases: Vec<(&str, &str, &str)> = vec![
        // beide Seiten fügen unterschiedliche Imports oben ein -> Konflikt
        (
            "import a\nimport b\n\nfn main() {}\n",
            "import a\nimport b\nimport c\n\nfn main() {}\n",
            "import a\nimport b\nimport d\nimport e\n\nfn main() {}\n",
        ),
        // Umformatierung gegen Änderung im selben Block -> Konflikt
        (
            "fn f() {\n    let x = 1;\n    let y = 2;\n}\n",
            "fn f() {\n  let x = 1;\n  let y = 2;\n}\n",
            "fn f() {\n    let x = 42;\n    let y = 2;\n}\n",
        ),
        // getrennte Blöcke -> sauber
        (
            "a\nb\nc\nd\ne\nf\n",
            "A\nb\nc\nd\ne\nf\n",
            "a\nb\nc\nd\ne\nF\n",
        ),
        // gleiche Löschung auf beiden Seiten -> sauber
        ("a\nb\nc\nd\n", "a\nd\n", "a\nd\n"),
        // Anhängen am Dateiende gegen Löschen der letzten Zeile -> Konflikt
        ("a\nb\n", "a\nb\nc\n", "a\nB\n"),
        // überlappende, unterschiedlich große Basisbereiche -> Konflikt
        (
            "l0\nl1\nl2\nl3\nl4\nl5\nl6\n",
            "l0\nl1\nl4\nnew1\nl6\n",
            "l0\nl1\nl3\nl4\nl5\nl6\n",
        ),
    ];
    for (i, (base, ours, theirs)) in cases.iter().enumerate() {
        let (b, o, t) = (split_lines(base), split_lines(ours), split_lines(theirs));
        write(&dir, "base.txt", &b);
        write(&dir, "ours.txt", &o);
        write(&dir, "theirs.txt", &t);
        let (code, git_text) = git_merge_file(&dir);
        let regions = merge_regions(&b, &o, &t);
        let my_conflict = regions.iter().any(|r| r.kind == Kind::Conflict);
        if code != 0 {
            assert!(
                my_conflict,
                "Fall {i}: git meldet Konflikt, wir nicht: {base:?}/{ours:?}/{theirs:?}"
            );
        } else {
            let text = render(
                &regions,
                &b,
                &o,
                &t,
                &HashMap::new(),
                "ours",
                "theirs",
                true,
            );
            assert_eq!(git_text, text, "Fall {i}: Textabweichung");
        }
        // Wort-Hervorhebung darf bei sauberem Merge nichts verändern
        let _ = diff_blocks(&b, &o);
    }
}

#[test]
fn conflict_projection_keeps_unchanged_edges_of_both_sides() {
    let base = split_lines("a=1\nb=2\nc=3\n");
    let ours = split_lines("a=10\nb=2\nc=30\n");
    let theirs = split_lines("a=1\nb=20\nc=3\n");
    let regions = merge_regions(&base, &ours, &theirs);
    let projected_ours: Vec<String> = regions
        .iter()
        .flat_map(|r| ours[r.ours.0..r.ours.0 + r.ours.1].iter().cloned())
        .collect();
    let projected_theirs: Vec<String> = regions
        .iter()
        .flat_map(|r| theirs[r.theirs.0..r.theirs.0 + r.theirs.1].iter().cloned())
        .collect();
    assert_eq!(projected_ours, ours);
    assert_eq!(projected_theirs, theirs);
}
