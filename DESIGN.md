# house — Design

> **Status:** Draft.
> **Inspiration:** [`glow`](https://github.com/charmbracelet/glow) (Go, bubbletea/glamour).
> **Stack target:** [`opentui`](https://github.com/anomalyco/opentui) on Bun + TypeScript.

## 1. Overview

`house` is a TUI-first markdown reader for the terminal. It opens in the current directory (or a path argument), shows a sidebar of markdown files, and renders the selected file in an adjacent reader pane. It is meant to be a great daily-driver for reading local project docs, and a showcase for what `opentui` can do in a real app.

It is explicitly **not** glow rewritten in TypeScript: glow's center of gravity is a CLI formatter that also happens to have a TUI; ours is a TUI that also happens to have a minimal CLI.

## 2. Goals

- Be the most pleasant way to read markdown sitting on your local filesystem.
- Take full advantage of `opentui`'s layout primitives — typographic, whitespace-rich presentation rather than the dense terminal aesthetic glow inherits from its rendering stack.
- Provide a foundation that can grow into a documentation explorer (cross-file navigation, search) without architectural rework.
- Serve as a learning vehicle for [Effect](https://effect.website) — the author has not used it before and wants to build production familiarity with it on a realistic but bounded codebase.

## 3. Non-Goals

These are hard non-goals. We will say no to PRs that pull in this direction.

- **Not an editor.** No buffer, no insert mode, no writes to disk. (Future releases may shell out to `$EDITOR`, but that is a hand-off, not editing inside the app.)
- **Not Windows-supported in v1.** Target platforms are macOS and Linux. Bun runs on Windows, but `house` has never been validated there — see the tracking epic [#129](https://github.com/carlesandres/house/issues/129) for the gap list. We will not block PRs that incidentally improve Windows compat, but we will not accept Windows-only complexity until the tier is explicitly chosen.
- **Not an exporter.** No HTML, PDF, or image output.
- **Not a cloud / sync service.** Glow had a stash feature; it was removed. We will not reintroduce that class of feature.
- **Not a general-purpose pager.** We will not try to replace `less`. Piping arbitrary text into `house` is out of scope.
- **Not a custom-stylesheet platform** in v1. No JSON/YAML theme files. Themes are TypeScript objects shipped with the binary.
- **No custom markdown parser.** v1 uses opentui's built-in `<markdown>` renderer. We reserve the right to swap to a custom remark/mdast pipeline later if and only if a concrete need (theming gap, link-following, search highlighting) forces it.

## 4. Target User & Use Cases

The primary user is a **developer reading local docs**: someone who has a repo open, wants to skim the README and `docs/`, and would rather stay in the terminal than open a browser or VS Code preview.

The likely future user is a **documentation explorer**: someone pointing `house` at a `docs/` tree (or a wiki, or an Obsidian vault) and navigating it like a small static site. v1 is built so this is reachable, not delivered.

Out of scope for both: scripts piping markdown through a CLI formatter (glow's other persona). We will keep stdin support on the post-beta list, but it is not the design center.

## 5. Product Scope

### 5.1 v1 — MVP

v1 is a personal-use MVP. It may never be published to npm, GitHub, or Homebrew. It exists to prove the architecture and the UX.

v1 ships when:

1. `house` and `house <path>` open a TUI with a sidebar of `.md` / `.markdown` / `.mdx` files discovered recursively from the path (default cwd).
2. Discovery respects `.gitignore`, skips `node_modules` / `.git` / `.venv` unconditionally, and does not follow symlinks.
3. Selecting a file renders it in the reader pane with support for: headings, paragraphs, lists (ordered, unordered, nested), blockquotes, GFM tables, inline emphasis (bold, italic, and strike — strike rendered as dim/muted because opentui's syntax-style API has no strikethrough attribute), inline code, links (rendered, not followed), images-as-alt-text, horizontal rules, fenced code blocks, including language-tagged fences.
4. The keymap in §7.2 works end-to-end, including the help overlay.
5. Dark and light themes ship; `--theme dark|light` selects (default `dark`). Terminal-background auto-detect is deferred to beta (§12).
6. `--width N` controls word-wrap column.
7. The app builds as a Bun standalone binary (host platform) with a smoke test on the binary. npm package and cross-target binaries are deferred to beta (§10.5).
8. `README.md` covers install + run; `DESIGN.md` reflects shipped behavior.

**v1 status: shipped** (see `LICENSE`, `README.md`, and the commit log up to and including the LICENSE commit). Subsequent work targets §10 beta gates and the deferred items listed in [`ROADMAP.md`](./ROADMAP.md) (overview in §5.3).

There is no performance gate, no coverage gate, and no public release in v1.

### 5.2 beta — Public release gates

`beta` is when we put the project in front of strangers. The gates are in §10. See `CONTEXT.md` for the glossary entry distinguishing `beta` (a release milestone) from any semver version.

### 5.3 Deferred / future

Planned work is tracked in [`ROADMAP.md`](./ROADMAP.md), which maps each item to a GitHub issue. Items confirmed as competitive gaps against mdcat / frogmouth / mdr (issue #16) are marked ★ there.

Key reservations for deferred features (search, navigation history, bookmarks, etc.) live in §7.3 — consult that section before binding new keys.

## 6. Discovery Rules

| Rule | v1 behavior |
|---|---|
| Root | Path argument if given, else `cwd`. |
| Recursion | Unbounded depth from root. |
| Extensions | `.md`, `.markdown`, `.mdx` (mdx rendered as plain markdown — no JSX evaluation). `.mdx` is opt-out via `--no-mdx` or `mdx = false` in `config.toml` (or `HOUSE_MDX=false`). |
| Ignore files | `.gitignore` honored. Nested `.gitignore` files honored. |
| Hard skips | `node_modules`, `.git`, `.venv` (always, even with `--all`). |
| Hidden files | Skipped by default; `--all` to include. |
| Symlinks | Not followed (loop hazard). |
| Sort | Alphabetical within each group. Group order is controlled by `--sort`: `dirs-first` (default) puts directories above files; `files-first` flips it so the current directory's files appear before nested subtrees. |

Discovery is a **non-trivial product decision** — users notice when their mental model of "what shows up" doesn't match. Changing these rules is a versioned change.

**Streaming.** `walk()` returns a `Stream` (Effect), not an eagerly-collected array. Entries arrive in per-directory DFS order as the walk progresses, so the sidebar mounts immediately on `files=[]` and grows live; the footer shows `indexing… N` until the stream completes. Cancellation is best-effort and checks `signal.aborted` between syscalls — Node's `readdir` is not itself abortable, so a single in-flight `readdir` on a slow filesystem still runs to completion. A `walkToArray()` helper exists for callers (and most tests) that don't need streaming. Per-walk traversal caps are tracked in #80/#81.

## 7. UX Architecture

### 7.1 Layout — wide two-pane, narrow single-pane stack

Layout shape switches on viewport. The boundary is `canFitInline(width)` — true when `SIDEBAR_MIN + DIVIDER + READER_MIN` (69 cols) fits side-by-side.

**Wide (≥ 69 cols) — inline two-pane.** Two pieces of state: `shown` (the user's sticky sidebar preference) and `focus` (which pane has the keyboard). Visibility is derived:

```
visible = shown || focus === "sidebar"
```

That rule means a hidden sidebar becomes reachable just by focusing it (via `/`, `tab`, or `s`), without a separate "open sidebar" operation.

**Narrow (< 69 cols) — single-pane stack.** Only one pane renders at a time, filling the entire pane area. `focus` is the single source of truth for which screen is up; `shown` is silently ignored for render but kept in sync so a later resize to wide opens with the right pane visible. No drawer, no overlay — the reader doesn't render underneath the sidebar.

Width is a pure function of viewport, decoupled from visibility:

```
resolveSidebarWidth(viewport, preferred) =
  clamp(preferred, SIDEBAR_MIN, viewport - DIVIDER - READER_MIN)
```

Until persistent config (#13) lands, `preferred` is derived from viewport (`floor(width * 0.25)` clamped to `[28, 60]`).

**Launch** — `--sidebar=auto|on|off` initialises `shown`:

- `auto` (default) — `shown=true`. Every viewport boots on the sidebar: narrow as the single visible screen, wide as the focused inline pane.
- `on` — `shown=true`. Same as `auto` in v1; reserved for future per-pane sticky behaviors.
- `off` — `shown=false`, focus=reader. Boots into reader (narrow) or reader-only inline (wide). Sidebar still reachable via `s`/`tab`/`/`.

**Resize** — switching layouts preserves intent:

- wide → narrow: whichever pane was focused becomes the single visible screen.
- narrow → wide: the visible pane becomes the focused inline pane; the other pane appears according to the wide visibility rule.

**Filter discoverability** — when a filter is applied (query non-empty) and the input is closed, the footer shows a `[filter: <query>]` chip in the hint row. Surfaces the otherwise-invisible invariant that `[`/`]` walks the filtered set even when the sidebar is hidden.

```
wide, shown=true, inline           narrow, focus=sidebar
┌────┬─────────────────┐           ┌──────────────────────┐
│ ▸R │ # Title         │           │ ▸ README.md          │
│  d │                 │           │   notes.md           │
│  x │ Body...         │           │   …                  │
└────┴─────────────────┘           └──────────────────────┘
```

This is more work than glow's sequential full-screen views, but it is what `opentui`'s layout system was designed for, and it is the natural seed for the future doc-explorer (a tree sidebar already in the right place).

### 7.2 Keymap — v1

Conventions follow `ghui` (escape-to-back, return-to-confirm, vim letters as arrow-key siblings) rather than glow.

| Key | Action |
|---|---|
| `j` / `k`, `↑` / `↓` | Move selection / scroll line |
| `shift+j` / `shift+k` | Jump (8 lines) |
| `space` / `b`, `pagedown` / `pageup`, `ctrl+d` / `ctrl+u` | Page / half-page |
| `g` / `G` | Top / bottom |
| `return`, `l`, `→` | Open file / focus reader |
| `escape`, `h`, `←` | Back / focus sidebar |
| `[` / `]` | Previous / next file in list (from reader) |
| `tab` | Toggle focus between sidebar and reader |
| `s` | Toggle sidebar visibility |
| `/` | Open filter input (fuzzy match on path) |
| `?` | Help overlay |
| `q`, `ctrl+c` | Quit |

The filter is a modal-edit input rendered as a row inside the sidebar (above the file list, suppressed on an empty vault). Three reachable states: **idle** (`/ filter…` placeholder), **editing** (`/<query>▏` while the modal is open), and **applied** (`/<query>` after `Return` commits; the list stays narrowed and Reader navigation keys operate on the filtered set). `Esc` closes the modal without reverting — the typed query is kept as the applied filter, so re-opening with `/` resumes editing it. `Ctrl+\` is the single "clear filter" chord, deliberately a chord (not a bare key) so it works *inside* the filter input without colliding with typed characters: from outside the modal it clears the applied filter and reopens for editing; from inside the modal it clears the current input and stays in editing mode. `Ctrl+U` is *not* overloaded for this — it stays reserved for sidebar/reader half-page-up to avoid mental overload. The footer surfaces `ctrl+\ clear` only when there is something to clear and no modal owns the input. `Return` on a zero-match list is treated as `Esc` (close, keep the query applied). `Backspace`/`Delete` while the query is empty closes the modal — the slash *is* the prompt, so deleting it dismisses the prompt. Pattern adapted from ghui's PR list (a filter row that lives inside the list it filters), not from hunk's StatusBar.

### 7.3 Reserved keys (future)

Do not bind these in v1:

| Key | Reserved for |
|---|---|
| `r` | Reload current file |
| `B` | Bookmarks panel |
| `ctrl+[` / `ctrl+]` | Navigation history back / forward |

`e` (open in `$EDITOR`) and `o` (open externally, currently HTML browser) are shipped — see the keymap. Reload semantics: `r` remains reserved because `e`'s post-edit reload is automatic; a manual reload is only needed if we ship file-watching as a separate feature.

### 7.4 Unified browser model

**Status: planned (umbrella [#118](https://github.com/carlesandres/house/issues/118)).** The principles below are committed; the implementation is sequenced across #109–#117. Any agent picking up one of those issues must read this section first — it is the contract the individual diffs are working towards.

There is **no "single-file mode"**. The Browser is the only render target. Whatever the user passes on the CLI, the resulting UI is Browser + sidebar + reader. The differences between "I named a file" and "I named a directory" collapse into a single axis: what filter query is preloaded.

**Invariant 1 — the sidebar is populated by search, never imperatively.** Sidebar contents are exactly `filter(discoveredPool, query)`. No code path may push entries into the sidebar by any other route. Refactors that need to "show entry X" must reframe as "what `(discoveryRoot, query)` pair selects X". This invariant exists so the sidebar has one source of truth; imperative population would diverge from the active filter under any edit / re-discovery / user input.

**Invariant 2 — the discovery root and the query are independent inputs.** Discovery root is resolved from (highest wins): `--root <dir>` → `defaultRoot` config → built-in `"cwd"`. `defaultRoot` is string-valued — `"cwd"` (default) or `"git"` (repo root via parent walk, silent cwd fallback). The CLI positional argument never controls discovery root; that surface is reserved for `--root` and config.

**Invariant 3 — the CLI positional is the initial filter query.** `house README.md` → walk the discovery root, seed the filter to `"README.md"`. The fuzzy scorer (`src/discovery/filter.ts`) ranks `README.md` highest (word-start + adjacency bonuses), sticky auto-select lands on it, the reader renders it. Clearing the filter (`Esc`) reveals the full tree. The CLI query is *applied* (live filter, visible in the filter chip), not *consumed* (silently picks selection and clears) — applied is the only shape that honors Invariant 1.

**Invariant 4 — the selected file drives the reader, regardless of focus.** As long as exactly one file is the active selection, that file's content is in the reader pane. Focus determines where keystrokes land, not what is shown. Empty selection → blank reader. There is no separate "open this file in the reader" action distinct from "select it".

**Invariant 5 — file-scoped actions are gated on `hasSelected`, not on `haveFiles`.** The File keymap group (`o` open-in-browser, `[` prev, `]` next) is available iff `selected !== null`. `haveFiles` (list non-empty) is a sloppy proxy that breaks under debounced filter + sticky select, where the list can be non-empty while no row is the selection. `hasSelected` is the honest predicate.

**Invariant 6 — filter input and applied filter are separated by a 50ms debounce.** `filterInput` (immediate) drives the typed line and the filter chip. `filterApplied` (debounced) drives `filterFiles` and selection. Three flush points bypass the debounce so the UI never feels stuck: launch with a seeded query (`initialQuery` initializes *both* states), `Esc` clearing the filter, `Return` committing a pick.

**Invariant 7 — sticky first-match auto-select.** Once `filterApplied` produces its first non-empty result, selection snaps to index 0 and stays. Later-streamed entries with higher scores never reseat selection under the user. The gate re-arms when `filterApplied` changes.

**Empty states.** Post-discovery, with nothing to select, the sidebar shows a single dim row in place of the file list: `no markdown files in <rootDir>` (empty pool) or `no matches for "<query>"` (pool non-empty, zero matches). The reader stays blank. The footer hint row drops File-scoped hints automatically via `hasSelected`.

**What this replaces.** The previous design had an `App` component for file targets and a `Browser` for directory targets, each with its own keymap. That split is the bug that motivated this work: `s` and `o` silently no-op in `App` because they're `Browser`-scoped. Under the unified model, `App` is deleted, `--serve <path>` takes its own explicit path (the positional is reserved for the query), and `house docs/` walks `defaultRoot` and filter-matches `"docs/"` instead of walking `./docs/` directly.

**Behavior-change note for `house docs/`.** Same visible result in the common case (the docs files surface at the top of the sidebar), but the mechanics differ — the entire discovery root is scanned, not just `docs/`. No compat shim; this is the cost of the cleaner model.

### 7.5 Theming

Themes are opencode-derived JSON definitions resolved into the typed token surface in `src/theme/types.ts`, then exposed through the `ColorPalette` singleton consumed by UI components. Selection is via config/CLI and can be cycled at runtime.

The semantic tokens are intentionally about UI role, not color names. When styling chrome, pick the token by meaning first and only then check how each bundled theme renders it.

| Token | Intended use |
|---|---|
| `background` | Main active pane background and base canvas. |
| `backgroundPanel` | Panel chrome and inactive pane background. |
| `backgroundElement` | Raised inner element background and active selection background. |
| `text` | Default readable UI text. |
| `textMuted` | Secondary copy, labels, separators, disabled-looking metadata. |
| `border` | Default pane and modal borders. |
| `borderActive` | Focused/active border where a border itself carries state. |
| `borderSubtle` | Low-contrast dividers and inactive selection background. |
| `selectedListItemText` | Foreground for selected list rows when a theme needs explicit contrast. |
| `primary` | Brand/primary accent, strong emphasis, and selected foreground. |
| `secondary` | Active contextual metadata: focused prompt marker, active filter chip, pending/discovery state, agent-like labels. Not generic emphasis. |
| `accent` | Decorative or alternate accent for uncommon UI highlights. |
| `error` | Errors and destructive/failed states. |
| `warning` | Warnings, caution, or needs-attention states. |
| `success` | Completed, confirmed, or positive states. |
| `info` | Informational status distinct from active metadata. |
| `syntax` | Markdown and fenced-code `SyntaxStyle` scope map built from `markdown*` and `syntax*` theme tokens. |

The raw theme token surface also includes markdown-specific tokens (`markdownHeading`, `markdownLink`, etc.) and fenced-code syntax tokens (`syntaxKeyword`, `syntaxString`, etc.). Use those through `colors.syntax` for rendered markdown instead of applying UI accent tokens to document content.

Terminal-background auto-detect (OSC 11 / `COLORFGBG` / fallback) is **deferred to beta** — see §12. Until that lands, users opt in via `--theme`.

Visual direction is **typographic**: generous whitespace, light accents, lots of contrast on headings. Glow's dense background-bar style is a workaround for constrained renderers — we are not constrained.

## 8. Technical Constraints / Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Matches `ghui`; standalone-binary build pipeline already proven. |
| Language | TypeScript | Strict mode. |
| TUI framework | `@opentui/react` | JSX + hooks fit a multi-view app; matches `ghui`. |
| State / IO | [Effect](https://effect.website) | Author wants to learn it; well-suited to async/IO when beta features land. |
| Markdown rendering | `opentui`'s built-in `<markdown>` (`MarkdownRenderable`) | opentui ships a production-hardened markdown renderer with tables, tree-sitter syntax highlighting, and theme support via `SyntaxStyle`. Reusing it skips a large class of parsing/layout work and matches the "showcase opentui" goal. |
| Linter | `oxlint` | Matches `ghui`. |
| Formatter | `oxfmt` | Matches `ghui`. |
| Tests | `bun test` | Stays in-runtime. |
| Distribution | Bun standalone binary + npm package | Brew tap deferred to post-beta. |

**Note on Effect.** The author has not shipped Effect before. Some early code will read like "Effect by way of Promises" until the patterns settle. That is expected and acceptable; refactors-toward-idiomatic-Effect are tracked as work in v1→beta.

## 9. Architecture Sketch

### 9.1 Module map

As shipped in v1 (flatter than the original sketch — top-level components live directly under `src/` until a second view forces a `tui/` subdir):

```
src/
├── cli/argv.ts            argv parsing + usage string
├── discovery/walk.ts      filesystem walk, gitignore (root + nested), hard skips
├── io/readFile.ts         Effect.tryPromise wrapper around fs/promises.readFile
├── keymap/keymap.ts       KeyBinding<C> + parseChord/dispatch
├── keymap/browser.ts      browserBindings + BrowserCtx (single source for bindings + help)
├── theme/types.ts         ColorPalette interface (~12 semantic tokens), ThemeId
├── theme/dark.ts          Nord-ish dark palette
├── theme/light.ts         GitHub-Light-leaning palette
├── theme/registry.ts      themeDefinitions, getThemeDefinition, isThemeId
├── theme/colors.ts        mutable singleton `colors` + setActiveTheme
├── Browser.tsx            two-pane component (sidebar + reader, focus, help overlay)
├── HelpOverlay.tsx        renders KeyBinding[] grouped by group field
└── index.tsx              entry: parseArgv → stat path → <Browser> or single-file <App>
```

A separate `reader/` module did not justify itself in v1: opentui's `<markdown>` plus a `<scrollbox>` wrapper is small enough to live inline in `Browser.tsx` and the single-file `App` in `index.tsx`. Extracting it is a follow-up once a second consumer (e.g., URL-fetched markdown, search-result preview) appears.

### 9.2 Data flow

```
argv ──► cli ──► (path, options)
                    │
                    ▼
              discovery ─► file list (signal/atom)
                                │
                       user selects ▼
                          read file → string
                                │
                                ▼
                          <markdown content={...} syntaxStyle={theme} />
                                │
                                ▼
                          rendered pane (inside scrollbox)
```

Discovery, parsing, and rendering are pure (Effect-y) functions of their inputs. The TUI layer wires them to user input and screen output. Keeping these layers strictly separated is what lets us add search, link-following, and live-reload later without touching the renderer.

### 9.3 Effect layering (sketch)

- `Discovery` service — `walk(path, opts) → Stream<FileEntry>`.
- `FileReader` service — `read(path) → Effect<string, ReadError>`.
- `Theme` service — `detect() → Effect<Theme, never>`; produces a `SyntaxStyle` for `<markdown>`.
- App `Layer` composes these and hands the live runtime to the React tree via `@effect/atom-react`.

Errors are tagged unions. No `throw` in domain code; errors-as-values flow up to the TUI layer, which renders them inline (e.g., a "couldn't parse this file" box).

## 10. beta Quality Gates

These are gates for *calling it beta and shipping publicly*, not blockers for individual PRs.

### 10.1 Performance (targets to validate)

Numbers below are guesses informed by "feels fast" expectations; treat them as targets to validate against measured baselines, not hard contracts.

| Metric | Target |
|---|---|
| Cold start to first paint (200-file repo) | <150ms |
| Render of a typical README (≤500 lines) | <50ms |
| Render of a 5,000-line stress doc | <250ms |
| Scroll latency (input → frame) | <16ms (60fps) |
| Discovery on a 10k-file monorepo | <500ms |
| Resident memory on a typical repo | <80MB |

A `bun run bench` script checks these against a fixture corpus checked into `test/fixtures/`.

### 10.2 Tests

- The theme's tree-sitter scope map (`buildSyntaxMap` in `src/theme/colors.ts`) has an entry for every markdown node type §5.1.3 promises. This is the integration surface we own; opentui's own test suite covers the renderer end. Regression-style tests for *our* uses of `<markdown>` (e.g. the code-block invisibility bug in `test/markdown-codeblock.test.tsx`) are kept as targeted coverage, not blanket per-node snapshots.
- Every keymap binding has at least one integration test (boot TUI, send keys, assert state).
- Discovery edge cases covered: `.gitignore`, nested `.gitignore`, hidden files, symlinks not followed, missing dir, empty dir.
- Smoke test on the built standalone binary in CI.
- No coverage % gate. Coverage rewards the wrong thing.

### 10.3 Structure

- Module boundaries from §9.1 enforced. No circular imports (lint rule).
- Effect services exposed as Layers; errors as tagged unions; no `throw` in domain code.
- Every exported symbol has TSDoc.

### 10.4 Documentation

- `README.md` — install, run, screenshots / asciicast, key cheatsheet.
- `DESIGN.md` — shipped behavior matches doc.
- `CONTRIBUTING.md` — dev, build, test, release flow.
- `CHANGELOG.md` — generated via changesets.

### 10.5 Release / OSS hygiene

- **Distribution: npm-only for now.** Published as `@carlesandres/house`; the user must have Bun on `PATH` (Bun is the runtime, no compiled binary). Modeled on ghui's distribution shape. Trigger: GH release `published` event → `publish.yml` runs `npm publish` via Trusted Publisher.
- **Single-binary distribution is a follow-up**, not a beta gate. It is attractive (no Bun-on-PATH requirement) but the matrix-build cost and per-OS smoke complexity are real. Tracked as a GitHub issue; revisit when there is concrete user demand for "I want one binary, not npm + bun".
- **Homebrew tap** still on the list, gated on either npm-only being insufficient or the binary distribution landing first.
- Semver from v0.1.0 onward; pre-v0.1 may break.
- Manual `CHANGELOG.md` (Keep-a-Changelog). Changesets remains an option if/when contributors land.
- CI: typecheck + lint + format:check + test + `npm pack --dry-run` on every PR (`ci.yml`).
- Issue & PR templates; communication is GitHub issues only.
- MIT license, single `LICENSE` file.

## 11. Open Questions

Things we will learn by building, not by debating.

- Does Effect's Layer model fit a single-process TUI cleanly, or does it feel oversized for the amount of IO we actually do? Revisit before beta.
- How much does `opentui`'s React reconciler cost on full re-renders of long documents? May need windowing/virtualization for large files; will be measured against §10.1 targets.
- What's the right boundary between "render plain markdown" (v1) and "follow a link to another file" (post-v1)? Done well, the renderer already produces navigable link nodes; done poorly, we re-architect.
- Bun's standalone binary size — acceptable, or do we need a slim build path?

## 12. Patterns to revisit

Approaches we deliberately did *not* adopt, with the trigger that should bring us back. Each entry pairs a deferred pattern with a concrete signal — when that signal fires, re-read this section.

Inline `// TODO(revisit: <topic>)` markers in the code point here from the relevant call sites. Grep for `TODO(revisit:` to enumerate them.

- **Declarative keymap as data — small in-house version landed.** Bindings as values with `{ id, description, keys, when?, run }` and a pure `dispatch` live in `src/keymap/`. The shape is enough to drive `useKeyboard` *and* the upcoming `?` help overlay from one source of truth.
  - **Outstanding ghui machinery (still deferred):** chord sequences (`g g`), vim count prefixes (`5j`), scoped contexts via contramap, conflict detection, command-palette routing.
  - Trigger to revisit: a third interactive overlay/modal lands (search, filter, command palette), OR a real need for chord/count input emerges.
  - **Current overlay count: 2** (help overlay, `/` filter modal). Both intercept keys outside the data-driven dispatch via `if`-branches in `Browser.tsx`. One more interactive surface trips the trigger.

- **Theme as a typed token interface — landed.** Implemented in `src/theme/`: `ColorPalette` interface (~12 semantic tokens), a `themeDefinitions` registry, and a mutable singleton `colors` consumers read directly. Modeled on ghui but at our smaller scale.
  - **Outstanding ghui machinery (still deferred):** large named-theme set (ghui ships 27), `ThemeConfig` distinguishing fixed-vs-system mode, OS appearance auto-detect, persistent config file, runtime theme switcher.
  - Trigger to revisit (system mode + auto-detect): a user explicitly asks for it, OR when the persistent config file lands. Trigger to revisit (runtime theme switcher / theme version state for re-render): when a "press `t` to cycle themes" UX is on the table.

- **Keymap composition / scoped contexts**
  - What it is: per-view keymaps that compose via `Keymap.scope(predicate)` so modal bindings stack on top of base bindings without giant if/else routing in one handler.
  - Why deferred: routing-by-state in our single `useKeyboard` is fine for sidebar-vs-reader.
  - Trigger: when the third overlay surface lands, OR when the focus-routing `if` chain in `Browser.tsx` gets uncomfortable to read.

- **User-configurable sidebar width**
  - What it is: a setting (CLI flag and/or config file) that overrides the sidebar width heuristic. Power users with strong layout preferences want this; the heuristic alone won't satisfy everyone.
  - Why deferred: the in-code heuristic `clamp(28, floor(width * 0.25), 60)` is a sensible default and ships with zero ceremony.
  - Trigger: when the persistent config file lands (already on the deferred list in §5.3) — wire `sidebarWidth` through it at the same time. A standalone `--sidebar-width` flag is fine sooner if a real user asks.

- **Sidebar truncation strategy**
  - What it is: how long file paths are shortened when they exceed the sidebar's width. Today: leading ellipsis, keeping the filename visible (`…l/job_search/cv.md`). Plausible alternatives: middle-truncation (`Personal/…/cv.md`), filename-first with dimmed parent dir, or a two-line entry that shows both.
  - Why deferred: the leading-ellipsis form is fine for a first pass; we don't yet know which case is actually annoying in real use.
  - Trigger: real-use friction with the leading-ellipsis form, OR feedback that filename context is being lost.

- **Custom remark/mdast renderer (replacing opentui's `<markdown>`)**
  - What it is: parse with `remark` + `remark-gfm`, walk the mdast, emit opentui boxes/text directly. Already noted in §3 non-goals as a reserved-right swap.
  - Trigger: a concrete need we can't solve inside `<markdown>` — cross-file link following, in-document search highlighting, theming tokens that `SyntaxStyle` doesn't expose.

## 13. References

- glow — https://github.com/charmbracelet/glow (Go reference; in `reference/glow/`)
- ghui — https://github.com/kitlangton/ghui (opentui+Effect precedent; in `reference/ghui/`)
- hunk — https://github.com/modem-dev/hunk (responsive-layout reference; in `reference/hunk/`)
- opentui — https://github.com/anomalyco/opentui (rendering core; in `reference/opentui/`)
- Effect — https://effect.website
- remark / mdast — https://github.com/remarkjs/remark
