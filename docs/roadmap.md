# Mergecraft roadmap

## [v1.4.0 · Safer merges and focused commits](https://github.com/Mohr90/mergecraft/milestone/7)

1. [Preview merges with real three-way conflict analysis before starting](https://github.com/Mohr90/mergecraft/issues/26).
2. [Stage and unstage complete text hunks directly from the diff](https://github.com/Mohr90/mergecraft/issues/27).
3. [Revert an ordinary commit with preview, conflict resolution and abort](https://github.com/Mohr90/mergecraft/issues/28).

The scope stays focused on Git: explicit actions, stale-state checks, German/English, keyboard access and real repository regression tests.

## [v1.3.0 · Outgoing commits and branch history](https://github.com/Mohr90/mergecraft/milestone/6)

- [Refresh local status on focus without fetching from the network](https://github.com/Mohr90/mergecraft/issues/24).
- Open outgoing commits from the branch indicator and inspect their files and diffs.
- Browse local and remote branch history without checkout.

## [v1.2.0 · Auto Resolve across files](https://github.com/Mohr90/mergecraft/milestone/5)

- [Partially resolve mixed conflicts](https://github.com/Mohr90/mergecraft/issues/20).
- [Apply and undo proposals across files](https://github.com/Mohr90/mergecraft/issues/21).
- [Inspect branch contributions](https://github.com/Mohr90/mergecraft/issues/22).

## [Completed in v1.1.0 · Conflict resolution and branch actions](https://github.com/Mohr90/mergecraft/milestone/4)

1. Preview independent additions to the same named JavaScript or TypeScript import. Show the exact result before applying it. Divergent modules, removed names and ambiguous bindings require a manual decision.
   For large conflict regions, analyze the changed portion within the existing memory budget. Show pending analysis separately from manual decisions.
2. Make checkout, compare and create-from actions distinguishable at a glance. Keep localized tooltips, accessible names and keyboard operation.
3. Verify the resolver against competing edits and exercise branch and conflict workflows in the browser before release.

Completed releases are recorded in the [changelog](../CHANGELOG.md).
