//! 3-Wege-Merge-Engine.
//!
//! Aus den drei Fassungen (Basis = gemeinsamer Vorfahre, lokal, eingehend) werden
//! *Regionen* berechnet: zeilenweise ausgerichtete Blöcke, die nebeneinander
//! dargestellt und einzeln entschieden werden können.
//!
//! Die Konfliktregel ist empirisch gegen `git merge-file` abgesichert
//! (siehe tests/diff3_compat.rs): angrenzende Änderungen sind Konflikte,
//! identische Änderungen nur bei identischem Basisbereich automatisch gleich,
//! und im Zweifel wird immer zugunsten eines sichtbaren Konflikts entschieden.

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, DiffOp, TextDiff};
use std::collections::{BTreeMap, HashMap};

/// Zerlegt Text in Zeilen; die durch einen Zeilenumbruch am Ende entstehende
/// Leerzeile wird verworfen ("a\nb\n" -> ["a", "b"]).
pub fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut v: Vec<String> = text.split('\n').map(|s| s.to_string()).collect();
    if text.ends_with('\n') {
        v.pop();
    }
    v
}

/// Ein geänderter Block eines 2-Wege-Diffs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub a_start: usize,
    pub a_len: usize,
    pub b_start: usize,
    pub b_len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Unchanged,
    OursOnly,
    TheirsOnly,
    BothSame,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Region {
    pub kind: Kind,
    /// (Start, Länge) in der Basis
    pub base: (usize, usize),
    /// (Start, Länge) lokal
    pub ours: (usize, usize),
    /// (Start, Länge) eingehend
    pub theirs: (usize, usize),
}

/// Zeilenweiser Diff als nicht-leere Blöcke, sortiert nach Basisposition.
pub fn diff_blocks(base: &[String], side: &[String]) -> Vec<Block> {
    if base.is_empty() && side.is_empty() {
        return Vec::new();
    }
    let b = base.join("\n");
    let s = side.join("\n");
    let diff = TextDiff::from_lines(&b, &s);
    let mut out: Vec<Block> = Vec::new();
    for op in diff.ops() {
        if matches!(op, DiffOp::Equal { .. }) {
            continue;
        }
        let or = op.old_range();
        let nr = op.new_range();
        let nb = Block {
            a_start: or.start,
            a_len: or.len(),
            b_start: nr.start,
            b_len: nr.len(),
        };
        if let Some(last) = out.last_mut() {
            let la_end = last.a_start + last.a_len;
            let lb_end = last.b_start + last.b_len;
            let na_end = nb.a_start + nb.a_len;
            let nb_end = nb.b_start + nb.b_len;
            if nb.a_start <= la_end && nb.b_start <= lb_end {
                let a_start = last.a_start.min(nb.a_start);
                let b_start = last.b_start.min(nb.b_start);
                *last = Block {
                    a_start,
                    a_len: la_end.max(na_end) - a_start,
                    b_start,
                    b_len: lb_end.max(nb_end) - b_start,
                };
                continue;
            }
        }
        out.push(nb);
    }
    out
}

#[derive(Debug, Default, Clone)]
struct Group {
    base_start: usize,
    base_end: usize,
    /// (base_start, base_len, side_start, side_len) aller Blöcke dieser Seite
    ours: Vec<(usize, usize, usize, usize)>,
    theirs: Vec<(usize, usize, usize, usize)>,
}

/// Beide Seiten haben *dieselbe* Änderung am *selben* Basisbereich gemacht:
/// genau ein Block je Seite, gleiche Basisspanne, gleicher Ergebnistext.
/// Absichtlich streng - lieber ein Konflikt zu viel als eine verlorene Änderung.
fn is_same_change(g: &Group, ours: &[String], theirs: &[String]) -> bool {
    if g.ours.len() != 1 || g.theirs.len() != 1 {
        return false;
    }
    let (ob, ol, os, olen) = g.ours[0];
    let (tb, tl, ts, tlen) = g.theirs[0];
    if (ob, ol) != (tb, tl) {
        return false;
    }
    if os + olen > ours.len() || ts + tlen > theirs.len() {
        return false;
    }
    ours[os..os + olen] == theirs[ts..ts + tlen]
}

/// Gehört eine Änderung an Basis[bs..bs+bl) zur selben Konfliktgruppe wie `g`?
/// Jede Änderung belegt das *abgeschlossene* Intervall der berührten Zeilen -
/// angrenzende Änderungen kollidieren also (wie bei git).
fn interferes(g: &Group, bs: usize, bl: usize) -> bool {
    bs <= g.base_end && bs + bl >= g.base_start
}

pub fn merge_regions(base: &[String], ours: &[String], theirs: &[String]) -> Vec<Region> {
    let bo = diff_blocks(base, ours);
    let bt = diff_blocks(base, theirs);
    merge_regions_with(base, ours, theirs, &bo, &bt)
}

/// Wie `merge_regions`, aber mit vorgegebenen Änderungsblöcken (z. B. gits
/// eigenen Hunks).
pub fn merge_regions_with(
    base: &[String],
    ours: &[String],
    theirs: &[String],
    bo: &[Block],
    bt: &[Block],
) -> Vec<Region> {
    let mut items: Vec<(usize, usize, bool, usize, usize)> = Vec::new();
    for b in bo {
        items.push((b.a_start, b.a_len, false, b.b_start, b.b_len));
    }
    for b in bt {
        items.push((b.a_start, b.a_len, true, b.b_start, b.b_len));
    }
    items.sort_by_key(|i| (i.0, i.1));

    let mut groups: Vec<Group> = Vec::new();
    for &(bs, bl, is_theirs, ss, sl) in &items {
        let attach = groups
            .last()
            .map(|g| interferes(g, bs, bl))
            .unwrap_or(false);
        if attach {
            let g = groups.last_mut().unwrap();
            g.base_start = g.base_start.min(bs);
            g.base_end = g.base_end.max(bs + bl);
            if is_theirs {
                g.theirs.push((bs, bl, ss, sl));
            } else {
                g.ours.push((bs, bl, ss, sl));
            }
        } else {
            let mut g = Group {
                base_start: bs,
                base_end: bs + bl,
                ..Default::default()
            };
            if is_theirs {
                g.theirs.push((bs, bl, ss, sl));
            } else {
                g.ours.push((bs, bl, ss, sl));
            }
            groups.push(g);
        }
    }

    let mut regions: Vec<Region> = Vec::new();
    let mut pos = 0usize;
    let mut ours_pos = 0usize;
    let mut theirs_pos = 0usize;
    for g in &groups {
        if g.base_start > pos {
            let len = g.base_start - pos;
            regions.push(Region {
                kind: Kind::Unchanged,
                base: (pos, len),
                ours: (ours_pos, len),
                theirs: (theirs_pos, len),
            });
            ours_pos += len;
            theirs_pos += len;
        }
        let len = g.base_end - g.base_start;
        // Every side spans the entire shared base interval, including unchanged
        // edges. Sequential cursors also avoid assigning boundary insertions twice.
        let ol = len - g.ours.iter().map(|b| b.1).sum::<usize>()
            + g.ours.iter().map(|b| b.3).sum::<usize>();
        let tl = len - g.theirs.iter().map(|b| b.1).sum::<usize>()
            + g.theirs.iter().map(|b| b.3).sum::<usize>();
        let kind = match (g.ours.is_empty(), g.theirs.is_empty()) {
            (false, true) => Kind::OursOnly,
            (true, false) => Kind::TheirsOnly,
            (false, false) => {
                if is_same_change(g, ours, theirs) {
                    Kind::BothSame
                } else {
                    Kind::Conflict
                }
            }
            (true, true) => Kind::Unchanged,
        };
        regions.push(Region {
            kind,
            base: (g.base_start, len),
            ours: (ours_pos, ol),
            theirs: (theirs_pos, tl),
        });
        pos = g.base_end;
        ours_pos += ol;
        theirs_pos += tl;
    }
    if pos < base.len() {
        let len = base.len() - pos;
        regions.push(Region {
            kind: Kind::Unchanged,
            base: (pos, len),
            ours: (ours_pos, len),
            theirs: (theirs_pos, len),
        });
    }
    regions
}

// ------------------------------------------------------- Wort-Hervorhebung

/// Ein Textstück einer Zeile; `changed` markiert den geänderten Teil.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSpan {
    pub text: String,
    pub changed: bool,
}

/// Zeichenweise geänderter Anteil einer Zeile (grob, nur zur Bewertung).
fn changed_ratio(a: &str, b: &str) -> f64 {
    let max = a.chars().count().max(b.chars().count()).max(1);
    let common_prefix = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    let common_suffix = a
        .chars()
        .rev()
        .zip(b.chars().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let same = (common_prefix + common_suffix).min(max);
    (max - same) as f64 / max as f64
}

/// Zerlegt eine Zeile in kleine Token (Bezeichner, Leerraum, einzelne
/// Satzzeichen). Die Worttrennung von `similar` fasst Code wie
/// `map.insert("a",` als ein Token zusammen - für die Hervorhebung im
/// Quelltext ist eine feinere Zerlegung nötig.
fn tokenize(line: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut class: Option<bool> = None; // true = Wortzeichen, false = Leerraum
    for ch in line.chars() {
        let wordish = ch.is_alphanumeric() || ch == '_';
        let spaceish = ch.is_whitespace();
        let kind = if wordish {
            Some(true)
        } else if spaceish {
            Some(false)
        } else {
            None
        };
        match kind {
            None => {
                if !buf.is_empty() {
                    out.push(std::mem::take(&mut buf));
                }
                out.push(ch.to_string());
                class = None;
            }
            Some(k) => {
                if class == Some(k) {
                    buf.push(ch);
                } else {
                    if !buf.is_empty() {
                        out.push(std::mem::take(&mut buf));
                    }
                    buf.push(ch);
                    class = Some(k);
                }
            }
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// Fügt benachbarte Stücke mit gleicher Markierung zusammen (kleineres DOM).
fn coalesce(spans: Vec<WordSpan>) -> Vec<WordSpan> {
    let mut out: Vec<WordSpan> = Vec::new();
    for span in spans {
        if let Some(last) = out.last_mut() {
            if last.changed == span.changed {
                last.text.push_str(&span.text);
                continue;
            }
        }
        out.push(span);
    }
    out
}

/// Wortweise Gegenüberstellung zweier Zeilen (Hervorhebung innerhalb der Zeile
/// wie im WebStorm-Diff). Bei zu großer Abweichung wird nichts hervorgehoben.
fn word_spans(a: &str, b: &str) -> Option<(Vec<WordSpan>, Vec<WordSpan>)> {
    if a == b {
        return None;
    }
    if changed_ratio(a, b) > 0.75 {
        return None;
    }
    let ta = tokenize(a);
    let tb = tokenize(b);
    let ta_ref: Vec<&str> = ta.iter().map(|s| s.as_str()).collect();
    let tb_ref: Vec<&str> = tb.iter().map(|s| s.as_str()).collect();
    let diff = TextDiff::from_slices(&ta_ref, &tb_ref);
    let mut sa: Vec<WordSpan> = Vec::new();
    let mut sb: Vec<WordSpan> = Vec::new();
    for op in diff.ops() {
        for change in diff.iter_changes(op) {
            let text = change.value().to_string();
            match change.tag() {
                ChangeTag::Equal => {
                    sa.push(WordSpan {
                        text: text.clone(),
                        changed: false,
                    });
                    sb.push(WordSpan {
                        text,
                        changed: false,
                    });
                }
                ChangeTag::Delete => sa.push(WordSpan {
                    text,
                    changed: true,
                }),
                ChangeTag::Insert => sb.push(WordSpan {
                    text,
                    changed: true,
                }),
            }
        }
    }
    let (sa, sb) = (coalesce(sa), coalesce(sb));
    if !sa.iter().any(|s| s.changed) && !sb.iter().any(|s| s.changed) {
        return None;
    }
    Some((sa, sb))
}

/// Paart Zeilen zweier gleich langer Abschnitte und liefert je Seite die
/// hervorgehobenen Zeilen (Schlüssel = Zeilenindex).
pub fn pair_highlights(
    a_lines: &[String],
    b_lines: &[String],
    a_start: usize,
    b_start: usize,
) -> (
    BTreeMap<usize, Vec<WordSpan>>,
    BTreeMap<usize, Vec<WordSpan>>,
) {
    let mut ha = BTreeMap::new();
    let mut hb = BTreeMap::new();
    if a_lines.len() != b_lines.len() {
        return (ha, hb);
    }
    for (i, (a, b)) in a_lines.iter().zip(b_lines.iter()).enumerate() {
        if let Some((sa, sb)) = word_spans(a, b) {
            ha.insert(a_start + i, sa);
            hb.insert(b_start + i, sb);
        }
    }
    (ha, hb)
}

// ------------------------------------------------------------- Auflösung

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Unresolved,
    Ours,
    Theirs,
    Both,
    Base,
    Custom(Vec<String>),
}

pub fn slice(lines: &[String], r: (usize, usize)) -> Vec<String> {
    let (s, l) = r;
    if l == 0 || s >= lines.len() {
        return Vec::new();
    }
    lines[s..(s + l).min(lines.len())].to_vec()
}

/// Erzeugt den Dateiinhalt. Unaufgelöste Konflikte werden als
/// git-Konfliktmarker geschrieben, damit nichts verloren gehen kann.
#[allow(clippy::too_many_arguments)]
pub fn render(
    regions: &[Region],
    base: &[String],
    ours: &[String],
    theirs: &[String],
    choices: &HashMap<usize, Choice>,
    ours_label: &str,
    theirs_label: &str,
    trailing_newline: bool,
) -> String {
    let mut out: Vec<String> = Vec::new();
    for (idx, r) in regions.iter().enumerate() {
        let auto = match r.kind {
            Kind::Unchanged => Choice::Base,
            Kind::OursOnly | Kind::BothSame => Choice::Ours,
            Kind::TheirsOnly => Choice::Theirs,
            Kind::Conflict => Choice::Unresolved,
        };
        let choice = choices.get(&idx).unwrap_or(&auto);
        let choice = if matches!(choice, Choice::Unresolved) && r.kind != Kind::Conflict {
            &auto
        } else {
            choice
        };
        match choice {
            Choice::Unresolved => {
                if r.kind == Kind::Conflict {
                    out.push(format!("<<<<<<< {ours_label}"));
                    out.extend(slice(ours, r.ours));
                    out.push("=======".to_string());
                    out.extend(slice(theirs, r.theirs));
                    out.push(format!(">>>>>>> {theirs_label}"));
                } else {
                    out.extend(resolve_with(&auto, r, base, ours, theirs));
                }
            }
            other => out.extend(resolve_with(other, r, base, ours, theirs)),
        }
    }
    let mut text = out.join("\n");
    if trailing_newline && !text.is_empty() {
        text.push('\n');
    }
    text
}

fn resolve_with(
    c: &Choice,
    r: &Region,
    base: &[String],
    ours: &[String],
    theirs: &[String],
) -> Vec<String> {
    match c {
        Choice::Ours => slice(ours, r.ours),
        Choice::Theirs => slice(theirs, r.theirs),
        Choice::Base => slice(base, r.base),
        Choice::Both => {
            let mut v = slice(ours, r.ours);
            v.extend(slice(theirs, r.theirs));
            v
        }
        Choice::Custom(t) => t.clone(),
        Choice::Unresolved => Vec::new(),
    }
}

/// Anzahl der Konflikte ohne Entscheidung.
pub fn open_conflicts(regions: &[Region], choices: &HashMap<usize, Choice>) -> usize {
    regions
        .iter()
        .enumerate()
        .filter(|(i, r)| {
            r.kind == Kind::Conflict && matches!(choices.get(i), None | Some(Choice::Unresolved))
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        split_lines(s)
    }

    fn kinds(base: &str, ours: &str, theirs: &str) -> Vec<Kind> {
        merge_regions(&v(base), &v(ours), &v(theirs))
            .iter()
            .map(|r| r.kind)
            .collect()
    }

    #[test]
    fn split_lines_handles_trailing_newline() {
        assert_eq!(split_lines("a\nb\n"), vec!["a", "b"]);
        assert_eq!(split_lines("a\nb"), vec!["a", "b"]);
        assert_eq!(split_lines("a\n\n"), vec!["a", ""]);
        assert_eq!(split_lines(""), Vec::<String>::new());
    }

    #[test]
    fn identical_files_have_one_unchanged_region() {
        let r = merge_regions(&v("a\nb\nc"), &v("a\nb\nc"), &v("a\nb\nc"));
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].kind, Kind::Unchanged);
        assert_eq!(r[0].base, (0, 3));
    }

    #[test]
    fn ours_only_and_theirs_only() {
        assert_eq!(
            kinds("a\nb\nc", "a\nB\nc", "a\nb\nc"),
            vec![Kind::Unchanged, Kind::OursOnly, Kind::Unchanged]
        );
        assert_eq!(
            kinds("a\nb\nc", "a\nb\nc", "a\nb\nC"),
            vec![Kind::Unchanged, Kind::TheirsOnly]
        );
    }

    #[test]
    fn same_change_on_both_sides_is_not_a_conflict() {
        assert_eq!(
            kinds("a\nb\nc", "a\nX\nc", "a\nX\nc"),
            vec![Kind::Unchanged, Kind::BothSame, Kind::Unchanged]
        );
    }

    #[test]
    fn different_change_same_line_conflicts() {
        assert_eq!(
            kinds("a\nb\nc", "a\nX\nc", "a\nY\nc"),
            vec![Kind::Unchanged, Kind::Conflict, Kind::Unchanged]
        );
    }

    #[test]
    fn changes_on_different_lines_do_not_conflict() {
        assert_eq!(
            kinds("a\nb\nc\nd", "a\nB\nc\nd", "a\nb\nc\nD"),
            vec![
                Kind::Unchanged,
                Kind::OursOnly,
                Kind::Unchanged,
                Kind::TheirsOnly
            ]
        );
    }

    #[test]
    fn adjacent_changes_conflict_like_git() {
        assert_eq!(
            kinds("a\nb\nc\nd", "a\nc\nd", "a\nb\nX\nd"),
            vec![Kind::Unchanged, Kind::Conflict, Kind::Unchanged]
        );
        assert_eq!(
            kinds("a\nb\nc", "a\nX\nb\nc", "a\nB\nc"),
            vec![Kind::Unchanged, Kind::Conflict, Kind::Unchanged]
        );
    }

    #[test]
    fn overlapping_changes_with_different_extent_conflict() {
        // lokal löscht l2+l3, eingehend nur l2 -> überlappende, unterschiedlich
        // große Bereiche: git meldet Konflikt, die Engine ebenfalls
        assert_eq!(
            kinds(
                "l0\nl1\nl2\nl3\nl4\nl5\nl6",
                "l0\nl1\nl4\nnew1\nl6",
                "l0\nl1\nl3\nl4\nl5\nl6"
            ),
            vec![
                Kind::Unchanged,
                Kind::Conflict,
                Kind::Unchanged,
                Kind::OursOnly,
                Kind::Unchanged
            ]
        );
    }

    #[test]
    fn render_resolves_and_marks() {
        let base = v("1\n2\n3\n4\n5\n6\n7");
        let ours = v("1\nO\n3\n4\n5\n6\n7");
        let theirs = v("1\nT\n3\n4\n5\n6\n7");
        let regions = merge_regions(&base, &ours, &theirs);
        let idx = regions
            .iter()
            .position(|r| r.kind == Kind::Conflict)
            .unwrap();
        let mut choices = HashMap::new();
        choices.insert(idx, Choice::Theirs);
        assert_eq!(
            render(&regions, &base, &ours, &theirs, &choices, "HEAD", "feat", true),
            "1\nT\n3\n4\n5\n6\n7\n"
        );
        let text = render(
            &regions,
            &base,
            &ours,
            &theirs,
            &HashMap::new(),
            "HEAD",
            "feat",
            true,
        );
        assert!(text.contains("<<<<<<< HEAD"));
        assert!(text.contains(">>>>>>> feat"));
        assert_eq!(open_conflicts(&regions, &HashMap::new()), 1);
    }

    #[test]
    fn clean_merge_has_no_conflicts() {
        let base = v("a\nb\nc\nd\ne");
        let ours = v("a\nB\nc\nd\ne");
        let theirs = v("a\nb\nc\nD\ne");
        let regions = merge_regions(&base, &ours, &theirs);
        assert_eq!(open_conflicts(&regions, &HashMap::new()), 0);
        assert_eq!(
            render(
                &regions,
                &base,
                &ours,
                &theirs,
                &HashMap::new(),
                "HEAD",
                "feat",
                true
            ),
            "a\nB\nc\nD\ne\n"
        );
    }

    #[test]
    fn word_higlight_marks_only_the_change() {
        let a_line = "    map.insert(\"a\", 1);";
        let b_line = "    map.insert(\"b\", 22);";
        let (a, b) = word_spans(a_line, b_line).expect("Hervorhebung erwartet");
        // Die Textstücke müssen die Zeile exakt wieder ergeben
        assert_eq!(a.iter().map(|s| s.text.clone()).collect::<String>(), a_line);
        assert_eq!(b.iter().map(|s| s.text.clone()).collect::<String>(), b_line);
        // der unveränderte Teil darf nicht markiert sein
        assert!(
            !a.iter()
                .filter(|s| s.changed)
                .any(|s| s.text.contains("map.insert")),
            "unveränderter Teil markiert: {:?}",
            a
        );
        assert!(
            !b.iter()
                .filter(|s| s.changed)
                .any(|s| s.text.contains("map.insert")),
            "unveränderter Teil markiert"
        );
        // und es gibt überhaupt Markierungen
        assert!(a.iter().any(|s| s.changed));
        assert!(b.iter().any(|s| s.changed));
    }

    #[test]
    fn word_higlight_skips_unrelated_lines() {
        assert!(word_spans("fn main() {", "let x = 42;").is_none());
        assert!(word_spans("gleich", "gleich").is_none());
    }
}
