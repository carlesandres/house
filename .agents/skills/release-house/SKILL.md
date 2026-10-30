---
name: release-house
description: >
  Release @carlesandres/house (changesets, version PR, GitHub release, npm
  publish). Use when the user asks to release house, cut a version, ship a
  patch/minor/major, publish to npm, or runs /release-house.
---

# Release house

Ship a stable version of `@carlesandres/house` and its platform binary packages.

## Goal

A published version on npm matching a GitHub release tag `vX.Y.Z`, with all four
platform packages at the same version.

## Hard rules

- Release notes come from `.changeset/*.md` files; never edit
  `apps/house/CHANGELOG.md` or the version in `apps/house/package.json` by hand.
- Merging the "chore: version packages" PR is the human approval. The release
  workflow then creates the GitHub Release and dispatches publishing; there is
  no later environment review.
- Never push to or edit the `changeset-release/main` branch; the workflow
  rebuilds it from `main` on every push.
- Repository Actions settings must allow GitHub Actions to create pull requests.
- Do not amend or force-push `main`.
- Do not invent `NPM_TOKEN` secrets (OIDC / Trusted Publisher only).
- Platform optionalDependencies in the monorepo may lag last-published versions
  so CI can install; the published main package pins them via
  `createPublicPackageManifest`. Do not "fix" CI by retargeting lockfile
  platform packages to an unpublished version.

## Procedure

### 1. Check the pending notes

```bash
git fetch origin main --tags
git ls-tree --name-only origin/main .changeset/
git log --first-parent --oneline "$(git tag --sort=-v:refname | head -1)..origin/main"
```

Every user- or maintainer-visible change since the latest tag should have a
changeset file, including dependency updates that fix a bug or vulnerability. If one is
missing, add it in a PR to `main` (see `AGENTS.md`,
"Add a changeset to each notable PR"). A `minor` changeset raises the release to
minor; the highest pending bump wins.

### 2. Find the version PR

```bash
gh pr list --head changeset-release/main --state open
```

If it is missing while changesets are pending, rerun the latest `release.yml`
run on `main`. Check its CI (`check` status) and review the version and the new
`apps/house/CHANGELOG.md` section.

### 3. Approve by merging

Merge only when the user asks. On that push to `main`, `release.yml` should:

1. Find the new version untagged.
2. Create the GitHub Release `vX.Y.Z` with that version's changelog section.
3. Dispatch `publish.yml` from the new tag.

### 4. Watch publish and verify

```bash
gh run list --workflow publish.yml --limit 3
gh run watch <id>
```

The `publish` job checks the four release assets. The green `verify-published` job
waits up to 45 minutes for npm to serve all five packages, then installs house from
npm and starts its TUI. For manual diagnosis:

```bash
npm view @carlesandres/house version
npm view @carlesandres/house-darwin-arm64 version
npm view @carlesandres/house-darwin-x64 version
npm view @carlesandres/house-linux-arm64 version
npm view @carlesandres/house-linux-x64 version
```

### 5. Report

Return:

- Version `vX.Y.Z`
- Version PR URL
- GitHub release URL
- Publish workflow URL + conclusion
- npm versions for main + four platform packages

## Common failures

| Symptom | Likely cause | What to do |
|--------|--------------|------------|
| CI `pnpm install` 404 on `@carlesandres/house-*-0.x.y` | Lockfile/package.json retargeted platform optionalDeps to unpublished version | Keep monorepo platform pins on last-published; public manifest pins to release version |
| Version PR has no CI | Built-in token did not emit a PR workflow | Rerun `release.yml` on `main`; it dispatches `ci.yml` |
| Release created but no publish run | Dispatch step failed | Rerun the failed `release.yml` job; it dispatches again while npm lacks the version |
| Release job: tag "points at …, not the X.Y.Z commit" or "exists without a GitHub Release" | Tag created outside the flow | Stop and report; do not publish from that tag |
| Version PR `check` fails in `version-pr-scope` | The version PR has more than one commit or touches more than release files | Stop and report; do not merge |
| Version PR `check` fails at "Audit shipped dependencies" | A dependency that ships in house has a high or critical advisory; `audit-exceptions.json` is invalid; pnpm's `auditConfig` is set; or the audit could not get or read pnpm's report | Read the annotations. For an advisory, update the dependency on `main` or add a reasoned, dated entry to `apps/house/dev/audit-exceptions.json` on `main`. Otherwise fix the exceptions file, the config, or the script on `main`, or rerun if the registry was down. Never edit the version PR |
| Publish job blocked by the `npm` environment | Run ref is not a `v*` tag or `main` | Dispatch from the release tag, or from `main` for npm-only recovery |
| Main package on npm without matching platform packages | Partial publish | Do not announce success; inspect publish job logs |
| `verify-published` times out waiting for npm while `publish` is green | npm is slow to serve the new versions, not a failed publish | Rerun the failed job once `npm view` shows the version and its tarball downloads |
| `verify-published` install or start step fails after npm serves every package | The published package is broken | Do not announce; investigate before anything else |

## Out of scope

- Homebrew tap (still deferred)
- Windows packages
- Changing Trusted Publisher / OIDC config unless the user asks
