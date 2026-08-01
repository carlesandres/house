# Plan 005: Extract generic Sidebar and isolate package subpaths

> **Execution gate:** Plan 004B approved `@parcel/watcher` 2.6.0; execute after Plans 001-003.

## Metadata

- **Status:** DONE
- **Priority:** P1
- **Effort:** M
- **Risk:** MEDIUM
- **Category:** refactor
- **Depends on:** Plan 004B approved; Plans 001-003 merged
- **Blocks:** Plans 006-007
- **Authority:** `docs/file-navigator-design.md:17-46`
- **Planned from:** `e7655ac` on 2026-07-31; executor verifies the actual base and checks

## Outcome

Land one behavior-neutral PR that makes Sidebar a generic, filesystem-free presentation component and
proves `@house/ui/sidebar` isolation in a fresh process/build graph. Keep the current private root
exports and old FileNavigator wrapper until Plan 007 migrates House. Do not pack or publish
`@house/ui`.

## Current-State Evidence

- `packages/ui/src/file-navigator/FileNavigator.tsx:25-121` currently combines frame, visible window,
  file defaults, and House-shaped `inline`/`stacked` variants.
- `packages/ui/src/file-navigator/types.ts:45-86` includes file, path, controller, and House-oriented
  presentation vocabulary.
- `packages/ui/src/index.ts:1-14` is the only export and is consumed by
  `apps/house/src/Browser.tsx:15` and `apps/house/src/Sidebar.tsx:1-2`.
- `packages/ui/package.json:5-7` has only the root export. Package scripts already cover `src/` and
  `test/`.
- The accepted boundary at `docs/file-navigator-design.md:23-25` requires Sidebar loading never to
  load File Navigator, the filesystem backend, or Node filesystem modules.

## Scope

- Add the `@house/ui/sidebar` subpath and generic Sidebar implementation/types agreed by the design.
- Preserve windowing, hidden-state reconciliation, header placement, complete neutral frame defaults,
  appearance controls, generic identity, required rendering, and generic empty fallback.
- Keep a temporary private root API/wrapper sufficient for unchanged House imports and behavior.
- Add fresh-process and build-graph isolation tests.

Internal filenames are implementation choices. Export only the Sidebar surface justified by the
design; do not predeclare the future File Navigator implementation surface in this PR.

### Non-Goals

- No filesystem scanner/watcher, Parcel runtime import, search/order strategy, or React filesystem
  component.
- No House source, behavior, copy, theme, query, selection, key, or discovery change.
- No deletion of current root exports, compatibility deprecation, npm pack, or independent package
  publication.
- No PTY, new key, frecency, sort picker, Windows CI, or unrelated style redesign.

## STOP Conditions

Stop when the approved plan inputs have materially drifted, House behavior cannot remain unchanged
through the temporary root wrapper, Sidebar isolation requires runtime filesystem code, or a fresh
build graph contains File Navigator/filesystem-backend/Node filesystem modules. Do not weaken isolation
or migrate House to make the PR pass.

## Test-First Stages

### 1. Verify Governance And Baseline

```bash
git status --short --branch
git log --oneline -10
bun run --cwd packages/ui test
bun test apps/house/test/browser.test.tsx apps/house/test/sidebar-empty-state.test.ts
```

Read current package rendering tests and capture the House frames/behaviors that the wrapper must
preserve. Verify actual PR/CI state at execution; this plan makes no remote-state claim.

### 2. Add Generic Sidebar Regressions

Write failing package tests for:

- generic items and identity accessor with required item renderer;
- selected-row presentation and selection-following visible window;
- shrink, resize, hidden updates, and first visible frame on reveal;
- optional header, custom empty state, and `No results found.` fallback;
- neutral full rectangular frame by default;
- configured borders/sides/characters, colors, opacity, padding, and selected-row colors;
- absence of file/path/controller/search/order and `inline`/`stacked` concepts from the Sidebar
  contract.

Use the existing headless OpenTUI harness, not a PTY.

### 3. Prove Subpath Isolation Outside Module Cache

Spawn a fresh child process that imports only `@house/ui/sidebar`; fail resolution if it asks for the
filesystem backend, Node filesystem modules, or the file-navigator subtree. Do not import Sidebar after
File Navigator in the parent process and infer isolation from `require.cache` or an ESM cache.

Separately build a minimal Sidebar-only entry in a fresh temporary output directory and inspect the
bundler metafile/module graph. Assert there is no Parcel, `node:fs`, `node:fs/promises`, scanner,
watcher, or File Navigator edge. The child and graph tests must clean up temporary files and fail on
an unavailable blocker rather than silently skipping.

### 4. Extract Sidebar And Preserve The Root Wrapper

Move presentation/window behavior behind the generic Sidebar API. Adapt the current private
FileNavigator/root surface as a thin wrapper so House and its tests remain unchanged. Do not label
that wrapper deprecated; it is temporary migration scaffolding removed atomically in Plan 007.

Add the Sidebar subpath to package exports. Do not remove `"."`, add a filesystem subpath before it
exists, or expose implementation helpers.

### 5. Confirm No House Behavior Change

Run current House Browser/sidebar tests without rewriting expectations. Any source adjustment under
`apps/house` is out of scope. Compare rendered frames and controller behavior for visible/hidden,
wide/narrow, empty, scanning, query, and selection paths already covered by the suite.

## Exact Verification

```bash
bun install --frozen-lockfile
bun run --cwd packages/ui test
bun run --cwd packages/ui typecheck
bun run --cwd packages/ui lint
bun run --cwd packages/ui format:check
bun test apps/house/test/browser.test.tsx apps/house/test/sidebar-empty-state.test.ts
bun run typecheck
bun run lint
bun run format:check
bun run test
git diff --check
git status --short
```

Do not run or add `npm pack --dry-run ./packages/ui`; private package contents are not a release gate.
The executor must inspect exact PR checks before merge.

## Done Criteria

- `@house/ui/sidebar` is generic and renders the agreed neutral/default and configured behavior.
- A fresh child process and fresh build graph prove Sidebar has no filesystem/File Navigator edge.
- Current private root exports remain and House source/behavior is unchanged.
- Package and workspace tests/type/lint/format gates pass without PTY or package publication work.
- Actual execution evidence is linked from the PR.

## Green PR And Rollback Boundary

This PR must be independently green while House remains on the old root API. Reverting it restores
the prior combined presentation component without touching discovery or product behavior. Do not
merge a commit that removes the old root wrapper before Plan 007's House migration commit.
