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

- Prefer the automated path: dispatch `release.yml` with a bump or exact version.
- Merging the release PR is the human approval. The merge workflow creates the
  GitHub Release and dispatches publishing; there is no later environment review.
- Use the local command only for dry-runs or recovery, from a clean `main` that
  matches `origin/main`.
- Repository Actions settings must allow GitHub Actions to create pull requests.
- Do not amend or force-push `main`.
- Do not invent `NPM_TOKEN` secrets (OIDC / Trusted Publisher only).
- Platform optionalDependencies in the monorepo may lag last-published versions
  so CI can install; the published main package pins them via
  `createPublicPackageManifest`. Do not “fix” CI by retargeting lockfile
  platform packages to an unpublished version.

## Procedure

### 1. Prepare release notes

```bash
git fetch origin main --tags
git checkout main && git pull --ff-only
git status --porcelain   # must be empty
```

Confirm:

- Latest tag matches `apps/house/package.json` version: `v` + version.
- `[Unreleased]` in `CHANGELOG.md` has the user-visible notes for this cut
  (especially fixes/features landed since the last tag).

Choose bump: default **patch** unless the user asks otherwise. Do not create the
dated changelog section manually.

### 2. Dispatch release preparation

```bash
gh workflow run release.yml -f version=patch
```

Use `minor`, `major`, or an exact stable version when requested. The workflow
creates or resumes `release/vX.Y.Z`, opens the PR, and explicitly dispatches CI.

For a local dry-run or recovery:

```bash
bun run release -- patch --dry-run
bun run release -- patch --yes
```

The local command stops after creating or resuming the PR.

If `main` advances before merge, close the stale PR, delete its managed release
branch, refresh `[Unreleased]`, and prepare the same version again; do not merge
new changes into an already-cut release branch.

### 3. Approve by merging

Review the release PR and its CI, then merge it. The merge workflow should:

1. Validate the version, changelog, previous tag, and exact merge SHA.
2. Create or reuse the GitHub Release at that SHA.
3. Dispatch `publish.yml` from the new `vX.Y.Z` tag.

### 4. Watch publish and verify

```bash
gh run list --workflow publish.yml --limit 3
gh run watch <id>

npm view @carlesandres/house version
npm view @carlesandres/house-darwin-arm64 version
npm view @carlesandres/house-darwin-x64 version
npm view @carlesandres/house-linux-arm64 version
npm view @carlesandres/house-linux-x64 version
# all five must equal X.Y.Z; the workflow also checks this automatically
```

Optional smoke:

```bash
npm install -g @carlesandres/house
house --version
```

### 5. Report

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
| Release PR has no CI | Built-in token did not emit a PR workflow | Rerun `release.yml`; it explicitly dispatches `ci.yml` |
| Publish job blocked by the `npm` environment | Run ref is not a `v*` tag or `main` | Dispatch from the release tag, or from `main` for npm-only recovery |
| Main package on npm without matching platform packages | Partial publish | Do not announce success; inspect publish job logs |

## Out of scope

- Homebrew tap (still deferred)
- Windows packages
- Changing Trusted Publisher / OIDC config unless the user asks
