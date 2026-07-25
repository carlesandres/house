# Repository Notes

Notes for AI assistants (and humans) working in this repo. This file is about *the moves*, not the design — read `DESIGN.md` for what the project is and `CONTRIBUTING.md` for the human-contributor view.

## Where to read first

- `DESIGN.md` — scope, non-goals (§3), deferred features (§5.3), reserved keys (§7.3), v2 gates (§10), **deferred patterns with triggers (§12)**. Always check §12 before re-introducing a pattern that "feels missing" — there is probably a documented reason it isn't there yet.
- `CONTRIBUTING.md` — local loop, testing, commit/PR shape, release flow.
- `CHANGELOG.md` — what's queued under `[Unreleased]`. New work appends here; release time moves it under a dated heading.

## Docs split

- `README.md` is **user-oriented**: what house is, install, usage, keys, configuration surface. Keep the top focused on users and features, not implementation. No internals, no env-var matrices for niche behaviors, no contributor instructions.
- `CONTRIBUTING.md` is **developer-oriented**: local loop, testing, commit/PR shape, release flow, and any implementation detail a user doesn't need to read.
- When tempted to add an implementation paragraph to the README, put it in `CONTRIBUTING.md` (or `DESIGN.md` if it's about scope/intent) instead.

## Conventions worth knowing

- Format: **tabs, no semicolons, 100-col, trailing commas** (see `.oxfmtrc.json`). `bun run format` writes; CI gates on `format:check`.
- Test root: `bunfig.toml` pins `[test] root = "test"` so `bun test` doesn't crawl `reference/`.
- `TODO(revisit: <topic>)` markers in source point back at `DESIGN.md` §12. `grep -r 'TODO(revisit:' src/` lists them.
- Bindings live in `src/keymap/browser.ts` as data. Adding a key: append a `KeyBinding`, the `?` overlay picks it up. Reserved keys (`/`, `r`) are off-limits in v1.
- Themes resolve into typed semantic tokens (`src/theme/types.ts`) consumed via the mutable singleton `colors`. Pattern lifted from ghui at small scale; do not introduce React Context for theme. Before adding or changing token usage, check DESIGN.md §7.5's token table and choose by semantic role, not by a single theme's color.
- The Browser is the only non-serve render target. Sidebar contents are always `filter(discoveredPool, query)`; do not imperatively push entries into the sidebar. See `DESIGN.md` §7.4 before touching root/query/selection behavior.

## Headless test pattern

`testRender` + `captureCharFrame` + `mockInput` (see `test/spike.test.tsx`). When asserting on `<markdown>` body content, prefer stable surfaces (border titles, sidebar rows) — the markdown body has first-frame quirks under headless render. Some keys (Escape) need a ~60ms wait after press for opentui's parser to disambiguate `\x1b`.

For deeper output validation (styled spans, async highlight pipelines, intermediate frames) use `captureSpans()`, `renderer.idle()`, `MockTreeSitterClient`, and `TestRecorder` — all from `@opentui/core/testing`. Worked example: `test/markdown-codeblock.test.tsx`. Full notes in `CONTRIBUTING.md` under "Validating rendered output deeper than text". Don't reach for PTY-based testing — `captureSpans` covers every case we have today.

If `bun dev` and `bun run dev` seem to differ, check for stale watcher processes before changing renderer code. Both resolve to the `dev` script, but orphaned `bun --watch src/index.tsx ...` processes can keep showing old behavior. Use `ps ... | rg 'bun (run )?dev|bun --watch src/index.tsx|src/index.tsx'` and `lsof -a -p <pid> -d cwd` to verify.

For fenced code blocks, rely on opentui's built-in `<markdown>` renderer and keep `test/markdown-codeblock.test.tsx` covering tagged fences. Do not replace the markdown renderer or reintroduce a broad `renderNode` override unless DESIGN.md §12's custom-renderer trigger has fired.

## termctrl

`termctrl` is available locally and is useful for debugging or testing terminal behavior outside the headless render harness. Use it to start persistent PTY sessions, send ordered input, wait for visible text, inspect the current screen, capture logs/screens, and export session videos when reproducing TUI issues or documenting behavior. When you need to explore its capabilities or exact flags, start with `termctrl --help` and then inspect the relevant subcommand help.

## Local commands

```bash
bun run dev [path]      # watch + run from source; positional seeds filter, use --root <dir> to browse a directory
bun test                # 75 tests, all headless
bun run typecheck
bun run lint
bun run format
bun run format:check
bun run dev/bench-markdown.ts <dir>   # microbench
npm pack --dry-run      # show exactly what would land on npm
```

## Release process

Release-event-driven. Modeled on ghui, adapted for this repo's branch protection (direct commits to `main` are blocked, every change goes through a PR).

1. Build release notes from `main` commits since the last tag before touching versions.
   - Start with `[Unreleased]` in `CHANGELOG.md`.
   - Then run `git log --first-parent --oneline vX.Y.Z..origin/main` (where `vX.Y.Z` is the latest tag) and verify every user-visible change is represented.
   - If `[Unreleased]` is empty or incomplete, reconstruct it from that commit range first, then move it under a new `## [X.Y.Z] — YYYY-MM-DD` heading.
   - Update the link refs at the bottom of the file.
2. Run `bun run version:set X.Y.Z` to bump the main package, all platform package pins, and `bun.lock` together.
3. From `main`, branch off (`git checkout -b release/vX.Y.Z`), commit (`chore: release vX.Y.Z`) — do **not** amend earlier commits — and push the branch.
4. Open a PR into `main` titled `chore: release vX.Y.Z`. Wait for CI to be green (typecheck + lint + format:check + test + `npm pack --dry-run`). Merge.
5. Pull `main` locally so the release commit is at `origin/main`'s tip:

   ```bash
   git checkout main && git pull --ff-only
   ```

6. Create a GitHub release at tag `vX.Y.Z` (auto-generated notes are fine; you can curate before publishing):

   ```bash
   gh release create vX.Y.Z --target main --title "vX.Y.Z" \
     --generate-notes
   ```

7. The `release: published` event fires `.github/workflows/publish.yml`, which:
   - verifies typecheck + `npm pack --dry-run` and asserts `v${package.version}` matches `${GITHUB_REF_NAME}`,
   - builds each platform binary on a native runner (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`),
   - publishes the four `@carlesandres/house-<os>-<arch>` packages first,
   - publishes `@carlesandres/house` (Node shim + `optionalDependencies`),
   - attaches `house-*.tar.gz` standalone archives to the GitHub Release.

The guarded one-command equivalent is `bun run release -- patch` (also `minor`, `major`, or an explicit stable version). Add `--dry-run` to plan without changes or `--yes` to skip confirmation. It performs the preflight, release branch/PR, CI wait, merge, GitHub release, and publish workflow watch. Required approval for the `npm` GitHub environment remains manual: approve the publish job in GitHub when it pauses.

If the `npm` GitHub environment has required reviewers, the **publish** job pauses at "Waiting for reviewer" — approve via the run's web page or `gh run view <id> --web`. Matrix build jobs do not use that environment.

8. Watch and verify:

   ```bash
   gh run list --workflow publish.yml --limit 3
   gh run watch
   npm view @carlesandres/house version              # should equal X.Y.Z
   npm view @carlesandres/house-darwin-arm64 version # same for the other three platform packages
   npm install -g @carlesandres/house                # no Bun required on supported platforms
   house --version
   ```

Don't add an `NPM_TOKEN`-style secret. Publish uses Trusted Publisher / OIDC with owner `carlesandres`, repo `house`, workflow `publish.yml`, environment `npm`.

**Trusted Publisher must be configured for every package name** that the workflow publishes:

- `@carlesandres/house` (already configured)
- `@carlesandres/house-darwin-arm64`
- `@carlesandres/house-darwin-x64`
- `@carlesandres/house-linux-arm64`
- `@carlesandres/house-linux-x64`

For each new platform package: create it once under the `@carlesandres` scope (or let the first OIDC publish create it if your npm org allows), then add a Trusted Publisher entry pointing at the same owner/repo/workflow/environment as the main package. Until those entries exist, the publish job will fail when publishing the binary packages.

Homebrew tap is still deferred until this npm binary path is proven in a real release (issue #51).

## Things that are *not* the right move

- Re-introducing a deferred pattern (DESIGN.md §12) without checking whether its trigger has fired.
- Adding a feature on the deferred list (§5.3) without an issue agreeing to do it now.
- Binding a reserved key (§7.3) — break it and v2 work has to re-train muscle memory.
- Adding `// TODO`s without the `(revisit: <topic>)` form when they pair with a §12 entry.
- Publishing `@carlesandres/house` without first publishing the matching platform binary packages at the same version — the Node shim cannot run without them.
- Amending or force-pushing commits on `main`.

## Communication

All project communication happens in **GitHub issues**. There is no Discussions tab, no chat. If something feels ambiguous, open an issue.
