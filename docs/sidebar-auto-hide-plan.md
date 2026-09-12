---
status: accepted-technical-plan
---

# Hide the Sidebar after opening a file

This document records the accepted behavior and test-driven delivery plan for hiding the Sidebar
after the user opens a selected file. It is an implementation input; released user-facing rules
will live in `README.md`, `DESIGN.md`, and `CONTEXT.md` after the feature ships.

## Outcome and boundary

- When the `autoHideSidebar` Option is enabled, a confirmed **Open file** action gives the Reader
  the full pane by hiding the Sidebar immediately.
- Sidebar navigation can still move through and preview files without interrupting browsing.
- The existing reveal behavior remains authoritative: `s` restores the persistent Sidebar state;
  `/`, `Tab`, and Reader Back reveal it through Sidebar focus.
- The behavior applies in wide and narrow layouts and records the same session visibility state in
  both, so a later resize does not reverse the user's last open action.
- `autoHideSidebar` is a boolean startup Option, enabled by default and resolved through the normal
  CLI, environment, config-file, and default precedence. It has no runtime control or footer chip.
- The feature does not add a key binding, command, notification, animation, or mouse interaction.

`CONTEXT.md` needs an **Open file** glossary entry because implementation depends on distinguishing
an explicit commitment to focused reading from navigation that merely changes and previews the
selected File Identity. No ADR is warranted: this interaction is local and inexpensive to reverse.

## Current state and constraints

- `DESIGN.md` §7.1 defines wide visibility as `shown || focus === "sidebar"`. Narrow mode renders
  only the focused pane but retains `shown` so a later wide render preserves visibility intent.
- `apps/house/src/Browser.tsx` owns `shown`, `focus`, the synchronous `focusRef`, filter commit, and
  the House keymap context. Its `sidebar.open` path currently focuses the Reader without clearing
  `shown`; matched filter Return duplicates that focus transition in the modal branch.
- Scalar startup Options are declared in `apps/house/src/config/options.ts` and resolved through
  `apps/house/src/config/load.ts` with CLI → environment → config file → default precedence. The
  boot path in `apps/house/src/index.tsx` threads resolved initial values into Browser props.
- Existing paired boolean flags (`--wrap` / `--no-wrap`) establish parser shape, conflict handling,
  and test conventions.
  Environment booleans accept strict `true` / `false`; invalid values fail.
- `apps/house/src/keymap/browser.ts` defines **Open file** as `Return`, `right`, or `l` while the
  Sidebar is focused. The command palette derives the same `sidebar.open` binding, so it must retain
  the same semantic action without a parallel command.
- `@house/ui/file-navigator` owns selection, search projection, discovery reconciliation, and
  selection callbacks. Those callbacks also cover automatic and background changes, so they are
  not a valid auto-hide seam and the package must remain unchanged.
- Selection already drives Reader preview regardless of focus (`DESIGN.md` §7.4). `j`/`k`, arrows,
  jumps, first/last, filter navigation, Reader `[`/`]`, selection restoration, New file, and Rename
  must retain that behavior without hiding the Sidebar.
- File Navigator rows currently have no mouse activation handler. Mouse opening remains outside this
  feature; a future implementation should route a mouse open through the same semantic action.
- Headless Browser coverage uses `testRender`, `captureCharFrame`, `captureSpans`, and `mockInput` in
  `apps/house/test/browser.test.tsx`. Escape assertions allow about 60 ms for parser disambiguation.
- Formatting is tabs, no semicolons, 100 columns, and trailing commas. Relevant gates are `bun test`,
  `bun run typecheck`, `bun run lint`, and `bun run format:check`.

## Accepted decision tree

| # | Question | Recommended decision | Rejected branches and reason |
| ---: | --- | --- | --- |
| 1 | What triggers automatic hiding when enabled? | Hide only for a confirmed **Open file**: Sidebar `Return`/`right`/`l`, the derived palette command, or filter Return with a real match. | Hiding on user navigation would stop multi-file browsing after one move. Hiding on every File Identity change would also react to filtering, discovery, restoration, and other background changes. |
| 2 | Is auto-hide configurable? | Add it to the scalar Option catalog and resolve it at startup. | Fixed behavior cannot preserve the current persistent two-pane workflow for users who prefer it. A separate bespoke config path would violate the repository's catalog convention. |
| 3 | What state transition implements an enabled confirmed open? | With a real selection and `autoHideSidebar=true`, set `shown=false`, synchronously record Reader focus, and set `focus="reader"` in one Browser-owned semantic action. With the Option disabled, only focus Reader. Do this in wide and narrow layouts. | Changing focus alone cannot implement enabled auto-hide in wide mode. A separate auto-hidden state duplicates the existing visibility model and complicates reveal behavior. |
| 4 | Does reopening the same File Identity hide the Sidebar when enabled? | Yes. Every confirmed open with a real selection hides it, including the initial auto-selection and a repeated open of the same file. | Tracking the last committed File Identity adds state and makes the same Open file command behave inconsistently. |
| 5 | What happens when Open file has no selected file? | Preserve the current focus-to-empty-Reader behavior without changing `shown`. | Hiding an empty Sidebar would claim a file-open transition that did not occur and make an empty Discovery Scope disappear. Removing the focus behavior is an unrelated compatibility change. |
| 6 | How does filter Return behave? | Flush the immediate query as today. A real post-flush match uses the same Open file action and conditionally hides the Sidebar; zero matches keep the existing close-without-open behavior. Esc never auto-hides. | Hiding on filter edits or auto-selection would dismiss the input while the user types. Hiding on zero matches would strand the user without a committed file. |
| 7 | How is the Sidebar revealed afterward? | Preserve every current path. `s` sets the persistent shown state and focuses the Sidebar; `/`, `Tab`, and Reader Back (`Esc`/`left`/`h`) reveal it through focus. | Restricting reveal to the two examples `s` and `/` would break the documented focus and Back keymap and require source-aware hidden state. |
| 8 | Do async Reader results affect visibility? | When auto-hide is enabled, hide immediately on user intent and keep it hidden through loading or read failure; existing Reader/error output and reveal controls provide feedback and recovery. | Waiting for a successful read makes layout response laggy and couples navigation state to asynchronous IO. Automatically reopening on error creates a new, surprising transition. |
| 9 | Does mouse selection open and hide? | No mouse behavior is added. A future mouse-open action must call the same semantic Open file action. | Treating a future row click as raw selection would conflate preview with open; adding mouse activation now expands scope beyond the existing interface. |
| 10 | Where is the behavior implemented and documented? | Keep interaction orchestration in Browser, expose one semantic Open file action through `BrowserCtx`, use the existing configuration pipeline, and update `CONTEXT.md`, `DESIGN.md`, `README.md`, and `[Unreleased]` in `CHANGELOG.md`. Do not change `@house/ui` or add an ADR. | A File Navigator callback cannot identify user commitment. A new component/state machine, bespoke config path, or ADR would overstate a small reversible behavior change. |
| 11 | Should the configured value be boolean or an extensible mode enum? | Use a boolean. It answers one stable question: whether confirmed Open file hides the Sidebar. | An enum such as `never` / `open` / `selection` reserves unsupported behavior, and selection-triggered hiding is already rejected because it breaks browsing. Add a new model only when a real second behavior is designed. |
| 12 | What is the default? | Default `autoHideSidebar` to `true`, making the requested behavior standard while allowing users to restore the former behavior explicitly. | Default `false` would make the new feature opt-in and easy to miss. A viewport-dependent default would make the same configuration behave inconsistently after resize. |
| 13 | What are the public configuration names and sources? | Use TOML `autoHideSidebar`, env `HOUSE_AUTO_HIDE_SIDEBAR`, and paired CLI flags `--auto-hide-sidebar` / `--no-auto-hide-sidebar`, with the normal precedence. Reject both CLI flags together explicitly. | Config-file-only is inconsistent with scalar Option conventions. A negative-only flag cannot override a lower layer set to `false` back to `true`. Silently choosing a winner for contradictory flags obscures user intent. Shorter names such as `autoHide` lose the affected surface. |
| 14 | Can the Option change inside a running Browser? | Resolve it once at startup and expose no key, command, footer control, or write-back. A restart applies external config changes. | Runtime mutation creates another interaction and persistence question without a requested use case. Footer space is reserved for frequently adjusted controls. |

## Detailed behavior and design

### Confirmed Open file

**Open file** is the command that commits the selected File Identity for focused reading. It is
distinct from changing the current selection, which continues to update the Reader preview.

When the Sidebar has a selected file, `autoHideSidebar` is enabled, and the user invokes `Return`,
`right`, or `l`:

1. Keep the selected File Identity and active query unchanged.
2. Set the Browser's session Sidebar visibility state to hidden (`shown=false`).
3. Update `focusRef.current` to `reader` before another keyboard event can observe stale focus.
4. Set React focus state to `reader`.
5. Let the existing debounced Reader load and stale-read protection render the selected file.

The transition is immediate and does not wait for file loading. A slow load or read error does not
reveal the Sidebar or add a new notice. Invoking Open file again on the same selection repeats the
same idempotent state transition.

With `autoHideSidebar=false`, confirmed Open file retains the current behavior: preserve `shown` and
focus the Reader. Selection, query, and Reader loading semantics are identical in both modes.

The existing `sidebar.open` binding and its command-palette projection route through this action.
There is no second command and no new key.

### Navigation and selection changes

The following continue to change or restore selection without changing Sidebar visibility or focus:

- Sidebar movement: `j`/`k`, up/down, jumps, pages, first, and last;
- movement within an open filter and sticky first-match selection while the query changes;
- Reader sibling navigation with `[` and `]`;
- initial selection, discovery/watcher reconciliation, and Shift+A restoration;
- selection performed after New file or Rename membership reconciliation.

This boundary is enforced by calling auto-hide from explicit Browser actions, never from
`onSelectionChange` or `handleSelectionChange`.

### Configuration

Declare `autoHideSidebar` in `houseOptions` as a boolean with default `true`. Pass the resolved value
down as an `initialAutoHideSidebar` Browser prop and use it to initialize Browser's existing Option
session. Read the session value for Open file behavior, but expose no runtime mutator. Omit `persist`
and `footer` because this Option changes only through startup configuration.

Expose every normal scalar source:

| Source | Enabled | Disabled | Absent |
| --- | --- | --- | --- |
| CLI | `--auto-hide-sidebar` | `--no-auto-hide-sidebar` | Fall through |
| Environment | `HOUSE_AUTO_HIDE_SIDEBAR=true` | `HOUSE_AUTO_HIDE_SIDEBAR=false` | Fall through |
| Config file | `autoHideSidebar = true` | `autoHideSidebar = false` | Fall through |
| Built-in | `true` | — | — |

CLI wins over environment, which wins over config file, which wins over the default. Supplying both
CLI flags is an explicit boot error rather than depending on Commander order. Environment values use
the catalog's strict boolean parsing; values such as `1` fail rather than gaining feature-specific
coercion.

Thread the value through `HouseConfig`, `CliOverrides`, `ParsedArgs`, `TuiBootOptions`,
`DiscoverShellProps`, and `BrowserProps`. `--serve` accepts parsing of the option like other TUI
options but does not use it because Browser is not rendered.

### Filter commit and non-commit states

Filter Return first flushes `filterInputRef.current` and uses the returned post-flush snapshot, as it
does today. If that snapshot has a selected file, closing the filter invokes the shared Open file
transition. This hides the Sidebar when `autoHideSidebar=true` and preserves `shown` when it is
`false`. It covers a match selected through sticky ranking or filter up/down navigation.

If the post-flush snapshot has no selection, Return retains the current zero-match behavior: close
the filter, keep the query applied, and keep the inline Sidebar focused when `shown` is true. Filter
Esc, empty Backspace dismissal, and Tab do not invoke Open file and do not clear `shown`.

### Empty selection

The existing `sidebar.open` keys may focus an empty Reader when no file is selected. Preserve that
compatibility, but leave `shown` unchanged. On a wide viewport this means the empty Sidebar remains
inline; on a narrow viewport Reader focus still selects the Reader screen because narrow rendering
uses focus.

### Reveal and responsive lifecycle

After a successful Open file with auto-hide enabled, `shown=false` and `focus=reader` feed the
existing visibility formula.

- Wide: the Sidebar is absent and the Reader uses the available width.
- Narrow: the Reader is the only rendered pane. Retained `shown=false` prevents a later switch to
  wide layout from restoring the Sidebar unexpectedly.
- `s`: existing toggle behavior sets `shown=true` and focuses the Sidebar. Returning focus to the
  Reader via Tab leaves the Sidebar inline until another confirmed Open file or `s` hides it.
- `/`: focuses the Sidebar and opens its filter while leaving `shown=false`. The Sidebar is therefore
  a transient focused reveal; matched Return hides it again, while Esc returns according to the
  existing filter-close rules.
- `Tab` and Reader Back: continue to reveal a hidden Sidebar through `focus=sidebar` without mutating
  `shown`. Returning to Reader focus hides that transient reveal.

### Architecture and integration seams

- Add a semantic action such as `openSelectedFile` to `BrowserCtx`; change `sidebar.open` to call it
  instead of setting focus directly. Update typed test fixtures that construct `BrowserCtx`.
- Add the catalog/load/CLI/boot wiring for `autoHideSidebar`, pass it to Browser as an immutable
  initial prop, and initialize/read it through Browser's existing Option session without exposing a
  runtime mutation path.
- Implement the action in `Browser.tsx`, using `navigator.getSnapshot().selectedFile` so it observes
  synchronous query flush or movement in the same input batch. With a selected file and the Option
  enabled it clears `shown`, updates `focusRef`, and focuses Reader. With the Option disabled, or
  without a selection, it only performs the current Reader focus transition.
- Route matched filter Return through that same action after `flushSearch`; keep the zero-match branch
  separate. Do not duplicate visibility mutation inside the modal branch.
- Leave `handleSelectionChange`, `Sidebar.tsx`, `@house/ui`, layout helpers, and the command builder
  unchanged.
- No data migration is needed. Existing config files omit the key and receive the new default;
  `autoHideSidebar = false` preserves the former wide-layout behavior.

## Observable acceptance scenarios

1. With the default `autoHideSidebar=true` on a wide viewport, Open file with `Return`, `right`, or
   `l` hides the Sidebar immediately, focuses the Reader, and keeps the chosen file rendered. This
   also works for the initial selection and a selection that was opened before.
2. Moving through multiple files with Sidebar navigation keeps the Sidebar visible and focused while
   the Reader preview follows the selection.
3. Pressing `s` after auto-hide restores and focuses the Sidebar persistently; after moving to or
   retaining any real selection, the next Open file hides it again.
4. Pressing `/` after auto-hide reveals the Sidebar with the filter active. Return on a real match
   hides it and focuses the matched Reader. Esc or Return with zero matches retains existing behavior.
5. `Tab` and Reader Back still reveal a hidden Sidebar through focus, and leaving that transient
   Sidebar for the Reader hides it again.
6. On a wide empty collection, an Open-file key can focus the empty Reader as before but does not hide
   the Sidebar. Background selection changes and New file/Rename reconciliation do not auto-hide.
7. On a narrow viewport, Open file switches to the Reader screen and records hidden visibility intent;
   `s` and `/` restore their existing Sidebar interactions. A later wide render keeps the Sidebar
   hidden until an existing reveal action changes the state.
8. With `autoHideSidebar=false`, Sidebar keys and matched filter Return focus the Reader without
   clearing `shown`, preserving the former wide two-pane behavior. Raw navigation is unchanged.
9. CLI, environment, and TOML values resolve with normal precedence; each can enable or disable the
   feature, invalid booleans fail, both CLI flags conflict, and omission resolves to `true`.
10. If the selected file loads slowly or fails to read after an enabled Open file, the Sidebar stays
    hidden and the existing Reader loading/error behavior remains the only feedback.

Security, permissions, privacy, destructive effects, external side effects, retry, cancellation,
and timeout behavior are not applicable: this feature changes only in-process presentation state and
does not add IO.

## Test-driven implementation slices

Every slice begins with one observable failing test, confirms the expected red state, makes the
smallest production change that turns it green, and refactors only while focused tests stay green.

### Slice 1: Resolve the boolean Option through every startup layer

- In `apps/house/test/config/load.test.ts`, add a failing default assertion for
  `autoHideSidebar=true`, then cover TOML and environment `true`/`false`, CLI precedence, and invalid
  environment/TOML types. Confirm the catalog/load path does not yet know the key.
- In `apps/house/test/cli.test.ts`, add failing parser assertions for `--auto-hide-sidebar`,
  `--no-auto-hide-sidebar`, their absent `null` state, and a conflict marker when both occur.
- Add the boolean to `apps/house/src/config/options.ts`; thread it through `HouseConfig`,
  `CliOverrides`, known file keys, catalog resolution, and the returned config in
  `apps/house/src/config/load.ts`.
- Add paired flags, parser fields, conflict handling, usage text, config keys, and environment help
  in `apps/house/src/cli/argv.ts` and the boot path. Follow the existing wrap parser shape rather
  than adding a generic boolean parser, but consume the new conflict marker and fail explicitly.
- Thread the resolved value through `apps/house/src/index.tsx` boot types and `DiscoverShell` into an
  `initialAutoHideSidebar` Browser prop. The Browser prop defaults to `true` for direct consumers,
  initializes the existing Option session, and is read without a runtime setter.
- Focused verification:
  `bun test apps/house/test/config/load.test.ts apps/house/test/cli.test.ts`.

### Slice 2: Enabled Open file hides the wide Sidebar

- In `apps/house/test/browser.test.tsx`, change the existing Open file navigation scenario so
  `Return` on a real selection must remove the Sidebar and focus the Reader. Confirm it fails because
  current `sidebar.open` only changes focus.
- Add `openSelectedFile` (or the final canonical name) to `BrowserCtx`, route `sidebar.open` through
  it, and implement the selected-file transition in `Browser.tsx` with the resolved boolean,
  `shown=false`, synchronous `focusRef`, and Reader focus.
- Preserve the no-selection focus-only branch in the same action.
- Update the `BrowserCtx` fixtures in `apps/house/test/keymap.test.ts` and
  `apps/house/test/file-group.test.ts`. Add a dispatcher assertion only if needed to prove
  `sidebar.open` uses the semantic action; the Browser frame is the primary behavior evidence.
- Extend the focused Browser scenario across `right` and `l`, reopening through existing Reader Back
  between aliases, so all keys on the binding demonstrate the same result.
- Focused verification:
  `bun test apps/house/test/browser.test.tsx apps/house/test/keymap.test.ts apps/house/test/file-group.test.ts`.

### Slice 3: Disabled mode preserves the current two-pane workflow

- In `apps/house/test/browser.test.tsx`, add a failing wide-layout test with
  `initialAutoHideSidebar={false}`. Render the disabled case through `DiscoverShell`, open a real
  selection, and assert Reader focus changes while the Sidebar remains visible; repeat the core
  behavior directly through Browser for matched filter Return. This proves the required
  `DiscoverShell` prop reaches Browser instead of relying only on direct Browser tests.
- Make the shared semantic action conditional on the resolved boolean. Do not fork the keymap or
  filter branches by mode.
- Assert `s`, `/`, Tab, and Reader Back retain their existing behavior in disabled mode; avoid
  duplicating scenarios already covered by mode-independent tests.
- Focused verification: `bun test apps/house/test/browser.test.tsx`.

### Slice 4: Matched filter Return uses the same transition

- In `apps/house/test/browser.test.tsx`, extend the post-flush-before-debounce test: after filter
  Return selects the correct match, the Sidebar must also be absent. Confirm the test fails with the
  current focus-only modal path.
- Refactor filter close so a real post-flush selection invokes the semantic Open file action. Keep
  the zero-match branch on the existing close-without-open path.
- Add or strengthen the `/` recovery scenario: start from auto-hidden state, open the filter, assert
  it is visible and active, commit a real match, and assert it hides again. Retain the existing
  zero-match and Esc assertions as regression evidence.
- Focused verification: `bun test apps/house/test/browser.test.tsx`.

### Slice 5: Protect selection, reveal, empty, and responsive boundaries

- Add one regression in `apps/house/test/browser.test.tsx` that moves across multiple Sidebar rows and
  asserts the Sidebar remains visible while the Reader title follows the selection. Confirm the
  failure only if implementation was accidentally attached to raw selection; otherwise record that
  it passes before further production changes and do not add code for it.
- Add focused scenarios proving: `s` persistently restores after auto-hide; `/` temporarily reveals;
  Tab and Reader Back still reveal; a no-selection Open leaves `shown` unchanged on wide layout; and
  narrow Open renders Reader while retaining hidden intent for a later wide render.
- Prefer observable headless frames. If the harness cannot resize one mounted renderer, extract only
  the smallest pure visibility transition needed to prove retained `shown=false`, then keep separate
  wide and narrow Browser integration coverage. Do not add a general layout state machine.
- Re-run New file, Rename, filter, Shift+A restoration, and Reader sibling tests to prove their
  selection changes did not acquire auto-hide behavior.
- Focused verification: `bun test apps/house/test/browser.test.tsx`.

### Slice 6: Align user, configuration, and domain documentation

- Add **Open file** to `CONTEXT.md`: the command that commits the selected File Identity for focused
  reading. Add a relationship stating that navigation may change and preview selection without
  invoking Open file. Keep `shown` and focus mechanics out of the glossary.
- Update `DESIGN.md` §7.1 so `shown` is session visibility state changed by `s` and, when
  `autoHideSidebar` is enabled, confirmed Open file. Document `shown=false, focus=reader`,
  narrow-to-wide retention, disabled behavior, and unchanged reveal paths. Update §7.2 Open file and
  matched-filter Return behavior.
- Update the `README.md` options table, TOML example, supported keys, precedence lists, environment
  variables, and defaults for `autoHideSidebar`. Update the Sidebar key row and nearby user copy:
  Open file focuses the Reader and hides the Sidebar when enabled; `s` or `/` brings navigation back.
- Add one outcome-focused bullet under `CHANGELOG.md` `[Unreleased]` / `### Changed`, for example:
  “Opening a selected file now hides the Sidebar by default so the Reader gets the full pane; set
  `autoHideSidebar = false` to retain the two-pane view.”
- Do not create an ADR or modify `CONTRIBUTING.md`; current keymap and test guidance already covers
  the implementation.

## Documentation and release verification

- `CONTEXT.md` owns the Open file/navigation vocabulary; `DESIGN.md` owns state and interaction
  semantics; `README.md` owns user-facing keys; `CHANGELOG.md` records the visible default change.
- The command palette receives the behavior through `sidebar.open`; verify its Open file label and
  availability remain unchanged rather than documenting another command.
- `README.md` and CLI usage are the public configuration contract. Verify the boolean Option appears
  consistently as `autoHideSidebar`, `HOUSE_AUTO_HIDE_SIDEBAR`, `--auto-hide-sidebar`, and
  `--no-auto-hide-sidebar` with default `true`.
- No runtime persistence, package API, dependency, data migration, or release-workflow changes are
  expected.
- After focused tests, run:

  ```bash
  bun run format
  bun test
  bun run typecheck
  bun run lint
  bun run format:check
  git diff --check
  ```

## Manual and final verification

- Run House against a directory with at least three markdown files in a wide terminal (about 120
  columns). Browse with `j`/`k`, open with each Open file alias, and verify `s`, `/`, Tab, and Reader
  Back preserve their established persistent/transient behavior.
- Repeat at a narrow width below 69 columns and confirm Open file switches to the Reader screen while
  `s` and `/` restore the Sidebar interactions. Use `termctrl` if a reproducible PTY session is
  useful; no new PTY regression test is required when headless coverage is conclusive.
- Exercise a matched filter, zero-match filter, and read failure. Confirm only a matched Open file
  auto-hides when the Option is enabled, and repeat confirmed Open file with the Option disabled.
- Smoke the default, config-file disable, and one CLI override so the rendered behavior agrees with
  the config-layer tests.
- Inspect the final diff for accidental runtime-control/package changes, unrelated work, narrated
  code comments, and sensitive material. Confirm `git status --short` lists only in-scope files.

## Explicit non-goals

- Hiding on raw selection changes, Reader `[`/`]`, discovery events, or identity restoration.
- Runtime mutation, footer exposure, or in-app persistence of `autoHideSidebar`.
- Additional auto-hide modes or a speculative enum without a second supported behavior.
- New keys, command-palette entries, footer controls, notices, animations, or theme tokens.
- Mouse selection or activation for File Navigator rows.
- Changes to File Navigator projection, selection identity, scanning, watching, or Reader debounce.
- Scoped keymap composition or any other deferred pattern from `DESIGN.md` §12.

## Completion criteria

The feature is complete only when the boolean `autoHideSidebar` Option resolves through CLI,
environment, config file, and its enabled-by-default fallback; all confirmed Open file paths with a
real selection hide the Sidebar when enabled and preserve `shown` when disabled; navigation-only and
empty-selection paths retain their documented behavior; every existing reveal path still works;
async Reader behavior is unchanged; configuration, glossary, user/design, and release docs agree;
focused and full repository gates pass; and desktop/narrow visual checks show no layout regression.
