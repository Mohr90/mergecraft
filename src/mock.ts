// Demo-Backend für den Browser (Designarbeit ohne Tauri).
// Die Region-Daten unten sind mit den drei Fassungen konsistent und geben
// genau das wieder, was die Rust-Engine für diese Datei berechnet:
// 1 Konflikt, 2 automatisch auflösbare Bereiche, 1 identische Änderung.

import type {
  BranchInfo,
  CommitInfo,
  ConflictData,
  FileDiff,
  Highlights,
  Region,
  RepoSnapshot,
  RepoStatus,
} from "./api";

const B = [
  "use std::collections::HashMap;",
  "",
  "fn main() {",
  "    let mut map = HashMap::new();",
  '    map.insert("a", 1);',
  '    map.insert("b", 2);',
  '    println!("{:?}", map);',
  "}",
  "",
  "fn helper() -> i32 {",
  "    42",
  "}",
];

const OURS = [
  "use std::collections::HashMap;",
  "use std::fs;",
  "",
  "fn main() {",
  "    let mut map = HashMap::new();",
  '    map.insert("a", 1);',
  '    map.insert("c", 3);',
  '    println!("{:?}", map);',
  "}",
  "fn helper() -> i32 {",
  "    42",
  "}",
];

const THEIRS = [
  "use std::collections::HashMap;",
  "",
  "fn main() {",
  "    let mut map = HashMap::new();",
  '    map.insert("a", 1);',
  '    map.insert("b", 22);',
  '    println!("{:?}", map);',
  "}",
  "fn helper() -> i32 {",
  "    43",
  "}",
  "// end",
];

const REGIONS: Region[] = [
  { kind: "unchanged", base: [0, 1], ours: [0, 1], theirs: [0, 1] },
  { kind: "ours_only", base: [1, 0], ours: [1, 1], theirs: [1, 0] },
  { kind: "unchanged", base: [1, 4], ours: [2, 4], theirs: [1, 4] },
  { kind: "conflict", base: [5, 1], ours: [6, 1], theirs: [5, 1] },
  { kind: "unchanged", base: [6, 2], ours: [7, 2], theirs: [6, 2] },
  { kind: "both_same", base: [8, 1], ours: [9, 0], theirs: [8, 0] },
  { kind: "unchanged", base: [9, 1], ours: [9, 1], theirs: [8, 1] },
  { kind: "theirs_only", base: [10, 1], ours: [10, 1], theirs: [9, 1] },
  { kind: "unchanged", base: [11, 1], ours: [11, 1], theirs: [10, 1] },
  { kind: "theirs_only", base: [12, 0], ours: [12, 0], theirs: [11, 1] },
];

// Wortweise Hervorhebung der Konfliktzeile (lokal "c", 3 | eingehend "b", 22)
const HL_OURS: Highlights = {
  "6": [
    { text: '    map.insert("', changed: false },
    { text: "c", changed: true },
    { text: '", ', changed: false },
    { text: "3", changed: true },
    { text: ");", changed: false },
  ],
};
const HL_THEIRS: Highlights = {
  "5": [
    { text: '    map.insert("', changed: false },
    { text: "b", changed: true },
    { text: '", ', changed: false },
    { text: "22", changed: true },
    { text: ");", changed: false },
  ],
};

const j = (lines: string[]) => lines.join("\n") + "\n";

const snapshot = (): RepoSnapshot => ({
  root: "/home/demo/projects/demo-repo",
  name: "demo-repo",
  head: "9f2c41ab77de00112233445566778899aabbccdd",
  head_branch: "main",
  merging: true,
  rebasing: false,
  cherry_picking: false,
  merge_head: "d41d8cd98f00b204e9800998ecf8427e",
  remote_url: "git@example.com:team/demo-repo.git",
  remote_name: "origin",
});

function branches(): BranchInfo[] {
  const mk = (name: string, o: Partial<BranchInfo> = {}): BranchInfo => ({
    name,
    full_name: `refs/heads/${name}`,
    is_remote: false,
    is_current: false,
    upstream: null,
    short_hash: "9f2c41a",
    timestamp: Date.now() / 1000 - 3600,
    subject: "Zwischenstand",
    tracking_known: true,
    ahead: 0,
    behind: 0,
    checkout_name: name,
    ...o,
  });
  const now = Date.now() / 1000;
  return [
    mk("main", { is_current: true, upstream: "origin/main", ahead: 2, behind: 0, timestamp: now - 600, subject: "main: Konfiguration umgestellt" }),
    mk("feature/refactor", { timestamp: now - 5400, subject: "CI: Pipeline angepasst", short_hash: "d41d8cd" }),
    mk("feature/merge-dialog", { timestamp: now - 9000, subject: "Merge-Dialog überarbeitet", short_hash: "ab12cd3" }),
    mk("feature/ui-redesign", { timestamp: now - 20000, subject: "Sidebar: Suche ergänzt", short_hash: "77ff001" }),
    mk("hotfix/login-timeout", { timestamp: now - 90000, subject: "Login: Timeout erhöht", short_hash: "5c3b9a2" }),
    mk("origin/main", { is_remote: true, full_name: "refs/remotes/origin/main", checkout_name: "main", timestamp: now - 900, ahead: 0, behind: 2, short_hash: "9f2c41a" }),
    mk("origin/feature/refactor", { is_remote: true, full_name: "refs/remotes/origin/feature/refactor", checkout_name: "feature/refactor", short_hash: "d41d8cd", timestamp: now - 5400 }),
    mk("origin/release/2.4", { is_remote: true, full_name: "refs/remotes/origin/release/2.4", checkout_name: "release/2.4", short_hash: "aa77b21", timestamp: now - 400000, subject: "Release 2.4 vorbereitet" }),
  ];
}

const status = (): RepoStatus => {
  const now = Date.now() / 1000;
  const entry = (path: string, o: Partial<RepoStatus["all"][number]> = {}) => ({
    path,
    orig_path: null,
    index: " ",
    worktree: "M",
    state: "modified" as const,
    conflict_code: null,
    ext: path.split(".").pop() ?? "",
    ...o,
  });
  const conflicts = [
    entry("src/main.rs", { index: "U", worktree: "U", state: "conflicted", conflict_code: "UU" }),
    entry("src/config.rs", { index: "A", worktree: "A", state: "conflicted", conflict_code: "AA" }),
    entry("docs/setup.md", { index: "U", worktree: "D", state: "conflicted", conflict_code: "UD" }),
  ];
  const staged = [
    entry("src/lib.rs", { index: "M", worktree: " ", state: "staged" }),
    entry("docs/neu.md", { index: "A", worktree: " ", state: "staged" }),
  ];
  const changed = [
    entry("README.md"),
    entry("Cargo.toml"),
    entry("src/parser/mod.rs"),
  ];
  const untracked = [entry("target/notes.txt", { index: "?", worktree: "?", state: "untracked" })];
  return {
    conflicts,
    staged,
    changed,
    untracked,
    all: [...conflicts, ...staged, ...changed, ...untracked],
    merging: true,
    head_subject: "main: Konfiguration umgestellt",
    head_author: "smohr",
    head_timestamp: now - 600,
  };
};

function history(): CommitInfo[] {
  const now = Date.now() / 1000;
  const mk = (i: number, subject: string, refs: string[], author = "Alex"): CommitInfo => {
    const hex = (0x9f2c41ab + i * 7919).toString(16).padStart(8, "0");
    return {
      hash: (hex + "112233445566778899aabbccdd").slice(0, 40),
      short_hash: hex.slice(0, 7),
      author,
      email: `${author}@example.com`,
      timestamp: now - i * 4200,
      parents: i === 0 ? [] : [(0x9f2c41ab + (i - 1) * 7919).toString(16).padStart(8, "0") + "112233445566778899aabbccdd"],
      refs,
      subject,
    };
  };
  return [
    mk(0, "main: Konfiguration umgestellt", ["HEAD -> main"]),
    mk(1, "Merge branch 'feature/refactor'", ["origin/main"]),
    mk(2, "CI: Pipeline angepasst", ["origin/feature/refactor", "feature/refactor"]),
    mk(3, "Merge-Dialog überarbeitet", ["feature/merge-dialog"]),
    mk(4, "Sidebar: Suche ergänzt", ["feature/ui-redesign"]),
    mk(5, "Login: Timeout erhöht", ["hotfix/login-timeout", "tag: v2.3.1"], "m.mueller"),
    mk(6, "Dependencies aktualisiert", []),
    mk(7, "Erste Fassung der Parser-Anbindung", []),
    mk(8, "Projektgerüst angelegt", ["tag: v2.3.0"]),
  ];
}

const OLD_TEXT = j([
  "fn main() {",
  "    let mut map = HashMap::new();",
  '    map.insert("a", 1);',
  '    map.insert("b", 2);',
  '    println!("{:?}", map);',
  "}",
]);

const NEW_TEXT = j([
  "fn main() {",
  "    let mut map = HashMap::new();",
  '    map.insert("a", 1);',
  '    map.insert("b", 22);',
  '    println!("{:?}", map);',
  "    std::process::exit(0);",
  "}",
]);

function fileDiff(path: string): FileDiff {
  return {
    path,
    a_label: "HEAD",
    b_label: "Arbeitskopie",
    a_text: OLD_TEXT,
    b_text: NEW_TEXT,
    blocks: [
      { a_start: 3, a_len: 1, b_start: 3, b_len: 1 },
      { a_start: 5, a_len: 0, b_start: 5, b_len: 1 },
    ],
    binary: false,
    a_missing: false,
    b_missing: false,
    highlight_a: {
      "3": [
        { text: '    map.insert("', changed: false },
        { text: "b", changed: true },
        { text: '", ', changed: false },
        { text: "2", changed: true },
        { text: ");", changed: false },
      ],
    },
    highlight_b: {
      "3": [
        { text: '    map.insert("', changed: false },
        { text: "b", changed: true },
        { text: '", ', changed: false },
        { text: "22", changed: true },
        { text: ");", changed: false },
      ],
    },
  };
}

export async function mockInvoke(cmd: string, args?: any): Promise<any> {
  await new Promise((r) => setTimeout(r, 4));
  switch (cmd) {
    case "check_for_updates": return {current:"0.3.0",latest:"v0.3.0",available:false,install_kind:"package",can_install:false,can_download:false};
    case "install_update": case "open_releases": case "open_update_download": return null;
    case "open_repo":
    case "init_repo":
    case "snapshot":
      return snapshot();
    case "recent_repos":
      return ["/home/demo/projects/demo-repo", "/home/demo/projects/another-repo"];
    case "branches":
      return branches();
    case "stashes":
      return [];
    case "tags":
      return [
        {name:"v2.4.0",full_name:"refs/tags/v2.4.0",commit:"9f2c41ab77de00112233445566778899aabbccdd",short_hash:"9f2c41a",is_annotated:true,timestamp:Date.now()/1000-86400,subject:"Release 2.4 · Stabilität und Merge-Editor",author:"Release Team"},
        {name:"v2.3.0",full_name:"refs/tags/v2.3.0",commit:"d41d8cd98f00b204e9800998ecf8427e0000000000",short_hash:"d41d8cd",is_annotated:true,timestamp:Date.now()/1000-864000,subject:"Release 2.3",author:"Release Team"},
        {name:"snapshot/ui",full_name:"refs/tags/snapshot/ui",commit:"aa77b21000000000000000000000000000000000",short_hash:"aa77b21",is_annotated:false,timestamp:Date.now()/1000-3600,subject:"Sidebar und Branch-Suche",author:"Test"},
      ];
    case "commit_info":
      return {...history()[0],hash:args.revision,short_hash:args.revision.slice(0,7),refs:["tag: v2.4.0"]};
    case "status":
      return status();
    case "history":
    case "file_history":
      return history();
    case "compare_files":
    case "commit_files":
      return [
        { status: "M", path: "src/main.rs" },
        { status: "M", path: "src/lib.rs" },
        { status: "A", path: "docs/neu.md" },
        { status: "D", path: "src/alt.rs" },
      ];
    case "conflicts":
      return [
        { path: "src/main.rs", code: "UU", has_base: true },
        { path: "src/config.rs", code: "AA", has_base: false },
        { path: "docs/setup.md", code: "UD", has_base: true },
      ];
    case "working_diff": {
      const diff = fileDiff(args.path);
      return {...diff,a_label:args.area === "staged" ? "Letzter Commit" : "Für Commit vorgemerkt",b_label:args.area === "staged" ? "Für Commit vorgemerkt" : "Arbeitskopie"};
    }
    case "file_diff":
    case "versions_diff":
    case "commit_file_diff":
    case "compare_diff":
      return fileDiff(args.path);
    case "conflict_data": {
      const data: ConflictData = {
        path: args.path,
        root: "/home/demo/projects/demo-repo",
        base: { label: "Basis", text: j(B), exists: true, lines: B.length, binary: false },
        ours: { label: "Lokal", text: j(OURS), exists: true, lines: OURS.length, binary: false },
        theirs: { label: "Eingehend", text: j(THEIRS), exists: true, lines: THEIRS.length, binary: false },
        merged: { label: "Arbeitskopie", text: j(OURS), exists: true, lines: OURS.length, binary: false },
        regions: REGIONS,
        trailing_newline: true,
        ours_label: "main",
        theirs_label: "feature/refactor",
        result_text: j(OURS),
        guarded: false,
        highlight_ours: HL_OURS,
        highlight_theirs: HL_THEIRS,
      };
      return data;
    }
    case "save_conflict":
      return { ok: true, code: 0, stdout: `${args.path} gespeichert`, stderr: "" };
    case "resolve_with_side":
      return { ok: true, code: 0, stdout: `${args.path} übernommen`, stderr: "" };
    case "standalone_data":
      return null;
    case "pick_folder":
      return "/home/demo/projects";
    case "merge_branch":
      return {
        ok: false,
        conflicts: ["src/main.rs", "src/config.rs"],
        stdout: "Automatischer Merge von src/main.rs\nKONFLIKT (Inhalt)",
        stderr: "",
        completed: false,
      };
    default:
      return { ok: true, code: 0, stdout: `[Mock] ${cmd}`, stderr: "" };
  }
}
