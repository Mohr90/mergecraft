// Typisierte Brücke zum Rust-Backend. Im Browser (Designarbeit mit
// `npm run dev:web`) übernimmt mock.ts.

import { mockInvoke } from "./mock";

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as any);

type InvokeFn = (cmd: string, args?: any) => Promise<any>;

let invokeLoader: Promise<InvokeFn> | null = null;

function loader(): Promise<InvokeFn> {
  if (!invokeLoader) {
    invokeLoader = inTauri
      ? import("@tauri-apps/api/core").then((m) => m.invoke as InvokeFn)
      : Promise.resolve(((cmd: string, args?: any) => mockInvoke(cmd, args)) as InvokeFn);
  }
  return invokeLoader;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await loader();
  return invoke(cmd, args) as Promise<T>;
}

// ------------------------------------------------------------------ Typen

export interface RepoSnapshot {
  root: string;
  name: string;
  head: string;
  head_branch: string | null;
  merging: boolean;
  rebasing: boolean;
  cherry_picking: boolean;
  merge_head: string | null;
  remote_url: string | null;
  remote_name: string | null;
}

export interface BranchInfo {
  name: string;
  full_name: string;
  is_remote: boolean;
  is_current: boolean;
  upstream: string | null;
  short_hash: string;
  timestamp: number;
  subject: string;
  ahead: number;
  behind: number;
  checkout_name: string;
}

export type FileState =
  | "conflicted"
  | "staged"
  | "modified"
  | "untracked"
  | "renamed"
  | "deleted";

export interface StatusEntry {
  path: string;
  orig_path: string | null;
  index: string;
  worktree: string;
  state: FileState;
  conflict_code: string | null;
  ext: string;
}

export interface RepoStatus {
  conflicts: StatusEntry[];
  staged: StatusEntry[];
  changed: StatusEntry[];
  untracked: StatusEntry[];
  all: StatusEntry[];
  merging: boolean;
  head_subject: string;
  head_author: string;
  head_timestamp: number;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  timestamp: number;
  parents: string[];
  refs: string[];
  subject: string;
}

export interface FileChange {
  status: string;
  path: string;
}

export interface ConflictFile {
  path: string;
  code: string;
  has_base: boolean;
}

export interface WordSpan {
  text: string;
  changed: boolean;
}

export type RegionKind =
  | "unchanged"
  | "ours_only"
  | "theirs_only"
  | "both_same"
  | "conflict";

export interface Region {
  kind: RegionKind;
  base: [number, number];
  ours: [number, number];
  theirs: [number, number];
}

export interface SideText {
  label: string;
  text: string;
  exists: boolean;
  lines: number;
  binary: boolean;
}

export type Highlights = Record<string, WordSpan[]>;

export interface ConflictData {
  path: string;
  root: string;
  base: SideText;
  ours: SideText;
  theirs: SideText;
  merged: SideText;
  regions: Region[];
  trailing_newline: boolean;
  ours_label: string;
  theirs_label: string;
  result_text: string;
  guarded: boolean;
  highlight_ours: Highlights;
  highlight_theirs: Highlights;
}

export interface DiffBlock {
  a_start: number;
  a_len: number;
  b_start: number;
  b_len: number;
}

export interface FileDiff {
  path: string;
  a_label: string;
  b_label: string;
  a_text: string;
  b_text: string;
  blocks: DiffBlock[];
  binary: boolean;
  a_missing: boolean;
  b_missing: boolean;
  highlight_a: Highlights;
  highlight_b: Highlights;
}

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface MergeOutcome {
  ok: boolean;
  conflicts: string[];
  stdout: string;
  stderr: string;
  completed: boolean;
}

// --------------------------------------------------------------- Befehle

export const api = {
  inTauri,
  openRepo: (path: string) => call<RepoSnapshot>("open_repo", { path }),
  recentRepos: () => call<string[]>("recent_repos"),
  snapshot: () => call<RepoSnapshot>("snapshot"),
  initRepo: (path: string) => call<RepoSnapshot>("init_repo", { path }),

  branches: () => call<BranchInfo[]>("branches"),
  status: () => call<RepoStatus>("status"),
  history: (limit = 300, all = false, path?: string) =>
    call<CommitInfo[]>("history", { limit, all, path: path ?? null }),
  commitFiles: (hash: string) => call<FileChange[]>("commit_files", { hash }),
  conflicts: () => call<ConflictFile[]>("conflicts"),

  fileDiff: (revA: string, revB: string, path: string, labelA?: string, labelB?: string) =>
    call<FileDiff>("file_diff", {
      rev_a: revA,
      rev_b: revB,
      path,
      label_a: labelA ?? null,
      label_b: labelB ?? null,
    }),
  versionsDiff: (
    revA: string,
    revB: string,
    path: string,
    labelA: string,
    labelB: string,
  ) =>
    call<FileDiff>("versions_diff", {
      rev_a: revA,
      rev_b: revB,
      path,
      label_a: labelA,
      label_b: labelB,
    }),
  commitFileDiff: (hash: string, path: string) =>
    call<FileDiff>("commit_file_diff", { hash, path }),
  compareDiff: (revA: string, revB: string, path: string) =>
    call<FileDiff>("compare_diff", { rev_a: revA, rev_b: revB, path }),

  conflictData: (path: string) => call<ConflictData>("conflict_data", { path }),
  saveConflict: (path: string, text: string, markResolved: boolean) =>
    call<CommandResult>("save_conflict", { path, text, mark_resolved: markResolved }),
  resolveWithSide: (path: string, side: "ours" | "theirs") =>
    call<CommandResult>("resolve_with_side", { path, side }),
  standaloneData: () => call<ConflictData | null>("standalone_data"),
  standaloneSave: (text: string) => call<CommandResult>("standalone_save", { text }),

  checkout: (name: string, opts?: { localName?: string; force?: boolean; track?: boolean }) =>
    call<CommandResult>("checkout_branch", {
      name,
      local_name: opts?.localName ?? null,
      force: opts?.force ?? false,
      track: opts?.track ?? false,
    }),
  createBranch: (name: string, start: string | null, checkout = true) =>
    call<CommandResult>("create_branch", { name, start, checkout }),
  deleteBranch: (name: string, force = false, remote = false) =>
    call<CommandResult>("delete_branch", { name, force, remote }),
  renameBranch: (name: string, newName: string) =>
    call<CommandResult>("rename_branch", { name, new_name: newName }),
  mergeBranch: (name: string, noFf = true, squash = false, message: string | null = null) =>
    call<MergeOutcome>("merge_branch", { name, no_ff: noFf, squash, message }),
  mergeAbort: () => call<CommandResult>("merge_abort", {}),
  mergeContinue: (message: string | null = null) =>
    call<CommandResult>("merge_continue", { message }),

  fetchRemote: (remote: string | null = null) =>
    call<CommandResult>("fetch_remote", { remote }),
  pull: () => call<CommandResult>("pull", {}),
  push: (setUpstream = false) => call<CommandResult>("push", { set_upstream: setUpstream }),

  stage: (paths: string[]) => call<CommandResult>("stage", { paths }),
  unstage: (paths: string[]) => call<CommandResult>("unstage", { paths }),
  discard: (paths: string[]) => call<CommandResult>("discard", { paths }),
  commit: (message: string, amend = false, sign = false, all = false) =>
    call<CommandResult>("commit", { message, amend, sign, all }),

  gitRaw: (args: string[]) => call<CommandResult>("git_raw", { args }),
  pickFolder: (title?: string) => call<string | null>("pick_folder", { title: title ?? null }),
  openPath: (path: string) => call<void>("open_path", { path }),
};
