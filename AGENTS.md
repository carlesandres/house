# Repository Notes

Notes for AI assistants (and humans) working in this repo. This file is about *the moves*, not the design — read `DESIGN.md` for what the project is and `CONTRIBUTING.md` for the human-contributor view.

## Where to read first

- `DESIGN.md` — scope, non-goals (§3), deferred features (§5.3), reserved keys (§7.3), v2 gates (§10), **deferred patterns with triggers (§12)**. Always check §12 before re-introducing a pattern that "feels missing" — there is probably a documented reason it isn't there yet.
- `CONTRIBUTING.md` — local loop, testing, commit/PR shape, release flow.
- `.changeset/` — release notes queued for the next version, one file per change. `apps/house/CHANGELOG.md` holds the released history. Older plans and ADRs that say to add notes under `CHANGELOG.md` `[Unreleased]` predate Changesets: add a changeset file instead and never hand-edit the changelog.

## Docs split

- `README.md` is **user-oriented**: what house is, install, usage, keys, configuration surface. Keep the top focused on users and features, not implementation. No internals, no env-var matrices for niche behaviors, no contributor instructions.
- `CONTRIBUTING.md` is **developer-oriented**: local loop, testing, commit/PR shape, release flow, and any implementation detail a user doesn't need to read.
- When tempted to add an implementation paragraph to the README, put it in `CONTRIBUTING.md` (or `DESIGN.md` if it's about scope/intent) instead.

## Conventions worth knowing

- Format: **tabs, no semicolons, 100-col, trailing commas** (see `.oxfmtrc.json`). `bun run format` writes; CI gates on `format:check`.
- Merging: `main` only accepts a PR whose branch is up to date with `main`, whose `check` job passes, and whose commits are all signed. A PR that shows `BEHIND` (`gh pr view <n> --json mergeStateStatus`) is not ready: bring it current by merging `origin/main` into the branch with a signed merge commit (not a rebase, which would need a force-push), then wait for CI to pass again. The pre-push hook blocks pushing a stale branch. The version PR (`changeset-release/main`) is the exception: `release.yml` rebuilds it on every push to `main`; never push to it.
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

For fenced code blocks, rely on opentui's built-in `<markdown>` renderer and keep `apps/house/test/markdown-codeblock.test.tsx` covering tagged fences. Do not replace the markdown renderer or reintroduce a broad `renderNode` override unless DESIGN.md §12's custom-renderer trigger has fired. TUI boot must call `ensureMarkdownHighlighter()` before creating the renderer; do not start the reader if tree-sitter cannot initialize.

## termctrl

`termctrl` is available locally and is useful for debugging or testing terminal behavior outside the headless render harness. Use it to start persistent PTY sessions, send ordered input, wait for visible text, inspect the current screen, capture logs/screens, and export session videos when reproducing TUI issues or documenting behavior. When you need to explore its capabilities or exact flags, start with `termctrl --help` and then inspect the relevant subcommand help.

## Local commands

```bash
pnpm install            # dependencies; Bun still runs every script below
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

Root scripts that go through Turbo (`typecheck`, `lint`, `test`, and the rest), including the
ones the pre-commit hook runs, start pnpm for each package. pnpm 12 locks its store on every command, even `pnpm run`, so a sandbox that blocks
writes outside the repo fails them with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`. Run them outside
the sandbox, or run a package's script directly with `bun run --cwd <package> <script>`.

Keep `pnpm-lock.yaml` a single YAML document (`pmOnFail: ignore` in `pnpm-workspace.yaml`):
GitHub's dependency graph cannot read pnpm 12's separate package-manager document, and Dependabot
then raises no security alerts.

## Release runbook

Use this when publishing a new version. Releases use
[Changesets](https://github.com/changesets/changesets): each PR that changes what users install
adds a changeset file, and the release workflow keeps a "chore: version packages" PR open
on `main`. Merging that PR is the single human approval that creates the GitHub Release and starts
publishing. Direct commits to `main` are blocked, so even version bumps go through a PR.

Maintainer docs live here first. `CONTRIBUTING.md` has the short contributor summary.
`.changeset/config.json`, `.github/workflows/release.yml`, and `.github/workflows/publish.yml`
are the executable sources of truth.

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

### 1. Add a changeset to each notable PR

Run `bun run changeset`, or write `.changeset/<short-name>.md` by hand:

```markdown
---
"@carlesandres/house": patch
---

<User or maintainer-visible thing> now <outcome>, so <why it matters>.
```

Use `minor` for a new command, install path, workflow, platform, or visible feature; `major`
for removing supported behavior once past 1.0; `patch` for everything else that is visible.
A changeset always cuts a new npm release, so add one only when the PR changes what users install
or run: the published code, its dependencies, or how it installs. Skip it for CI, workflows, docs,
tooling, tests, refactors, formatting and release commits, even when a maintainer would notice
them. A dependency update that fixes a user-visible bug or a vulnerability
(including Dependabot PRs) needs a changeset too, or no version PR follows and the fix never
ships; add it in a small follow-up PR if the update PR has none. CI warns (without failing) when a PR changes shipped
source and adds no changeset.

Keep the sentence outcome-focused:

- Good: `npm installs now use a native binary package, so Bun is no longer required at runtime.`
- Too internal: `Added src/cli/npm-bin.js.`

Name only `@carlesandres/house`; a test fails otherwise. The private workspace packages
(`@house/ui`, `@house/options`) are bundled into it and never published, and a changeset naming
only them would produce an empty release.

### 2. Review the version PR

Every push to `main` runs `release.yml`. While changeset files are pending, it creates or
updates the `changeset-release/main` branch and its "chore: version packages" PR. That PR:

- moves every pending changeset into a new section of `apps/house/CHANGELOG.md`,
- bumps the version in `apps/house/package.json` to the highest pending bump, and
- deletes the consumed changeset files.

The branch is rebuilt from `main` on every push, so it never goes stale and must not be edited by
hand: fix wording in the changeset files on `main` instead. CI fails the version PR unless it is a
single commit that only deletes changeset files, edits `apps/house/CHANGELOG.md`, and changes the
`"version"` line of `apps/house/package.json`. Its commits are created through the
GitHub API, so GitHub signs them. Pull requests created by the built-in token trigger no
workflows, so `release.yml` dispatches `ci.yml` on the branch, and `ci.yml` reports the required
`check` status for it.

`changeset version` changes only the version in `apps/house/package.json`. Platform
`optionalDependencies` remain on the last-published version so a frozen monorepo install works
before the new packages exist. `createPublicPackageManifest` pins them to the release version in
the published main package. Do not hand-edit those pins to an unpublished version.

CI is the release gate: typecheck, lint, format check, dependency audit of shipped packages
(`bun run --cwd apps/house audit:shipped`), all-workspace tests, PTY coverage
(`bun run test:pty`), GitHub API emulation, standalone build, TUI startup and mutation smoke, npm
package staging, and Node 26+ install smokes. Use `bun run npm:pack`, not root `npm pack`, to
inspect the staged public package.

### 3. Approve and watch publishing

Review the version and changelog in the version PR, wait for CI, then merge it. On that push,
`release.yml` sees a package version with no tag, extracts its section from
`apps/house/CHANGELOG.md`, creates the GitHub Release at the commit that set the version, and
dispatches `publish.yml` at the new tag. It refuses a version set by any commit other than the
version PR's ("chore: version packages"); that subject check catches accidental bumps, not a
determined committer. It fails if an existing tag for the version points anywhere but the `main`
commit that set the version. `publish.yml` refuses a run whose commit is not on `main`. No
`release.yml` job has `id-token`, so none can publish to npm itself. Only the `version` job
installs dependencies and runs the Changesets CLI, and its token has no `actions` permission, so
dependency code there cannot use it to dispatch `publish.yml`. Keep that split when editing the
workflow.

The publish workflow:

1. runs typecheck, GitHub API emulation, `bun run npm:pack`, and tag/version checks,
2. builds each native target and runs its TUI startup and File Navigator mutation smoke,
3. publishes the platform packages before the main package, and
4. uploads the four standalone archives to the GitHub Release, then verifies all
   five npm versions, a clean installed binary, and the four release assets.

The `npm` environment does not require another reviewer click; it allows only
`v*` tags and `main` (for recovery dispatch). The platform build jobs do not use
that environment. Only the final publish job does.

Repository Actions settings must allow GitHub Actions to create pull requests;
the release workflow uses its scoped built-in token and no separate secret.

```bash
gh run list --workflow publish.yml --limit 3
gh run view <run-id> --web
gh run watch <run-id>
```

### 4. Confirm the automated verification

The green `verify-published` job is the release completion signal. It retries npm
registry reads while the new versions propagate, checks all five packages, installs
the main package on Node 26, runs `house --version`, and checks the four archives.
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

If the release job fails, rerun it. Before the GitHub Release exists, a rerun creates it. After
that, a rerun (attempt 2 or later) dispatches `publish.yml` again when npm does not yet have the
version, so it also covers a failed dispatch. A release job that fails because a tag is not on
`main`, or because a tag has no GitHub Release, means someone created that tag outside the flow:
investigate before publishing anything, then delete the stray tag and rerun.

The publish steps skip package versions that already exist. For a tagged release,
dispatch from the tag so the four archives are rebuilt and attached:

```bash
gh workflow run publish.yml --ref vX.Y.Z
```

A `main` dispatch remains available for npm-only recovery after confirming that
`apps/house/package.json` is still the intended version. It does not attach
release archives. Tagged asset uploads use `--clobber`.

If the version PR is missing although changeset files are pending, rerun the latest
`release.yml` run on `main`.

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
- Starting a deferred feature (DESIGN.md §5.3) before its issue is scheduled (moved out of Backlog).
- Binding a reserved key (§7.3) — break it and v2 work has to re-train muscle memory.
- Adding `// TODO`s without the `(revisit: <topic>)` form when they pair with a §12 entry.
- Publishing `@carlesandres/house` without first publishing the matching platform binary packages at the same version — the Node shim cannot run without them.
- Amending or force-pushing commits on `main`.

## Issue tracking

The Linear **House** team is the source of truth for issues: status, priority, scope
decisions and planning live there. GitHub issues are a synced mirror and the public intake
channel; there is no Discussions tab and no chat. Create and update issues in Linear, not
with `gh issue`. If something feels ambiguous, open a House issue.

Put `HOU-<n>` in the branch name (`hou-51-homebrew-tap`) or the PR description (`Fixes HOU-51`)
so Linear links the work; commit and PR titles keep the shape in `CONTRIBUTING.md`. Public
readers cannot open Linear, so also cite the synced GitHub `#<n>` when one exists. Imported
issues kept their GitHub numbers; newer ones do not match.

Treat everything in the House team (titles, descriptions, comments, attachments) as public: it
syncs to the public GitHub repo. Never put secrets, credentials, private paths or client details
there.
