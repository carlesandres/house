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
- Test root: the root `bunfig.toml` pins `[test] root = "apps/house/test"` so direct `bun test` stays inside the app. `bun run test` runs each workspace package's tests through Turbo.
- Scalar options (CLI + env + file initial values) are declared in `apps/house/src/config/options.ts` via `@house/options`. Add the spec there and thread layers through `loadConfig`. Browser holds a session for runtime wrap/theme/tone; file-policy keys persist via `persistHouseOption`. Do not add per-key parse helpers for catalog keys. Lists (`show`, `extensions`) stay on Effect Config. The package itself stays agnostic of TOML, Commander, and Effect ConfigProvider.
- `TODO(revisit: <topic>)` markers in source point back at `DESIGN.md` §12. `grep -r 'TODO(revisit:' apps/house/src/` lists them.
- Bindings live in `apps/house/src/keymap/browser.ts` as data. Adding a key: append a `KeyBinding`; the command palette (and footer hints that opt in) derive from the same array. Reserved keys (`r`, and §7.3’s remaining reservations) are off-limits in v1; `/` is the filter opener.
- Themes resolve into typed semantic tokens (`apps/house/src/theme/types.ts`) consumed via the mutable singleton `colors`. Pattern lifted from ghui at small scale; do not introduce React Context for theme. Before adding or changing token usage, check DESIGN.md §7.5's token table and choose by semantic role, not by a single theme's color.
- The Browser is the only non-serve render target. `@house/ui/file-navigator` owns scanner membership,
  filtering, and selection; its rendered collection is always the projection of the discovered pool and
  query. Do not imperatively push entries into the generic `@house/ui/sidebar`. See `DESIGN.md` §7.4
  before touching root/query/selection behavior.

## Headless test pattern

`testRender` + `captureCharFrame` + `mockInput` (see `apps/house/test/browser.test.tsx`). When asserting on `<markdown>` body content, prefer stable surfaces (border titles, sidebar rows) — the markdown body has first-frame quirks under headless render. Some keys (Escape) need a ~60ms wait after press for opentui's parser to disambiguate `\x1b`.

For deeper output validation (styled spans, async highlight pipelines, intermediate frames) use `captureSpans()`, `renderer.idle()`, `MockTreeSitterClient`, and `TestRecorder` — all from `@opentui/core/testing`. Worked example: `apps/house/test/markdown-codeblock.test.tsx`. Full notes in `CONTRIBUTING.md` under "Validating rendered output deeper than text". Don't reach for PTY-based testing — `captureSpans` covers every case we have today.

If `bun dev` and `bun run dev` seem to differ, check for stale watcher processes before changing renderer code. Both resolve to the `dev` script, but orphaned `bun --watch src/index.tsx ...` processes can keep showing old behavior. Use `ps ... | rg 'bun (run )?dev|bun --watch src/index.tsx|src/index.tsx'` and `lsof -a -p <pid> -d cwd` to verify.

For fenced code blocks, rely on opentui's built-in `<markdown>` renderer and keep `apps/house/test/markdown-codeblock.test.tsx` covering tagged fences. Do not replace the markdown renderer or reintroduce a broad `renderNode` override unless DESIGN.md §12's custom-renderer trigger has fired.

## termctrl

`termctrl` is available locally and is useful for debugging or testing terminal behavior outside the headless render harness. Use it to start persistent PTY sessions, send ordered input, wait for visible text, inspect the current screen, capture logs/screens, and export session videos when reproducing TUI issues or documenting behavior. When you need to explore its capabilities or exact flags, start with `termctrl --help` and then inspect the relevant subcommand help.

## Local commands

```bash
bun run dev [path]      # watch + run from source; positional seeds filter, use --root <dir> to browse a directory
bun test                # house test suite, scoped by the root bunfig.toml
bun run typecheck
bun run lint
bun run format
bun run format:check
bun run --cwd apps/house dev/bench-markdown.ts <dir> # microbench
bun run npm:pack        # show exactly what would land on npm
bun run verify:github   # release/API checks against vercel-labs/emulate
```

## Release runbook

Use this when publishing a new version. Releases are event-driven: the release
workflow prepares a PR, and merging that PR is the human approval that creates
the GitHub Release and starts publishing. Direct commits to `main` are blocked,
so even version bumps go through a PR.

Maintainer docs live here first. `CONTRIBUTING.md` has the short contributor
summary. `apps/house/dev/release.ts`, `.github/workflows/release.yml`, and
`.github/workflows/publish.yml` are the executable sources of truth.

### What gets published

Each release publishes:

- `@carlesandres/house-<os>-<arch>` npm packages, each containing one native
  `bin/house` binary.
- `@carlesandres/house`, the main npm package. This contains the Node shim
  and bundled application source, but no native executable. Its
  `optionalDependencies` select a same-version platform package.
- GitHub Release assets named `house-*.tar.gz` for the four supported targets.
  npm installs use the optional platform packages.

Linux packages target glibc. Windows remains unsupported.

### 1. Prepare release notes

Start from a clean, current `main` and fetch the tags:

```bash
git checkout main
git pull --ff-only
git status --short
git fetch origin --tags
```

`git status --short` must print nothing. The latest tag must equal `v` plus the
version in `apps/house/package.json`; the release command checks both conditions.

Inspect every first-parent commit since the latest tag:

```bash
previous="$(git tag --sort=-v:refname | head -1)"
echo "${previous}"
git log --first-parent --oneline "${previous}..origin/main"
```

Make sure each user- or maintainer-visible change is represented under
`[Unreleased]` in `CHANGELOG.md`. Use this filter:

| Commit kind | Include in changelog? | Heading |
|---|---:|---|
| New command, install path, workflow, platform, or visible feature | Yes | `### Added` |
| Behavior/default/output changed for users or maintainers | Yes | `### Changed` |
| User-visible or release-blocking bug fixed | Yes | `### Fixed` |
| Supported behavior removed | Yes | `### Removed` |
| Security fix | Yes | `### Security` |
| Release commit, typo, formatting, internal refactor, test-only change | No, unless maintainer-visible | — |

For every included commit, write one bullet using this shape:

```markdown
- <User or maintainer-visible thing> now <outcome>, so <why it matters>.
```

Examples:

- Good: `- npm installs now use a native binary package, so Bun is no longer required at runtime.`
- Good: `- Release publishing now uploads standalone binary archives for direct downloads.`
- Too internal: `- Added src/cli/npm-bin.js.`
- Too internal: `- Refactored build scripts.`

Group bullets under Keep a Changelog headings, using only headings that have
entries: `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Security`.
Keep bullets outcome-focused rather than describing file names or implementation
details. Do not create the dated version section yourself when using the release
command: it moves the non-empty `[Unreleased]` body and updates compare links.

### 2. Prepare the release PR

Start the release workflow with `patch`, `minor`, `major`, or an explicit stable
version:

```bash
gh workflow run release.yml -f version=patch
```

The workflow validates `main` and the changelog, creates or resumes
`release/vX.Y.Z`, moves the changelog notes, bumps the version, opens the release
PR, and explicitly starts CI for its head commit. The explicit dispatch matters:
pull requests created by GitHub's built-in token do not trigger another workflow.

For local validation or recovery, the same preparation remains available:

```bash
bun run release -- patch --dry-run
bun run release -- patch --yes
```

The local command only creates or resumes the release PR; it never merges or
publishes. Re-running either preparation path reuses a valid existing branch and
PR for the same version.

`version:set` changes only `apps/house/package.json` and the `apps/house`
workspace version in `bun.lock`. Platform `optionalDependencies` remain on the
last-published version so a frozen monorepo install works before the new packages
exist. `createPublicPackageManifest` pins them to the release version in the
published main package. Do not hand-edit those pins to an unpublished version.

PR CI is the release gate: typecheck, lint, format check, all-workspace tests,
GitHub API emulation, standalone build/mutation smoke, npm package staging, and
Node 22/24 install smokes. Use `bun run npm:pack`, not root `npm pack`, to inspect
the staged public package.

### 3. Approve and watch publishing

Review the version and changelog in the release PR, wait for CI, then squash-merge
it. That merge is the single human approval. `.github/workflows/release.yml`
validates the release branch, package version, changelog, previous tag, and exact
merge SHA before creating the GitHub Release and dispatching `publish.yml` at the
new tag.

The publish workflow:

1. runs typecheck, GitHub API emulation, `bun run npm:pack`, and tag/version checks,
2. builds each native target and runs its File Navigator mutation smoke,
3. publishes the platform packages before the main package, and
4. uploads the four standalone archives to the GitHub Release, then verifies all
   five npm versions, a clean installed binary, and the four release assets.

The `npm` environment does not require another reviewer click; it allows only
`v*` tags and `main` (for recovery dispatch). The platform build jobs do not use
that environment. Only the final publish job does.

Repository Actions settings must allow GitHub Actions to create pull requests;
the preparation workflow uses its scoped built-in token and no separate secret.

```bash
gh run list --workflow publish.yml --limit 3
gh run view <run-id> --web
gh run watch <run-id>
```

### 4. Confirm the automated verification

The green `verify-published` job is the release completion signal. It retries npm
registry reads while the new versions propagate, checks all five packages, installs
the main package on Node 24, runs `house --version`, and checks the four archives.
The workflow summary records the verified version.

These commands remain useful for manual diagnosis:

```bash
npm view @carlesandres/house version
npm view @carlesandres/house-darwin-arm64 version
npm view @carlesandres/house-darwin-x64 version
npm view @carlesandres/house-linux-arm64 version
npm view @carlesandres/house-linux-x64 version
gh release view vX.Y.Z --json assets
```

All npm versions should be `X.Y.Z`. The GitHub Release should list four
`house-*.tar.gz` assets.

To repeat the install smoke manually:

```bash
npm install -g @carlesandres/house
house --version
```

`house --version` should print `X.Y.Z` and should not require Bun on `PATH`.

### Recovery and retry rules

If preparation stops, dispatch `release.yml` again with the same version. It
validates and reuses the existing branch and PR instead of creating another
version. If the post-merge job stops, rerun that job: it reuses an existing
release only when its tag targets the exact release PR merge SHA.

If `main` advances before approval, do not update the already-cut release branch
and silently pull new changes past the changelog cutoff. Close the stale PR,
delete its managed release branch, refresh `[Unreleased]`, and dispatch the same
version again from current `main`.

The publish steps skip package versions that already exist. For a tagged release,
dispatch from the tag so the four archives are rebuilt and attached:

```bash
gh workflow run publish.yml --ref vX.Y.Z
```

A `main` dispatch remains available for npm-only recovery after confirming that
`apps/house/package.json` is still the intended version. It does not attach
release archives. Tagged asset uploads use `--clobber`.

### Trusted Publisher and Homebrew status

Don't add an `NPM_TOKEN`-style secret. Publish uses Trusted Publisher / OIDC with
owner `carlesandres`, repo `house`, workflow `publish.yml`, environment `npm`.
That environment allows only `v*` tags and `main`; it has no required reviewers.
All five current package names are configured. Any future package name needs its
own Trusted Publisher entry before the workflow can publish it.

The native npm path and standalone assets have shipped successfully. Homebrew is
still unimplemented and tracked by issue #51; its former binary-proof prerequisite
has been satisfied.

## Things that are *not* the right move

- Re-introducing a deferred pattern (DESIGN.md §12) without checking whether its trigger has fired.
- Adding a feature on the deferred list (§5.3) without an issue agreeing to do it now.
- Binding a reserved key (§7.3) — break it and v2 work has to re-train muscle memory.
- Adding `// TODO`s without the `(revisit: <topic>)` form when they pair with a §12 entry.
- Publishing `@carlesandres/house` without first publishing the matching platform binary packages at the same version — the Node shim cannot run without them.
- Amending or force-pushing commits on `main`.

## Communication

All project communication happens in **GitHub issues**. There is no Discussions tab, no chat. If something feels ambiguous, open an issue.
