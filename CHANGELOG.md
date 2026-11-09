# Changelog

## 1.1.0 — 2026-11-09

- Resolve independent edits inside large conflict regions and distinguish pending analysis from manual decisions.
- Preview independent additions to the same named JavaScript or TypeScript import before accepting the result.
- Distinguish checkout, compare and branch creation with dedicated icons.

## 1.0.1 — 2026-11-06

- Clean up selected local branches together, with a select-all preview and explicit confirmation for branches with their own commits.
- Protect the current branch and linked worktrees, validate branch refs before deletion and report partial failures.
- Show checkout, compare, merge, branch creation and deletion directly as consistent icons with localized tooltips and accessible names.


## 1.0.0 — 2026-11-06

- Delete local branches directly from the branch list, with explicit confirmation for commits absent from the current branch.
- Choose whether to keep local changes or preview a rollback before switching branches, including remote checkouts.
- Review selected tracked and staged files before discarding. Untracked files remain protected by Git during checkout.
- Move the remaining discovery, pre-merge comparison, conflict review and contextual history roadmap to v1.5.0.

## 0.5.0 — 2026-11-05

- Read source changes with syntax colors for Java, TypeScript/JavaScript, JSON, Rust, CSS, HTML/XML, Python and shell files in diffs and the merge workspace.
- Keep Git word highlights alongside syntax colors; unknown and large inputs remain plain text.
- Pin repositories beside Open, distinguish projects by path and switch directly from recent projects.
- Return to each repository's workspace, filters and commit draft during the current app session. Existing unsaved-merge confirmation remains in effect.

## 0.4.0 — 2026-11-04

- Merge workspace with file navigation, retained drafts and undo history, adjustable result width and branch direction.
- Explainable automatic proposals distinguish unambiguous text combinations from same-line suggestions requiring review.
- Background analysis for large conflict regions, explicit preview and grouped undo.
- Inline errors and a visible resolve → commit → push workflow.


## 0.3.1 — 2026-11-04

- German/English language controls with flags and native language names beside the appearance switch.
- Local language preference, system-language detection, translated dialogs, accessibility labels, tooltips and locale-aware dates.
- Language switching preserves commit drafts, staging, filters, comparisons and unsaved merge decisions/text/undo history.
- Translation catalog and interpolation checks, plus English/German browser workflows.

- Minimal version information: installed version, newer-version notice and a link to the GitHub project.
- Read-only daily version checks; updates are installed manually.
- Native test startup synchronized with frontend readiness instead of a fixed delay.
- Automatic tag-based release builds with tests, native fixtures, checksums and downloadable installers.

## 0.2.0 — 2026-11-03

First public release of Mergecraft for Linux.

- Light and dark desktop interface with separate Changes, Branches, Tags, History and Console workspaces.
- File staging checkboxes, inline diffs, explicit new/amend commit modes and per-file rollback.
- Searchable favorites, local and remote branches, commit synchronization status, safe remote checkout and missing-upstream guidance.
- Three-way conflict editor with per-region side choices, manual editing, reviewed Auto Resolve proposals, undo/redo, preview reset and running-merge abort.
- Git differential tests, real repository regressions, browser flows and native test fixtures.
- MIT license, installation instructions, user guide and synthetic demo screenshots.
