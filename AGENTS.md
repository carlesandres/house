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
- Bindings live in `src/keymap/browser.ts` as data. Adding a key: append a `KeyBinding`, the `?` overlay picks it up. Reserved keys (`/`, `e`, `o`, `r`) are off-limits in v1.
- Themes are typed `ColorPalette` values (`src/theme/types.ts`) consumed via the mutable singleton `colors`. Pattern lifted from ghui at small scale; do not introduce React Context for theme.

## Headless test pattern

`testRender` + `captureCharFrame` + `mockInput` (see `test/spike.test.tsx`). When asserting on `<markdown>` body content, prefer stable surfaces (border titles, sidebar rows) — the markdown body has first-frame quirks under headless render. Some keys (Escape) need a ~60ms wait after press for opentui's parser to disambiguate `\x1b`.

For deeper output validation (styled spans, async highlight pipelines, intermediate frames) use `captureSpans()`, `renderer.idle()`, `MockTreeSitterClient`, and `TestRecorder` — all from `@opentui/core/testing`. Worked example: `test/markdown-codeblock.test.tsx`. Full notes in `CONTRIBUTING.md` under "Validating rendered output deeper than text". Don't reach for PTY-based testing — `captureSpans` covers every case we have today.

If `bun dev` and `bun run dev` seem to differ, check for stale watcher processes before changing renderer code. Both resolve to the `dev` script, but orphaned `bun --watch src/index.tsx ...` processes can keep showing old behavior. Use `ps ... | rg 'bun (run )?dev|bun --watch src/index.tsx|src/index.tsx'` and `lsof -a -p <pid> -d cwd` to verify.

For fenced code blocks, rely on opentui's built-in `<markdown>` renderer and keep `test/markdown-codeblock.test.tsx` covering tagged fences. Do not replace the markdown renderer or reintroduce a broad `renderNode` override unless DESIGN.md §12's custom-renderer trigger has fired.

## Local commands

```bash
bun run dev <path>      # watch + run from source
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

1. Move `[Unreleased]` items in `CHANGELOG.md` under a new `## [X.Y.Z] — YYYY-MM-DD` heading; update the link refs at the bottom of the file.
2. Bump `version` in `package.json`.
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
   - runs `bun run typecheck`,
   - asserts `v${package.version}` matches `${GITHUB_REF_NAME}`,
   - runs `npm pack --dry-run`,
   - runs `npm publish` (Trusted Publisher / OIDC; no `NPM_TOKEN`).

   If the `npm` GitHub environment has required reviewers, the publish job pauses at "Waiting for reviewer" — approve via the run's web page or `gh run view <id> --web`.

8. Watch and verify:

   ```bash
   gh run list --workflow publish.yml --limit 3
   gh run watch
   npm view @carlesandres/house version    # should equal X.Y.Z
   ```

There is no compiled binary, no Homebrew tap yet — both tracked as GitHub issues. Don't add an `NPM_TOKEN`-style secret; the npm-side config uses Trusted Publisher with owner `carlesandres`, repo `house`, workflow `publish.yml`, environment `npm`.

## Things that are *not* the right move

- Re-introducing a deferred pattern (DESIGN.md §12) without checking whether its trigger has fired.
- Adding a feature on the deferred list (§5.3) without an issue agreeing to do it now.
- Binding a reserved key (§7.3) — break it and v2 work has to re-train muscle memory.
- Adding `// TODO`s without the `(revisit: <topic>)` form when they pair with a §12 entry.
- Compiling to a standalone binary as part of the release flow. We ship JS source via npm; the user brings Bun. Binary distribution is a future option tracked as a GH issue, not a near-term move.
- Amending or force-pushing commits on `main`.

## Communication

All project communication happens in **GitHub issues**. There is no Discussions tab, no chat. If something feels ambiguous, open an issue.
