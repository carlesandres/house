# Plan 002: Extract the controlled file navigator into `@house/ui`

> **Executor instructions**: Do not begin while this plan is BLOCKED in `plans/README.md`. Issue #235
> approves the broader package/controller scope, but Plan 001 must be merged into `main` first. Once
> unblocked, follow every step and verification gate. If a STOP condition occurs, stop and report; do
> not improvise. When done, update this plan's status row in `plans/README.md` unless a reviewer told
> you they maintain the index.
>
> **Drift check (run first)**:
> 1. Confirm Plan 001 is DONE and `apps/house/src/Sidebar.tsx` exists.
> 2. Run
> `git diff --stat 3049ca9..HEAD -- packages/ui apps/house/src apps/house/test apps/house/dev apps/house/package.json bun.lock bunfig.toml turbo.json DESIGN.md CONTRIBUTING.md CHANGELOG.md plans/README.md`.
> Changes made by completed Plan 001 are expected. Any other change to filtering, selection,
> sidebar rendering, packaging, or test topology must be reconciled against this plan; stop if the
> contracts below no longer match.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001 merged into `main`
- **Category**: migration
- **Planned at**: commit `3049ca9`, 2026-07-25
- **Issue**: https://github.com/carlesandres/house/issues/235

## Why this matters

House's file navigator is useful outside the reader, but its current implementation is coupled to
House's `FileEntry`, theme singleton, fuzzy ranking policy, discovery status, and keyboard router.
This plan creates a private source-export workspace package with a generic controlled-query hook and
complete navigator pane while preserving House's responsive composition and product copy. It also
fixes a documented correctness gap: selection becomes ID-based so a later streamed result that ranks
ahead does not silently change the selected file.

This is not a behavior-neutral refactor. The approving issue and changelog must explicitly call out
the streamed-selection correction and the Return-before-debounce correction described below.

## Current state

### Product and state contracts

- `apps/house/src/Browser.tsx:213-243` stores numeric selection plus immediate and applied query
  state.
- `apps/house/src/Browser.tsx:260-279` keeps synchronous filter/modal refs because multiple keys can
  arrive before React commits.
- `apps/house/src/Browser.tsx:375-423` filters and ranks files, resets first-match selection, clamps
  numeric indices, restores discovery-toggle selection, and derives the selected file.
- `apps/house/src/Browser.tsx:464-490` deliberately passes the displayed list to `BrowserCtx` and
  wraps keymap-driven selection so it clears pending restoration and disables auto-selection.
- `apps/house/src/Browser.tsx:686-853` owns keyboard routing. Command palette and filter modal
  intercept keys before `dispatch(browserBindings, ...)`; the package must never call `useKeyboard`.
- `apps/house/src/Browser.tsx:765-780` sets the applied query and immediately reads the prior render's
  `displayedFiles`. A flush API must return a post-flush snapshot so Return is not stale.
- `apps/house/src/index.tsx:137-184` streams discovery in batches; the package receives arrays and
  never imports discovery services.

### Filtering and selection evidence

- `apps/house/src/discovery/filter.ts:21-25` says basename/depth ranking is application-specific.
- `apps/house/src/discovery/filter.ts:123-147` owns match filtering and ordering; ties retain input
  discovery order.
- `DESIGN.md:82-86` makes discovery order a product decision.
- `DESIGN.md:179-191` requires sidebar contents to equal `filter(discoveredPool, query)`, separates
  immediate/applied query by 50 ms, and requires later streamed entries not to reseat selection.
- Current numeric-index state violates the final requirement when a later file ranks before the
  selected row. This plan intentionally corrects that mismatch.

### Rendering and package evidence

- After Plan 001, `apps/house/src/Sidebar.tsx` owns the frame, visible-window scroll, prompt slot,
  empty state, and rows; Browser owns responsive visibility and passes dimensions/state.
- `apps/house/src/PromptRow.tsx` is shared with `CommandPalette`; it stays in House.
- `apps/house/src/theme/types.ts:90-107` defines the full House palette. The package receives only
  navigator tokens.
- Root workspaces already include `packages/*` (`package.json:4`).
- `apps/house/dev/build-cli.ts:14-41` bundles imports except its explicit third-party runtime
  externals. `@house/ui` must not be added to that external list.
- `apps/house/dev/build-standalone.ts:80-89` compiles from source and must resolve the workspace
  source export.
- `apps/house/dev/build-npm-main.ts:13-21` currently copies the app manifest unchanged; that would
  leak `"@house/ui": "workspace:*"`.
- `bunfig.toml:1-2` scopes direct root `bun test` to the House app. Each workspace needs its own
  `bunfig.toml`; the all-workspace gate is `bun run test` through Turbo.

Repository conventions:

- Bun workspaces and Turborepo; exact local gates are documented in `CONTRIBUTING.md:11-27` and CI
  in `.github/workflows/ci.yml:20-27`.
- TypeScript uses NodeNext ESM, `.ts` import extensions, `jsxImportSource: "@opentui/react"`, strict
  mode, exact optional properties, and no unchecked indexed access.
- Tabs, no semicolons, 100 columns, trailing commas.
- Every exported symbol needs TSDoc (`DESIGN.md:359-364`).
- Use `testRender`, `captureCharFrame`, `captureSpans`, `mockInput`, and `act`; do not add PTY tests.

## Target architecture

### Ownership

`useFileNavigator` owns:

- internal applied query and the debounce timer;
- filtering through a required caller-supplied strategy;
- selected ID as canonical state;
- derived selected file/index;
- first-match auto-selection, ID preservation, disappearance clamping, and movement actions;
- synchronous snapshots for keyboard actions and flush.

`FileNavigator` owns:

- the complete pane frame and active/inactive body styling;
- internal scroll offset, visible-window calculation, and selection-following scroll;
- default basename-first row rendering and an optional one-line row renderer;
- rendering caller-supplied one-line header and empty-state content.

House owns:

- discovery and streamed updates;
- `filterFiles` ranking policy;
- immediate `filterInput`, filter-open state, synchronous keyboard refs, and modal semantics;
- all `useKeyboard` routing and `browserBindings`;
- responsive sidebar visibility and reader composition;
- discovery-toggle restoration and the distinction between user and internal selection actions;
- prompt and empty-state copy;
- reader loading/actions and theme-singleton-to-prop mapping.

### Required package API

Export these TSDoc-documented types and symbols from `packages/ui/src/index.ts`:

```ts
export type FileId = string | number

export type FileFilterStrategy<TFile> = (
	files: readonly TFile[],
	query: string,
) => readonly TFile[]

export interface FileNavigatorSnapshot<TFile> {
	readonly appliedQuery: string
	readonly filteredFiles: readonly TFile[]
	readonly selectedFile: TFile | null
	readonly selectedIndex: number | null
}

export interface UseFileNavigatorOptions<TFile, TId extends FileId> {
	readonly files: readonly TFile[]
	readonly query: string
	readonly getId: (file: TFile) => TId
	readonly getPath: (file: TFile) => string
	readonly filter: FileFilterStrategy<TFile>
	readonly initialSelectedId?: TId | null
	readonly debounceMs?: number
}

export interface FileNavigatorController<TFile, TId extends FileId>
	extends FileNavigatorSnapshot<TFile> {
	readonly getId: (file: TFile) => TId
	readonly getPath: (file: TFile) => string
	readonly getSnapshot: () => FileNavigatorSnapshot<TFile>
	readonly flushSearch: (query: string) => FileNavigatorSnapshot<TFile>
	readonly cancelAutoSelect: () => void
	readonly selectIndex: (index: number) => FileNavigatorSnapshot<TFile>
	readonly selectId: (id: TId) => FileNavigatorSnapshot<TFile>
	readonly moveBy: (delta: number) => FileNavigatorSnapshot<TFile>
	readonly selectFirst: () => FileNavigatorSnapshot<TFile>
	readonly selectLast: () => FileNavigatorSnapshot<TFile>
}

export interface FileNavigatorTheme {
	readonly background: string
	readonly backgroundPanel: string
	readonly backgroundElement: string
	readonly text: string
	readonly textMuted: string
	readonly border: string
	readonly selectedListItemText: string
}

export type FileNavigatorVariant = "inline" | "stacked"

export interface FileNavigatorEmptyState {
	readonly label: string
	readonly value: string
}

export interface FileRowRenderContext<TFile> {
	readonly file: TFile
	readonly index: number
	readonly selected: boolean
	readonly width: number
	readonly theme: FileNavigatorTheme
}
```

`FileNavigatorProps<TFile, TId>` must contain:

- `controller: FileNavigatorController<TFile, TId>`;
- `width: number` — actual pane width;
- `paneHeight: number` — available height after House header/footer, including navigator borders;
- `variant: "inline" | "stacked"`;
- `active: boolean`;
- `visible: boolean` — keep the component mounted while hidden so scroll state persists;
- `theme: FileNavigatorTheme`;
- optional one-line `header: ReactNode`;
- optional `emptyState: FileNavigatorEmptyState` shown only when filtered results are empty;
- optional `renderFile(context): ReactNode` constrained to a one-cell row by the component wrapper.

Do not export sorting, a default filter, discovery/loading types, keyboard helpers, House theme types,
or `FileEntry`.

### Exact controller semantics

- IDs must be unique within `files`. Duplicate IDs always throw a descriptive error; do not silently
  select the first duplicate.
- `query` is the immediate controlled value. Internal `appliedQuery` drives `filter`.
- The initial query applies synchronously; ordinary prop changes apply after `debounceMs` (default
  50 ms).
- On initial render, a non-empty query takes precedence over `initialSelectedId`: select the first
  filtered result. With an empty initial query, use `initialSelectedId` only when that ID is present;
  otherwise select the first result. Empty results produce null selection.
- `flushSearch(query)` cancels the pending timer, applies exactly the provided query synchronously,
  reconciles selection, and returns the post-flush snapshot in the same call.
- When `appliedQuery` changes, first-match selection is armed. The first non-empty result selects its
  first file, then the gate disarms.
- When files stream under an unchanged applied query and the selected ID remains present, preserve
  that ID even if its derived index changes.
- If the selected ID disappears while results remain, clamp the previous selected index into the new
  result range and select that file. If results are empty, selection is null while retaining the
  prior index only as internal clamping history.
- If selection is null and results become non-empty, select the first result. This covers empty
  startup followed by streamed discovery.
- `selectedIndex` is `null` exactly when `selectedFile` is null.
- `selectIndex` clamps to the available result range; empty results produce null selection.
- `selectId` selects only an ID present in current filtered results. An absent ID leaves selection
  unchanged. `getSnapshot().selectedFile` lets House determine whether restoration succeeded.
- All movement and selection methods update internal refs before scheduling React state so several
  actions in one keyboard batch observe the latest selection.
- `cancelAutoSelect()` disarms first-match selection for the current applied query and changes no
  selection. The gate rearms only when the applied query changes. House calls it before
  keymap-driven user navigation; filter-modal movement and internal reconciliation do not call it.

### Exact House filter semantics

- Browser retains controlled `filterInput` and `filterInputRef`.
- Typing/backspace updates input and immediately calls `controller.selectIndex(0)`, preserving the
  current pre-debounce cursor reset.
- Ordinary typing lets the 50 ms debounce apply.
- Escape flushes the latest input, closes editing without reverting, and stays in the sidebar.
- Return flushes the latest input and uses the returned snapshot. It focuses the reader only when the
  post-flush snapshot has a selected file.
- `ctrl+\` sets input to `""`, calls `flushSearch("")`, resets to the first file, and stays/reopens
  in filter mode.
- Tab closes filter editing without flushing; the existing pending debounce completes normally.
- Browser keeps synchronous modal refs. Do not move key interpretation into the package.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install/update lock | `bun install` | exit 0; `bun.lock` records `@house/ui` workspace |
| Frozen install check | `bun install --frozen-lockfile` | exit 0; no lockfile change |
| Package tests | `bun run --cwd packages/ui test` | exit 0; package tests pass |
| House tests | `bun test` | exit 0; House app tests pass |
| All tests | `bun run test` | exit 0; House and UI workspace tests pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 |
| Release API checks | `bun run verify:github` | exit 0 |
| Standalone | `bun run build:standalone` | exit 0; host binary smoke passes |
| npm stage | `bun run npm:pack` | exit 0; dry-run package succeeds |

## Suggested executor toolkit

- Load the repository's coding-preferences guidance if available.
- Use OpenTUI's in-process testing utilities documented in `CONTRIBUTING.md`; do not use a PTY.
- Re-read `DESIGN.md` §§7.1, 7.4, 7.5, 9, and 12 before modifying architecture.

## Scope

**In scope** — only these files/directories may be modified:

- `packages/ui/package.json` — create private source-export package.
- `packages/ui/tsconfig.json`, `packages/ui/bunfig.toml` — create strict package config.
- `packages/ui/src/**` — create controller, component, internal row/empty-state helpers, and index.
- `packages/ui/test/**` — create package controller/render tests.
- `apps/house/package.json`, `bun.lock` — add the workspace dependency and resolve peers.
- `turbo.json` — add upstream build/hash edges for release build tasks.
- `apps/house/src/Browser.tsx` — integrate the controller.
- `apps/house/src/Sidebar.tsx` — reduce to a House adapter over `FileNavigator`.
- `apps/house/src/keymap/browser.ts` — replace index-setter context with navigation actions.
- `apps/house/src/layout/sidebarRow.ts` — delete after package default-row tests replace it.
- `apps/house/test/sidebar-row.test.ts` — move equivalent coverage into the package.
- `apps/house/test/browser.test.tsx` — add streamed-ID and pre-debounce Return regressions.
- `apps/house/test/keymap.test.ts` — update its typed BrowserCtx fixture for navigation actions.
- `apps/house/test/file-group.test.ts` — update its typed BrowserCtx fixture for navigation actions.
- `apps/house/dev/build-npm-main.ts` — stage a sanitized public manifest.
- `apps/house/dev/public-package-manifest.ts` — create a pure manifest sanitizer.
- `apps/house/test/public-package-manifest.test.ts` — create sanitizer regression tests.
- `DESIGN.md`, `CONTRIBUTING.md`, `CHANGELOG.md` — document the shipped boundary and workflow.
- `plans/README.md` — update status after all gates pass.

**Out of scope** — do not touch:

- `apps/house/src/discovery/filter.ts` or `apps/house/test/filter.test.ts`; House owns ranking.
- Discovery/walk behavior, ordering, batching, ignore rules, or `DiscoverShell`.
- Reader rendering/loading, command palette behavior, or overlay coordination.
- New sort controls, mouse support, scroll primitives, key bindings, or scoped keymap composition.
- `PromptRow` or command-palette prompt rendering.
- House's theme registry, theme JSON, or global singleton architecture.
- `README.md`; `@house/ui` is private implementation structure.
- Publishing `@house/ui`, adding it to optional dependencies, or changing platform packages.
- Any unrelated stale documentation. Update only sections directly affected by this extraction.

## Git workflow

- Start only after the approving issue exists and Plan 001 is merged.
- Suggested branch: `refactor/extract-file-navigator-package`.
- Prefer logical conventional commits if instructed to commit, for example:
  `refactor(ui): add file navigator controller`, then
  `refactor: integrate shared file navigator`, then
  `fix(release): strip private workspace dependency`.
- Do not push, open a PR, or commit unless the operator explicitly instructs you.

## Steps

### Step 1: Add regression tests before moving behavior

In `apps/house/test/browser.test.tsx`:

1. Adjust `renderBrowser` so an explicitly supplied `filterDebounceMs` is preserved; continue using
   zero by default for existing tests.
2. Add a stateful streamed-files wrapper with an active query. Start with one matching file selected,
   append a new higher-ranked match ahead of it, and assert the reader/header stays on the original
   selected path while its sidebar index changes.
3. Add a production-delay test that starts from an applied zero-match query, edits it into a query
   with a match, and presses Return in the same input batch before 50 ms elapses. Assert the matched
   file appears and the sidebar is inactive afterward using the existing `sidebarIsFocused` span
   helper. Current code finds no `picked` file in the stale zero-result list and incorrectly leaves
   focus in the sidebar, so this assertion must be red before implementation.

Both new regression tests must fail before implementation while all prior tests pass. Do not weaken
either assertion.

**Verify**:
`bun test apps/house/test/browser.test.tsx` → expected to fail only in the two newly documented
regressions before implementation; all prior tests pass.

### Step 2: Create the workspace package and dependency topology

Create `packages/ui/package.json` with:

- `"name": "@house/ui"`, `"private": true`, `"type": "module"`;
- source export `".": "./src/index.ts"`;
- scripts: `build` and `typecheck` as `tsc --noEmit`, package-local `test`, `lint`, `format`, and
  `format:check` matching app conventions;
- exact peer dependencies `react: 19.2.6`, `@opentui/core: 0.2.15`, and
  `@opentui/react: 0.2.15`;
- matching exact dev dependencies plus the repository's current TypeScript, Bun types, React types,
  Oxlint, and Oxfmt versions.

Create a strict package `tsconfig.json` matching the app's compiler rules except for the
House-specific Effect plugin. Include `src` and `test`. Create `packages/ui/bunfig.toml` with test
root `test`.

Add `"@house/ui": "workspace:*"` to House's regular dependencies and run `bun install` to update
`bun.lock`.

Update `turbo.json` so `build:cli` and `build:standalone` depend on `^build`. The UI package's
typecheck-only `build` task provides a dependency hash edge while Bun still bundles source directly.
Do not add `@house/ui` to `runtimeExternals`.

**Verify**:

```bash
bun install
bun install --frozen-lockfile
bun run --cwd packages/ui typecheck
bun run typecheck
```

Expected: all exit 0; the frozen install makes no further lockfile change.

### Step 3: Implement and test `useFileNavigator`

Create the controller under `packages/ui/src/file-navigator/` and export the exact API and semantics
from "Target architecture." Keep selection reconciliation in pure internal functions where possible;
the React hook should primarily own refs, state, effects, and timer lifecycle.

Timer cleanup must occur on query replacement and unmount. Accessors and filter functions must be
included in relevant memo/effect dependencies rather than assumed stable. Do not mutate caller arrays.

Create `packages/ui/test/use-file-navigator.test.tsx` using a tiny OpenTUI `testRender` harness that
captures the latest controller. Cover:

- initial query applies synchronously;
- non-empty initial query selects its first result regardless of `initialSelectedId`; empty initial
  query honors a present initial ID and otherwise selects first;
- an ordinary controlled query change remains unapplied before the delay and applies afterward;
- `flushSearch` cancels the timer and immediately returns post-flush files and selection;
- a newly applied query selects its first non-empty result once;
- appending a higher-ranked result preserves selected ID and changes only derived index;
- removing the selected ID clamps from its prior index;
- empty results produce null file/index and later results select first;
- movement clamps, `selectFirst`, `selectLast`, and present/absent `selectId` behavior;
- `cancelAutoSelect` preserves an explicit user selection until the applied query changes;
- duplicate IDs fail descriptively.

Use a simple test-owned strategy; do not import House's filter.

**Verify**: `bun run --cwd packages/ui test` → all controller tests pass.

### Step 4: Implement and test `FileNavigator`

Move/generalize the rendering behavior from the Plan 001 component into
`packages/ui/src/file-navigator/FileNavigator.tsx`:

- `inline`: top/bottom/right borders and existing `┬`/`┴` junction characters;
- `stacked`: top/bottom borders, no right divider, flex-filling pane;
- body left padding 1;
- row width `width - 2` inline and `width - 1` stacked, clamped to at least 4;
- visible rows `max(1, paneHeight - 2 - (header ? 1 : 0))`;
- internal scroll follows the nullable selected index and clamps after list shrink/resize;
- use the desired scroll in the current render, not one frame later;
- run scroll hooks/reconciliation while `visible` is false, then render `null`, so hide/reopen does
  not reset a retained window;
- empty state gets the same one-line top spacer behavior when a header exists;
- each row is wrapped in a one-cell-high, full-width box, even for custom renderers;
- row key uses `controller.getId(file)`.

Port basename-first/default-row behavior and its tests into the package. Keep truncation internal to
the file navigator; do not export a generic House utility. Delete the app's sidebar-row helper/test
only after equivalent package tests pass.

Create `packages/ui/test/FileNavigator.test.tsx`. Cover:

- default basename and dim parent rendering;
- custom one-line renderer;
- all semantic theme tokens with `captureSpans`;
- configurable empty state and optional header;
- inline and stacked border variants;
- visible-window limits and selection-following scroll;
- resize/list shrink scroll clamping;
- hide/reopen persistence where the retained window differs from a reset window.

**Verify**: `bun run --cwd packages/ui test` → all package tests pass.

### Step 5: Integrate the controller without moving keyboard ownership

In `Browser.tsx`, replace local applied-query/filter/selection effects with `useFileNavigator`:

- pass raw `files`, controlled `filterInput`, `file.path` as ID, `file.relativePath` as path, House's
  `filterFiles`, initial selected ID derived from the current `initialIndex`, and the existing test
  debounce override;
- derive the initial ID by clamping `initialIndex` into the initial raw file range exactly as current
  Browser does; use null when the initial raw list is empty, allowing the controller to select the
  first later-streamed result;
- use controller `filteredFiles`, `selectedFile`, nullable `selectedIndex`, and `appliedQuery` as the
  only displayed-list/selection source;
- reader loading, current-file header, file actions, and BrowserCtx must consume controller snapshots,
  never independently index raw files;
- keep `filterOpenRef`, `filterInputRef`, focus refs, and palette refs in Browser;
- implement Escape, Return, `ctrl+\`, Tab, typing, and backspace exactly as specified under "Exact
  House filter semantics";
- use `flushSearch(filterInputRef.current)`'s return value for immediate Return behavior;
- use `getSnapshot()` for file actions that can follow a movement in the same keyboard batch.

In `keymap/browser.ts`, replace the generic `setSelectedIndex` updater with explicit Browser-owned
actions such as `moveSelectionBy`, `selectFirst`, and `selectLast`. Keep `files` equal to the
controller's filtered list for existing gates. Browser wrappers for keymap-driven movement must clear
`pendingSelectionPathRef`, call `controller.cancelAutoSelect()`, and then invoke the controller
movement. Update typed BrowserCtx fixtures in both `apps/house/test/keymap.test.ts` and
`apps/house/test/file-group.test.ts`.

Preserve the current modal-arrow restoration distinction: filter-modal Up/Down call controller
movement directly and do not clear House's pending discovery-toggle restoration. Changing that
semantics is a separate behavior decision.

House's discovery-toggle effect continues to hold an absent path across re-walks. When the path is
present in filtered files, call `selectId(path)` and clear the pending ref only if the resulting
snapshot selected that path.

**Verify**:
`bun test apps/house/test/browser.test.tsx apps/house/test/keymap.test.ts apps/house/test/file-group.test.ts`
→ all tests, including the two new regressions, pass.

### Step 6: Turn `Sidebar` into the House adapter

Keep `apps/house/src/Sidebar.tsx`, but reduce it to product mapping:

- render the existing `PromptRow` as `FileNavigator`'s header when the current House rules reserve
  the row;
- choose House empty copy from raw pool count, `discoveryActive`, root label, and controller applied
  query;
- map the current singleton values into the narrowed `FileNavigatorTheme` prop on every render;
- map `narrow` to `stacked`, wide mode to `inline`, and pass actual pane width/height/active state;
- pass Browser's visibility flag through so `FileNavigator` remains mounted and owns persistent
  scroll state while returning no host nodes when hidden;
- render `FileNavigator` and no longer implement rows, scrolling, or borders itself.

Preserve the exact House state matrix:

| State | Header | Empty copy |
| --- | --- | --- |
| Discovery status non-empty, pool empty | reserved | `Scanning`, value `…` |
| Discovery complete, pool empty | hidden | `No markdown files in`, value root label |
| Pool non-empty, filtered results empty | visible | `No files match`, value applied query |
| Filtered results non-empty | visible | none |

Preserve inactive opacity `0.62`, neutral borders, selected parent text remaining muted, and selected
row background in both active and inactive panes.

**Verify**: `bun test apps/house/test/browser.test.tsx` → all existing visual/layout assertions pass.

### Step 7: Sanitize and test the public npm manifest

Create `apps/house/dev/public-package-manifest.ts` with a pure function that clones the app manifest,
removes `@house/ui` from `dependencies`, and throws if any staged dependency or optional dependency
value begins with `workspace:`. Preserve all public dependencies and optional platform packages.

Use that function in `build-npm-main.ts` instead of writing the imported manifest verbatim.

Add `apps/house/test/public-package-manifest.test.ts` covering:

- private workspace dependency is removed;
- all public runtime and optional dependencies are retained unchanged;
- an unexpected workspace protocol elsewhere fails staging.

After building, assert both manifest and bundle contain no private package reference.

**Verify**:

```bash
bun test apps/house/test/public-package-manifest.test.ts
bun run build:npm-main
! rg '@house/ui|workspace:' apps/house/dist/npm/main/package.json apps/house/dist/npm/main/dist
```

Expected: all commands exit 0; the negative search finds no matches.

### Step 8: Update architecture and contributor documentation

Update only directly affected documentation:

- `DESIGN.md` §7.1: Browser owns responsive visibility/composition; package owns navigator pane
  rendering once given variant and dimensions.
- `DESIGN.md` §7.4: House owns filter ranking and immediate input; controller owns applied-query
  debounce and ID-based selection. Correct the flush wording so Escape means close-without-revert,
  not clear.
- `DESIGN.md` §7.5: House normally consumes the mutable singleton; reusable package components take a
  narrowed semantic theme prop mapped by a House adapter.
- `DESIGN.md` §§9.1-9.2: add `packages/ui`, controller flow, and House adapter.
- `CONTRIBUTING.md`: document package layout, package-local tests, `bun test` as House-only, and
  `bun run test` as all-workspaces.
- `CHANGELOG.md` `[Unreleased]`: record the private extraction plus selected-file stability during
  streamed reranking and correct Return behavior before debounce.

Do not add implementation internals to `README.md`.

**Verify**: `bun run format:check` → exit 0.

### Step 9: Run complete CI-equivalent verification

Run formatting first if needed, then every CI/release-relevant gate.

**Verify**:

```bash
bun run format
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run verify:github
bun run build:standalone
bun run npm:pack
! rg '@house/ui|workspace:' apps/house/dist/npm/main/package.json apps/house/dist/npm/main/dist
git diff --check
git status --short
```

Expected: every positive command exits 0; negative `rg` finds no matches; status lists only in-scope
files, and expected ignored build output is absent from Git status.

## Test plan

Package controller tests:

- debounce, cancellation, and synchronous flush snapshot;
- first-match selection and streaming selected-ID stability;
- disappearance clamping and empty/null semantics;
- selection/movement actions and duplicate-ID rejection.

Package renderer tests:

- default/custom rows, width/truncation, semantic tokens;
- empty/header content;
- inline/stacked frames;
- virtualization, follow-scroll, list shrink, and resize.

House compatibility/regression tests:

- every existing Browser integration assertion remains passing;
- later higher-ranked streamed match does not change selected file;
- Return before the 50 ms delay opens the post-flush match;
- discovery-toggle restoration and user-navigation cancellation remain passing;
- public manifest strips the private workspace dependency.

Packaging tests:

- frozen install;
- source package resolves in CLI and standalone builds;
- npm stage has no unresolved private import or workspace protocol.

## Done criteria

- [ ] The approving GitHub issue explicitly authorizes the package/controller scope.
- [ ] `@house/ui` is private, source-exported, strict, independently testable, and TSDoc-complete.
- [ ] The package imports no House module or `FileEntry` type.
- [ ] House's fuzzy filter remains unchanged and is passed as the required strategy.
- [ ] No sort API or default ranking policy exists in the package.
- [ ] Selection is ID-based; streamed reranking preserves the selected file.
- [ ] `flushSearch` returns a synchronous post-flush snapshot used by Return.
- [ ] Browser remains the only `useKeyboard` owner and retains modal routing.
- [ ] `Sidebar.tsx` is a thin House adapter; package code owns frame/rows/windowing.
- [ ] Hiding and reopening the sidebar preserves its retained scroll window.
- [ ] Existing wide/narrow, prompt, empty-state, theme, virtualization, and restoration tests pass.
- [ ] Package tests run through `bun run test`; direct `bun test` remains the House suite.
- [ ] `bun install --frozen-lockfile`, all CI gates, standalone build, and npm pack exit 0.
- [ ] Staged npm output contains no `@house/ui` or `workspace:` reference.
- [ ] No out-of-scope files changed; `git diff --check` exits 0.
- [ ] `plans/README.md` marks Plan 002 DONE.

## STOP conditions

Stop and report rather than improvising if:

- No GitHub issue authorizes this broader scope.
- Plan 001 is not complete or its resulting boundary materially differs from this plan.
- React or OpenTUI peer versions differ from House by the time implementation starts.
- Bun cannot resolve and bundle the source export without a built `dist` package. Report the exact
  resolution error; do not silently switch package architecture.
- Correct synchronous flush requires package-level keyboard handling or `flushSync`.
- Unique stable IDs cannot be obtained from House file paths.
- ID preservation conflicts with an approved product decision made after this plan.
- Preserving layout requires importing House header/footer/theme modules into `@house/ui`.
- Sanitizing the staged manifest would remove any public runtime dependency besides `@house/ui`.
- An existing compatibility test can pass only by changing documented user behavior not explicitly
  approved here.
- Any verification gate fails twice after a reasonable scoped correction.

## Maintenance notes

- Reviewers should focus on synchronous controller refs, timer cleanup, selected-ID reconciliation,
  and whether every House file action reads the controller snapshot rather than raw arrays.
- The package's filter function owns complete output ordering. If a future consumer needs separate
  score/base-sort composition, add it only with a concrete use case and tests; do not retrofit an
  unused comparator now.
- If a future consumer needs a different frame, add a named variant rather than boolean style props.
- If mouse selection lands later, Browser must decide whether it clears pending discovery restoration
  before invoking controller selection.
- Publishing `@house/ui` would require a separate public API/versioning review; this plan does not
  establish a supported external package.
