---
name: release-house
description: >
  Release @carlesandres/house (version bump, release PR, GitHub release, npm
  publish). Use when the user asks to release house, cut a version, ship a
  patch/minor/major, run the release script, publish to npm, or runs
  /release-house.
---

# Release house

Ship a stable version of `@carlesandres/house` and its platform binary packages.

## Goal

A published version on npm matching a GitHub release tag `vX.Y.Z`, with all four
platform packages at the same version.

## Hard rules

- Run from a clean `main` that matches `origin/main`.
- Prefer the automated path: `bun run release -- <patch|minor|major|X.Y.Z>`.
- Creating the GitHub Release is the human approval. Do not prompt for an `npm`
  environment reviewer click; that gate is gone. The environment allows only `v*`
  tags and `main`.
- Do not amend or force-push `main`.
- Do not invent `NPM_TOKEN` secrets (OIDC / Trusted Publisher only).
- Platform optionalDependencies in the monorepo may lag last-published versions
  so CI can install; the published main package pins them via
  `createPublicPackageManifest`. Do not “fix” CI by retargeting lockfile
  platform packages to an unpublished version.

## Procedure

### 1. Preflight

```bash
git fetch origin main --tags
git checkout main && git pull --ff-only
git status --porcelain   # must be empty
```

Confirm:

- Latest tag matches `apps/house/package.json` version: `v` + version.
- `[Unreleased]` in `CHANGELOG.md` has the user-visible notes for this cut
  (especially fixes/features landed since the last tag).

Choose bump: default **patch** unless the user asks otherwise.

Dry-run first when useful:

```bash
bun run release -- patch --dry-run
```

### 2. Run the release automation

```bash
bun run release -- patch --yes    # or minor / major / 0.x.y
```

This should:

1. Move `[Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD` and fix compare links  
2. `version:set` (main package + lockfile workspace version only)  
3. Branch `release/vX.Y.Z`, commit `chore: release vX.Y.Z`, open PR  
4. Wait for CI, squash-merge, pull `main`  
5. `gh release create vX.Y.Z --target main --generate-notes`  
6. Start watching `publish.yml`

If the script dies early (e.g. empty `gh pr checks`), finish the same steps
manually; do not invent a different versioning scheme.

### 3. Watch publish and verify

```bash
gh run list --workflow publish.yml --limit 3
gh run watch <id>

npm view @carlesandres/house version
npm view @carlesandres/house-darwin-arm64 version
npm view @carlesandres/house-darwin-x64 version
npm view @carlesandres/house-linux-arm64 version
npm view @carlesandres/house-linux-x64 version
# all five must equal X.Y.Z
```

Optional smoke:

```bash
npm install -g @carlesandres/house
house --version
```

### 4. Report

Return:

- Version `vX.Y.Z`
- Release PR URL (if still useful)
- GitHub release URL
- Publish workflow URL + conclusion
- npm versions for main + four platform packages

## Common failures

| Symptom | Likely cause | What to do |
|--------|--------------|------------|
| CI `bun install` 404 on `@carlesandres/house-*-0.x.y` | Lockfile/package.json retargeted platform optionalDeps to unpublished version | Keep monorepo platform pins on last-published; public manifest pins to release version |
| `gh pr checks` fails with “no checks reported” | Race before CI registers | Wait/retry; empty checks ≠ failure |
| Publish job blocked by the `npm` environment | Run ref is not a `v*` tag or `main` | Create the GitHub Release, or dispatch from `main` |
| Main package on npm without matching platform packages | Partial publish | Do not announce success; inspect publish job logs |

## Out of scope

- Homebrew tap (still deferred)
- Windows packages
- Changing Trusted Publisher / OIDC config unless the user asks
