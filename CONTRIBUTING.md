# Contributing to house

Thanks for considering a contribution. house is a small project; the bar for changes is "reads cleanly, fits the design, doesn't accidentally bind a reserved key." This doc covers the local loop and the rules that aren't obvious from the code.

Read [`DESIGN.md`](./DESIGN.md) before opening a PR that adds a feature. §3 lists hard non-goals, §5.3 lists what's deliberately deferred, and §7.3 lists keys reserved for v2.

All project communication happens in **GitHub issues** — bugs, feature requests, design questions, scope debates. There is no Discussions tab, no Discord, no chat. If you're not sure whether something is a bug or by design, open an issue.

If you're an AI assistant pairing on this repo, also read [`AGENTS.md`](./AGENTS.md) — it's the cookbook for the moves (commands, release process, things-not-to-do).

## Local loop

```bash
bun install
bun run dev <path>      # watch + run from source
bun test                # full test suite
bun run typecheck
bun run lint
bun run format          # write
bun run format:check    # check (CI uses this)

npm pack --dry-run      # show exactly what would ship to npm
```

Any PR has to pass `typecheck`, `lint`, `format:check`, `test`, and `npm pack --dry-run` — that's what `.github/workflows/ci.yml` enforces.

A versioned pre-commit hook (`.githooks/pre-commit`) runs `format:check` and `lint` before each commit so the cheap CI gates don't bite you on PR review. `bun install` activates it (the `prepare` script in `package.json` sets `core.hooksPath`). If you ever need to bypass it, prefer fixing the underlying issue over `git commit --no-verify`.

## Project layout

See `DESIGN.md` §9.1 for the module map. In short:

- `src/cli/` — argv parsing
- `src/discovery/` — filesystem walk + `.gitignore`
- `src/io/` — file reads (Effect)
- `src/keymap/` — declarative bindings + dispatch
- `src/theme/` — typed palette + mutable singleton
- `src/Browser.tsx`, `src/HelpOverlay.tsx`, `src/index.tsx` — TUI
- `test/` — `bun test` runs only files under here (see `bunfig.toml`)
- `dev/` — build + smoke + bench scripts (not shipped)

## Testing

The headless test pattern is documented in `test/spike.test.tsx`. Use `testRender` + `captureCharFrame` + `mockInput`. When asserting on `<markdown>` body content, prefer asserting on stable surfaces (border titles, sidebar rows) — the markdown body has first-frame quirks in headless render.

Add tests alongside features. We don't enforce coverage, but every keymap binding should have at least one integration test (see §10.2 of DESIGN.md for the v2 gate).

### Validating rendered output deeper than text

`captureCharFrame()` returns characters only. For bugs where the character is correct but the *style* isn't — code block rendered with `bg == fg` so it looks invisible, span dropped to zero width, wrong attribute applied — reach for `captureSpans()` instead. It returns `{ cols, rows, cursor, lines: [{ spans: [{ text, fg, bg, attributes, width }] }] }`, which lets you assert on colors and widths.

Three other primitives from `@opentui/core/testing` are worth knowing:

- `renderer.idle()` — awaits *all* pending async work (tree-sitter highlights, layout reflow). Prefer this over a loop of `renderOnce()` whenever the component you're testing kicks off async work. `renderOnce()` only flushes one paint; `idle()` waits for the system to actually settle.
- `MockTreeSitterClient` — pass it via the `treeSitterClient` prop on `<markdown>` (or any `<code>`) to take the highlighter out of the loop. `setMockResult({ highlights, warning })` controls what `highlightOnce` returns, and `resolveAllHighlightOnce()` releases pending calls on demand. This is how you simulate "no parser for this language" deterministically. Real wasm loading is flaky in tests; mocking it is not.
- `TestRecorder` — `new TestRecorder(renderer); recorder.rec(); ... recorder.stop()` captures every intermediate frame. Use it when you suspect a "renders then disappears" race, or when you need to compare frame *N* vs. frame *N+1*.

`test/markdown-codeblock.test.tsx` is the worked example. opentui's own `Markdown.code-colors.test.ts` (under `reference/opentui/`) is the canonical pattern reference.

### When you reach for a PTY, stop

Spawning house under `script(1)` to capture real terminal output is slower, brittle, and gives you characters but not colors. The `captureSpans()` path above is strictly more powerful for everything we care about. Keep PTY-based testing in reserve for bugs that only manifest against a real terminal emulator (e.g. an OSC sequence the in-process renderer doesn't model) — and prefer adding a minimal reproducer to the opentui test suite over carrying a PTY harness here.

### Before changing markdown rendering

If `bun dev` and `bun run dev` appear to render differently, first check for stale watchers. Bun expands both forms to the package `dev` script when it exists, but old `bun --watch src/index.tsx ...` processes can survive as orphaned children after terminal/session timeouts and keep showing pre-fix code.

Use this before changing renderer code:

```bash
ps -axo pid,ppid,lstart,command | rg 'bun (run )?dev|bun --watch src/index.tsx|src/index.tsx'
```

Then inspect any suspicious process with:

```bash
lsof -a -p <pid> -d cwd
```

Do not replace opentui's markdown renderer wholesale just because a running TUI looks stale. First reproduce in-process with `testRender`, `renderer.idle()`, and `captureSpans()` against the current checkout.

Tagged fenced-code blocks are covered by `test/markdown-codeblock.test.tsx`. If a future opentui upgrade regresses them, prefer a focused upstream-style reproducer over adding a custom parser or custom `renderNode` tree.

## Keymap changes

Bindings are data: `src/keymap/browser.ts` is the single source for `useKeyboard` *and* the `?` help overlay. To add a binding, append a `KeyBinding` to `browserBindings` with `id`, `description`, `keys`, an optional `group`, optional `when` predicate, and `run`. The help overlay picks it up automatically.

Do not bind these keys — they are reserved for v2 (DESIGN.md §7.3): `/`, `e`, `o`, `r`.

## Themes

A theme is a `ColorPalette` value (see `src/theme/types.ts`). To add one: drop a new file in `src/theme/`, register it in `src/theme/registry.ts`, and add it to the `--theme` validation in `src/cli/argv.ts`. v2 has user-supplied stylesheets on the deferred list; until then, themes are TS values shipped with the binary.

## Demo recordings

`tape/` holds [VHS](https://github.com/charmbracelet/vhs) scripts that capture house running, for use as README hero assets.

```bash
brew install vhs            # one-time
vhs tape/house.tape         # → tape/house.gif (animated demo)
vhs tape/screenshot.tape    # → tape/house.png (still)
```

Both tapes invoke `bun run src/index.tsx .` against the repo's own markdown, so they don't need a published build or sample data. Tweak `Set Width` / `Set Height` / `Set FontSize` / `Sleep` durations inside the tape; change the `Output` extension (`.gif`, `.mp4`, `.webm`, `.png`) to switch format. Inside the tape, `Type "t"` cycles house's theme — distinct from `Set Theme`, which sets the *terminal* theme around it.

After regenerating, commit the asset and update the embed in `README.md`.

## Patterns we deliberately did not adopt

DESIGN.md §12 records design choices we deferred and the trigger that should bring each one back. If you're tempted to land one of those patterns, check that the trigger has fired — or update §12 with a new one.

## Commits, branches, PRs

- Branch off `main`. Force-pushes to `main` are not allowed.
- Commit messages: imperative, lowercase prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `ci:`, `chore:`, `build:`, `test:`). The one-line subject is the contract; bodies are encouraged when the *why* isn't obvious.
- PR titles match the same shape. Keep PRs small enough to review in one sitting.

## Update notifier

When a newer published version is available on npm, house prints a one-line notice in the footer at startup and a copy-pasteable upgrade tip on quit. The check is opt-out: set `NO_UPDATE_NOTIFIER=1` (any non-empty, non-`0` value works) or pass `--no-update-check`. The check is also skipped under CI (any non-empty `CI` value).

## Release flow

Release-event-driven. See `.github/workflows/publish.yml` and the more detailed step-by-step in `AGENTS.md`. Quick version:

1. Move `[Unreleased]` items in `CHANGELOG.md` under a new dated heading; update link refs.
2. Bump `version` in `package.json`.
3. Branch off `main` (e.g. `release/vX.Y.Z`), commit `chore: release vX.Y.Z`, push, open a PR into `main`. Wait for CI; merge. Direct commits to `main` are blocked by branch protection.
4. After merge, pull `main` locally, then `gh release create vX.Y.Z --target main --title vX.Y.Z --generate-notes` — the workflow takes it from there (`npm publish` via Trusted Publisher).

The release workflow builds on five runners (mac arm64/x64, linux arm64/x64, windows x64), runs smoke on each, and attaches archives to a GitHub release with auto-generated notes. There is no npm or Homebrew distribution yet — see DESIGN.md §10.5.

## License

By contributing, you agree your contribution is licensed under MIT, the same as the rest of the project.
