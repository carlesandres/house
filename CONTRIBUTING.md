# Contributing to house

Thanks for considering a contribution. house is a small project; the bar for changes is "reads cleanly, fits the design, doesn't accidentally bind a reserved key." This doc covers the local loop and the rules that aren't obvious from the code.

Read [`DESIGN.md`](./DESIGN.md) before opening a PR that adds a feature. §3 lists hard non-goals, §5.3 lists what's deliberately deferred, and §7.3 lists keys reserved for v2.

All project communication happens in **GitHub issues** — bugs, feature requests, design questions, scope debates. There is no Discussions tab, no Discord, no chat. If you're not sure whether something is a bug or by design, open an issue.

If you're an AI assistant pairing on this repo, also read [`AGENTS.md`](./AGENTS.md) — it's the cookbook for the moves (commands, release process, things-not-to-do).

## Local loop

```bash
bun install
bun run dev [path]      # watch + run from source; positional seeds filter, use --root <dir> to browse a directory
bun test                # House app tests (root bunfig.toml scope)
bun run test            # all workspace tests through Turbo
bun run --cwd packages/ui test # reusable UI package tests only
bun run --cwd packages/options test # options catalog / session tests
bun run typecheck
bun run lint
bun run format          # write
bun run format:check    # check (CI uses this)

bun run --cwd apps/house bench:file-navigator
bun run build:standalone
bun run --cwd apps/house smoke:file-navigator:standalone
bun run --cwd apps/house smoke:file-navigator:installed
bun run npm:pack        # stage the app package and show exactly what would ship to npm
bun run verify:github   # exercise release APIs against vercel-labs/emulate
```

`bench:file-navigator --record` rewrites
`apps/house/recordings/file-navigator-production-benchmark.json` with raw old/current 1k, 5k, and 10k
trials. Keep the deterministic fixture and report first-visible/completion, scan transactions, React
snapshots/commits, reader reads, event batches/snapshot publications, CPU/RSS, and mixed-burst latency. Old live
mutation metrics remain unsupported because pre-migration production had no watcher.

Any PR has to pass `typecheck`, `lint`, `format:check`, `test`, `npm:pack`, and the
GitHub emulator verification — that's what `.github/workflows/ci.yml` enforces.

The File Navigator smoke commands invoke the built House artifact's private headless mode; they do not
compile a workspace-only substitute. Installed mode packs the staged main and host platform packages
into a temporary npm prefix unless CI supplies its already-installed `house` path. Artifact execution
removes Bun from `PATH` and exercises the embedded static Parcel binding through filesystem mutations.

Versioned Git hooks live in `.githooks/`. `bun install` activates them (the `prepare` script in `package.json` sets `core.hooksPath`). The pre-commit hook runs `format:check` and `lint` so the cheap CI gates don't bite you on PR review. The pre-push hook fetches `origin/main` and blocks stale branch pushes; it is only a safeguard and does not merge, rebase, or run tests. If a hook blocks, prefer fixing the underlying issue over bypassing it.

## Project layout

See `DESIGN.md` §9.1 for the module map. The root is a private Bun workspace and Turborepo
orchestrator; the publishable app lives in `apps/house`, while reusable controlled OpenTUI
components live in the private `packages/ui` source package:

- `apps/house/src/cli/` — argv parsing
- `apps/house/src/discovery/` — root resolution, show policy, and root labels
- `apps/house/src/io/` — file reads (Effect)
- `apps/house/src/keymap/` — declarative bindings + dispatch
- `apps/house/src/theme/` — typed palette + mutable singleton
- `apps/house/src/Browser.tsx`, `apps/house/src/index.tsx` — TUI
- `apps/house/test/` — tests; the root `bunfig.toml` keeps direct `bun test` scoped here
- `apps/house/dev/` — build, release, smoke, and benchmark scripts
- `packages/ui/src/sidebar/` — filesystem-free generic sidebar presentation
- `packages/ui/src/file-navigator/` — policy-aware scanner, watcher, projection, selection, and rendering
- `packages/ui/test/` — package-local navigator and headless render tests
- `packages/options/` — catalog, layered resolve, and runtime session for CLI/env/config-seeded options
- `apps/house/src/config/options.ts` — House's scalar options catalog consumed by load + Browser

## Testing

The headless test pattern is documented in `apps/house/test/browser.test.tsx`. Use `testRender` + `captureCharFrame` + `mockInput`. When asserting on `<markdown>` body content, prefer asserting on stable surfaces (border titles, sidebar rows) — the markdown body has first-frame quirks in headless render.

Direct `bun test` remains intentionally scoped to `apps/house/test` by the root `bunfig.toml`. Use
`bun run test` for the CI-equivalent all-workspace test gate, or
`bun run --cwd packages/ui test` while iterating on the reusable package.

Native backend feasibility probes are intentionally outside the release gate now that their durable
evidence is recorded and exact House artifacts run the mutation matrix. Use
`bun run --cwd packages/ui evidence:parcel` for the approved Parcel experiments or
`bun run --cwd packages/ui evidence:rejected-backend` for Chokidar; either empirical command can fail
when the host does not reproduce its recorded result. The normal suite still validates topology,
evidence parsing, core synchronization, and the active release path.

Add tests alongside features. We don't enforce coverage, but every keymap binding should have at least one integration test (see §10.2 of DESIGN.md for the v2 gate).

For reader empty-state guidance, test the product contract rather than the exact source shape: the footer should continue to reflect currently actionable controls, while the reader tips should read like short English guidance about features/workflows and usually mention the relevant key inside the sentence. Only one reader tip should appear at a time; tips are ordered by relevance and rotate each time the reader empty state appears. Prefer asserting on representative sentences in the generic empty state and the zero-match filtered state, plus at least one leave/re-enter rotation check.

### Validating rendered output deeper than text

`captureCharFrame()` returns characters only. For bugs where the character is correct but the _style_ isn't — code block rendered with `bg == fg` so it looks invisible, span dropped to zero width, wrong attribute applied — reach for `captureSpans()` instead. It returns `{ cols, rows, cursor, lines: [{ spans: [{ text, fg, bg, attributes, width }] }] }`, which lets you assert on colors and widths.

Three other primitives from `@opentui/core/testing` are worth knowing:

- `renderer.idle()` — awaits _all_ pending async work (tree-sitter highlights, layout reflow). Prefer this over a loop of `renderOnce()` whenever the component you're testing kicks off async work. `renderOnce()` only flushes one paint; `idle()` waits for the system to actually settle.
- `MockTreeSitterClient` — pass it via the `treeSitterClient` prop on `<markdown>` (or any `<code>`) to take the highlighter out of the loop. `setMockResult({ highlights, warning })` controls what `highlightOnce` returns, and `resolveAllHighlightOnce()` releases pending calls on demand. This is how you simulate "no parser for this language" deterministically. Real wasm loading is flaky in tests; mocking it is not.
- `TestRecorder` — `new TestRecorder(renderer); recorder.rec(); ... recorder.stop()` captures every intermediate frame. Use it when you suspect a "renders then disappears" race, or when you need to compare frame _N_ vs. frame _N+1_.

`apps/house/test/markdown-codeblock.test.tsx` is the worked example. opentui's own `Markdown.code-colors.test.ts` (under `reference/opentui/`) is the canonical pattern reference.

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

Tagged fenced-code blocks are covered by `apps/house/test/markdown-codeblock.test.tsx`. If a future opentui upgrade regresses them, prefer a focused upstream-style reproducer over adding a custom parser or custom `renderNode` tree.

## Keymap changes

Bindings are data: `apps/house/src/keymap/browser.ts` is the single source for `useKeyboard` and command-palette derivation. To add a binding, append a `KeyBinding` to `browserBindings` with `id`, `description`, `keys`, an optional `group`, optional `when` predicate, and `run`. Only add `hint` for the small fixed footer set of essential app controls; otherwise rely on the palette for discoverability.

Do not bind these keys — they are reserved for v2 (DESIGN.md §7.3): `/`, `r`.

## Themes

A theme resolves from opencode-style JSON into the typed token surface in `apps/house/src/theme/types.ts`, then into the `ColorPalette` singleton. The exposed UI tokens keep OpenCode's naming (`background`, `backgroundPanel`, `backgroundElement`, `borderSubtle`, `primary`, `secondary`, etc.). To add one: drop a new JSON file in `apps/house/src/theme/themes/` and register it in `apps/house/src/theme/loader.ts`.

Before using a token in UI code, check DESIGN.md §7.5's semantic token table. Tokens are role-based: choose by intended meaning, not by the color a single bundled theme happens to render. In particular: section/category headers should usually be `textMuted` (optionally bold), while selected interactive rows should use `backgroundElement` plus `primary`/`selectedListItemText`.

## Demo recordings

`apps/house/recordings/` holds the `termctrl` recording workflow used to capture house running for the README hero asset.

```bash
brew install termctrl ffmpeg          # one-time
bun run --cwd apps/house record-demo  # → apps/house/recordings/house-demo.mp4
```

The recorder starts from a clean `zsh` session, types `house`, drives the demo via `termctrl send`, and exports `apps/house/recordings/house-demo.mp4`. Tweak timing, terminal size, or key flow in `apps/house/recordings/record-demo.sh`. Inside the demo, `t` cycles house's theme.

After regenerating, commit the asset and update the embed in `README.md`.

## Patterns we deliberately did not adopt

DESIGN.md §12 records design choices we deferred and the trigger that should bring each one back. If you're tempted to land one of those patterns, check that the trigger has fired — or update §12 with a new one.

## Commits, branches, PRs

- Branch off `main`. Force-pushes to `main` are not allowed.
- Commit messages: imperative, lowercase prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `ci:`, `chore:`, `build:`, `test:`). The one-line subject is the contract; bodies are encouraged when the _why_ isn't obvious.
- PR titles match the same shape. Keep PRs small enough to review in one sitting.

## Update notifier

When a newer published version is available on npm, house prints a one-line notice in the footer at startup and a copy-pasteable upgrade tip on quit. The check is opt-out: set `NO_UPDATE_NOTIFIER=1` (any non-empty, non-`0` value works) or pass `--no-update-check`. The check is also skipped under CI (any non-empty `CI` value).

## Release flow

Releases are event-driven. See `AGENTS.md` for the maintainer runbook,
`apps/house/dev/release.ts` for the guarded automation, and
`.github/workflows/publish.yml` for publishing.

1. Compare first-parent commits since the latest tag with `[Unreleased]` in
   `CHANGELOG.md`. Keep outcome-focused notes for user- and maintainer-visible
   changes; the release command moves them under the dated version heading.
2. From a clean, current `main`, dry-run and then run `bun run release -- patch`
   (also `minor`, `major`, or an explicit stable version). It creates and merges
   the release PR, creates the GitHub Release at the merge SHA, and watches publish.
   Creating the GitHub Release is the approval; the `npm` environment allows only
   `v*` tags and `main`, with no reviewer click.
3. Verify all five npm package versions and four release assets.

`version:set` updates the app version and its `bun.lock` workspace entry. It
deliberately leaves monorepo platform pins on their last-published versions;
the staged public manifest pins all four platform packages to the release version.
Publishing uses Trusted Publisher/OIDC, never an `NPM_TOKEN`. The four platform
packages provide native executables; the main package provides the Node shim and
bundled application source.

## License

By contributing, you agree your contribution is licensed under MIT, the same as the rest of the project.
