# File navigator ranking research

**Status:** Research for the filesystem-aware `@house/ui/FileNavigator` design
**Date:** 2026-07-26
**Primary reference:** [FFF v0.9.4](https://github.com/dmtrKovalenko/fff/tree/v0.9.4)

## Executive summary

FFF is a useful design reference and a possible opt-in high-performance backend, but its complete
ranking model should not become the default contract of `@house/ui/FileNavigator`. FFF deliberately
blends fuzzy relevance, access history, filesystem modification time, git status, current-file
proximity, filename bonuses, and query-specific history. That policy is too opinionated for an
independent UI library.

The File Navigator should treat these as independent concepts:

1. **Browse order:** structural/tree order or an explicitly selected alternative.
2. **Modification recency:** filesystem `mtime`; this means “changed recently,” not “used often.”
3. **Interaction frecency:** decayed history of files the user explicitly opened.
4. **Query relevance:** fuzzy match quality for the current query.

Recommended reuse:

- Use [`fuzzysort`](https://github.com/farzher/fuzzysort) directly for query matching and ranking.
- Use `@parcel/watcher` 2.6.0 as the normalized event source behind a narrow adapter.
- Adapt FFF's bounded timestamp-decay model if interaction frecency is added.
- Do not copy FFF's total blended score or its git-dependent modification score.
- Consider `@ff-labs/fff-bun` or `@ff-labs/fff-node` only as an optional backend if very-large-tree
  performance justifies native package distribution and more opinionated semantics.

## Terminology

### Browse order

The ordering used when no query is active. Tree order and recently modified order are browse-order
strategies.

### Modification recency

Ordering by filesystem `mtime`, normally newest first. It reflects writes from any source and is not
evidence that the user opened or valued a file.

### Interaction frecency

A decayed score calculated from explicit user opens. Frequency rewards repeated opens; recency makes
old opens lose influence.

### Query relevance

How well a query matches a file path or filename. This is independent of whether a file is recent or
frequently opened.

## Confirmed FFF behavior

### Access history

FFF stores a chronological list of Unix-second access timestamps for each file. The identity is a
BLAKE3 hash of the UTF-8 path string; it is path-based rather than inode-based. Each file retains at
most 128 timestamps.

Sources:

- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L11-L25)
- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L194-L265)

In the Neovim integration, a valid file `BufEnter` records an access asynchronously after resolving
the real path. Merely navigating directories does not record an access.

- [`lua/fff/core.lua`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/lua/fff/core.lua#L15-L42)
- [`crates/fff-nvim/src/lib.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-nvim/src/lib.rs#L521-L575)

FFF's AI mode also treats filesystem create/modify events as accesses, with a five-minute per-file
cooldown. Normal filesystem read/open events are ignored because previews and indexer reads would
pollute history.

- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L28-L35)
- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L416-L428)
- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L607-L648)

For a generic File Navigator, filesystem changes should not count as user interaction. They belong to
modification recency.

### Frecency formula

For an access `d` days old, normal mode assigns:

```text
weight(d) = exp(-0.0693 × d)
```

This gives an approximate ten-day half-life. Accesses older than 30 days are ignored. AI mode uses an
approximate three-day half-life and a seven-day cutoff.

The weighted accesses are summed:

```text
raw = sum(weight(accessAgeDays))
```

Diminishing returns apply above ten weighted accesses:

```text
score = raw                         when raw <= 10
score = 10 + sqrt(raw - 10)        when raw > 10
final = round(score)
```

With the 128-timestamp cap, 128 fresh accesses produce only about 21 points. This prevents repetitive
opening from increasing rank without bound.

- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L306-L350)

### Query-specific history

FFF separately remembers the selected file for an exact raw query. Its key hashes the project path
and query. Repeatedly selecting the same file increments `open_count`; selecting a different file for
that query replaces the association and resets the count.

The default query-affinity boost starts after three selections and is approximately:

```text
openCount × 100
```

Although `last_opened` is persisted, query affinity does not decay and stale associations are not
cleaned up. This is distinct from global access frecency.

- [`crates/fff-core/src/dbs/query_tracker.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/query_tracker.rs#L13-L38)
- [`crates/fff-core/src/dbs/query_tracker.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/query_tracker.rs#L227-L280)
- [`crates/fff-core/src/score.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/score.rs#L684-L704)

Query-specific affinity is not recommended initially. It adds persistence and surprising rank changes
before ordinary interaction frecency has proven useful.

### Modification score

FFF records each indexed file's size, `mtime`, git status, access score, and modification score.
However, its modification score is nonzero only when the file currently has modified git status. It
is therefore not a generic “recently modified” strategy: a newly written non-git file can receive no
modification boost.

Normal-mode modification points decay through these thresholds:

| Age               | Score |
| ----------------- | ----: |
| At most 2 minutes |    16 |
| 15 minutes        |     8 |
| 1 hour            |     4 |
| 1 day             |     2 |
| 1 week            |     1 |
| Older             |     0 |

Values are linearly interpolated between thresholds.

- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L27-L42)
- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L352-L395)

The File Navigator's recently modified strategy should use filesystem `mtime` directly and should not
depend on git status.

### Empty-query order

FFF does not preserve structural tree order when the query is empty. It calculates:

```text
emptyScore = accessScore + 4 × modificationScore
```

Git-dirty files receive an additional boost, and the current file is heavily penalized. Results are
ordered by total score descending, then `mtime` descending.

- [`crates/fff-core/src/score.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/score.rs#L801-L942)

This is a deliberate “most interesting files first” projection, not a filesystem browsing order.

### Query ranking

FFF delegates base fuzzy matching to the Rust `neo_frizbee` crate, then combines many signals:

```text
total = baseFuzzyScore
      + proportionalFrecencyBoost
      + gitBoost
      + pathDistanceAdjustment
      + filenameBonus
      + currentFilePenalty
      + queryHistoryBoost
      + pathAlignmentBonus
```

Its frecency contribution is proportional to fuzzy relevance:

```text
frecencyBoost = baseFuzzyScore × (accessScore + modificationScore) / 100
```

Matched files are ordered by total score and then `mtime`.

- [`crates/fff-core/src/score.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/score.rs#L597-L799)
- [`crates/fff-core/src/score.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/score.rs#L877-L942)

This makes frecency part of both browse order and query ranking. The independent File Navigator should
not inherit that coupling accidentally.

### Persistence and path changes

FFF persists access and query history in LMDB through `heed`, using Bincode values. The Node/Bun APIs
do not choose a default location; persistence is skipped unless the caller supplies database paths.

Old access timestamps are removed, and records containing only expired timestamps are garbage
collected. Query associations do not have equivalent stale-association cleanup.

Deletes remove files from the in-memory index but do not delete their history. Rename-like events are
handled as old-path removal plus new-path addition. Because identity is a path hash, history does not
transfer to the new path; the old record remains until time-based cleanup.

- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L70-L78)
- [`crates/fff-core/src/dbs/frecency.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/dbs/frecency.rs#L121-L192)
- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L461-L499)
- [`crates/fff-core/src/file_picker.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/file_picker.rs#L1535-L1595)

### Filesystem watching

FFF uses Rust `notify` with a 50 ms full debouncer. It uses one recursive watch on macOS and Windows,
but nonrecursive per-directory watches on Linux. Create, update, and remove events reconcile the
index; ignore-file changes and overflow/rescan events trigger broader rescans.

- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L1-L35)
- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L55-L97)
- [`crates/fff-core/src/background_watcher.rs`](https://github.com/dmtrKovalenko/fff/blob/v0.9.4/crates/fff-core/src/background_watcher.rs#L430-L605)

Its defensive behavior is worth retaining: watcher events should request reconciliation, and the
navigator should restat affected paths rather than assuming event metadata is authoritative.

## Reuse options

| Option              | Direct TypeScript/Bun reuse | Strengths                                                                                                                   | Costs and constraints                                                      |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `fuzzysort`         | Yes                         | Pure JS, TypeScript declarations, prepared targets, multi-key matching, thresholds, match indexes, custom score composition | No filesystem semantics or typo edit-distance matching                     |
| `@parcel/watcher`   | Yes                         | Mature cross-platform native event API                                                                                      | Native optional packages; navigator still owns metadata and reconciliation |
| `@ff-labs/fff-bun`  | Yes, Bun only               | Scan, watch, metadata, git, fuzzy search, native performance                                                                | Opinionated blended score and native platform distribution                 |
| `@ff-labs/fff-node` | Yes, Node only              | Same FFF core through Node FFI                                                                                              | Separate runtime adapter and native platform distribution                  |
| `neo_frizbee`       | No direct JS API            | Fast SIMD typo-tolerant matcher                                                                                             | Rust binding or FFF dependency required                                    |
| Ripgrep `--files`   | Through subprocess          | Fast streaming discovery with mature ignore handling                                                                        | Needs a binary, `stat` metadata, and a separate watcher                    |

Both FFF packages are MIT-licensed. Version 0.9.4 publishes native packages for macOS, Linux, and
Windows on x64 and arm64. FFF's Bun and Node APIs are separate packages, which is meaningful for an
independent library expected to support both runtimes.

References in this repository:

- `reference/opencode/bun.lock:318,1627-1643`
- `reference/opencode/packages/core/src/filesystem/fff.bun.ts:1-13`
- `reference/opencode/packages/core/src/filesystem/search.ts:122-227`

### Why `fuzzysort` is the strongest query-ranking candidate

`fuzzysort` is an established pure-JavaScript matcher. It supports prepared targets, result limits,
thresholds, multi-key object search, custom score composition, and matched-character indexes for
highlighting. OpenCode already combines its score with a separate frecency factor through `scoreFn`.

- [`fuzzysort` source](https://github.com/farzher/fuzzysort/blob/v3.1.0/fuzzysort.js#L23-L169)
- `reference/opencode/packages/tui/src/component/prompt/autocomplete.tsx:488-524`

Its important limitation is that characters must remain in order. It is not typo-edit-distance
matching like `neo_frizbee`; transposed or substituted characters can fail to match.

### Why `@parcel/watcher` is the strongest watcher candidate

`@parcel/watcher` supplies normalized create, update, and delete events without imposing discovery or
ranking policy. OpenCode demonstrates dynamic platform loading, teardown, and a graceful no-watcher
fallback.

- `reference/opencode/packages/core/src/filesystem/watcher.ts:20-35,51-104`

It should remain behind a narrow internal watcher boundary so event backends can change without
changing the public File Navigator API.

### Discovery/watch decision after ecosystem survey

The design uses a small policy-aware scanner built on Node-compatible directory reads and the
established `ignore` parser as the single source of truth for initial discovery, static mode, refresh,
and subtree reconciliation. `@parcel/watcher` 2.6.0 supplies normalized live invalidation events only;
physical watcher pruning was explicitly relaxed while scanner traversal and collection membership
remain strict. No mature scanner package satisfies the full neutral contract without hard-coded policy
or missing depth/stream/cancellation behavior.

Parcel passed the four-target correctness, repeat, standalone, and required stress gates and was
explicitly approved by the project owner on 2026-08-01. Chokidar remains rejected after its Bun 10k
event-mode crash. Parcel stays behind a narrow backend-neutral boundary: Linux uses the approved
configurable/disableable 60-second authoritative consistency scan because Parcel hides inotify
overflow, and Bun standalone builds use a generated platform-static native binding with Parcel's
`createWrapper` because the computed dynamic require does not bundle correctly.

Sources:

- [Chokidar 5 documentation](https://github.com/paulmillr/chokidar/blob/5.0.0/README.md)
- [`ignore` package](https://github.com/kaelzhang/node-ignore)
- [Bun issue #34160](https://github.com/oven-sh/bun/issues/34160)
- [Chokidar issue #1471](https://github.com/paulmillr/chokidar/issues/1471)
- [`@parcel/watcher` feasibility evidence](./file-navigator-parcel-feasibility.md)

## OpenCode's FFF integration: a caution

OpenCode creates FFF without access-history or query-history database paths. In FFF 0.9.4, omitted
paths skip those trackers. Consequently, that integration does not get persistent access frecency or
query affinity despite UI comments implying that FFF's file order includes frecency.

OpenCode also re-sorts FFF output by score and then shorter path, replacing FFF's own `mtime`
tie-breaker.

- `reference/opencode/packages/core/src/filesystem/search.ts:122-227`
- `reference/opencode/packages/tui/src/component/prompt/autocomplete.tsx:323-357`

OpenCode has a separate JSONL frecency store with this score:

```text
frequency / (1 + ageInDays)
```

It records opens when a file is inserted into a prompt and retains the 1,000 most recently opened
paths, but this score is not applied to FFF file results.

- `reference/opencode/packages/tui/src/prompt/frecency.tsx:8-76`

The lesson is that selecting a mature backend does not remove the need to define and test the adapter's
semantics. Configuration can silently disable the behavior the product expects.

## Recommended File Navigator contract

### Reuse mechanisms, retain explicit policy

```text
discovery and reconciliation
  established scanner or bounded filesystem implementation
  + stat metadata
  + @parcel/watcher events

browse projection
  tree | recently-modified | optionally frecent

query projection
  fuzzysort relevance
  + optional interaction-frecency tie-breaker or bounded boost
  + stable browse position

presentation
  Sidebar
```

### Interaction history

If frecency is added, adapt FFF's bounded timestamp decay and update it only from an explicit committed
open operation, such as `recordOpen(fileId)`. Do not count:

- Initial discovery.
- Watcher events.
- Preview rendering.
- Content reads or syntax highlighting.
- Moving the highlighted row without opening it.

Persistence should be optional and injected or configured. A persistence failure should not make
navigation unavailable.

### Determinism

Every strategy needs a deterministic final tie-breaker. Stable relative path is preferable for a
recently modified list because watcher reconciliation can otherwise cause equal-`mtime` rows to jump.
Tree order can preserve its structural discovery index.

## Decided ordering contract

The design interview established that query relevance remains primary whenever a query is active:

```text
empty query:
  explicitly selected browse-order strategy

non-empty query:
  fuzzy relevance descending
  interaction frecency descending, if enabled
  selected browse order
  stable relative path
```

This keeps a weak but frequently opened match from displacing an obvious exact filename match. If
frecency proves too subtle as a secondary criterion, use an explicit recent/frequent mode rather than
allowing it to overpower relevance or adopting FFF's entire blended score accidentally.

### Strategy extensibility

Browse order uses named, extensible strategy objects rather than a closed string union or anonymous
comparator as the primary API. The library provides at least structural tree order and recently
modified order, while callers may provide additional strategies.

A strategy has stable identity and comparison behavior. The File Navigator owns copying, sorting,
deterministic final tie-breaking, and selection retention. Changing strategy may move the selected
file's index but does not change its stable selected identity.

Strategies affect browse order only. They do not replace relevance-first search ranking.

## Deferred frecency questions

When interaction frecency is scheduled, decide:

1. What counts as an open.
2. Whether repeated opens use a cooldown.
3. Whether history is global, per discovery root, or per navigator instance.
4. Whether history migrates when a file is renamed.
5. Whether query-specific affinity should ever be supported.

## Scope decision

Interaction frecency is deferred from the initial File Navigator implementation. The extensible File
Order Strategy API must permit a future frecent strategy, but the initial library does not track or
persist user behavior. FFF's bounded timestamp-decay model remains the preferred reference when that
feature is scheduled.
