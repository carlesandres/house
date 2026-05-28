# Changelog

All notable changes to house land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from v0.1.0 onward.

The publish workflow (`.github/workflows/publish.yml`) runs on the `release: published` event, runs `npm publish` via Trusted Publisher, and lets GitHub auto-generate release notes from commit subjects; this file is the curated, narrative version.

## [Unreleased]

### Docs

- Corrected usage docs and `--help` text: directory browsing is controlled by `--root` / `defaultRoot`; the positional path now seeds the initial browser filter query.

### Changed

- Removed TUI single-file mode: non-serve launches always open the browser over the discovery root, with any positional path applied as the initial sidebar filter.

## [0.4.7] — 2026-05-27

### Added

- `--root <path>` and TOML `defaultRoot` let launches default to a configured browsing root while preserving explicit path arguments.
- Discovery/indexing status now shows a spinner in the chrome instead of only static text.

### Changed

- File actions now use uppercase `E` / `O` instead of lowercase `e` / `o`, adding a small amount of friction to edit and open-in-browser actions.
- Sidebar filtering now applies after a short debounce to reduce churn while typing.
- Filtered browsing now keeps the first match sticky/selected as results update.

### Fixed

- PTY typing coverage and footer hint tests now match the shifted file-action bindings.
- CI typechecking now satisfies exact optional prop typing in the release branch.

### Docs

- Removed the obsolete `CONTEXT.md` glossary and inlined the beta-term explanation into `DESIGN.md` with cleaned-up cross-references.
- ROADMAP shipped items were pruned after the covered work landed.

### Tests

- Browser test noise from React act warnings was reduced around the new filter behavior coverage.

## [0.4.6] — 2026-05-25

### Added

- Reader empty states now show one tip at a time and rotate through a relevance-ordered set of workflow hints.

### Changed

- Startup behavior now uses `--focus <sidebar|reader|filter>`, `HOUSE_FOCUS`, and TOML `focus = "..."`; the built-in startup default is now `filter`.
- Active filter/status metadata now uses the secondary theme token, matching opencode's use of `secondary` for active contextual metadata.
- UI theme consumers now use the opencode-aligned `primary` token directly for strong emphasis and selected foreground.
- UI chrome no longer uses house-only aliases (`surface`, `selectedBg`, `selectedBgInactive`), and background/backgroundPanel are no longer reordered by luminance.
- Sidebar filtering now ranks basename matches above folder-only matches and softly prefers current-folder files over deeper nested paths, while keeping empty-query tree order unchanged.

### Fixed

- Tabbing away from the sidebar filter now lands on the reader without dropping filter mode, and the next `Tab` restores focus to the filter input instead of the sidebar list.
- Batched key input no longer clears active filter focus unexpectedly during tab cycling.

### Docs

- Added semantic token usage guidance for supported theme tokens.
- DESIGN now documents the sidebar filter's basename-first, pure-function ranking model.

### Tests

- Added headless and PTY regression coverage for filter tab-cycle focus restoration.

## [0.4.5] — 2026-05-24

### Changed

- npm install/upgrade runtime baseline is now explicit: Node `>=22.22.2` is required when installing `@carlesandres/house` via npm, matching transitive engine requirements.

### Docs

- README now calls out the Node `>=22.22.2` requirement for npm-based install/upgrade.

### Tests

- CI now includes an npm global-install smoke matrix on Node `22.22.2` and Node `24` with `engine-strict=true`, catching runtime-floor regressions before release.

## [0.4.4] — 2026-05-24

### Added

- Discovery visibility controls: new `--show <list>` CLI flag, `HOUSE_SHOW` env var, and TOML `show = ["..."]` config, replacing boolean discovery toggles with explicit categories (`hidden`, `gitignored`).
- Session visibility toggle: `shift+a` flips discovery between the configured visibility set and showing all categories, preserving selection across the re-walk.

### Changed

- Discovery plumbing now uses a first-class visibility-category model so future categories can be added without reshaping CLI/config/TUI surfaces.

### Docs

- README updated for the discovery-show vocabulary (`--show`, `HOUSE_SHOW`, `show=[...]`) and the `shift+a` keybind.

## [0.4.3] — 2026-05-23

### Fixed

- Dependency alignment: bumped `effect` to `4.0.0-beta.70` to match `@effect/atom-react@4.0.0-beta.70`, removing npm `ERESOLVE overriding peer dependency` warnings during global installs.

## [0.4.2] — 2026-05-23

### Added

- Editor hand-off: press `E` to open the selected file in `$EDITOR`/`$VISUAL` (`#19`).
- Sidebar rows now render basename-first with segment-aware parent-path elision, improving scanability in deep trees.
- `ctrl+\\` clears an active sidebar filter query without leaving filter mode.

### Changed

- Sidebar filter input and command palette input now share a single `PromptRow` UI path for consistent rendering and behavior.

### Fixed

- Dev server SSE stream (`/__reload`) now stays open past Bun's 10s idle timeout.
- Filter Escape behavior no longer reverts to the pre-filter selection; Escape now closes/clears filter predictably.

### Docs

- README synced with current features, options, keys, and config behavior.
- Windows support is now documented as POSIX-only for this release line, with tracking issues linked.
- ROADMAP docs updated for release tooling and standalone-binary epic breakdown.

### Tests

- Added PTY regression coverage for selection background behavior.
- Added sidebar coverage for basename+parent rendering and `fitTail` behavior at very narrow widths.

## [0.4.1] — 2026-05-22

### Added

- Header chrome: borderless one-row identity strip above the panes carries the ⌂ brand mark and running version. Renders in both directory mode (Browser) and single-file mode (App). Hidden on terminals shorter than 20 rows so tight panes keep the reader breathable.

## [0.4.0] — 2026-05-21

### Added

- Command palette v1: `ctrl+p` opens a modal palette with visible browser commands derived from the keymap, including quit, sidebar toggle, help, filter, open-in-browser, and theme controls.
- Palette search uses a small tiered scorer so empty queries stay in keymap order while typed queries rank stronger title and word-boundary matches.

### Fixed

- Reader scroll focus is suspended while overlays are open, preventing palette arrow navigation from scrolling the markdown pane behind the modal.

### Tests

- Added command-palette interaction coverage plus scroll regression checks.

## [0.3.1] — 2026-05-17

Beta release gates (DESIGN §10.2) closed.

### Fixed

- Language-tagged fenced code blocks no longer disappear while markdown highlighting settles. `house` now uses opentui `0.2.12`, which includes markdown/code-block rendering fixes, and the browser pane no longer remounts markdown for one file while still holding another file's loaded content.
- Strikethrough text (`~~strike~~`) now renders distinctly (dim + muted foreground) instead of as plain body text. opentui's syntax-style API has no true strikethrough attribute; this is the closest visual we can produce, documented in DESIGN §5.1.

### Changed

- Reduced re-renders and allocations in `Browser` / `Footer` hot paths.
- DESIGN §10.2 test gate rephrased to target the integration surface house owns (the tree-sitter scope map) rather than re-testing opentui's renderer; `test/theme-syntax-map.test.ts` enforces scope coverage for every node type §5.1.3 promises.

### Docs

- README embeds a VHS-generated demo gif; `tape/` holds the source scripts.
- `CONTRIBUTING.md` documents the `captureSpans()` / `MockTreeSitterClient` / `TestRecorder` testing patterns and the "before blaming `<markdown>`" stale-watcher debugging checklist.

## [0.3.0] — 2026-05-16

### Changed

- **Project renamed from `openmdr` to `house`.** The npm package is now `@carlesandres/house`; `@carlesandres/openmdr` is deprecated and will not receive further releases. The CLI binary is now `house` (was `openmdr`). The GitHub repository moved to `https://github.com/carlesandres/house`; GitHub auto-redirects old URLs and issue/PR numbers are preserved. The theme schema file moved to `schema/house-theme.schema.json` and its `$id` is now a GitHub URL on the new repo.
- `/` is no longer reserved (DESIGN.md §7.3) — it now drives the filter input.

### Added

- `--sort <mode>` flag selecting the per-directory group order in the sidebar. `dirs-first` (the existing default) keeps directories above files; `files-first` flips it, surfacing top-level files like `README.md` before nested subtrees.
- `/` opens a filter input at the bottom of the sidebar. Typed characters narrow the list with a fuzzy subsequence match on the file's relative path; matches are re-ranked by score (word-boundary and consecutive-character bonuses). Esc clears the query and closes the filter; Return closes it and focuses the reader on the highlighted match.

## [0.2.1] — 2026-05-13

### Added

- Footer hint row in the browser pane, generated from the keymap so the visible hints stay in sync with the bindings.
- `ROADMAP.md` as the single index of planned work; footer/header chrome issues registered there.

### Changed

- Sidebar toggle rebound from `\` to `s`.
- Help overlay: theme keys (`t` / `T` / `L`) now cycle while the overlay is open; the help hint label switches to `close` while the overlay is showing.
- `DESIGN.md` §5.3 expanded with competitive-review gaps; keys reserved for history and bookmarks.

### Fixed

- Footer falls back to the bare first key on ultra-narrow viewports.
- `q` quit is stubbed on the help-open context (regression-tested).

## [0.2.0] — 2026-05-11

### Added — themes

- **33 bundled JSON themes** selectable via `--theme <id>`: `aura`, `ayu`, `carbonfox`, `catppuccin`, `catppuccin-frappe`, `catppuccin-macchiato`, `cobalt2`, `cursor`, `dracula`, `everforest`, `flexoki`, `github`, `gruvbox`, `kanagawa`, `lucent-orng`, `material`, `matrix`, `mercury`, `monokai`, `nightowl`, `nord`, `one-dark`, `opencode`, `orng`, `osaka-jade`, `palenight`, `rosepine`, `solarized`, `synthwave84`, `tokyonight`, `vercel`, `vesper`, `zenburn`. Token values sourced directly from each upstream's canonical palette via `dev/build-themes.ts`.
- **`--tone dark|light`** flag to select the variant of a theme. Defaults to `dark`. Not all themes have a well-tuned light variant; quality is best-effort for those.
- **JSON theme format**: each theme is a `{defs, theme: {dark, light}}` file validated against `schema/openmdr-theme.schema.json`. The format mirrors opencode's TUI theme shape; `defs` supports variable substitution.
- **`dev/build-themes.ts`**: fetches themes from the opencode GitHub API, strips diff tokens, resolves variables, and regenerates `src/theme/loader.ts`. Supports `GITHUB_TOKEN` and `--dry-run`. Not shipped in the npm package.
- **Runtime theme cycling**: press `t` / `T` to step forward / backward through all themes without restarting. Press `L` (shift+l) to toggle between dark and light tone. Works in both browser mode and single-file mode. Theme changes take effect immediately; syntax highlighting rebuilds with the new palette.

### Changed

- Theme system replaced: derivation engine (`derive.ts`) and the 12 TS-value themes removed in favour of the JSON format above. The `ColorPalette` interface is unchanged; existing consumers (`Browser`, `App`, `HelpOverlay`) required no changes beyond the re-render wiring.
- `--theme` default changed from `dark` to `opencode` (the opencode project's own palette).
- Effect Atoms (`@effect/atom-react`) wired for re-render signalling: `themeAtom` holds `{ id, tone }`; `RegistryProvider` wraps both render paths in `index.tsx`.

## [0.1.0] — 2026-05-10

The v1 MVP, published as `@carlesandres/openmdr` on npm.

### Added — TUI

- Two-pane browser: sidebar + reader, with a focus model, sidebar visibility toggle (`\`), and a `?` help overlay generated from the bindings array.
- Single-file mode when invoked on a file path.
- Themes: dark + light as typed `ColorPalette` values, mutable singleton consumer, selected via `--theme`.

### Added — discovery

- Recursive walk from the path argument (or cwd), `.md` / `.markdown` / `.mdx` only.
- Honors `.gitignore` (root + nested).
- Hard-skips `node_modules`, `.git`, `.venv` (always, even with `--all`).
- Does not follow symlinks.

### Added — CLI

- `--help`, `--version`, `--width <N>`, `--all`, `--theme <id>`.

### Added — keymap

- `KeyBinding[]` with `id` / `description` / `keys` / `group` / optional `when` / `run`. Single source for both `useKeyboard` dispatch and the help overlay.
- Bindings: `j`/`k` + arrows, shift-jump, page/half-page, `g`/`G`, `return`/`l`/`→`, `escape`/`h`/`←`, `[`/`]`, `tab`, `\`, `?`, `q`/`ctrl+c`. Reserved (not bound): `/`, `r`.

### Added — release infra

- Distribution as `@carlesandres/openmdr` on npm (Bun runtime required on user's `PATH`, no compiled binary). Modeled on ghui.
- `.github/workflows/ci.yml`: typecheck, lint, format:check, test, and `npm pack --dry-run` on every push and PR.
- `.github/workflows/publish.yml`: `release: published` triggers `npm publish` via Trusted Publisher (OIDC, no token), with a tag-vs-`package.json`-version assertion before publish.
- `.oxfmtrc.json`: pinned formatting so `format:check` is meaningful.

### Added — docs

- `DESIGN.md`: foundational design doc (13 sections; §3 non-goals, §5.3 deferred, §7.3 reserved keys, §10 v2 gates, §12 deferred patterns with triggers).
- `README.md`, `CONTRIBUTING.md`, `AGENTS.md` (cookbook for AI assistants), `LICENSE` (MIT).
- Issue templates (bug + feature + blank), PR template. All communication routes through GitHub issues.

### Added — tests

- 75 headless tests via `testRender` + `captureCharFrame` + `mockInput`.

### Out of scope (deliberate, see DESIGN.md §3 / §5.3)

Search, stdin, URL fetching, cross-file link following, `$EDITOR` hand-off, syntax highlighting, persistent config, OS-appearance auto-detect, single-binary distribution (issue [#2](https://github.com/carlesandres/openmdr/issues/2)), Homebrew tap. All tracked.

[Unreleased]: https://github.com/carlesandres/house/compare/v0.4.7...HEAD
[0.4.7]: https://github.com/carlesandres/house/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/carlesandres/house/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/carlesandres/house/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/carlesandres/house/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/carlesandres/house/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/carlesandres/house/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/carlesandres/house/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/carlesandres/house/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/carlesandres/house/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/carlesandres/house/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/carlesandres/house/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/carlesandres/house/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/carlesandres/house/releases/tag/v0.1.0
