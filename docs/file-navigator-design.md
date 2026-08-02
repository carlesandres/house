# Filesystem-aware File Navigator design

**Status:** Implemented and shipped
**Date:** 2026-07-26

`@parcel/watcher` 2.6.0 was explicitly approved by the project owner on 2026-08-01 after the
four-target empirical gate passed. Physical watcher pruning is not required; scanner traversal and
collection membership remain strict.

This document records decisions from the File Navigator design interview and the shipped component
API. Research notes and rejected alternatives remain part of the historical record.

## Library boundary

`@house/ui` is a private workspace package bundled into House. Its components may use Node-compatible
local-filesystem APIs but must not encode House-specific policy, copy, configuration, themes, keyboard
routing, or application state.

The library owns generic filesystem mechanisms. Callers supply product policy through typed inputs.

Portable presentation and filesystem-aware behavior use separate public subpath exports:

- `@house/ui/sidebar` exports Sidebar without Node filesystem dependencies.
- `@house/ui/file-navigator` exports File Navigator, built-in strategies, and filesystem types for
  Node/Bun consumers.

Sidebar never imports File Navigator. File Navigator may import Sidebar. Tests must prove that loading
the Sidebar entry point does not load the filesystem backend or Node filesystem modules. There is no
package-root export or compatibility alias; these subpaths are the public package boundary used by House.

## Component responsibilities

### Sidebar

The Sidebar is a generic presentation surface for an already-prepared selected collection. It owns
visual layout, the visible row window, selection presentation, header placement, empty-state
placement, and generic item rendering. It does not scan or watch the filesystem.

Sidebar has no file types, paths, file controller, search, ordering, selection reconciliation,
navigation commands, product copy, or House-specific styling. It receives generic items, selected
identity, an identity accessor, and a required item renderer. The current default file row moves to
the File Navigator layer.

Sidebar provides a complete neutral rectangular frame by default. A backend-neutral appearance input
configures border presence, sides and characters, active/inactive colors, inactive opacity, horizontal
padding, and selected-row colors. House's connected border junctions and exact pane styling are caller
configuration.

The generic component has no `inline` or `stacked` vocabulary; callers provide dimensions and visual
options directly.

### File Navigator

The File Navigator is the filesystem-backed navigation capability. It owns initial scanning,
filesystem event handling, metadata reconciliation, discovery scope, browse ordering, search ranking,
selection identity, and rendering through the Sidebar.

The complete component renders a useful default file row with basename as primary content and a muted
parent path as secondary context. Basename visibility wins under truncation. Callers may supply a
header, custom file-row renderer, or reason-aware empty-state renderer. Sidebar appearance is grouped
separately from filesystem and search options.

The initial API has no headless rendering mode. File Navigator consistently means filesystem-backed
navigation rendered through Sidebar.

### Query and selection ownership

The query is caller-controlled. The File Navigator does not own an input field, prompt semantics,
focus, keyboard bindings, or initial CLI behavior.

Selection is owned internally by normalized absolute-path identity so discovery, watcher, ordering,
and search changes can reconcile atomically. `onSelectionChange` reports the selected file or `null`
to the caller.

Selection reconciliation follows these generic rules:

- Initial discovery selects the first eligible file once; later batches retain its identity.
- A new nonempty applied query selects its first result once, then retains that identity while the
  query remains active.
- Clearing a query retains the selected file if it still exists.
- Browse-order changes retain selected identity.
- Removal or exclusion selects the surviving row nearest the previous index, or `null` when empty.
- A query with no results selects `null`; if a match later appears for the same query, the first result
  is selected once and then retained.

`onSelectionChange` fires only when selected identity changes. A separate
`onSelectedFileInvalidated(file, event)` callback reports a reconciled filesystem update to the
currently selected identity, allowing callers to refresh content without misrepresenting it as a
selection change. For events delivered by the backend, invalidation does not depend on public size or
`mtimeMs` changing: content can change while those values remain equal. Parcel may suppress duplicate
events when physical `mtime` is unchanged, so selected-file invalidation is best-effort rather than a
guarantee for physically unobservable same-metadata rewrites. Coalesced backend events produce one
invalidation for one committed update; unselected file updates do not invoke it.

A narrow imperative handle exposes application-agnostic actions such as reading the current snapshot,
moving by an offset, selecting the first/last/specified identity, flushing the controlled query, and
requesting an authoritative refresh. House maps its own keybindings onto these actions; the library
does not know those keys.

The flush action accepts an explicit immediate query and returns the post-flush snapshot. It does not
assume the latest caller input has already committed as a React prop; this preserves synchronous
key-event sequences that update an input and immediately act on its results.

### Status and diagnostics

The synchronous navigator snapshot exposes orthogonal facts rather than a lifecycle enum:

- `scanning` reports an initial or explicit authoritative scan in progress.
- `watching` reports that the live backend subscription reached readiness.
- `error` exposes the latest navigator error or `null`.

The last valid collection remains available if watching fails. Nonfatal scan, watch, and refresh
problems are emitted through a diagnostic callback with phase, optional path, underlying error, and
fatality. The library does not implement a generalized retry state machine.

The File Navigator and Sidebar may provide concise generic fallback copy for standard empty states.
Callers can replace those defaults; no fallback refers to House, Markdown, House configuration, or
House keybindings.

Default File Navigator copy is:

| Condition                                          | Copy                    |
| -------------------------------------------------- | ----------------------- |
| Initial scan with no rows                          | `Scanning…`             |
| Completed scan with no eligible files              | `No files found.`       |
| Active query with no matches                       | `No results found.`     |
| Failed initial discovery with no usable collection | `Unable to load files.` |

Raw errors are not rendered automatically, and watch failures do not replace a usable collection.
Callers may override every state through a reason-aware empty-state renderer. A generic Sidebar with
no items and no supplied empty state displays `No results found.`

## Filesystem scope

The File Navigator is local-filesystem-aware through Node-compatible APIs. It is House-agnostic, not
runtime-agnostic.

`root` is required. Relative roots resolve against `process.cwd()` when applied; the snapshot exposes
the resolved absolute root. Root must be an existing directory. Paths are lexically normalized but
not passed through `realpath`; an explicitly selected symlink root is allowed. Discovered identities
must remain contained beneath that lexical root.

An explicitly supplied symlink root is traversed as the chosen root even when nested symlink following
is disabled. The `followSymlinks` policy applies only to entries discovered beneath that root.

Absolute identity preserves filesystem case. Relative paths always use `/` separators on every
platform. The library does not lowercase identities on case-insensitive filesystems.

The initial private-package migration is supported and gated on House's macOS and Linux target
matrix. The implementation avoids deliberate POSIX-only assumptions, but Windows is not a claimed or
CI-gated platform until the package is prepared for independent publication with Windows-specific
path, symlink, watcher, and identity tests.

`recursive` defaults to `true`:

- `recursive={true}` discovers the complete eligible subtree.
- `recursive={false}` includes only regular files directly inside the root.
- Nonrecursive mode does not scan nested directories or include nested files. A native event backend
  may hold a broader recursive root subscription; nested events cannot populate the collection.
- Root-level inclusion and exclusion policy still applies.
- Changing the option at runtime restarts discovery and replaces the collection.
- Selection remains on the same stable file identity if that file remains eligible.

Depth-limited traversal is not part of the initial contract.

### Discovery policy

The library defaults to all regular files and directories, no ignore-policy files, and no followed
symlinks. Callers may provide a neutral policy with these independent concerns:

- `includeFile` determines whether a regular file belongs in the collection.
- `includeDirectory` prunes scanner traversal and collection membership. Native watcher topology may
  be broader when the selected backend cannot represent the policy physically.
- `ignoreFiles` names nested ignore-policy files whose rules apply at their directory and below.
- `followSymlinks` explicitly opts into following symbolic links and defaults to `false`.

When nested symlink following is enabled, targets may live outside the root's physical directory. The
public identity remains the lexical path beneath the configured root, and traversal uses physical
ancestry only to prevent cycles. An explicitly selected symlink root likewise preserves its lexical
public paths.

Changing an active ignore-policy file causes an authoritative refresh. One generic policy-aware
scanner is authoritative in live and static modes, so both produce the same collection.

House supplies Markdown extensions, hidden-file behavior, hard-skipped directories, and
`ignoreFiles: [".gitignore"]`; none are library defaults.

### File identity and rename

The normalized absolute path is canonical file identity. File entries also expose normalized absolute
path, root-relative path, basename, modification time, and size.

Content and ordering changes retain identity. A filesystem rename is modeled as deletion of the old
path and creation of the new path. The File Navigator does not infer renames from inode/device values
or adjacent watcher events, and it does not transfer selection or interaction history automatically.
Selection reconciles normally if the selected identity disappears.

### Public file metadata

File entries are plain immutable values containing normalized absolute identity/path, forward-slash
relative path, basename, lowercased extension, size, and `mtimeMs`. The public contract does not expose
raw `fs.Stats`, access/change/birth timestamps, inode/device identifiers, git status, file content, or
MIME detection. Strategies and renderers therefore remain serializable and independent of the active
filesystem backend.

## Live synchronization

Filesystem watching is enabled by default. `watch={false}` selects a static-snapshot mode that runs
the policy-aware scanner without creating a filesystem subscription. Changing discovery inputs still
starts a new scan in either mode.

House uses live synchronization. Static-snapshot mode exists for immutable trees, constrained
filesystems, deterministic tests, and callers that arrange refresh externally.

### Initial streaming and generation changes

Initial discovery streams files into immutable, ordered snapshots before the scan reaches readiness.
Updates are batched so large trees do not require one render per file. Later batches may move rows but
do not replace a retained selected identity merely because a newly discovered file ranks earlier.

Changing root, recursion, or Discovery Policy cancels and awaits the previous watcher generation,
clears files and selection immediately, and starts a new scanning generation. Late events from a
cancelled generation are ignored. Files from the old Discovery Scope are never displayed while the
new scope is scanning.

Changing root starts with fresh selection. For a recursion or Discovery Policy change on the same
root, File Navigator provisionally remembers the prior selected identity: it restores that file if it
remains eligible, otherwise it selects the first file after the scan establishes that restoration is
impossible. It does not temporarily select another streamed row while waiting for the prior identity.

This is deliberately easy to revise after field use. If restoration feels surprising, same-root
setting changes may later adopt the simpler rule of always selecting the first result; no persistence
or public identity contract depends on restoration.

### Authoritative refresh

`refresh()` keeps the current collection and selection visible while the policy-aware scanner scans
the active scope. Live events are buffered during the scan, the completed snapshot is reconciled
atomically, buffered paths are restatted, and browse/search projections are reapplied. Concurrent
calls share one in-flight refresh.

The returned promise resolves after the reconciled snapshot commits. Failure retains the last valid
collection, clears `scanning`, exposes and diagnoses the refresh error, and rejects the shared promise.

### Discovery and watcher dependencies

No mature npm package combines deterministic streaming, arbitrary directory policy, nested ignore
files, depth control, metadata, cancellation, and a reusable live matcher. The implementation
therefore owns a small generic cascade scanner built on Node-compatible directory reads and the
established `ignore` parser. The scanner loads each directory's active policy files before sorting and
descending, streams deterministic structural entries, and is authoritative for initial discovery,
static mode, explicit refresh, and subtree reconciliation.

`@parcel/watcher` 2.6.0 is the approved event source. It normalizes create, update, and delete events
and provides async teardown. Backend events are invalidation hints rather than authoritative
membership changes. A directory-create or ignore-policy-file event schedules policy-aware scanner
reconciliation. The adapter subscribes to the configured root's physical path and any minimal external
physical targets needed for followed lexical symlinks, then maps events back to lexical identities.

In live mode the backend subscription and authoritative scanner use a reconciliation handoff that
accounts for mutations during subscription startup and scanning. Native subscriptions may observe a
broader root than Discovery Scope; only policy-approved scanner results can enter the collection. The
File Navigator does not wrap raw `fs.watch` or create a generalized watcher framework. It retains the
last valid collection if the backend reports an error and exposes the error to its caller.

The public watch configuration is backend-neutral and does not expose raw Parcel options. It includes
`consistencyIntervalMs`, which controls periodic authoritative reconciliation independently of normal
event delivery. On Linux it defaults to `60_000`; callers may configure or disable it. Normal backend
events remain immediate. On macOS it defaults to disabled because FSEvents surfaces overflow and
root-change invalidation. A periodic tick always runs the same policy-aware authoritative scanner and
never populates the collection directly from events; it is consistency reconciliation, not implicit
event-backend polling.

Parcel's Linux backend silently drops `IN_Q_OVERFLOW`, so a rare overflow can leave the collection
stale until the next consistency tick. With the default, that staleness is bounded by one minute.
Based on native macOS first-scan measurements and Linux container evidence for 10k trees, one scan per
minute is estimated at roughly 0.5-1.3% amortized scanner wall-time. This estimate combines different
environments and is not a native cross-platform performance comparison.

The feasibility choice passed these adoption gates:

1. Benchmark the selected backend under Bun against a representative large tree.
2. Verify its subscription/startup and new-directory races through authoritative reconciliation.
3. Verify the scanner and backend through actual discovery and mutation in standalone binaries on the
   four target combinations, not only `--version`.

The production standalone and installed-package mutation smokes passed as Plan 007 release integration
gates. They do not reopen the approved backend decision when the exact approved build path is used.

Chokidar 5.0.0 remains rejected after Bun 1.3.10 crashed in a required 10k event-mode cell. Parcel
Watcher passed all 11 correctness scenarios and 3/3 repeats on darwin-arm64 native, darwin-x64 under
Rosetta, linux-arm64 in native-architecture Docker, and linux-x64 under emulation. Generated
platform-static native binding plus Parcel's `createWrapper` is mandatory for Bun standalone builds;
Parcel's computed dynamic require does not bundle correctly. Static standalone mutation and clean exit
passed on all four targets without source `node_modules`.

Native darwin-arm64 passed the full 1k/5k/10k broad/deep matrix and the 10k broad 3x100 cell.
Linux-arm64 also passed 10k broad 3x100 without a crash. Rosetta, emulated, and container timings are
behavioral evidence only, not native performance comparisons. The owner explicitly approved Parcel
2.6.0 and the Linux consistency policy in this design session on 2026-08-01.

## Ordering model

Browse order and search ranking are separate stages.

With no active query, a named File Order Strategy determines browse order. The library provides at
least:

- Structural tree order, compatible with House's current files-before-directories DFS behavior.
- Recently modified order based on filesystem `mtime`.

The public `order` prop accepts out-of-the-box names or a custom strategy object:

```ts
type FileOrder = "tree" | "recently-modified" | FileOrderStrategy
```

Omitting `order` selects `"tree"`. The caller chooses the active order and owns any picker, keybinding,
configuration, or persistence. File Navigator does not render a sort selector. Changing order
reprojects the current collection without rescanning or restarting the watcher and retains selected
identity.

Structural tree order uses files-before-subdirectories hierarchy and a caller-configurable
`Intl.Collator`. Its default collator uses the runtime locale without implicitly enabling numeric or
case-insensitive comparison. Normalized relative path is the final tie-breaker when the collator
considers names equivalent. Consumers may construct a tree strategy with a pinned locale and options.

Callers may supply additional named strategy objects. The File Navigator copies before sorting,
applies deterministic final tie-breaking, and retains selection by stable identity when order changes.

The built-in recently modified strategy is defined as:

1. Filesystem `mtimeMs` descending.
2. Structural tree order.
3. Normalized relative path.

It does not use creation time, git status, time buckets, or decay. Nested files may precede root files
when modified more recently. A changed selected file may move while remaining selected by identity.
Future-dated timestamps are not silently corrected.

With an active query, ordering is:

1. Fuzzy relevance descending.
2. Interaction frecency descending, if enabled.
3. Selected browse order.
4. Stable relative path.

Browse order and frecency never overpower an obviously better query match.

### Default search strategy

The library provides an out-of-the-box `fuzzysort`-backed Search Strategy. It uses the established
library's relative-path matching and ranking rather than reproducing House's custom filename, stem,
root, and depth bonuses. Equal fuzzy scores fall back to selected browse order and stable relative
path.

House adopts the independent File Navigator's default behavior. The new component and default Search
Strategy do not contain compatibility logic intended to preserve House's current result order. Search
outcomes may therefore change when House migrates.

Search Strategy remains a replaceable library boundary for consumers with different requirements,
but House does not initially supply a custom strategy.

The public `search` prop accepts `"fuzzy"` or a named custom Search Strategy and defaults to
`"fuzzy"`. Empty queries bypass search. A strategy scores only entries from the already browse-ordered
collection; File Navigator owns descending score order, browse-order and path tie-breakers, and
selection. Changing Search Strategy reprojects the active query without rescanning or restarting the
watcher. The component does not render a search-engine selector.

### Controlled query and debounce

The caller's `query` is immediate while the snapshot's `appliedQuery` identifies the value currently
used for search results. File Navigator applies query changes after a configurable 50 ms debounce by
default; zero disables debouncing. The initial query and an empty query apply synchronously.

An imperative `flushQuery(query)` applies its explicit immediate value and returns the resulting
snapshot. Order and collection changes re-evaluate the already-applied query immediately. Pending
timers are cancelled when the component unmounts or changes discovery generation.

When root, recursion, or Discovery Policy changes while a newer controlled query is still waiting for
debounce, the new discovery generation applies that latest controlled query synchronously. It never
starts a new scope with stale `appliedQuery` text.

### Deferred interaction frecency

Interaction frecency is an intended extension, but not part of the initial implementation. The first
change does not track opens, persist behavioral history, or export a built-in frecent order.

The named File Order Strategy boundary must leave room for a future `frecentOrder`. When that work is
taken up, FFF's bounded timestamp decay is the preferred research reference; the product must first
decide what counts as an open, persistence scope, cooldown, cleanup, privacy, and multi-process
behavior.

## Research dependencies

See [`file-navigator-ranking-research.md`](./file-navigator-ranking-research.md) for analysis of FFF,
`fuzzysort`, `@parcel/watcher`, and other implementation options.

## Migration policy

`@house/ui` is private, so the migration is atomic and has no deprecated compatibility surface. The
current presentation-only FileNavigator becomes Sidebar, the new filesystem-aware component takes the
FileNavigator name, House's Sidebar adapter is absorbed or removed, and discovery leaves
`DiscoverShell`. Old controller and filter APIs are removed once no consumer remains.

The change may be staged in reviewable commits, but the final package exposes one coherent API. House
does not retain compatibility code for its old fuzzy order. User-visible live synchronization and
search-order changes are recorded in the changelog.

## Shipped implementation notes

The design interview and Plan 007 implementation are complete. The following remain the exact contracts
and operational constraints of the shipped implementation:

- Concrete custom order/search strategy type shapes and error behavior.
- Generation-linearized scan/event handoff and callback commit ordering.
- Stable policy revisions that do not restart watchers because callback identities churn.
- Nested ignore precedence, negation, diagnostics, and control-file changes.
- Exact snapshot error clearing and diagnostic ordering.
- Carry the approved Parcel adapter handoff and Linux consistency behavior into implementation tests.
- Generate a host-static Parcel native binding on every standalone release runner.
- Standalone and installed-package tests exercise real discovery and mutation through the smoke commands
  `bun run --cwd apps/house smoke:file-navigator:standalone` and
  `bun run --cwd apps/house smoke:file-navigator:installed`.
- House adopts the package through `@house/ui/file-navigator`; the filesystem-free presentation boundary
  remains `@house/ui/sidebar`.
- The supported distribution is four-target npm platform packages plus standalone archives. Each
  standalone runner uses a host-static Parcel native binding and Parcel's `createWrapper`.
