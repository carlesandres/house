# Plan 007: Compose and migrate the filesystem File Navigator

> **Execution gate:** Execute only after approved Plan 004B and green Plans 005-006. The final PR is one
> atomic green boundary: add the React component first, then switch House and remove old APIs in the
> same migration commit. Never delete the old controller before House changes compile and pass with
> the replacement.

## Metadata

- **Status:** DONE
- **Priority:** P1
- **Effort:** L
- **Risk:** HIGH
- **Category:** feature / migration
- **Depends on:** Plan 004B; Plans 005-006
- **Authority:** `docs/file-navigator-design.md`; `CONTEXT.md`; shipped truth in `DESIGN.md`
- **Planned from:** `e7655ac` on 2026-07-31; executor verifies actual drift and checks

## Outcome

Compose the public React FileNavigator over the Plan 006 core and Plan 005 Sidebar, preserve Plan 003
commit safety, then atomically migrate House from `DiscoverShell`, the old controller/wrapper, and
House ranking. Complete the same PR with reader invalidation, production batching evidence, standalone
and installed mutation smoke, and documentation/changelog updates to shipped state.

The final tree has the design-approved Sidebar and File Navigator subpaths, no package root export, no
old controller/discovery/filter compatibility API, and no deprecated aliases.

## Current-State Evidence

- `packages/ui/src/file-navigator/useFileNavigator.ts:130-259` provides commit-safe caller-fed query
  and selection operations that Plan 003 repaired.
- `packages/ui/src/index.ts:1-14` is the current private root API; Plans 005-006 intentionally retain it.
- `apps/house/src/index.tsx:116-215` owns `DiscoverShell`, scan batching, and show-driven rewinds.
- `apps/house/src/Browser.tsx:153-223` receives files and invokes the old controller;
  lines 355-408 own temporary selection restoration and reader reads.
- `apps/house/src/Sidebar.tsx:24-80` adapts House copy/theme/layout to the old package component.
- `apps/house/src/discovery/filter.ts:84-148` is House-specific ranking. The accepted design explicitly
  changes House to the package fuzzy default (`docs/file-navigator-design.md:318-336`).
- `apps/house/dev/build-standalone.ts:91-101` and `.github/workflows/ci.yml:53-62` currently exercise
  installed artifacts only with `--version`.
- `DESIGN.md:291-319` says the new architecture is future work. It remains shipped truth until this PR
  actually migrates House.

## Scope

- React FileNavigator composition, public handle/snapshot/callback behavior, default rows/empty states,
  and commit-safe controlled query.
- Atomic House policy, Browser, reader, discovery-status, and test migration.
- Production batching measurement and legal package-owned mutation smoke through standalone/npm
  artifacts, including no-Bun runtime `PATH`.
- Final package export cleanup and shipped docs/changelog updates.

Exact public names come from the design and implementation review; do not add convenience aliases or
export scanner/watcher internals. Internal filenames remain implementation choices.

### Non-Goals

- No PTY, new keys, frecency, behavioral persistence, sort/search picker, Windows CI/support claim,
  raw Parcel options, raw Stats, old House ranking compatibility, deprecated aliases, fallback
  backend, `@house/ui` pack/publication, or independent library release.

## React And Product Contracts

### Commit Safety And Cleanup

- Preserve Plan 003's separation between render candidates and committed operational state. Abandoned
  renders cannot publish root, policy, strategies, callbacks, query, selection, or engine state.
- Handle methods are synchronous where designed, observe prior actions in the same input batch, and
  return committed post-action snapshots. Fresh callback identities publish only at commit and do not
  restart timers or filesystem generations.
- Root/recursion/policy changes synchronously invalidate the prior generation at commit. React cleanup
  also invalidates synchronously and starts async `close()`, but cannot and must not pretend to await
  it. Tests separately retain an engine/test handle and explicitly await shutdown before asserting no
  handles, callbacks, or late work.

### Query, Selection, And Defaults

- Query is caller-controlled and immediate; `appliedQuery` is projected state. Initial and empty query
  apply synchronously; other changes use the design's 50 ms default, with zero disabling debounce.
- `flushQuery(explicitQuery)` cancels pending work and returns the synchronous post-flush snapshot.
  A new discovery generation applies the latest controlled query, not a stale applied value.
- Initial discovery and each new nonempty applied query select the first result once, then retain File
  Identity across later batches/reordering. Clearing retains identity; removal selects nearest prior
  index; no results select null; a later first result for the same query selects once.
- Root changes start fresh. Same-root recursion/policy revision changes remember the prior identity,
  show no temporary fallback, restore it if eligible, and choose first only when completion proves it
  absent. Watch toggles retain the current valid selection through Plan 006's refresh handoff.
- Defaults remain design-owned: recursive/watch on, tree Browse Order, fuzzy Search, no followed nested
  symlinks, neutral all-file policy, basename-first row with parent context, and the four specified File
  Navigator empty reasons. Linux defaults to 60-second consistency reconciliation; macOS defaults to
  disabled. House overrides policy/copy/appearance, not ranking.

### Reader Invalidation Epochs

Use monotonically increasing reader epochs independent of React render order. Selection/render-target
change, selected-file invalidation, explicit editor refresh, and teardown synchronously advance the
epoch before starting or cancelling a read. A completion may commit only when its epoch and path still
match the active rendered target.

If invalidation arrives while selection is ahead of the reader debounce, record it for that identity;
the eventual target read consumes the newest epoch. If it targets the currently rendered identity,
start one fresh read immediately. Coalesced engine updates produce one read; stale selection or older
read completion cannot overwrite newer content/error. Invalidation is not a selection callback.

## STOP Conditions

Stop if the approved core/API has drifted, commit safety requires render-time mutation or `flushSync`,
React cleanup is treated as awaitable, reader epochs permit stale overwrite, or House needs two active
discovery populations. Also stop if migration requires old ranking compatibility, an imperative
Sidebar insertion, illegal House imports of package internals, a private package pack gate, Bun on the
installed runtime `PATH`, or unapproved backend/product changes.

## Test-First Stages

### 1. Verify Governance And Green Inputs

```bash
git status --short --branch
git log --oneline -10
bun run --cwd packages/ui test
bun run test
```

Confirm Plans 004-006 results and exact adopted versions. Read current Browser/discovery/distribution
tests and reconcile any source drift. Verify actual PR/CI state at execution.

### 2. Compose FileNavigator Test-First

Before changing House, add failing package tests for scanner-to-Sidebar composition, defaults/custom
row, basename truncation priority, appearance/header/empty reasons, static/live modes, status and
diagnostics, imperative handle, query timing/flush, selection rules/restoration, invalidation, and
hidden/reveal window behavior.

Port Plan 003 regressions for abandoned render isolation, first committed frame, stale candidate vs
synchronous action, callback churn, timer deadline using latest committed inputs, and synchronous
multi-action sequences. Add unmount coverage that first proves synchronous generation invalidation,
then explicitly awaits engine shutdown outside React cleanup.

Add the File Navigator subpath while retaining the old root exports so this commit is independently
green and House still builds unchanged.

### 3. Prepare House Policy And Integration Regressions

Write failing House-focused tests using real temporary directories and the existing headless harness:

- Markdown/configured extensions, hidden/gitignored show policy, permanent hard skips, nested ignore
  negation, and no nested symlink following;
- CLI initial query and exact modal flush semantics for Escape, Return, and `ctrl+\`;
- fuzzy default ranking without old filename/depth assertions;
- add/remove/rename-as-remove-plus-add, atomic save, immediate child in a new directory, ignore change,
  and show-policy generation replacement;
- same-root restoration, absent-at-completion fallback, root-change fresh selection, and watch toggle
  retention;
- selected rewrite reload, equal-public-metadata reload, unselected rewrite no reload, editor refresh,
  epoch ordering, stale read rejection, and one read per coalesced invalidation;
- existing focus, keymap, empty copy, status/warnings, wide/narrow layout, and reader behavior.

Use an injected metadata/read boundary for deterministic equal-metadata and epoch order. Do not rely on
mtime granularity or sleeps.

### 4. Record The Old Production Baseline

Before deleting the old path, record its 64-entry/60 ms behavior on a seeded representative tree.
Measure time to first visible batch/completion, transaction and React commit counts, reader reads,
CPU/RSS, and mixed-burst latency on the 1k, 5k, and 10k fixtures from Plan 004. Preserve fixture seeds,
commands, and raw results so the same inputs can be run after migration.

### 5. Atomic House Migration

In one commit, switch House to `@house/ui/file-navigator`, map current House discovery policy with an
explicit revision, route Browser actions through the new handle, and adopt fuzzy default Search.
Keep filter input/modal, layout, key routing, product copy/theme, reader, and file actions in House.

Only after the new path compiles in that same commit, delete `DiscoverShell`, the old House walker and
ranking path where no consumer remains, the local Sidebar adapter if absorbed, temporary selection
restore logic, old package controller/wrapper/types, and the package root export. Update tests in the
same commit. The commit must not contain a point where House imports a deleted API.

Do not retain a hidden old discovery fallback, compatibility Search Strategy, root alias, or deprecated
export in the final state.

### 6. Validate New Production Batching

Measure the new production composition on the exact recorded fixture: time to first visible
batch/completion, scan transaction count, React snapshot/commit count, event-batch count, reader reads,
CPU/RSS, and latency for the same mixed burst/atomic-save workload.

Record raw runs and compare against the observed old/core/backend baselines. Require explicit review
before accepting a material tradeoff. Do not invent a subjective hard threshold; apply only an
existing approved product SLO if one exists at execution. Unapproved material regression is a STOP for
investigation, not permission to tune assertions after the fact. Add the stable
`bench:file-navigator` app script because this production batching check remains useful after
migration.

### 7. Distribution Mutation Smoke

Add one package-owned legal smoke seam. Preferred shapes are an internal package-owned executable
compiled by House's build tooling or the supported File Navigator subpath driven by a House-owned
smoke host. House application source must not import a private scanner/engine path, and scanner/watcher
must not become public merely for testing.

Through ordinary child processes, not PTYs, exercise initial discovery/readiness, create, equal-size
rewrite, atomic replace, immediate child in a new directory, ignore change, remove, and clean shutdown.
Wire it into host standalone build smoke and installed main/platform-package smoke. The installed test
must invoke the installed `house` artifact with a sanitized `PATH` containing the installed bin and
required OS tools but no Bun executable, and fail if it resolves workspace source.

Inspect staged public manifests/bundles for `workspace:` and `@house/ui` leakage. Run `bun run
npm:pack` only for House's public artifacts; never pack `@house/ui` as a gate. Native target execution
follows the existing macOS/Linux release matrix and must be verified by the executor before claiming
coverage. Add stable `smoke:file-navigator:standalone` and `smoke:file-navigator:installed` app scripts;
their permanent script surface is justified by the release regression they enforce.

Each standalone release runner must generate a host-static import of its exact Parcel native platform
package and construct the watcher with Parcel's `createWrapper`. The ordinary computed dynamic require
is forbidden because it does not bundle the addon. Mutation and clean exit must pass without source
`node_modules` for every target runner.

Pin CI and publish builds to the Bun runtime approved by Plan 004B (or rerun feasibility and record
approval for the release runtime in use). Package-manager metadata, CI setup, and publish setup must
agree; an unpinned latest Bun build cannot inherit older feasibility evidence.

### 8. Update Shipped Documentation

Only after migration and distribution smoke pass:

- Update `DESIGN.md` discovery, Sidebar/File Navigator language, projection/query/selection ownership,
  ranking, live reader invalidation, architecture/data flow, tests, and measured performance to what
  actually ships.
- Mark `docs/file-navigator-design.md` implemented and reconcile exact shipped contracts; preserve
  research history in `docs/file-navigator-ranking-research.md`.
- Keep `CONTEXT.md` terminology strict; update only if shipped relationships require it.
- Add user-visible live synchronization, reader refresh, ignore correction, and fuzzy-order changes to
  `CHANGELOG.md`; update `README.md` only for user behavior and `CONTRIBUTING.md`/`AGENTS.md` for
  developer commands and boundaries.

Do not change future docs to “shipped” before the atomic migration is green.

## Exact Verification

```bash
bun install --frozen-lockfile
bun run --cwd packages/ui test
bun run --cwd packages/ui typecheck
bun run --cwd packages/ui lint
bun run --cwd packages/ui format:check
for run in 1 2 3 4 5; do bun run --cwd packages/ui test || exit 1; done
bun test apps/house/test/browser.test.tsx
bun test apps/house/test/discovery-root.test.ts
bun test apps/house/test/standalone.test.ts apps/house/test/npm-bin.test.ts
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run --cwd apps/house bench:file-navigator --record
bun run build:standalone
bun run --cwd apps/house smoke:file-navigator:standalone
bun run npm:pack
bun run --cwd apps/house smoke:file-navigator:installed
bun run verify:github
git diff --check
git status --short
```

Add these exact production benchmark and mutation-smoke invocations to `CONTRIBUTING.md` and the PR
description. The executor must inspect exact PR checks and native matrix results before merge rather
than relying on this plan.

## Done Criteria

- React composition, commit-safe handle/callbacks, query/selection/defaults, synchronous invalidation,
  separately awaited shutdown tests, and reader epochs pass.
- House has one discovered pool and uses package fuzzy default with no old ranking compatibility.
- Migration/removal is atomic; final exports have no root/old aliases or internal scanner/watcher.
- Production batching measurements are approved against observed baselines.
- Standalone and installed artifacts pass real mutation smoke; installed execution has no Bun on
  `PATH`; public artifacts leak no private workspace dependency.
- Shipped docs and changelog describe only the behavior that passed; no forbidden scope entered.

## Green PR And Rollback Boundary

The component-only commit is green while old House imports remain. The next atomic commit switches
House and removes old paths together and must itself be green. Distribution and docs may follow as
green commits in the same PR, but the PR does not merge without all of them. Roll back the entire
migration commit (and its distribution/docs followers) rather than restoring compatibility aliases or
running old and new discovery in parallel.

## Execution Record

- Migration completed in `2fcfc68` (`refactor: migrate House to FileNavigator`). Static Parcel host
  generation completed in `d537a3c` (`build: add static Parcel watcher hosts`).
- Verification passed: full `bun test` (398 passed, 7 skipped), UI tests (59 passed), typecheck,
  lint, format, standalone build, npm pack, GitHub verification, and both standalone and installed
  mutation smoke scripts.
- The shipped result uses `@house/ui/sidebar` and `@house/ui/file-navigator`, with strict scanner
  membership, root-driven House policy, fuzzy default search, reader invalidation epochs, and
  four-target npm/standalone distribution.
