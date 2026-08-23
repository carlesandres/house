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
- Scalar options (CLI + env + file initial values) are declared in `apps/house/src/config/options.ts` via `@house/options`. Add the spec there and thread layers through `loadConfig`. Browser holds a session for runtime `wrap` changes. Do not add per-key parse helpers for catalog keys. Persist policy is `session` or `file`; file writes stay in `config/save.ts`. Lists (`show`, `extensions`) stay on Effect Config. The package itself stays agnostic of TOML, Commander, and Effect ConfigProvider.
- `TODO(revisit: <topic>)` markers in source point back at `DESIGN.md` §12. `grep -r 'TODO(revisit:' apps/house/src/` lists them.
- Bindings live in `apps/house/src/keymap/browser.ts` as data. Adding a key: append a `KeyBinding`, the `?` overlay picks it up. Reserved keys (`/`, `r`) are off-limits in v1.
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

Use this when publishing a new version. Releases are event-driven: you prepare a
release PR, merge it, then create a GitHub Release. The GitHub Release triggers
`.github/workflows/publish.yml`, which builds binaries and publishes npm packages.
Direct commits to `main` are blocked, so even version bumps go through a PR.

Maintainer docs live here first. `CONTRIBUTING.md` has the short contributor
summary. `apps/house/dev/release.ts` and `.github/workflows/publish.yml` are the
executable sources of truth.

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

<<<<<<< HEAD
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

### 2. Run the guarded release command

Dry-run the selected stable version or bump first:

```bash
bun run release -- patch --dry-run
```

Then run `patch`, `minor`, `major`, or an explicit stable version. Omit `--yes`
for an interactive confirmation:

```bash
bun run release -- patch --yes
```

The command validates the changelog and preflight, creates `release/vX.Y.Z`,
moves the changelog notes, bumps the version, opens a release PR, waits for CI,
squash-merges, pulls `main`, creates the GitHub Release at the exact merge SHA,
and watches `publish.yml`.

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

The `release: published` event starts `.github/workflows/publish.yml`. It:

1. runs typecheck, GitHub API emulation, `bun run npm:pack`, and tag/version checks,
2. builds each native target and runs its File Navigator mutation smoke,
3. publishes the platform packages before the main package, and
4. uploads the four standalone archives to the GitHub Release.

If the run pauses at **Waiting for reviewer**, approve the `npm` environment in
GitHub. This approval is intentionally manual:

```bash
gh run list --workflow publish.yml --limit 3
gh run view <run-id> --web
gh run watch <run-id>
```

The platform build jobs do not use the `npm` environment. Only the final publish
job does.

### 4. Verify the published release

After the publish run is green:

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

Finally smoke-test an install on a supported platform:

```bash
npm install -g @carlesandres/house
house --version
```

`house --version` should print `X.Y.Z` and should not require Bun on `PATH`.

### Recovery and retry rules

If the guarded command stops, inspect the branch, PR, release, and workflow it
already created before continuing. Follow the same remaining sequence from
`apps/house/dev/release.ts`; do not create another version or amend/force-push
`main`. A manual release must target the release PR's exact merge SHA rather than
whatever `main` points to later.

Manual dispatch is allowed only from `main`. Before using it, confirm that
`apps/house/package.json` on `main` is still the version you intend to publish:

```bash
gh workflow run publish.yml --ref main
```

The npm publish steps skip package versions that already exist. A manual dispatch
does **not** attach archives because it has no release event; rerun the failed
original release workflow when release assets need recovery. Release-event asset
upload uses `--clobber`.

### Trusted Publisher and Homebrew status

Don't add an `NPM_TOKEN`-style secret. Publish uses Trusted Publisher / OIDC with
owner `carlesandres`, repo `house`, workflow `publish.yml`, environment `npm`.
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
