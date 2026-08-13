# Plan 004B: Validate Parcel Watcher as the filesystem backend

> **Execution note:** Plan 004 rejected Chokidar 5.0.0 after Bun crashed reproducibly in the required
> 10k broad/event benchmark. This follow-up approved Parcel Watcher 2.6.0 after the project owner
> explicitly accepted the completed empirical result and Linux consistency policy on 2026-08-01.

## Metadata

- **Status:** DONE — APPROVED (`@parcel/watcher` 2.6.0)
- **Priority:** P1
- **Effort:** M
- **Risk:** HIGH
- **Category:** research / feasibility
- **Depends on:** Plan 004 rejection evidence
- **Unblocks:** Plans 005-007
- **Authority:** `docs/file-navigator-design.md`
- **Prior evidence:** `docs/file-navigator-backend-feasibility.md`
- **Planned from:** `e7655ac` on 2026-07-31; execution must verify actual drift

## Execution result

**Stage 1 was initially rejected on 2026-08-01 under the original physical-watch-pruning contract.**
The design session subsequently relaxed that requirement: recursion and Discovery Policy now strictly
limit scanner traversal and collection membership, while the native backend may observe a broader
recursive root.

Source evidence remains useful but no longer rejects Parcel solely for broad subscription topology.
All 11 scenarios and 3/3 repeats passed on the four supported platform/architecture combinations.
Generated platform-static binding plus Parcel `createWrapper` passed standalone mutation and clean exit
on each target without source `node_modules`; computed dynamic require remains unsupported. Native
darwin-arm64 passed the full matrix and 10k broad 3x100, while linux-arm64 passed 10k broad 3x100
without crash. Full evidence is recorded in `docs/file-navigator-parcel-feasibility.md`.

The owner approved Parcel 2.6.0 with a Linux-only default `consistencyIntervalMs=60_000`, configurable
or disableable through backend-neutral watch settings. Plans 005-007 are unblocked.

## Outcome

Produce reproducible evidence for or against `@parcel/watcher` as the File Navigator invalidation
backend under Bun standalone binaries. Do not migrate production discovery, alter House behavior, or
change accepted scope semantics in this plan.

Approval evidence demonstrates that Parcel can support:

- policy-derived directory exclusion without leaking excluded descendant events;
- the agreed hard nonrecursive scanner and collection boundary despite a broader subscription;
- authoritative scanner plus watcher handoff without missed final membership;
- create, update, atomic replace, remove, directory-plus-immediate-child, and ignore-control changes;
- lexical symlink roots and followed external nested symlinks;
- event coalescing, error propagation, and clean async teardown;
- Bun source and standalone execution on House's supported native matrix;
- packaging without breaking House's single-binary distribution;
- representative 1k/5k/10k performance without the Chokidar/Bun crash.

Parcel may observe a broader recursive root. Nonrecursive and policy exclusions still apply strictly
to scanner traversal and collection membership; no out-of-scope event may inject a file.

## Scope

May add exact Parcel Watcher dev dependencies, package-owned spike modules/tests, spike-only configs,
and a feasibility evidence document. Reuse Plan 004's scanner fixtures and evidence machinery where it
remains backend-neutral, but do not distort Chokidar evidence or productionize either adapter.

### Non-goals

- No production scanner/component, House migration, public watcher API, Parcel fallback abstraction,
  new key, picker, frecency, Windows CI, raw native event export, or independent package publication.
- No weakening of collection membership, scanner recursion, symlink identity, or single-binary
  behavior to make Parcel pass.
- No assumption that filtered events prove physical watch pruning; inspect source and native behavior.

## STOP Conditions

Reject Parcel and stop when:

- ignored/newly-unignored directories can imperatively populate the collection without scanner
  reconciliation;
- Bun cannot compile and execute the native addon as a standalone single binary;
- any supported host misses eligible mutations, leaks excluded mutations, crashes, or leaks handles;
- native platform packages cannot fit House's release matrix without changing the distribution model;
- proceeding requires a product-contract change that has not been explicitly approved.

## Test-first stages

### 1. Source and package inspection

Record exact package/version/license/platform packages and inspect the public API plus native backends.
Determine whether ignore patterns prune native subscriptions or only callback delivery, whether depth
zero exists, how overflow/rescan errors surface, and how symlinks are treated. Cite source in the
evidence document.

### 2. Boundary harness

Add a narrow Parcel adapter to the package-owned spike. Test immediate backend events and periodic
authoritative scanner reconciliation against real temporary trees:

- included/excluded sibling directories and policy changes in both directions;
- recursive and nonrecursive roots, including newly created nested directories;
- scanner/subscription/reconciliation interleavings;
- immediate children in new directories;
- ignore-control changes;
- symlink root, disabled nested symlinks, followed external target, and cycle termination;
- exact logical publications, callback errors, unsubscribe, and timely process exit.

Use authoritative scanner reconciliation. Do not infer native registration from callback silence alone.

### 3. Bun standalone and packaging

Compile a package-owned Parcel smoke with House's `bun build --compile --bytecode --format=esm` shape.
Run actual mutations. Inspect the binary and runtime filesystem for required `.node` addons. A smoke
that works only with workspace `node_modules` present does not pass; rerun from an isolated directory.

### 4. Performance evidence

Use process-isolated cells and incremental evidence recording. Exercise 1k/5k/10k broad and deep
fixtures with scanner handoff and mixed mutations. A crash, timeout, nonzero exit, or malformed output
records the exact failed cell. Compare with Plan 004's Chokidar evidence without rerunning failed
Chokidar cells.

### 5. Decision

Write `docs/file-navigator-parcel-feasibility.md` with source citations, commands, exact environment,
boundary results, standalone/package results, performance summaries, and `approved`, `rejected`, or
`incomplete`. A rejection may still be a green evidence change.

**Result:** `approved`. The project owner explicitly approved the cross-platform evidence and Linux
consistency policy on 2026-08-01. Chokidar remains rejected.

## Verification

```bash
bun install --frozen-lockfile
bun run --cwd packages/ui test
bun run --cwd packages/ui tsc --noEmit -p tsconfig.spike.json
bun run --cwd packages/ui tsc --noEmit -p tsconfig.node-probe.json
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run verify:github
git diff --check
```

Run explicit spike lint/format commands for every new `dev/` file because normal package scripts do not
cover that directory.

## Done criteria

- Source-level watch/pruning/depth behavior is documented rather than inferred.
- Correctness and standalone/package evidence is reproducible.
- Performance evidence uses isolated cells and cannot lose prior results on crash.
- The conclusion is truthful and does not change the product contract implicitly.
- Plans 005-007 are unblocked by this approved backend result.

## Rollback boundary

This remains a package-owned feasibility change. Reverting it leaves House behavior untouched but
returns Plans 005-007 to a blocked backend decision.
