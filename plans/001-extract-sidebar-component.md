# Plan 001: Extract the local Sidebar component

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update this plan's status row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3049ca9..HEAD -- apps/house/src/Browser.tsx apps/house/src/Sidebar.tsx apps/house/test/browser.test.tsx DESIGN.md CHANGELOG.md plans/README.md`
> If an in-scope file changed, compare the current-state descriptions below with live code. Stop if
> the sidebar ownership, rendering, or test contracts no longer match.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3049ca9`, 2026-07-25

## Why this matters

`Browser.tsx` currently owns file navigation, keyboard and modal routing, reader behavior, and the
entire sidebar rendering implementation. Issue #66 approves a behavior-neutral first step: move the
sidebar pane, row rendering, and manual virtualization into a local component while Browser retains
all product state. This creates a reviewable seam before any package or controller extraction and
keeps the subtle keyboard/filter behavior untouched.

## Current state

- `apps/house/src/Browser.tsx:213-243` owns selection, sidebar scroll, filter-open state, immediate
  filter input, and applied filter state.
- `apps/house/src/Browser.tsx:375-423` owns debounce, filtering, sticky first-match behavior,
  clamping, discovery-toggle restoration, and selected-file derivation. None of this moves.
- `apps/house/src/Browser.tsx:686-853` is the sole `useKeyboard` owner. Palette and filter-modal
  interception occur before `dispatch(browserBindings, ...)`. None of this moves.
- `apps/house/src/Browser.tsx:855-932` computes responsive layout, sidebar dimensions, manual
  virtualization, and row width.
- `apps/house/src/Browser.tsx:970-1093` renders the filter row, empty states, file rows, pane frame,
  connected wide-mode borders, and active/inactive styling.
- `apps/house/src/layout/sidebarRow.ts` is the pure basename-first row formatter. Keep it in place.
- `apps/house/src/PromptRow.tsx` is shared by the sidebar and command palette. Keep it in place.
- `apps/house/test/browser.test.tsx:1756-1958` characterizes virtualization and
  selection-following scroll, but does not yet cover hiding and reopening a scrolled sidebar.
- `apps/house/test/browser.test.tsx:1960-2223` characterizes prompt and empty-state rendering.
- `apps/house/test/browser.test.tsx:3937-4045` characterizes discovery-toggle restoration.

Relevant design constraints:

- `DESIGN.md:90-124`: Browser owns wide/narrow composition and visibility.
- `DESIGN.md:179-191`: sidebar contents are `filter(discoveredPool, query)`; input/applied query
  separation and sticky selection are product contracts.
- `DESIGN.md:225-230`: pane frames use `border`; selected rows use `backgroundElement` and
  `selectedListItemText`.
- `DESIGN.md:408-411`: scoped keymap composition remains deferred.

Repository conventions:

- TypeScript is strict; shared exports need explicit types and TSDoc (`apps/house/tsconfig.json`,
  `DESIGN.md:359-364`).
- Format with tabs, no semicolons, 100 columns, and trailing commas (`.oxfmtrc.json`).
- Follow the headless render pattern in `apps/house/test/browser.test.tsx`; do not add PTY tests.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Targeted tests | `bun test apps/house/test/browser.test.tsx apps/house/test/sidebar-row.test.ts` | exit 0; all selected tests pass |
| Typecheck | `bun run typecheck` | exit 0; no errors |
| Lint | `bun run lint` | exit 0; no errors |
| Format check | `bun run format:check` | exit 0 |
| Full tests | `bun run test` | exit 0; all workspace tests pass |

## Scope

**In scope** — the only files to modify:

- `apps/house/src/Sidebar.tsx` — create the local presentational component.
- `apps/house/src/Browser.tsx` — replace inline sidebar rendering with `<Sidebar>`.
- `apps/house/test/browser.test.tsx` — add one scroll-persistence characterization test, then leave
  all existing assertions unchanged.
- `DESIGN.md` — update §9.1's module map to name the new boundary.
- `CHANGELOG.md` — add the internal extraction under `[Unreleased]`.
- `plans/README.md` — mark Plan 001 DONE after all gates pass.

**Out of scope** — do not touch:

- Filtering/ranking in `apps/house/src/discovery/filter.ts`.
- `selectedIndex`, filter input/applied state, debounce, clamping, or restoration behavior.
- `useKeyboard`, `browserBindings`, command-palette routing, or modal routing.
- `PromptRow`, `layout/sidebarRow.ts`, or `ui/middleTruncate.ts`.
- Any package under `packages/`; do not create `@house/ui` in this plan.
- Existing test assertions. Add only the scroll-persistence characterization named in Step 1. If an
  existing assertion is demonstrably stale, stop and report.
- `README.md`; this is not a user-facing change.

## Git workflow

- Branch from current `main`; suggested name: `refactor/extract-sidebar`.
- Use conventional commits matching repository history, e.g. `refactor: extract sidebar component`.
- Do not push, open a PR, or commit unless the operator explicitly instructs you.

## Steps

### Step 1: Establish the behavior baseline

Run the targeted tests before editing. Then add a Browser characterization test in the virtualization
describe block that:

1. navigates a long list to the bottom;
2. moves selection upward several rows while keeping it inside the bottom window, so the retained
   scroll offset is greater than the minimum offset needed to show the selection;
3. hides the sidebar with `s`;
4. shows it again with `s`;
5. asserts the prior bottom window remains visible. A reset-to-zero implementation would recompute a
   different, earlier window around the same selected row and must fail this assertion.

This pins the current behavior created by `sidebarScroll` living in always-mounted Browser state. Run
the new test before the extraction and confirm it passes. Record the passing test count in PR notes,
not in source.

**Verify**:
`bun test apps/house/test/browser.test.tsx apps/house/test/sidebar-row.test.ts` → exit 0.

### Step 2: Create the local `Sidebar` component

Create `apps/house/src/Sidebar.tsx` and move only the following rendering concerns from Browser:

- `sidebarScroll` state and its selection-following/clamping effect;
- filter-row visibility and sidebar body-height calculation;
- visible-window slicing;
- wide versus narrow row-width budget;
- filter row rendering via the existing `PromptRow`;
- `SidebarEmptyMessage` and its existing centered layout;
- default file-row rendering via `formatSidebarRow` and `middleTruncate`;
- pane border sides, wide-mode `SIDEBAR_BORDER_CHARS`, inactive opacity `0.62`, and active/inactive
  body styling.

Export a TSDoc-documented `SidebarProps` interface and named `Sidebar` component. Keep the component
House-specific and typed to `FileEntry`; genericization belongs to Plan 002.

Use this prop contract unless live code drift makes it impossible:

```ts
export interface SidebarProps {
	readonly files: readonly FileEntry[]
	readonly displayedFiles: readonly FileEntry[]
	readonly selectedIndex: number
	readonly filterInput: string
	readonly filterApplied: string
	readonly filterOpen: boolean
	readonly discoveryActive: boolean
	readonly rootLabel: string
	readonly viewportHeight: number
	readonly paneWidth: number
	readonly narrow: boolean
	readonly active: boolean
	readonly visible: boolean
}
```

`files` is the discovered pool; `displayedFiles` is the filtered source of truth. `viewportHeight`
retains the existing formula using `HEADER_HEIGHT` and `FOOTER_HEIGHT`; importing those constants in
the local component is acceptable in this first plan. `paneWidth` is the actual rendered sidebar
width: terminal width in narrow mode and `sidebarWidth` in wide mode.

The component must remain mounted while hidden so moving `sidebarScroll` does not reset it. Run its
hooks and scroll reconciliation on every render, then return `null` when `visible` is false. Do not put
the component itself behind Browser's current `sidebarInline && ...` conditional.

Keep row keys as `file.path`. Preserve these exact semantic tokens:

- active body: `colors.background`;
- inactive body/frame: `colors.backgroundPanel` with body opacity `0.62`;
- border: `colors.border`;
- selected row: `colors.backgroundElement` and `colors.selectedListItemText`;
- ordinary basename: `colors.text`;
- parent suffix and empty copy: `colors.textMuted`.

**Verify**: `bun run typecheck` → exit 0 with the new file included.

### Step 3: Replace Browser's inline sidebar with the component

In `Browser.tsx`:

- remove `sidebarScroll` and the moved rendering helpers/constants;
- retain `displayedFiles`, `selectedIndex`, filtering, selection effects, and `selected` derivation;
- retain `isNarrow`, `sidebarInline`, `sidebarWidth`, and reader visibility/composition;
- render `<Sidebar>` unconditionally as the reader pane's sibling and pass
  `visible={sidebarInline}`; the component returns `null` only after its hooks run;
- pass `paneWidth={isNarrow ? width : sidebarWidth}` and all other props from Step 2;
- keep the reader pane as the sibling, preserving the connected wide layout.

Do not move the outer app box, header, footer, reader pane, or any overlay into `Sidebar`.

**Verify**:
`bun test apps/house/test/browser.test.tsx apps/house/test/sidebar-row.test.ts` → exit 0 with unchanged
assertions.

### Step 4: Update internal architecture documentation

In `DESIGN.md` §9.1, add `Sidebar.tsx` as the House-specific sidebar pane responsible for frame,
rows, and visible-window rendering; narrow `Browser.tsx`'s description to orchestration, focus,
filter/selection state, reader, and overlays. Do not document `@house/ui` yet.

Append one behavior-neutral refactor entry under `CHANGELOG.md` `[Unreleased]`. Do not claim new user
behavior.

**Verify**: `bun run format:check` → exit 0.

### Step 5: Run all gates and inspect scope

Run the full verification set, then inspect the diff. No existing Browser test assertion should have
changed.

**Verify**:

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test
git diff --check
git status --short
```

Expected: every command exits 0; status lists only the in-scope files.

## Test plan

- Existing Browser virtualization tests remain the compatibility contract.
- The new hide/reopen characterization test proves scroll state survives a hidden render.
- Existing wide/narrow, active/inactive theme, filter-row, empty-state, and discovery-toggle tests
  must pass unchanged.
- Existing pure row-layout tests remain in `apps/house/test/sidebar-row.test.ts` unchanged.
- Do not add snapshots or PTY tests.

## Done criteria

- [ ] `apps/house/src/Sidebar.tsx` owns pane rendering, row rendering, and visible-window state.
- [ ] `Sidebar` remains mounted while hidden, and the hide/reopen test preserves its scroll window.
- [ ] `Browser.tsx` has no `sidebarScroll`, `SIDEBAR_BORDER_CHARS`, `SidebarEmptyMessage`, or
  `visibleFiles` declaration.
- [ ] `Browser.tsx` still owns filter input/applied state, filtering, selection, restoration,
  responsive visibility, and `useKeyboard`.
- [ ] `bun run typecheck`, `lint`, `format:check`, and `test` all exit 0.
- [ ] Existing Browser test assertions were not edited.
- [ ] `git diff --check` exits 0.
- [ ] No out-of-scope files are modified.
- [ ] `plans/README.md` marks Plan 001 DONE.

## STOP conditions

Stop and report rather than improvising if:

- Issue #66 has been closed as rejected or superseded by a conflicting design.
- Current Browser code no longer has the rendering/state boundary described above.
- Preserving the connected wide border requires changing the reader pane.
- A test appears to require a user-visible behavior change.
- The extraction requires changing filtering, selection, keyboard routing, or discovery restoration.
- A verification gate fails twice after correcting straightforward import/type/format errors.

## Maintenance notes

- This component intentionally remains House-specific. Do not add generic accessors, filter
  strategies, theme props, or controller state in review; those belong to Plan 002.
- Review border junctions, narrow mode, and the one-row filter reservation carefully. These are the
  highest-risk visual regressions.
- Plan 002 may later turn `Sidebar` into a thin House adapter over `@house/ui`; keeping product state
  out of this component makes that migration smaller.
