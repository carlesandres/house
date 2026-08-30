# Release to npm

```
git fetch origin main --tags
git checkout main
git pull --ff-only
test -z "$(git status --porcelain)"
test "$(git tag --sort=-v:refname | head -1)" = "v$(jq -r .version apps/house/package.json)"
git log --first-parent --oneline "$(git tag --sort=-v:refname | head -1)..origin/main"
```
Edit `CHANGELOG.md` `[Unreleased]` for those commits (`### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security`; outcome-focused; skip release/typo/format/internal/test-only).
Do not add a dated version heading.
Do not retarget platform `optionalDependencies` in the monorepo to an unpublished version.
```
bun run release -- patch --dry-run
bun run release -- patch --yes
```
Swap `patch` for `minor`, `major`, or `X.Y.Z`.
If the script dies, inspect the existing `release/vX.Y.Z` branch, PR, tag, and `publish.yml` run; finish the remaining steps from `apps/house/dev/release.ts`; do not start a second version or amend/`--force` `main`.
```
gh run list --workflow publish.yml --limit 3
gh run view <run-id> --web
```
Approve the `npm` environment if the publish job is Waiting for reviewer (matrix build jobs do not need approval).
```
gh run watch <run-id>
npm view @carlesandres/house version
npm view @carlesandres/house-darwin-arm64 version
npm view @carlesandres/house-darwin-x64 version
npm view @carlesandres/house-linux-arm64 version
npm view @carlesandres/house-linux-x64 version
gh release view vX.Y.Z --json assets
```
All five npm versions must equal `X.Y.Z`; assets must be four `house-*.tar.gz`.
```
npm install -g @carlesandres/house
house --version
```
`house --version` must print `X.Y.Z` with no Bun on `PATH`.
If publish never started after the GitHub Release exists: `gh workflow run publish.yml --ref main` only after `apps/house/package.json` on `main` is the intended version. Manual dispatch does not attach archives; rerun the original release-event `publish.yml` run for assets (`--clobber`).
Do not add an `NPM_TOKEN`.
