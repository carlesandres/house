# Changelog

All notable changes to house land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from
v0.1.0 onward.

The publish workflow (`.github/workflows/publish.yml`) runs on the
`release: published` event, runs `npm publish` via Trusted Publisher,
and lets GitHub auto-generate release notes from commit subjects; this
file is the curated, narrative version.

## [Unreleased]

## [0.4.0] — 2026-05-21

### Added

- Command palette v1: `ctrl+p` opens a modal palette with visible browser
  commands derived from the keymap, including quit, sidebar toggle, help,
  filter, open-in-browser, and theme controls.
- Palette search uses a small tiered scorer so empty queries stay in keymap
  order while typed queries rank stronger title and word-boundary matches.

### Fixed

- Reader scroll focus is suspended while overlays are open, preventing palette
  arrow navigation from scrolling the markdown pane behind the modal.

### Tests

- Added command-palette interaction coverage plus scroll regression checks.

## [0.3.1] — 2026-05-17

Beta release gates (DESIGN §10.2) closed.

### Fixed

- Language-tagged fenced code blocks no longer disappear while markdown
  highlighting settles. `house` now uses opentui `0.2.12`, which includes
  markdown/code-block rendering fixes, and the browser pane no longer
  remounts markdown for one file while still holding another file's loaded
  content.
- Strikethrough text (`~~strike~~`) now renders distinctly (dim + muted
  foreground) instead of as plain body text. opentui's syntax-style API
  has no true strikethrough attribute; this is the closest visual we can
  produce, documented in DESIGN §5.1.

### Changed

- Reduced re-renders and allocations in `Browser` / `Footer` hot paths.
- DESIGN §10.2 test gate rephrased to target the integration surface
  house owns (the tree-sitter scope map) rather than re-testing opentui's
  renderer; `test/theme-syntax-map.test.ts` enforces scope coverage for
  every node type §5.1.3 promises.

### Docs

- README embeds a VHS-generated demo gif; `tape/` holds the source
  scripts.
- `CONTRIBUTING.md` documents the `captureSpans()` / `MockTreeSitterClient`
  / `TestRecorder` testing patterns and the "before blaming `<markdown>`"
  stale-watcher debugging checklist.

## [0.3.0] — 2026-05-16

### Changed

- **Project renamed from `openmdr` to `house`.** The npm package is now
  `@carlesandres/house`; `@carlesandres/openmdr` is deprecated and will
  not receive further releases. The CLI binary is now `house` (was
  `openmdr`). The GitHub repository moved to
  `https://github.com/carlesandres/house`; GitHub auto-redirects old
  URLs and issue/PR numbers are preserved. The theme schema file moved
  to `schema/house-theme.schema.json` and its `$id` is now a GitHub URL
  on the new repo.
- `/` is no longer reserved (DESIGN.md §7.3) — it now drives the filter
  input.

### Added

- `--sort <mode>` flag selecting the per-directory group order in the
  sidebar. `dirs-first` (the existing default) keeps directories above
  files; `files-first` flips it, surfacing top-level files like
  `README.md` before nested subtrees.
- `/` opens a filter input at the bottom of the sidebar. Typed
  characters narrow the list with a fuzzy subsequence match on the
  file's relative path; matches are re-ranked by score (word-boundary
  and consecutive-character bonuses). Esc clears the query and closes
  the filter; Return closes it and focuses the reader on the highlighted
  match.

## [0.2.1] — 2026-05-13

### Added

- Footer hint row in the browser pane, generated from the keymap so the
  visible hints stay in sync with the bindings.
- `ROADMAP.md` as the single index of planned work; footer/header chrome
  issues registered there.

### Changed

- Sidebar toggle rebound from `\` to `s`.
- Help overlay: theme keys (`t` / `T` / `L`) now cycle while the overlay
  is open; the help hint label switches to `close` while the overlay is
  showing.
- `DESIGN.md` §5.3 expanded with competitive-review gaps; keys reserved
  for history and bookmarks.

### Fixed

- Footer falls back to the bare first key on ultra-narrow viewports.
- `q` quit is stubbed on the help-open context (regression-tested).

## [0.2.0] — 2026-05-11

### Added — themes

- **33 bundled JSON themes** selectable via `--theme <id>`: `aura`, `ayu`,
  `carbonfox`, `catppuccin`, `catppuccin-frappe`, `catppuccin-macchiato`,
  `cobalt2`, `cursor`, `dracula`, `everforest`, `flexoki`, `github`,
  `gruvbox`, `kanagawa`, `lucent-orng`, `material`, `matrix`, `mercury`,
  `monokai`, `nightowl`, `nord`, `one-dark`, `opencode`, `orng`,
  `osaka-jade`, `palenight`, `rosepine`, `solarized`, `synthwave84`,
  `tokyonight`, `vercel`, `vesper`, `zenburn`. Token values sourced
  directly from each upstream's canonical palette via
  `dev/build-themes.ts`.
- **`--tone dark|light`** flag to select the variant of a theme. Defaults
  to `dark`. Not all themes have a well-tuned light variant; quality is
  best-effort for those.
- **JSON theme format**: each theme is a `{defs, theme: {dark, light}}`
  file validated against `schema/openmdr-theme.schema.json`. The format
  mirrors opencode's TUI theme shape; `defs` supports variable
  substitution.
- **`dev/build-themes.ts`**: fetches themes from the opencode GitHub API,
  strips diff tokens, resolves variables, and regenerates `src/theme/loader.ts`.
  Supports `GITHUB_TOKEN` and `--dry-run`. Not shipped in the npm package.
- **Runtime theme cycling**: press `t` / `T` to step forward / backward
  through all themes without restarting. Press `L` (shift+l) to toggle
  between dark and light tone. Works in both browser mode and single-file
  mode. Theme changes take effect immediately; syntax highlighting
  rebuilds with the new palette.

### Changed

- Theme system replaced: derivation engine (`derive.ts`) and the 12
  TS-value themes removed in favour of the JSON format above. The
  `ColorPalette` interface is unchanged; existing consumers (`Browser`,
  `App`, `HelpOverlay`) required no changes beyond the re-render wiring.
- `--theme` default changed from `dark` to `opencode` (the opencode
  project's own palette).
- Effect Atoms (`@effect/atom-react`) wired for re-render signalling:
  `themeAtom` holds `{ id, tone }`; `RegistryProvider` wraps both render
  paths in `index.tsx`.

## [0.1.0] — 2026-05-10

The v1 MVP, published as `@carlesandres/openmdr` on npm.

### Added — TUI

- Two-pane browser: sidebar + reader, with a focus model, sidebar
  visibility toggle (`\`), and a `?` help overlay generated from the
  bindings array.
- Single-file mode when invoked on a file path.
- Themes: dark + light as typed `ColorPalette` values, mutable singleton
  consumer, selected via `--theme`.

### Added — discovery

- Recursive walk from the path argument (or cwd), `.md` / `.markdown` /
  `.mdx` only.
- Honors `.gitignore` (root + nested).
- Hard-skips `node_modules`, `.git`, `.venv` (always, even with `--all`).
- Does not follow symlinks.

### Added — CLI

- `--help`, `--version`, `--width <N>`, `--all`, `--theme <id>`.

### Added — keymap

- `KeyBinding[]` with `id` / `description` / `keys` / `group` / optional
  `when` / `run`. Single source for both `useKeyboard` dispatch and the
  help overlay.
- Bindings: `j`/`k` + arrows, shift-jump, page/half-page, `g`/`G`,
  `return`/`l`/`→`, `escape`/`h`/`←`, `[`/`]`, `tab`, `\`, `?`,
  `q`/`ctrl+c`. Reserved (not bound): `/`, `e`, `o`, `r`.

### Added — release infra

- Distribution as `@carlesandres/openmdr` on npm (Bun runtime required
  on user's `PATH`, no compiled binary). Modeled on ghui.
- `.github/workflows/ci.yml`: typecheck, lint, format:check, test,
  and `npm pack --dry-run` on every push and PR.
- `.github/workflows/publish.yml`: `release: published` triggers
  `npm publish` via Trusted Publisher (OIDC, no token), with a
  tag-vs-`package.json`-version assertion before publish.
- `.oxfmtrc.json`: pinned formatting so `format:check` is meaningful.

### Added — docs

- `DESIGN.md`: foundational design doc (13 sections; §3 non-goals,
  §5.3 deferred, §7.3 reserved keys, §10 v2 gates, §12 deferred
  patterns with triggers).
- `README.md`, `CONTRIBUTING.md`, `AGENTS.md` (cookbook for AI
  assistants), `LICENSE` (MIT).
- Issue templates (bug + feature + blank), PR template. All
  communication routes through GitHub issues.

### Added — tests

- 75 headless tests via `testRender` + `captureCharFrame` +
  `mockInput`.

### Out of scope (deliberate, see DESIGN.md §3 / §5.3)

Search, stdin, URL fetching, cross-file link following, `$EDITOR`
hand-off, syntax highlighting, persistent config, OS-appearance
auto-detect, single-binary distribution (issue
[#2](https://github.com/carlesandres/openmdr/issues/2)),
Homebrew tap. All tracked.

[Unreleased]: https://github.com/carlesandres/house/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/carlesandres/house/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/carlesandres/house/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/carlesandres/house/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/carlesandres/house/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/carlesandres/house/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/carlesandres/house/releases/tag/v0.1.0
