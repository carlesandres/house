# Plan 006: Build the policy-aware File Navigator core

> **Execution gate:** Execute after approved Plan 004B and green Plan 005. Parcel 2.6.0, its exact
> adapter handoff, static binding constraint, and Linux consistency policy are binding.

## Metadata

- **Status:** DONE
- **Priority:** P1
- **Effort:** L
- **Risk:** HIGH
- **Category:** feature / infrastructure
- **Depends on:** Plan 004B approved; Plan 005
- **Blocks:** Plan 007
- **Authority:** `docs/file-navigator-design.md:127-355`, `CONTEXT.md`
- **Research:** `docs/file-navigator-ranking-research.md:256-298,362-397`
- **Planned from:** `e7655ac` on 2026-07-31; executor verifies actual drift and checks

## Outcome

Land an independently green, non-React File Navigator core inside `@house/ui`: policy-aware scanning,
path/metadata identity, Browse Order and Search Strategies, and a generation-linearized
synchronization engine. Add the exact Parcel 2.6.0 adapter approved by Plan 004B.

Do not add the React FileNavigator, migrate House, remove the current private root API, or export the
scanner/watcher. Internal filenames below are illustrative responsibilities, not prescribed topology.

## Current-State Evidence

- `packages/ui/src/file-navigator/useFileNavigator.ts:130-259` is a caller-fed React controller; it
  has no filesystem generation or refresh lifecycle.
- `packages/ui/src/file-navigator/types.ts:4-43` uses caller IDs/files and a combined filter strategy.
- `apps/house/src/discovery/walk.ts:97-198` owns shipped traversal and
  `apps/house/src/discovery/filter.ts:84-148` owns current House ranking.
- `apps/house/src/index.tsx:116-184` streams scans in 64-entry/60 ms batches.
- `docs/file-navigator-design.md:232-284` chooses a policy-aware authoritative scanner and Parcel 2.6.0
  as the invalidation source; Plan 004B supplies the empirical approval and Linux policy.
- `docs/file-navigator-design.md:378-390` leaves generation ordering, policy revision, ignore details,
  errors, and runtime evidence to implementation planning.

## Scope

- One authoritative scanner for initial/static discovery, refresh, and live reconciliation.
- Immutable public file values and normalized lexical absolute-path File Identity.
- Structural and recently-modified Browse Order plus fuzzysort Search Strategy.
- Generation, batching, refresh, diagnostics, invalidation, and backend-neutral watch contracts.
- Internal package tests and, if useful, an internal package-owned smoke executable.

Keep the entire new core internal in this PR and test it through relative package-owned seams. Plan 007
adds the File Navigator subpath and its reviewed public types together with the component. Scanner, raw
watcher, backend handles, filesystem-operation injection, and synchronization internals remain
unexported throughout.

### Non-Goals

- No React component/hook, House source migration, House ranking compatibility, root-export removal,
  docs-to-shipped status update, or distribution integration.
- No PTY, keys, frecency, picker, Windows CI, raw Parcel options, raw Stats, rename inference,
  generalized watcher framework, fallback backend, or `@house/ui` pack/publication.

## Authoritative Core Contracts

### Paths, Metadata, And Policy Snapshot

- Resolve root when applied, normalize lexically, preserve filesystem case, use `/` in relative paths,
  and reject lexical escapes. An explicit symlink root is traversed without replacing public identity
  by realpath.
- Public immutable metadata is the design-approved path identity, relative path, basename, lower-case
  extension, size, and `mtimeMs`; no Stats/inode/device/content leaks.
- A supplied Discovery Policy has an explicit semantic `revision`. At generation start, snapshot its
  callbacks and normalized values together. New object/callback identities with the same revision do
  not alter or restart the generation; changed behavior requires a changed revision.
- A policy callback throw fails the whole current scan/reconciliation transaction. During initial
  streaming, already published current-generation batches may have been visible; failure withdraws
  them and leaves the generation in its fatal empty state. Refresh/live transactions retain the prior
  valid collection. Never leave a partial result as final state, reinterpret a throw as `false`, or
  continue under mixed policy semantics.
- `includeDirectory` prunes scanner traversal and collection membership. Parcel may retain a broader
  physical subscription; out-of-scope events cannot populate the collection. `includeFile` controls
  membership only.
- Use `ignore.test()` to preserve unmatched/ignored/unignored states. Parent-to-child levels and
  caller-listed control files apply in order; child negation may override a parent file decision but
  cannot recover descendants of a pruned directory. Matching uses `/` paths and the existing
  `ignore` parser's case-insensitive default on every supported platform; identities remain
  case-preserving. Add explicit mixed-case tests so this is not accidental platform behavior.
- `recursive=false` reads and includes root files only. Parcel may observe nested events, but no nested
  control file or mutation may affect state.

The design authorizes followed nested symlink targets outside the physical root while retaining
lexical containment and physical-ancestry cycle detection. Test that contract directly. If the design
authority changes or later direction contradicts it, STOP rather than choosing a different boundary
inside the implementation PR.

### Strategies

- Empty query uses selected Browse Order. Built-ins are structural files-before-subdirectories order
  and `mtimeMs` descending with structural/path ties.
- Active query uses fuzzysort relevance on relative path, then browse position, then relative path.
  House's filename/stem/root/depth bonuses do not enter this package.
- Strategy input is copied. Throws or non-finite outputs fail one projection atomically, preserve the
  prior valid projection/selection, and diagnose without stopping synchronization.
- Semantic strategy identity, not callback identity, determines reprojection. Keep deterministic path
  ties and test case/diacritic behavior from the adopted fuzzysort version rather than adding an
  unapproved normalizer.

### Synchronization, Refresh, And Errors

- The scanner is authoritative; watcher events are contained, normalized invalidation hints.
- In live mode, use Plan 004B's proven subscribe/buffer/repeated-scan convergence handoff, reconcile
  final scanner membership plus buffered invalidations, then commit readiness. Never infer physical
  registration from callback silence.
- Every scope generation has a monotonic token. A replacement subscribes and converges while the
  previous generation remains live, then atomically commits and closes the previous subscriptions.
  Only the active generation may publish; drop all late results, errors, diagnostics, and callbacks.
- `watch=false` performs the same scan without a watcher. `true -> false` synchronously invalidates the
  watch token and reports `watching=false`, retains the valid collection, then closes asynchronously.
  `false -> true` retains the collection, starts/buffers a watcher, runs authoritative refresh, and
  reports ready only after handoff. Watch-setting/consistency changes use the same close/start/refresh
  transaction. A failed transition retains the collection and reports a watch error.
- Initial streaming is batched. A later policy callback failure withdraws already published batches so
  no partial collection survives as final state. Use deterministic injected barriers instead of
  scheduler sleeps to test handoff.
- `refresh()` retains visible state, shares one in-flight promise per generation, buffers events,
  atomically replaces from scan plus restats, resolves after commit, and retains/rejects on failure.
- Track unresolved errors by phase/sequence. New discovery clears old errors; successful refresh,
  projection, or watch generation clears its own phase only. Snapshot exposes the newest unresolved
  error. Commit snapshot before selection/invalidation/diagnostic callbacks.
- Selected-file invalidation follows a committed logical update even when public metadata is equal;
  unselected updates and selected removal do not emit it. This is best-effort for events Parcel
  delivers; same-mtime duplicate suppression can make a physical rewrite unobservable.
- On Linux, default `consistencyIntervalMs` to `60_000` through the backend-neutral watch setting and
  permit callers to configure or disable it. Keep normal events immediate. Every tick performs an
  authoritative policy-aware scanner reconciliation and never populates from event payloads. Default
  it to disabled on macOS, where FSEvents reports overflow/root invalidation.

## STOP Conditions

Stop if Plan 004B's approved adapter, static binding requirement, or race compensation cannot be
retained behind a narrow adapter. Also stop if policy pruning cannot control membership,
nonrecursive mode crosses root, symlink safety requires realpath identity, ignore behavior conflicts
with authority, callback throws can leave a partial collection as final state, generation overlap can
publish stale state, refresh cannot linearize events, or correctness requires public
scanner/watcher/raw backend types.

## Test-First Stages

### 1. Baseline And Internal Seams

```bash
git status --short --branch
git log --oneline -10
bun run --cwd packages/ui test
```

Reconcile design and Plan 004B evidence with installed exact dependency versions. Introduce only narrow
internal boundaries needed to inject filesystem metadata, scan barriers, event source, clock/batching,
and close completion. Names/files are executor choices.

### 2. Scanner, Identity, And Policy

Write failing tests for root validation/containment, forward-slash paths, case preservation, metadata,
deterministic structural scan, cancellation, explicit symlink root, nested symlink modes/cycles,
recursive boundary, directory pruning, nested ignore precedence/negation/mixed case, unreadable paths,
ordered diagnostics, policy snapshots, and atomic callback throws. Then implement the smallest
authoritative scanner satisfying them.

For followed nested symlinks outside physical root, test lexical identity, target updates, aliasing,
and cycle termination. Do not silently change the boundary.

### 3. Browse And Search Projections

Write failing tests for structural hierarchy/collator/path ties, recently-modified ties/future times,
fuzzysort relative-path relevance and case behavior, no input mutation, semantic strategy changes,
cache eviction, and atomic throw/non-finite failures. Implement without House ranking code.

### 4. Adapter And Generation Engine

Implement Plan 004B's exact narrow Parcel adapter: broad physical root/external-target subscriptions,
lexical mapping, scanner-only membership, buffered watch-before-scan convergence, readiness-bearing
replacement, errors, coalescing/order, and async unsubscribe. Test the Linux periodic consistency tick,
including default/configured/disabled behavior and scanner-only recovery. Do not expose raw options or
populate from events.

Use injected barriers to cover watcher-before-scan buffering, both ready/scan completion orders,
root/policy/recursion replacement, watch true/false and configuration transitions, stale work, close
before replacement, static mode, watch failure with valid scan, and authoritative refresh.

Inject a metadata provider returning byte-for-byte equal public metadata before and after a logical
selected-file update. Assert exactly one invalidation after commit. Do not use timestamp sleeps,
filesystem granularity luck, or mutate the expected value to fake inequality.

### 5. Batch And Smoke Validation

Test deterministic scan/event batch bounds and callback count under 10k initial entries and a mixed
mutation burst. Record timings/render-independent transaction counts as evidence for Plan 007; these
are measurements unless an approved product SLO exists.

If a compiled smoke is useful, make it a package-owned internal executable that imports package
internals legally. It must exercise static/live discovery and mutations, but it is not yet wired into
House artifacts or presented as a public package export.

## Exact Verification

```bash
bun install --frozen-lockfile
bun run --cwd packages/ui test
bun run --cwd packages/ui typecheck
bun run --cwd packages/ui lint
bun run --cwd packages/ui format:check
for run in 1 2 3 4 5; do bun run --cwd packages/ui test || exit 1; done
bun run typecheck
bun run lint
bun run format:check
bun run test
git diff --check
git status --short
```

The executor must verify and report exact PR checks. No command in this plan implies current remote CI
is green.

## Done Criteria

- Scanner, identity/metadata, policy/ignore/symlink/recursion, strategies, adapter, engine, refresh,
  batching, error clearing, callback order, and equal-metadata invalidation contracts pass.
- Policy values are captured by explicit revision and callback throws cannot leave a partial final
  collection.
- Watch toggles and generation handoff are linearized; membership follows policy and no callback
  silence is treated as topology proof.
- Parcel is pinned to the exact Plan 004B-approved version and remains behind the narrow adapter.
- Linux periodic reconciliation and same-metadata best-effort invalidation limits match the approved
  design.
- No React component, House migration, internal scanner/watcher export, root API removal, private pack,
  or distribution integration entered the PR.

## Green PR And Rollback Boundary

This PR adds unused package core behind internal/package-approved types while House remains on its old
controller and discovery path. Every commit and the final PR must be green. Reverting the PR removes
the core without changing House. Plan 007 is the only consumer switch and must not begin until this
boundary is approved.
