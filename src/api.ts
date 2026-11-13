// Typisierte Brücke zum Rust-Backend. Im Browser (Designarbeit mit
// `npm run dev:web`) übernimmt mock.ts.

import {localizeText} from "./i18n";
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
  try { return await invoke(cmd, args) as T; }
  catch (error) {
    if(typeof error === 'string') throw localizeText(error);
    if(error instanceof Error) throw new Error(localizeText(error.message));
    throw error;
  }
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
  reverting?: boolean;
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
  tracking_known?: boolean;
  ahead: number;
  behind: number;
  checkout_name: string;
}

export interface StashInfo {
  oid: string;
  selector: string;
  message: string;
  timestamp: number;
}

export interface TagInfo {
  name: string;
  full_name: string;
  commit: string | null;
  short_hash: string;
  is_annotated: boolean;
  timestamp: number;
  subject: string;
  author: string;
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
  working_modified?: boolean;
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

export type ChangeArea = "staged" | "work" | "untracked";

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

export interface PullPlan {branch:string;upstream:string;upstream_oid:string;head:string;ahead:number;behind:number;token:string;}
export interface PullResult extends CommandResult {plan?:PullPlan|null;conflicts?:string[];}

export interface WorktreeBranchDeletion {discardable:boolean;branch:string;path:string;branch_oid:string;caller_head:string;token:string;blocked:string|null;}

export interface MergePreview {
  source: string; target: string; source_oid: string; tree_oid: string; target_oid: string; token: string;
  kind: "up_to_date" | "fast_forward" | "clean" | "conflicts";
  incoming: number; files: FileChange[]; conflicts: string[];
}
export interface HunkSet {token: string; patches: string[]; blocks: FileDiff["blocks"]; reason: string | null;}
export interface RevertPreview {commit: CommitInfo; target: string; token: string; files: FileChange[];}

export const api = {
  inTauri,
  checkForUpdates: () => call<import("./updates").UpdateInfo>("check_for_updates"),
  openProject: () => call<void>("open_project"),
  startSelftest: () => inTauri ? call<void>("start_selftest") : Promise.resolve(),
  openRepo: (path: string) => call<RepoSnapshot>("open_repo", { path }),
  recentRepos: () => call<string[]>("recent_repos"),
  snapshot: () => call<RepoSnapshot>("snapshot"),
  initRepo: (path: string) => call<RepoSnapshot>("init_repo", { path }),

  branches: () => call<BranchInfo[]>("branches"),
  tags: () => call<TagInfo[]>("tags"),
  commitInfo: (revision: string) => call<CommitInfo>("commit_info", { revision }),
  status: () => call<RepoStatus>("status"),
  history: (limit = 300, all = false, path?: string) =>
    call<CommitInfo[]>("history", { limit, all, path: path ?? null }),
  branchLog: (name: string, outgoing: boolean) => call<CommitInfo[]>("branch_log", {name, outgoing}),
  commitFiles: (hash: string) => call<FileChange[]>("commit_files", { hash }),
  conflicts: () => call<ConflictFile[]>("conflicts"),

  workingDiff: (path: string, area: ChangeArea) => call<FileDiff>("working_diff", {path, area}),
  fileHistory: (path: string) => call<CommitInfo[]>("file_history", {path}),
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
  compareFiles: (revA: string, revB: string) =>
    call<FileChange[]>("compare_files", { rev_a: revA, rev_b: revB }),
  compareDiff: (revA: string, revB: string, path: string) =>
    call<FileDiff>("compare_diff", { rev_a: revA, rev_b: revB, path }),

  conflictData: (path: string) => call<ConflictData>("conflict_data", { path }),
  saveConflict: (path: string, text: string, markResolved: boolean, expected?:ConflictData) =>
    call<CommandResult>("save_conflict", { path, text, mark_resolved: markResolved,expected_working:expected?.merged.text,expected_sources:expected ? [expected.base.text,expected.ours.text,expected.theirs.text] : null }),
  resolveWithSide: (path: string, side: "ours" | "theirs") =>
    call<CommandResult>("resolve_with_side", { path, side }),
  standaloneData: () => call<ConflictData | null>("standalone_data"),
  standaloneSide: (side: "ours" | "theirs") => call<CommandResult>("standalone_side", { side }),
  standaloneSave: (text: string) => call<CommandResult>("standalone_save", { text }),

  checkout: (name: string, opts?: { localName?: string; force?: boolean; track?: boolean; updateFromRemote?: boolean; expectedLocal?: string; expectedRemote?: string }) =>
    call<CommandResult>("checkout_branch", {
      name,
      local_name: opts?.localName ?? null,
      force: opts?.force ?? false,
      track: opts?.track ?? false,
      update_from_remote: opts?.updateFromRemote ?? false,
      expected_local: opts?.expectedLocal ?? null,
      expected_remote: opts?.expectedRemote ?? null,
    }),
  createBranch: (name: string, start: string | null, checkout = true) =>
    call<CommandResult>("create_branch", { name, start, checkout }),
  deleteBranch: (name: string, force = false, remote = false, expected?: string, expectedHead?: string) =>
    call<CommandResult>("delete_branch", { name, force, remote, expected, expected_head: expectedHead }),
  worktreeBranchPreview: (name:string)=>call<WorktreeBranchDeletion|null>("worktree_branch_preview",{name}),
  removeWorktreeBranch: (preview:WorktreeBranchDeletion,force:boolean,discard_changes=false)=>call<CommandResult>("remove_worktree_branch",{preview,force,discard_changes}),
  renameBranch: (name: string, newName: string) =>
    call<CommandResult>("rename_branch", { name, new_name: newName }),
  mergeBranch: (name: string, noFf = true, squash = false, message: string | null = null) =>
    call<MergeOutcome>("merge_branch", { name, no_ff: noFf, squash, message }),
  mergePreview: (name: string) => call<MergePreview>("merge_preview", {name}),
  cancelMergePreview: () => call<void>("cancel_merge_preview"),
  mergeChecked: (preview: MergePreview, noFf: boolean) => call<MergeOutcome>("merge_checked", {preview, no_ff:noFf}),
  hunkSet: (path: string, area: ChangeArea) => call<HunkSet>("hunk_set", {path, area}),
  applyHunk: (path: string, area: ChangeArea, index: number, token: string) => call<CommandResult>("apply_hunk", {path, area, index, token}),
  revertPreview: (revision: string) => call<RevertPreview>("revert_preview", {revision}),
  revertChecked: (revision: string, token: string) => call<MergeOutcome>("revert_checked", {revision, token}),
  workflowToken: () => call<string>("workflow_token"),
  revertControl: (abort: boolean, expected: string) => call<CommandResult>("revert_control", {abort, expected}),
  mergeAbort: () => call<CommandResult>("merge_abort", {}),
  mergeContinue: (message: string | null = null) =>
    call<CommandResult>("merge_continue", { message }),

  fetchRemote: (remote: string | null = null) =>
    call<CommandResult>("fetch_remote", { remote }),
  pull: (expectedBranch: string, trackSameName = false, confirmed:PullPlan|null=null) => call<PullResult>("pull", { expected_branch: expectedBranch, track_same_name: trackSameName, confirmed }),
  push: (setUpstream = false) => call<CommandResult>("push", { set_upstream: setUpstream }),

  stashes: () => call<StashInfo[]>("stashes"),
  rollback: (paths: string[], expectedHead: string) => call<CommandResult>("rollback", {paths, expected_head: expectedHead}),
  saveStash: (message: string) => call<CommandResult>("save_stash", {message}),
  applyStash: (oid: string) => call<MergeOutcome>("apply_stash", {oid}),
  stage: (paths: string[]) => call<CommandResult>("stage", { paths }),
  unstage: (paths: string[]) => call<CommandResult>("unstage", { paths }),
  discard: (paths: string[]) => call<CommandResult>("discard", { paths }),
  commit: (message: string, amend = false, sign = false, all = false) =>
    call<CommandResult>("commit", { message, amend, sign, all }),

  gitRaw: (args: string[]) => call<CommandResult>("git_raw", { args }),
  setTitle: (title: string) =>
    inTauri ? call<void>("set_title", { title }) : Promise.resolve(),
  pickFolder: (title?: string) => call<string | null>("pick_folder", { title: title ?? null }),
  openPath: (path: string) => call<void>("open_path", { path }),
};
