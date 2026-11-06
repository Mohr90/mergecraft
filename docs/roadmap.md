# Mergecraft roadmap

Mergecraft stays a focused Git client: branches, tags, history, diffs and conflict resolution. These milestones describe scope, not promised release dates. Issue acceptance criteria and CI determine when work is ready.

## v0.5.0 — read changes and switch repositories faster

[Milestone](https://github.com/Mohr90/mergecraft/milestone/1)

- [#11 Syntax colors in diffs and the three-way merge workspace](https://github.com/Mohr90/mergecraft/issues/11): a compact, local language bundle; source text and Git word highlights stay intact. No language server or code completion.
- [#12 Pinned/recent repositories beside Open](https://github.com/Mohr90/mergecraft/issues/12): durable local shortcuts, paths to distinguish matching names, keyboard access and restoration of workspace/filter/commit drafts during the app session. The existing unsaved merge confirmation protects editor work.

## v1.0.0 — local branch cleanup and checkout

[Milestone](https://github.com/Mohr90/mergecraft/milestone/3) · [Feature request #15](https://github.com/Mohr90/mergecraft/issues/15)

- Delete local branches directly from the branch overview. Confirm branches with commits absent from the current branch, and protect the current branch and linked worktrees.
- Before switching with local changes, choose to carry them or preview selected files to roll back to HEAD. Git protects untracked files that would be overwritten.
- Keep remote tracking and fast-forward updates explicit. A checkout failure shows the Git error and leaves the resulting workspace visible.

## v1.5.0 — planned follow-up

[Milestone](https://github.com/Mohr90/mergecraft/milestone/2)

- [#7 Branch and tag discovery](https://github.com/Mohr90/mergecraft/issues/7): consistent search/filter behavior, clear tracking status and useful tag details.
- [#8 Pre-merge comparison](https://github.com/Mohr90/mergecraft/issues/8): confirm direction, incoming commits and changed files before starting a merge.
- [#9 Reviewable conflict decisions](https://github.com/Mohr90/mergecraft/issues/9): show each resolution's origin and navigate proposals still needing review.
- [#10 Contextual file history](https://github.com/Mohr90/mergecraft/issues/10): enter the existing file history from diffs/conflicts and return without losing editor context.

These four follow-ups are planned after v1.0.0. Conflict review already gained source-side actions, ancestor inspection and selective Auto Resolve in PR #14; #9 tracks the remaining improvements. Debuggers, completion engines, IDE project trees and hosting-provider dashboards are outside this roadmap.
