# Context — house

Glossary of project terms whose meaning isn't obvious from the code or the filename. Implementation details belong elsewhere (`DESIGN.md`, ADRs).

---

## beta

The first publicly-announced release of `house`.

- **Gated by:** `DESIGN.md` §10 (perf, tests, structure, docs, distribution).
- **Not a semver version.** The package is currently `0.3.0`; "beta" describes the *announcement state*, not a version number. The release itself may ship as `0.x` or `1.0` — decided when gates are met.
- **Already on npm ≠ already in beta.** The package being published doesn't put the project in beta; the *announcement* does. Until then, the project is in pre-beta development.
- **Tracked as a GitHub milestone** (`beta`). Items required for the announcement live there; nice-to-haves live in `beta — stretch`.

In older documents `beta` is sometimes called **"v2"** (see early `DESIGN.md` §5.2 and `ROADMAP.md`). That terminology is being phased out because it was being confused with semver "2.0.0". They refer to the same release.
