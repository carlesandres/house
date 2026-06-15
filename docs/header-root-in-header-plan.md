# Header discovery-root segment plan

Working plan for adding the current discovery root to the one-line header.
Not authoritative yet. The code, issue thread, and any later DESIGN.md update
become the sources of truth once this ships.

## Goal

Show the directory tree backing the sidebar in the header so the current scan
scope is visible even when the sidebar is populated.

Today the header shows:

- brand on the left
- selected file path next to the brand
- version on the right

The gap: the discovery root is only obvious in some empty-state copy, so once
files are present there is no always-visible place that answers "what tree is
the sidebar showing?"

The important nuance: the answer must still be useful when the user no longer
remembers the shell cwd. A user may have several tmux panes, several terminals,
or a long-lived TUI session. Labels like `.`, `docs`, or `..` are compact, but
they require remembering where `house` was launched from. The header should
anchor the user in the filesystem, not in a remembered cwd.

## Target header shape

Primary wide-layout intent:

`⌂ house · <file> · <root>  vX.Y.Z`

Semantics:

- `⌂` = permanent brand anchor
- `house` = expendable wordmark
- `<file>` = currently selected file path, already root-relative
- `<root>` = current discovery root / scan scope, formatted as a location-stable
  filesystem label
- `vX.Y.Z` = current package version

When no file is selected, the root still appears on wide enough rows:

`⌂ house · <root>  vX.Y.Z`

That covers scanning, empty-vault, and zero-match states, where the root is the
most relevant dynamic context.

## Settled decisions

### 1. Root belongs in the header as secondary context

- The selected file remains the more important dynamic signal when present.
- The root is subordinate but always eligible to appear on wide enough rows.
- The root should still appear when no file is selected.
- The header should not show query/intent, only actual scan scope.

### 2. Root display is unlabeled

We are not adding `in`, `root:`, or similar copy. Meaning comes from stable
position and styling.

Grammar:

- brand group
- file, if selected
- root
- version

### 3. Root labels should be location-stable, not cwd-relative

Do not display `.`, `docs`, or `..` merely because those are short relative to
the launch cwd. They are only helpful if the user remembers the cwd, which is
exactly the context we cannot assume.

Instead, display the resolved discovery root as:

- `~` / `~/...` when the root is inside the user's home directory
- absolute path otherwise

This is slightly denser than cwd-relative labels, but the header already has a
width degradation ladder and middle truncation. The root segment's job is to
answer "where am I?" without hidden state.

### 4. Header should be segment-based

Do not hardcode separators into one string. Instead:

- build ordered segments
- truncate/drop by priority
- join surviving left-side segments with ` · `
- keep version as the right-side segment while present

This prevents orphaned separators as segments disappear.

Important detail: `⌂ house` is a brand group, not two dot-separated context
segments. The icon and wordmark can be controlled independently, but the wide
header should not render `⌂ · house`.

### 5. Root uses the same compression idiom as sidebar paths

Use the existing middle-truncation helper for the root segment.

### 6. File may also middle-truncate, but only after root has yielded

The selected file stays more informative than the root, so it yields later.

### 7. Wordmark and icon are separate brand units

- `⌂` stays as the irreducible identity anchor.
- `house` can disappear before the version does.
- Dropping `house` changes the brand group from `⌂ house` to `⌂`; it does not
  create or remove a context separator by itself.

### 8. Root display should be canonical and shared

Do not show the raw CLI/config input string. Instead show a normalized,
user-facing label for the resolved discovery root.

That same formatter should be reused anywhere else we name the scan scope,
including the sidebar empty state.

## Root label formatting

Introduce a small domain helper, e.g. `formatDiscoveryRootLabel(...)`.

Inputs:

- resolved `discoveryRoot`
- `home`

The formatter should not depend on whether the root came from:

- `--root`
- `defaultRoot = "cwd"`
- `defaultRoot = "git"`

Equivalent directories should display equivalently.

### Path normalization before formatting

Normalize the discovery root before it reaches the formatter.

Current code returns `cliRoot` unchanged when `--root` is provided. That means
`--root docs`, `--root ./docs`, and `--root /absolute/path/to/docs` can display
differently even when they walk the same directory. Fix that at the discovery
root resolution boundary.

Recommended boot-layer policy:

- `resolveDiscoveryRoot(...)` should return an absolute, lexically normalized
  path for every source.
- For CLI roots, use `resolve(cwd, cliRoot)`.
- Do not introduce `realpath` unless there is a separate product decision to
  collapse symlinks. Lexical normalization is enough to make equivalent CLI
  spellings converge without changing symlink behavior.

### Canonical display rules

Given an absolute normalized root path:

1. If the root equals `$HOME`, show `~`
2. If the root is inside `$HOME`, show a home-relative path like `~/notes`
3. Else show the absolute path

Do not special-case cwd-relative labels in the header or empty state.

### Examples

Assuming:

- `cwd = /Users/carles/src/house.more-tweaks`
- `home = /Users/carles`

| Resolved discovery root | Display label |
| --- | --- |
| `/Users/carles` | `~` |
| `/Users/carles/src/house.more-tweaks` | `~/src/house.more-tweaks` |
| `/Users/carles/src/house.more-tweaks/docs` | `~/src/house.more-tweaks/docs` |
| `/Users/carles/src` | `~/src` |
| `/Users/carles/notes` | `~/notes` |
| `/tmp/project-docs` | `/tmp/project-docs` |

Equivalent launches such as `--root docs`, `--root ./docs`, and an absolute
path to the same directory should converge to the same display label.

## Priority and degradation ladder

Agreed yield order:

1. `⌂` stays
2. `house` stays while room allows
3. file stays whole while room allows, when selected
4. root stays whole while room allows
5. root middle-truncates
6. root drops
7. `house` drops
8. version drops
9. file middle-truncates, when selected

Notes:

- Root yields before file.
- Wordmark drops before version.
- Version is intentionally preserved longer than usual for now because release
  cadence is high and the version is still operationally useful.
- This policy may change later without changing the overall segment model.
- When no file is selected, skip file-related steps; root still participates in
  the ladder.

## Styling intent

- `⌂` and `house` keep the current brand treatment.
- file should read as the primary dynamic context.
- root should be more muted than file so the two path-like segments do not
  compete equally.
- version keeps its current far-right metadata role.

Current implementation detail: the selected file is already rendered with
`colors.textMuted`. If root is added with the same token, file and root will
compete visually. Prefer raising the selected file to `colors.text` and keeping
root on `colors.textMuted`, unless visual tests show the result is too loud.

## Implementation plan

### 1. Normalize discovery-root resolution

- Update `resolveDiscoveryRoot(...)` so CLI roots are resolved against `cwd` and
  returned as absolute normalized paths.
- Keep `defaultRoot = "cwd"` and `defaultRoot = "git"` behavior unchanged apart
  from the guarantee that the returned root is absolute.
- Add or update unit tests showing that `docs`, `./docs`, and an absolute path
  resolve to the same root when they point at the same directory.

### 2. Add a discovery-root display formatter

- Create a small helper dedicated to scan-scope labeling.
- Unit test it with the canonical examples above.
- Reuse it instead of formatting roots ad hoc in components.
- Keep the formatter independent of CLI/config source.

Possible location: a new `src/discovery/rootLabel.ts` or similar. Keeping it
near discovery vocabulary is preferable to putting it in a UI-only module,
because the label is a domain concept reused by both header and sidebar empty
state.

### 3. Thread the formatted root label into the Browser/header path

- Compute the display label near the boot layer, where the resolved discovery
  root and home directory are readily available.
- Pass the formatted label into `DiscoverShell`.
- Pass it into `Browser` as the canonical root label.
- Pass it onward into `Header`.
- Replace the current raw `emptyRootLabel={target}` path with the same canonical
  label.

Alternative acceptable shape: pass the raw resolved root plus home context and
let `Browser` format it once. The important part is that the formatter is shared
and the component tree receives one canonical label, not multiple formatting
policies.

### 4. Rework `Header` into ordered segments with pure layout logic

- Split the brand into an icon plus optional wordmark inside a brand group.
- Build left-side context segments in order:
  - brand group
  - file, when selected
  - root
- Keep version on the right while present.
- Apply the agreed degradation ladder as width gets tight.
- Join only visible left-side segments with ` · `.

Prefer extracting pure layout logic from JSX, e.g.:

```ts
type HeaderSegment = {
	readonly id: "brand" | "file" | "root"
	readonly text: string
	readonly tone: "brand" | "primary" | "muted"
}

type HeaderLayout = {
	readonly left: readonly HeaderSegment[]
	readonly right: string | null
}
```

The exact type shape can differ. The important part is that width degradation is
unit-testable without depending only on captured terminal frames.

### 5. Reuse the same root label in empty states

- Replace the raw `emptyRootLabel={target}` style path with the canonical
  formatted label.
- Keep empty-state copy otherwise unchanged unless tests show quote handling or
  spacing needs an update.

## Tests

### Formatter / root-resolution tests

- root equals home → `~`
- root inside home → `~/...`
- root outside home → absolute path
- root with a prefix sibling does not falsely match home, e.g.
  `/Users/carles2/project` is not inside `/Users/carles`
- equivalent CLI spellings produce the same resolved root and display label
- CLI root `docs` and `./docs` resolve against cwd before formatting

### Header layout tests

- wide viewport shows brand, file, root, and version together
- wide viewport with no selected file shows brand, root, and version together
- root is not rendered as `.`, `docs`, or `..` just because it is related to cwd
- medium viewport truncates root before dropping it
- tighter viewport drops root before dropping `house`
- tighter viewport drops `house` before version
- tighter viewport drops version before truncating file
- separators remain clean as segments disappear
- brand icon and wordmark render as `⌂ house`, not `⌂ · house`
- extreme narrow width does not produce negative widths, orphaned separators, or
  wrapped header text

### Empty-state tests

- empty-state root label uses the same canonical formatter as the header
- empty-state copy shows `~/...` for a home-contained root instead of raw CLI
  input

## Risks / watchpoints

- The header becomes denser, so styling and breakpoint behavior matter more.
- Home-relative root labels are longer than cwd-relative labels. This is an
  intentional tradeoff: correctness and orientation beat compactness here.
- Two path-like segments can feel noisy if root is not clearly subordinate.
- The width ladder must be deterministic and tested, otherwise tiny layout
  tweaks will create fragile regressions.
- Changing CLI root normalization may expose tests or assumptions that depended
  on raw `--root` strings. Treat that as a good cleanup unless it changes actual
  discovery behavior.

## Out of scope

- showing the initial query in the header
- adding folder navigation
- changing discovery-root source precedence
- changing discovery vocabulary or filtering behavior
- resolving symlinks / realpath canonicalization
- changing the version policy beyond the agreed drop order

## Follow-up after implementation

- If the shipped behavior feels good, promote the header/root policy into
  `DESIGN.md`.
- Revisit whether keeping version longer than the wordmark still feels right
  once releases become less frequent.
- Revisit whether root labels need an optional compact mode only after real use
  shows that home-relative paths are too noisy in common terminal widths.
