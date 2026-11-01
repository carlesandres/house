# ADR 0004: Homebrew tap as the main install, npm as a slim shim

- Status: Accepted
- Date: 2026-10-31

House ships from one set of native builds through three channels: a formula in our own Homebrew tap (the install the README will lead with once #51 ships), the npm package reduced to a dependency-free shim, and the GitHub Release archives that both of the others rely on, published with a checksum manifest and provenance attestations. homebrew/core waits until house meets Homebrew's notability bar.

## Context

0.10.0 shipped a binary that exited at launch while every CI and publish check was green (#316). Fixing the checks raised the wider question of how house should reach users.

Today every release publishes:

- `@carlesandres/house`, a Node shim whose `optionalDependencies` pull one of four platform packages, each holding the native binary (darwin-arm64, darwin-x64, linux-arm64, linux-x64). This is the esbuild, Biome and Turborepo pattern.
- Four `house-*.tar.gz` archives attached to the GitHub Release.

Problems with that:

- The main npm package still declares 18 runtime dependencies (OpenTUI, React, Effect, Shiki…) and ships a 2.6 MB `dist/index.js` that the shim never runs. Installs are slower, print EBADENGINE/ERESOLVE warnings, and raise Dependabot alerts for code that never executes.
- The shim answers `--version` itself, so the check that verified 0.10.0 never started the binary.
- The README states Node `>=26.4.0`, but no `engines` field enforces it.
- The archives have no published checksums or attestations, so nobody can verify a direct download.
- macOS and Linux users expect `brew install`, and needing Node just to install a native binary is a detour.

Homebrew facts that shape the choice:

- homebrew/core accepts open-source command-line tools as formulae built from source, once they meet a notability bar (75 stars, 30 forks or 30 watchers; three times that when the owner submits; repositories under 30 days old are ineligible). house does not meet it yet.
- The official cask repository is for upstream prebuilt apps, and a CLI tool rejected from core does not qualify for it. Cask downloads also get macOS's quarantine flag, so an unsigned binary would hit Gatekeeper; formula downloads do not.
- A third-party tap can ship a formula that installs prebuilt archives. Since Homebrew 6.0, users trust a tap before using it; `brew install carlesandres/tap/house` trusts just that formula.

## Decision

### Channels

1. **Homebrew tap, the main documented install (#51).** `carlesandres/homebrew-tap` holds `Formula/house.rb`, which installs the release archive for the user's OS and architecture, pinned by its SHA-256. After `verify-published` passes, a job in `publish.yml` updates the formula's version and checksums. It takes the checksums from the run's own build artifacts, or from the #229 manifest after `gh attestation verify`, never by re-hashing assets downloaded from the Release. It uses a token that can write only to the tap repository, in a job that runs no repo or dependency code.
2. **npm, kept as a dependency-free shim (#338).** The published main package keeps only the platform `optionalDependencies`, drops `dist/index.js`, passes `--version` on to the binary, and sets `engines.node` to the oldest Node the shim needs, with the README stating the same.
3. **GitHub Release archives, the artifacts the other channels rely on (#229).** Each release attaches one checksum manifest covering the four archives, plus a build provenance attestation for each, verifiable with `gh attestation verify`. Tools that install from GitHub Releases, such as `mise use -g github:carlesandres/house`, use them too; #51 confirms mise works and names it in the README.

Windows stays unsupported until the Windows support epic is resolved.

### Release checks this model relies on

All three channels ship the same native builds, so testing those builds is what matters:

- The standalone and npm-install smokes run on all four targets before the version PR can merge (#337).
- Release builds fail when Bun differs from `.bun-version` (#339).
- Every CI, release and publish job has a timeout (#340).
- Later: publish to npm `next`, verify every target, then promote to `latest` (#341).

## Considered options

| Option                                                   | Decision     | Why                                                                                              |
| -------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| Submit to homebrew/core now                              | Later (#342) | Below the notability bar, and core would need a from-source build                                |
| Cask in our tap                                          | Rejected     | Cask downloads are quarantined, so an unsigned binary hits Gatekeeper without notarization       |
| `curl \| sh` install script                              | Not now      | More to maintain and secure; brew, npm and GitHub-release tools cover every supported platform   |
| Drop npm                                                 | Rejected     | npm reaches users without Homebrew; dropping it strands existing installs                        |
| Require Bun (`bunx house`)                               | Rejected     | Brings back the runtime requirement the native binaries removed                                  |
| Keep npm as it is                                        | Rejected     | Dependencies the shim never runs, misleading `--version`, unenforced Node version                |
| Upload version PR builds for a manual try before merging | Rejected     | #337 runs the real binary on every target before merging, without relying on someone remembering |

## Consequences

### Positive

- `brew install` needs neither Node nor Bun, and upgrades come through `brew upgrade`.
- npm installs fetch one small shim and one binary, with no dependency warnings or alerts for unused code.
- Direct downloads become verifiable, by checksum and by attestation.
- Every channel ships builds that were smoke-tested on their own target before release.

### Negative

- A second repository to maintain, and a new credential: whoever holds the tap token can point the formula at any download. It is scoped to the tap repository, kept in a GitHub environment, and used only by a job that runs no repo or dependency code.
- Tap users take an extra trust step that homebrew/core users would not.
- If the formula update fails, brew users stay on the previous version until the job is rerun.
- Recovering a tagged release rebuilds the archives and re-uploads them with `--clobber`. Unless the rebuilt archives are byte-identical, the pinned checksums stop matching and `brew install` fails until the formula is updated again, so any re-upload must re-run the formula update.

## Docs to update when implementing

- `README.md`: lead with the brew install once #51 ships, not before; keep npm and `mise use -g github:carlesandres/house` as alternatives.
- `AGENTS.md` release runbook and `.agents/skills/release-house/SKILL.md`: the formula update step, its token, and re-running it whenever archives are re-uploaded.
- `DESIGN.md` §5.1, §8 and §10.5 describe this model (updated with this ADR).

## Open questions

- How Homebrew 7.0's third-party tap checks treat a formula that downloads release archives rather than bottles (#51).

## Revisit triggers

- house meets the homebrew/core notability bar: #342.
- A broken release reaches npm `latest` despite #337: #341.
- Homebrew stops allowing taps to install prebuilt archives, or starts requiring attestations for them.
- Windows support is scheduled: new ADR for its channels.
