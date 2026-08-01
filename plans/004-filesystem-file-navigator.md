# Plan 004: Validate File Navigator filesystem backend

> **Execution note:** The File Navigator sequence was approved in the design session that produced
> `docs/file-navigator-design.md`. A GitHub tracking issue is optional project bookkeeping, not an
> execution prerequisite.

## Metadata

- **Status:** REJECTED — Chokidar 5.0.0 crashes Bun 1.3.10 in the required 10k broad/event cell
- **Priority:** P1
- **Effort:** M
- **Risk:** HIGH
- **Category:** research / feasibility
- **Depends on:** Plans 001-003 as merged in PR #237
- **Blocks:** Plans 005-007
- **Authority:** `docs/file-navigator-design.md`, especially lines 127-170 and 232-268
- **Research:** `docs/file-navigator-ranking-research.md`, especially lines 279-298
- **Planned from:** `e7655ac` on 2026-07-31; the executor must verify the actual base

## Outcome

Produce a green, reviewable feasibility PR containing reproducible evidence for or against Chokidar 5
as the File Navigator event source. Do not migrate production discovery, add a React component, alter
House behavior, or select another backend in this PR.

Chokidar passes only when correctness, runtime, compilation, and representative performance evidence
are reviewed and accepted. A rejected result may still produce a green evidence PR, but it does not
unlock Plans 005-007. Parcel Watcher is researched, not an automatic fallback.

### Execution result

The host-local gate rejected Chokidar 5.0.0. On Bun 1.3.10/darwin-arm64, both the isolated matrix child
and a direct rerun crashed with a segmentation fault while starting the required 10,000-file,
1,000-directory broad event-mode benchmark. Lower 1k/5k cells, correctness, polling, symlink, race,
compiled, and emitted-Node probes passed, but one required host failure is sufficient to reject the
backend. See `docs/file-navigator-backend-feasibility.md` for structured evidence and Bun reports.

Plans 005-007 remain blocked pending an explicit backend decision. Parcel Watcher is not selected
automatically.

## Current-State Evidence

- `package.json:31` pins the workspace package manager to Bun 1.3.10.
- `packages/ui/package.json:5-14` exposes source through one private root export and has no filesystem
  dependency or `dev/` validation in package scripts.
- `packages/ui/tsconfig.json:20` includes only `src/` and `test/`; spike files therefore need explicit
  type, lint, and format coverage.
- `apps/house/src/discovery/walk.ts:97-153` is the shipped scanner. It must not be imported by the
  package spike because it is a House-private implementation.
- `apps/house/dev/build-standalone.ts:80-101` compiles with Bun and currently smokes only `--version`.
- `.github/workflows/publish.yml:45-72` identifies the four native House build targets. Executor-time
  CI and runner availability must be verified rather than inferred from this file.
- `DESIGN.md:360-373` contains performance targets to validate, not a product SLO.

## Scope

The PR may add package-owned spike/test code, a spike-specific TypeScript config, exact dev
dependencies and lockfile changes, a results document, and narrowly scoped CI needed to run the matrix.
The spike may import its own package internals. House source must not import private package paths.

Keep package scripts unchanged unless the PR demonstrates why a permanent script is needed. Direct
commands below must cover every spike file. Do not pack or publish `@house/ui`.

### Non-Goals

- No production scanner, watcher adapter, synchronization engine, React component, or House migration.
- No package root-export change and no claim that plain Node can load source `.tsx` exports.
- No PTY, Windows CI, raw public Chokidar options, raw Stats, frecency, picker, or key change.
- No hard benchmark threshold invented before measurement and no automatic Parcel experiment.

## Required Runtime Matrix

Use exact versions in the evidence and pin them in any added matrix:

| Purpose               | Runtime                       | Native targets / runner labels                                                                                                 | Modes                     |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Adoption behavior     | Bun 1.3.10                    | `darwin-arm64` / `macos-15`; `darwin-x64` / `macos-15-intel`; `linux-arm64` / `ubuntu-24.04-arm`; `linux-x64` / `ubuntu-24.04` | events, explicit polling  |
| Bun issue comparison  | Bun 1.3.14                    | `linux-x64` / `ubuntu-24.04`                                                                                                   | events                    |
| ESM/import comparison | Node 22.22.2 and Node 24.18.0 | `linux-x64` / `ubuntu-24.04`                                                                                                   | direct dependency imports |
| Watch baseline        | Node 24.18.0                  | `linux-x64` / `ubuntu-24.04`                                                                                                   | events, explicit polling  |

If an exact runner/runtime cannot execute, record the gap and STOP; do not replace it silently. Node
tests cover Chokidar, `ignore`, fuzzysort, and emitted/bundled JavaScript only. They are not evidence
that Node can import `@house/ui`'s TypeScript/TSX source package.

## STOP Conditions

Stop and report when:

- Source or design drift changes the intended backend-neutral contract.
- Any target misses eligible mutations, crosses a nonrecursive or policy-pruned boundary, leaks a
  watcher, or cannot close asynchronously.
- Chokidar's new-directory race cannot be closed and demonstrated without treating `getWatched()` as
  registration proof.
- An explicit symlink root cannot be watched while nested symlink following remains independently off.
- Import, package-owned standalone compilation, or execution fails on the required matrix.
- Observed performance is not approved against the recorded scanner/Node baselines.
- Proceeding requires Parcel, House imports of private package internals, or a new product policy.

## Test-First Stages

### 1. Baseline And Reproduction Harness

Before editing, run:

```bash
git status --short --branch
git log --oneline -10
bun --version
node --version
```

Build one package-owned executable, conventionally `packages/ui/dev/backend-feasibility.ts`, with
subcommands for fixtures, correctness, benchmark, imports, and compiled smoke. Add tests around its
pure orchestration where useful. A `packages/ui/tsconfig.spike.json` may extend the package config and
include `dev/` without broadening normal package scripts.

First make failures observable: timeouts, duplicate logical events, missed final membership, leaked
handles, and cleanup failures must produce nonzero exit status and a retained result record.

### 2. Policy-Derived Topology And Boundaries

Prototype only the minimum topology needed to answer feasibility. Derive watched directories from a
captured policy scan; do not recursively watch an unpruned root and filter events afterward.
`includeDirectory` must prune both traversal and watcher registration.

Because topology is policy-derived, prove the complete initial handoff rather than assuming a watcher
can start first: policy scan, watcher registration, then an authoritative reconciliation scan while
events are buffered. Force mutations during the topology scan, between scan and registration, and
during reconciliation in both already-known and newly discovered directories. Readiness may commit
only when final membership matches disk.

Test on real temporary trees in event and polling modes:

- included and excluded sibling directories, then mutations under each;
- directory policy changing the eligible topology;
- recursive and nonrecursive roots, proving nested directories are neither read nor watched in the
  latter;
- event create, rewrite, atomic replace, remove, directory create plus immediate child, and ignore
  control-file mutation;
- clean async close and no event after close.

Instrument requested watch/add/remove inputs and observed events. `getWatched()` may be recorded only
as a diagnostic count; it cannot establish that registration completed or that a race is closed.

### 3. Chokidar Race Correctness

Reproduce the Chokidar #1471 new-directory handoff against the exact installed version. Use
controllable barriers around the spike's own scan/reconcile steps plus unmodified-package stress.
Never patch installed dependencies or import Chokidar private internals as production evidence.

For both watch modes, force immediate child creation at each available interleaving and assert final
authoritative membership plus exactly one logical addition. Prove a candidate sequence through
observable outcomes: parent invalidation, topology update, authoritative subtree reconciliation, and
subsequent externally observed mutations. Do not wait for or assert `getWatched()` registration.

Record upstream issue/release state on the execution date. If the installed release is fixed, retain a
regression that proves externally visible behavior. If compensation is needed, record the exact
sequence Plan 006 may implement. If neither can be proven, fail the gate.

### 4. Symlink Root And Follow Policy

On all native targets, cover a lexical root that is itself a symlink with nested following disabled.
It must discover and observe target mutations while preserving the lexical root identity. Separately
show that nested symlink files/directories are skipped when following is false. When following is true,
prove that a target outside the root's physical directory remains observable through its lexical path
beneath root and that physical-ancestry cycle detection terminates safely.

### 5. Imports And Package-Owned Standalone

Prove source execution under Bun and direct ESM dependency imports under Node 22.22.2 and 24.18.0.
Compile the package-owned executable with the same `--compile --bytecode --format=esm` shape House
uses. Execute it natively for every House target and drive discovery, readiness, create, equal-size
rewrite, atomic replace, new-directory immediate child, ignore change, remove, and shutdown.

The executable may import package-private spike code because it is owned by `@house/ui`; House must
not import it. Do not describe this as plain-Node support for the source package.

### 6. Representative Measurements

Use disposable fixtures at 1k, 5k, and 10k files with realistic depth, at least 100 policy files, and
both included and pruned subtrees. Include a broad-directory and deep-directory shape. Run one warmup
and at least three recorded trials per native target/mode; compare Bun and Node on the same Linux x64
host.

Record exact runtime/dependency/OS/architecture, fixture seed and topology, policy scan first/result
times, topology construction and ready times, requested directory count, RSS delta, CPU time, close
duration, and p50/p95/max latency for at least 100 mixed mutations. Include the existing House scan or
an equivalent package-owned policy scan as the observed discovery baseline without importing House
private code.

The observed tradeoff must be reviewed before Chokidar is adopted. `DESIGN.md` §10.1 is a
target-to-validate, not a hard SLO, so do not turn it or an invented ratio into an automatic STOP after
seeing data. Harness timeouts guard hangs; they are not product performance acceptance thresholds.

### 7. Record Decision

Write `docs/file-navigator-backend-feasibility.md` with commands, exact versions, raw summaries,
artifacts, race outcome, topology proof, symlink outcome, and one conclusion: `approved`, `rejected`,
or `blocked`. An approved conclusion records who reviewed the measurements and when. A rejection must
preserve enough evidence to make the backend decision without keeping failed production code. The
harness must have an evidence-validation mode that exits successfully when a declared rejection is
complete and reproducible; it must not mislabel failed behavior as an approved pass.

## Exact Verification

```bash
bun install --frozen-lockfile
bun run --cwd packages/ui test
bun run --cwd packages/ui tsc --noEmit -p tsconfig.spike.json
bun x oxlint --tsconfig packages/ui/tsconfig.spike.json packages/ui/dev/ packages/ui/test/
bun x oxfmt --check packages/ui/dev/ packages/ui/test/ packages/ui/tsconfig.spike.json \
  docs/file-navigator-backend-feasibility.md
bun packages/ui/dev/backend-feasibility.ts verify-evidence
bun packages/ui/dev/backend-feasibility.ts benchmark --record
bun run typecheck
bun run lint
bun run format:check
bun run test
git diff --check
git status --short
```

The evidence command must fail if required cells/artifacts are absent or if its result disagrees with
the recorded conclusion. It may validate either complete approved evidence or complete rejected
evidence; skipped cells cannot be labeled passing. The executor must inspect exact PR checks before
merge rather than claiming CI state from this plan.

## Done Criteria

- Every required runtime/target/mode cell has reproducible evidence with Bun 1.3.10 as the measured
  candidate runtime.
- Approved conclusion: policy topology, initial handoff, boundaries, events/polling, race correctness,
  imports, compilation, mutations, shutdown, and accepted measurements all pass.
- Rejected conclusion: at least one failed gate is reproduced deterministically and linked to the
  evidence document; Plans 005-007 remain blocked pending a new sequence decision.
- No conclusion relies on `getWatched()` as registration proof or post-hoc performance waiver.
- No production migration, House private import, private package pack/publish, Parcel adoption, or
  plain-Node source-package claim entered the PR.

## Green PR And Rollback Boundary

This PR is evidence and package-owned spike infrastructure only. It must be green independently for an
approved or rejected conclusion. If approved, later plans may adopt the exact backend/version and
proven handoff. If rejected, retain reproducible results, mark dependent plans BLOCKED, and open no
implementation PR until the issue records a new sequence decision.
