# Parcel Watcher Feasibility

**Conclusion:** `approved` on 2026-08-01 for `@parcel/watcher` 2.6.0
**Decision:** Explicit project-owner approval after the four-target empirical gate

## Source assessment

**Historical rejection under a superseded constraint.** The first source review rejected
`@parcel/watcher` 2.6.0 because it cannot physically prune native watching to Discovery Scope. The
design session subsequently relaxed that requirement: scanner traversal and collection membership
remain strict, while the native backend may observe a broader recursive root. Plan 004B then reopened
for empirical testing and passed.

The source findings below remain constraints and risks; they are no longer all adoption blockers.
The project owner explicitly approved Parcel 2.6.0 and the Linux consistency policy on 2026-08-01.
Plans 005-007 are unblocked; House production behavior remains unchanged until those plans execute.

## Scope And Method

The review inspected the public API, JavaScript wrapper, N-API binding, macOS FSEvents backend, Linux
inotify backend, shared event/debounce code, package metadata, upstream tests, and official platform
documentation. Source citations use the npm package's recorded `gitHead`,
[`b46c53f`](https://github.com/parcel-bundler/watcher/commit/b46c53feb075c9dfd2c87d2183eb259df384d90b).
That commit follows the `v2.6.0` tag only to adjust release packaging; the cited source ranges are
unchanged.

The npm registry identifies 2.6.0 as MIT-licensed, N-API v3, and published with optional native
packages for House's macOS and Linux x64/arm64 targets:

- [official npm registry metadata](https://registry.npmjs.org/@parcel%2Fwatcher/2.6.0)
- [v2.6.0 release, published 2026-07-20](https://github.com/parcel-bundler/watcher/releases/tag/v2.6.0)
- [package metadata and N-API declaration](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/package.json#L1-L72)

No result below is inferred from callback silence. Native topology claims come from the backend source.

## Accepted Contract

The governing design now requires:

- recursive mode to discover only the complete eligible subtree;
- nonrecursive mode to scan/include root files only;
- `includeDirectory` to prune scanner traversal and collection membership;
- a broader native subscription to remain unable to inject out-of-scope files;
- lexical symlink roots and optional followed external nested symlinks;
- best-effort watcher invalidations for backend-delivered updates even when public size or `mtimeMs`
  does not change;
- authoritative watch-before-scan reconciliation without missed final membership;
- surfaced watcher failures so the scanner can recover authoritatively.

The earlier physical-watch-pruning requirement was intentionally relaxed after this source assessment.

## Source constraints and risks

### No Hard Nonrecursive Boundary

The public options contain only `ignore` and `backend`; there is no depth or recursive option:

- [public `Options` API](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/index.d.ts#L4-L15)
- [upstream nonrecursive feature request #92](https://github.com/parcel-bundler/watcher/issues/92)

The package documents watching as recursive, including changes in subdirectories:

- [recursive watching contract](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/README.md#L36-L42)

Ignore patterns cannot emulate the required root-only boundary. Matching receives a relative pathname,
not an entry type:

- [wrapper conversion from globs to regular expressions](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/wrapper.js#L5-L50)
- [native relative-path matching](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/Watcher.cc#L218-L240)

A pattern matching every one-component directory also matches root-level files. A pattern requiring a
separator leaves immediate directories unmatched, allowing Linux to watch them and macOS to continue
observing them through its recursive stream. Enumerating current directory paths is not durable for
directories created later and does not provide a type-aware rule.

This prevents native depth pruning, but it no longer rejects Parcel by itself. The scanner must enforce
the root-only collection boundary despite broader event observation.

### macOS Uses One Recursive Root Stream

The FSEvents backend creates one stream whose sole watched path is the configured root and enables
per-file events:

- [root stream construction](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/macos/FSEventsBackend.cc#L206-L234)

Literal ignore paths are passed to `FSEventStreamSetExclusionPaths`, but this is an exclusion filter on
the root stream, not a pruned directory-subscription topology:

- [FSEvents exclusion setup](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/macos/FSEventsBackend.cc#L236-L250)

Glob and RegExp ignores are not passed to FSEvents. Delivered paths are checked in the callback:

- [callback ignore check](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/macos/FSEventsBackend.cc#L97-L110)
- [cross-platform glob discrepancy #171](https://github.com/parcel-bundler/watcher/issues/171)

Apple describes FSEvents as an advisory stream and requires monitored directories to be rescanned when
events are dropped or coalesced:

- [Apple File System Events Programming Guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html)

Parcel's macOS architecture confirms that event observation can be broader than scanner membership.
The adapter must reconcile through the policy-aware scanner and never populate from callbacks directly.

### Linux Silently Loses Overflow

The inotify backend recognizes `IN_Q_OVERFLOW` and immediately continues. It records no error, emits no
invalidation, and requests no rescan:

- [silent overflow branch](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/linux/InotifyBackend.cc#L117-L125)

Linux documents that overflow drops events and robust applications may need to rebuild their cache:

- [official `inotify(7)` overflow guidance](https://man7.org/linux/man-pages/man7/inotify.7.html)

House cannot trigger event-driven recovery for a condition the backend hides. The owner explicitly
accepted a Linux-only default `consistencyIntervalMs=60_000`, configurable or disableable through a
backend-neutral watch setting. Normal events remain immediate. Each periodic tick performs an
authoritative policy-aware scanner reconciliation and never populates from events. Rare-overflow
staleness is therefore bounded by one interval rather than left unbounded.

### Linux Symlink Semantics Require Adapter Mapping

Linux intentionally avoids following symlinks:

- [physical FTS traversal](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/unix/fts.cc#L19-L22)
- [`IN_DONT_FOLLOW | IN_ONLYDIR` watch mask](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/linux/InotifyBackend.cc#L8-L12)
- [`lstat` used to avoid following new symlinks](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/linux/InotifyBackend.cc#L165-L179)

A lexical symlink directory root therefore fails unless a caller canonicalizes it before subscription:

- [symlink-root report and realpath workaround #62](https://github.com/parcel-bundler/watcher/issues/62)

Nested directory symlinks are not followed. A target outside the watched physical tree cannot be
observed through the root subscription. Supporting the accepted external-following policy would require
separate target subscriptions, cycle-aware topology, and lexical event rewriting that Parcel does not
expose as a mode.

The upstream test also establishes that modifying a file through a symlink reports the physical target
path rather than the lexical symlink path:

- [symlink update expectation](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/test/watcher.js#L416-L429)

This cannot satisfy lexical identity directly. The approved adapter subscribes to physical roots and
minimal followed external targets discovered by the scanner, then maps backend paths to lexical
identities. The four-target correctness matrix passed lexical root, external target, and cycle cases.

### macOS Suppresses Same-mtime Updates

The FSEvents backend stats modified paths and discards a modification when its nanosecond-resolution
`mtime` equals the cached value:

- [duplicate-event suppression](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/macos/FSEventsBackend.cc#L122-L146)

Restoring or preserving an `mtime` before FSEvents handles the event can suppress invalidation. The
approved contract is therefore best-effort for events Parcel delivers, not a guarantee for physically
unobservable same-metadata rewrites. For a delivered event, public size and `mtimeMs` equality still
does not suppress selected-file invalidation.

### Linux Crawls Before Watching

Linux subscription first builds a complete directory tree, then loops over that result and registers an
inotify watch for each directory:

- [crawl-then-watch sequence](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/linux/InotifyBackend.cc#L66-L79)
- [recursive FTS crawl](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/unix/fts.cc#L19-L49)

A directory created after its parent was crawled but before that parent receives a watch can be absent
from both the internal tree and permanent native topology. Parcel exposes no API to add one directory
to an existing subscription. A later House scan may discover the directory's current files but cannot
repair future watching without restarting the whole subscription.

The related post-readiness race is independently reported: files created immediately inside a new
directory can precede registration of that directory's inotify watch:

- [immediate-child race #243](https://github.com/parcel-bundler/watcher/issues/243)
- [recursive `mkdir -p` gap #97](https://github.com/parcel-bundler/watcher/issues/97)

A directory-create-triggered subtree scan can reconcile ordinary post-readiness membership. It cannot
prove or dynamically repair topology missed during Parcel's own initial crawl-before-watch gap. The
approved periodic Linux scan still reconciles membership, bounding staleness even if native topology
misses a later event.

## Backend Distinctions

Linux ignore handling is stronger than macOS callback filtering in the uncomplicated single-watcher
case. During FTS traversal, an ignored directory receives `FTS_SKIP`, so descendants are not read and
the directory is absent from later watch registration:

- [Linux traversal pruning](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/unix/fts.cc#L29-L46)

New directories are checked against ignores before Parcel calls `watchDir`:

- [event-time ignore and registration](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/linux/InotifyBackend.cc#L151-L183)

At source-review time that did not rescue adoption because the matcher is not type-aware and
nonrecursive mode remains unexpressible. The approved scanner-only membership boundary and periodic
Linux consistency policy address those constraints outside Parcel. The topology cache also keys only
on root, not ignore policy, so subscriptions with different policies can reuse an incompatible tree:

- [root-only `DirTree` cache key](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/DirTree.cc#L31-L46)
- [confirmed cache-policy bug #240](https://github.com/parcel-bundler/watcher/issues/240)

## Event Semantics

Parcel emits `create`, `update`, and `delete`; a rename is delete-old plus create-new, which matches the
File Navigator's public rename model:

- [documented rename and coalescing behavior](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/README.md#L36-L53)

Its event list coalesces by path:

- create plus update remains create;
- create plus delete disappears;
- delete plus create becomes update;
- update plus delete becomes delete;
- output order follows the path-keyed map rather than native temporal order.

Source:

- [path-based event coalescing](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/Event.hh#L30-L68)

The shared debouncer uses a 50 ms minimum wait and 500 ms maximum interval. The first event after an
idle interval may be delivered separately from the rest of a burst:

- [debounce constants](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/Debounce.hh#L9-L10)
- [debounce behavior](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/Debounce.cc#L70-L97)

These semantics require the approved scanner reconciliation but are not themselves a rejection basis.

## Readiness And Rescan

The JavaScript `subscribe()` promise resolves after native `backend->watch()` completes:

- [subscription runner](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/binding.cc#L165-L190)
- [N-API async-work completion](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/PromiseRunner.hh#L47-L68)

There is no initial event stream, snapshot, or separate readiness callback. On macOS, completion follows
successful `FSEventStreamStart`; on Linux, it follows the unsafe crawl-then-register sequence. A
watch-first authoritative scan with buffered invalidations remains necessary, but cannot repair a
directory absent from Parcel's native topology.

macOS converts FSEvents dropped-event flags into an error saying the filesystem must be rescanned, but
does not rescan itself:

- [FSEvents overflow reporting](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/macos/FSEventsBackend.cc#L82-L90)

Error-only delivery has an additional uncertainty because `Watcher::notify()` wakes the debouncer only
when ordinary events exist:

- [notification gate](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/src/Watcher.cc#L68-L79)

That uncertainty informed the empirical gate. macOS correctness passed, while Linux's hidden overflow
is addressed independently by periodic scanner reconciliation.

## Secondary Risks

The following findings increase adoption risk but did not determine the historical source-stage
rejection.

### Dynamic Native Loading

The main package computes a platform package name at runtime and calls `require(name)`, falling back to
local build paths:

- [dynamic loader](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/index.js#L3-L31)

Each optional platform package exposes one `watcher.node` file as its main entry:

- [platform package generation](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/scripts/build-npm.js#L96-L130)

Bun supports N-API and standalone `.node` embedding, but its official executable documentation says the
addon must be required directly or it will not bundle correctly:

- [Bun Node-API support](https://bun.sh/docs/runtime/node-api)
- [Bun executable N-API embedding](https://bun.sh/docs/bundler/executables#embed-n-api-addons)

Parcel's computed require does not embed correctly in House's standalone binary. The mandatory build
path generates a platform-static native binding import and passes it to Parcel's `createWrapper`.
Static standalone mutation and clean exit passed on all four targets without source `node_modules`;
the ordinary computed dynamic require failure remains recorded rather than treated as a fallback.

### Bun Coverage

Upstream runs its Mocha suite under Node LTS, not Bun:

- [upstream test matrix](https://github.com/parcel-bundler/watcher/blob/b46c53feb075c9dfd2c87d2183eb259df384d90b/.github/workflows/test.yml#L20-L68)

The suite covers ordinary mutations, callback ignores, basic symlink entries, coalescing, teardown, and
worker threads. It does not cover hard depth boundaries, native pruning proof, overflow, mutation during
subscription, lexical symlink roots, external followed symlinks, Bun, or compiled executables.

Relevant Bun history remains mixed:

- [older native-addon crash, considered fixed in Bun 1.3.1+](https://github.com/oven-sh/bun/issues/13516)
- [optional platform dependency fix verified after House's pinned Bun 1.3.10](https://github.com/oven-sh/bun/issues/19282)
- [still-open Parcel install/prebuild report #204](https://github.com/parcel-bundler/watcher/issues/204)

### Additional Native Risks

Open reports include a native stack overflow when glob ignores match long paths and a possible callback
payload leak when N-API callback queueing fails:

- [glob matcher stack overflow #250](https://github.com/parcel-bundler/watcher/issues/250)
- [possible callback payload leak #255](https://github.com/parcel-bundler/watcher/issues/255)

These warranted process-isolated stress tests during the empirical stage and remain upstream risks.

## Initially unexecuted stages

Plan 004B intentionally stopped after source and package inspection. It did not:

- install `@parcel/watcher` or any platform package;
- add a dependency, adapter, fixture, test, or generated configuration;
- run source correctness or native topology probes;
- compile or run a Bun standalone executable;
- benchmark 1k/5k/10k broad or deep trees;
- test teardown, resource usage, or performance against Chokidar evidence.

Those omissions were correct under the original contract. The relaxed native-subscription boundary
later reopened and completed source correctness, standalone embedding, reconciliation, and performance
stages. Linux overflow, symlink mapping, and handoff races now have the approved mitigations below.

## Completed empirical gate

Plan 004B demonstrated that an adapter can safely provide:

- strict scanner membership despite a broader native subscription;
- Linux overflow recovery through the approved periodic authoritative reconciliation policy;
- lexical symlink-root support and a defined external-target strategy;
- best-effort selected-file invalidation with documented backend limits;
- generation-safe subscription/scan reconciliation across initial and new-directory races;
- standalone native-addon embedding without workspace `node_modules`.

The empirical result supersedes the historical source-only rejection and determines Parcel adoption.

## Completed empirical evidence

This section is append-only relative to the historical source assessment above. The package-owned
spike uses `scanTopology` as the sole authority for collection membership. Parcel callbacks are
recorded as observed invalidations and schedule a policy-aware full reconciliation; they never add,
change, or remove collection records directly.

The adapter subscribes broadly to the configured root's physical path and to each minimal external
physical target discovered through followed lexical symlinks. Initial and replacement generations
buffer events while repeated scans converge. A replacement becomes active only after its subscriptions
are ready and scanner topology plus collection membership remain stable; the previous generation stays
live until that commit.

The periodic reconciliation proof established scanner-only recovery for a deliberately dropped event.
The adopted public setting is backend-neutral: Linux defaults to 60 seconds and callers can configure
or disable it; macOS defaults to disabled because FSEvents surfaces overflow/root-change invalidation.
It does not delay normal events or poll Parcel for events.

Standalone evidence uses House's `bun build --compile --bytecode --format=esm --target=<host>` flags.
The resulting binaries execute without source `node_modules`. The generated host-static variant imports
the exact native platform package and passes it to Parcel's `createWrapper`. Dynamic failure remains
recorded even when the generated static path succeeds.

Commands:

```bash
bun packages/ui/dev/parcel-feasibility.ts correctness --record
bun packages/ui/dev/parcel-feasibility.ts repeat --runs 3 --record
bun packages/ui/dev/parcel-feasibility.ts standalone-smoke --record
bun packages/ui/dev/parcel-feasibility.ts benchmark-matrix --record
bun packages/ui/dev/parcel-feasibility.ts verify-evidence
```

Compact host-local artifacts remain below, followed by the cross-target decision artifact. Legacy or
host-local evidence without that decision remains `incomplete`; any real correctness, packaging,
crash, timeout, or malformed-cell failure remains `rejected`.

### Local darwin-arm64 result (2026-08-01)

Environment: Bun 1.3.10, `darwin-arm64`, Darwin 25.5.0, `@parcel/watcher` 2.6.0.

The first teardown rejection was invalid spike evidence: `ParcelPolicyWatcher.close()` cleared its
subscription registry before guarded close, so native `unsubscribe()` was skipped. The fix and
regression tests prove one unsubscribe per subscription and bounded process exit. The false timeout is
not an evidence artifact or backend failure.

Process-isolated correctness completed all 11 scenarios and exited in 4,674 ms. Three further isolated
repeats passed in 14,194 ms. Broad excluded/ignored events were observed without entering membership;
the run recorded eight such events, ten scanner publications, and five replacement generations. The
100 ms periodic full-scan probe recovered a deliberately dropped event in 144 ms. That mode can perform
ten full traversals per idle second and remains an explicitly costly spike-only overflow mitigation.

The unmodified dynamic standalone compiled but failed from the isolated directory because Parcel's
computed native-package require was not bundled; its fallback then tried the absent local
`./build/Release/watcher.node`. The generated host-static variant directly imported
`@parcel/watcher-darwin-arm64`, used Parcel's wrapper, compiled with House's exact Bun flags, observed a
real mutation, unsubscribed, and exited while the sandbox denied workspace `node_modules`. Its
61,614,224-byte binary contains `watcher.node`; no persistent extracted `.node` remained. The addon is
therefore embedded or transiently runtime-extracted by Bun and is not required externally. Dynamic
failure remains evidence rather than being hidden by the successful static fallback.

All performance cells used one physical subscription and exited without crash or timeout. Scanner is
shown as first authoritative scan / cumulative readiness scans. CPU is user + system time; RSS is peak
delta. Single-trial cells used 20 mutations; 10k broad used three trials and 100 mutations each.

| Shape         |      Scanner ms | Subscribe ms | Ready ms | Mutation ms p50/p95/max | RSS MiB |           CPU s | Unsub ms |
| ------------- | --------------: | -----------: | -------: | ----------------------: | ------: | --------------: | -------: |
| 1k broad      |    30.1 / 113.7 |        0.768 |    297.4 |   145.1 / 152.0 / 166.9 |     0.0 |   0.796 + 0.526 |    0.336 |
| 1k deep       |     13.8 / 61.1 |        0.700 |    245.0 |   119.6 / 136.4 / 137.9 |     7.3 |   0.481 + 0.290 |    1.819 |
| 5k broad      |   131.0 / 519.8 |        1.308 |    707.3 |   351.0 / 379.7 / 468.9 |    12.9 |   4.815 + 2.215 |    0.849 |
| 5k deep       |    73.5 / 316.3 |        0.998 |    501.4 |   220.3 / 243.1 / 270.1 |    14.8 |   2.393 + 1.271 |    0.727 |
| 10k broad p50 | 289.3 / 1,148.7 |        3.428 |  1,339.9 | 836.2 / 977.7 / 2,452.3 |    17.3 | 69.132 + 20.216 |    0.903 |
| 10k broad max | 342.8 / 1,204.8 |        5.995 |  1,397.3 |         - / - / 2,452.3 |    20.5 | 69.508 + 20.274 |    1.017 |
| 10k deep      |   164.3 / 615.2 |        1.467 |    802.4 |   397.2 / 489.4 / 507.9 |    32.0 |   6.068 + 2.478 |    0.824 |

The darwin-arm64 artifact set was locally **incomplete** when recorded. It is retained unchanged as
detailed native evidence; the later cross-target decision below completes approval. The static import
requirement must be carried into every platform-specific House build path because the unmodified
dynamic Parcel loader is not standalone-safe.

### Cross-target result and owner decision (2026-08-01)

Parcel 2.6.0 passed all 11 correctness scenarios and 3/3 isolated repeats on every supported target:

| Target       | Execution environment      | Correctness | Repeats | Generated-static standalone  |
| ------------ | -------------------------- | ----------: | ------: | ---------------------------- |
| darwin-arm64 | Native                     |       11/11 |     3/3 | Mutation + clean exit passed |
| darwin-x64   | Rosetta                    |       11/11 |     3/3 | Mutation + clean exit passed |
| linux-arm64  | Native-architecture Docker |       11/11 |     3/3 | Mutation + clean exit passed |
| linux-x64    | Emulation                  |       11/11 |     3/3 | Mutation + clean exit passed |

Every standalone ran without source `node_modules`. Each used a generated platform-static native
binding and Parcel `createWrapper`; normal computed dynamic require failed bundling and is not an
approved build path.

Native darwin-arm64 passed the complete 1k/5k/10k broad/deep matrix and 10k broad 3x100. Linux-arm64
10k broad 3x100 also passed without a crash. Rosetta, emulated, and container timings establish
behavior only and must not be presented as native performance comparisons.

For the approved Linux default, a 10k authoritative scan once per minute is estimated at roughly
0.5-1.3% amortized scanner wall-time using the native macOS first-scan range and Linux container
evidence. This is an order-of-magnitude estimate across unlike environments, not a native Linux CPU or
latency benchmark. A rare hidden `IN_Q_OVERFLOW` can leave membership stale for at most one configured
interval; ordinary delivered events remain immediate.

The project owner explicitly approved `@parcel/watcher` 2.6.0, generated-static standalone packaging,
and the Linux-only 60-second default consistency interval in this design session on 2026-08-01.
Chokidar remains rejected. The overall conclusion is **approved**.

<!-- parcel-feasibility:evidence:start -->

<!-- prettier-ignore -->
```json
{"schemaVersion":1,"conclusion":"approved","updatedAt":"2026-08-01T14:38:54.905Z","artifacts":[{"id":"f7c645f0-4c4b-4999-a5e2-3003d0d63c5b","recordedAt":"2026-08-01T10:39:41.782Z","kind":"correctness","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"correctness","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"durationMs":4673.74825,"scenarios":["scanner-only-membership-under-broad-events","root-create-change-atomic-delete","directory-immediate-child","ignore-and-policy-both-directions","deterministic-coalescing-unsubscribe-no-late-publication","initial-handoff-barriers","readiness-bearing-replacement-barriers","nonrecursive-observed-not-published","lexical-root-external-target-mapping-and-cycle","callback-error","periodic-authoritative-dropped-event-recovery"],"observedExcludedEvents":8,"publications":10,"replacementGenerations":5,"periodicRecovery":{"enabled":true,"intervalMs":100,"recoveredPath":"dropped.txt","recoveryMs":144.32408399999986}},"failure":null},{"id":"4d95a0d5-4a59-441c-a7bb-6b643a1fb299","recordedAt":"2026-08-01T10:40:01.358Z","kind":"repeat","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"repeat","runs":3,"passed":3,"failed":0,"durationMs":14193.754167,"errors":[]},"failure":null},{"id":"e5d5b8a4-ab5b-4c86-a0e8-758fa097b327","recordedAt":"2026-08-01T10:41:55.326Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":1000,"dirs":120,"runs":1,"mutations":20,"shape":"broad"},"trials":[{"run":1,"firstScannerMs":30.073167000000012,"mutationLatencyMs":{"p50":145.12175000000002,"p95":151.9816249999999,"max":166.91799999999967},"cpuUserMicros":796272,"cpuSystemMicros":526210,"rssPeakDeltaBytes":0,"unsubscribeMs":0.33608300000014424,"noCrash":true,"scannerMs":113.71716700000002,"subscribeMs":0.7679160000000138,"totalReadinessMs":297.381208,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":915,"rssDeltaBytes":-13811712}],"summary":{"scannerMs":{"p50":113.71716700000002,"p95":113.71716700000002,"max":113.71716700000002},"subscribeMs":{"p50":0.7679160000000138,"p95":0.7679160000000138,"max":0.7679160000000138},"totalReadinessMs":{"p50":297.381208,"p95":297.381208,"max":297.381208},"mutationLatencyMs":{"p50":145.12175000000002,"p95":151.9816249999999,"max":166.91799999999967},"rssPeakDeltaBytes":{"p50":0,"p95":0,"max":0},"cpuUserMicros":{"p50":796272,"p95":796272,"max":796272},"cpuSystemMicros":{"p50":526210,"p95":526210,"max":526210},"unsubscribeMs":{"p50":0.33608300000014424,"p95":0.33608300000014424,"max":0.33608300000014424},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"6023b826-82fd-4e4a-96d3-dfe72d880e16","recordedAt":"2026-08-01T10:41:59.005Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":1000,"dirs":120,"runs":1,"mutations":20,"shape":"deep"},"trials":[{"run":1,"firstScannerMs":13.845708999999943,"mutationLatencyMs":{"p50":119.64804200000026,"p95":136.377209,"max":137.92012499999987},"cpuUserMicros":480995,"cpuSystemMicros":289935,"rssPeakDeltaBytes":7602176,"unsubscribeMs":1.8193750000000364,"noCrash":true,"scannerMs":61.131166000000235,"subscribeMs":0.7004160000000184,"totalReadinessMs":244.9928749999999,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":515,"rssDeltaBytes":3473408}],"summary":{"scannerMs":{"p50":61.131166000000235,"p95":61.131166000000235,"max":61.131166000000235},"subscribeMs":{"p50":0.7004160000000184,"p95":0.7004160000000184,"max":0.7004160000000184},"totalReadinessMs":{"p50":244.9928749999999,"p95":244.9928749999999,"max":244.9928749999999},"mutationLatencyMs":{"p50":119.64804200000026,"p95":136.377209,"max":137.92012499999987},"rssPeakDeltaBytes":{"p50":7602176,"p95":7602176,"max":7602176},"cpuUserMicros":{"p50":480995,"p95":480995,"max":480995},"cpuSystemMicros":{"p50":289935,"p95":289935,"max":289935},"unsubscribeMs":{"p50":1.8193750000000364,"p95":1.8193750000000364,"max":1.8193750000000364},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"c298f648-7972-4f7a-a713-9529ceb4319f","recordedAt":"2026-08-01T10:42:10.433Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":5000,"dirs":500,"runs":1,"mutations":20,"shape":"broad"},"trials":[{"run":1,"firstScannerMs":130.98025000000007,"mutationLatencyMs":{"p50":350.99145899999985,"p95":379.68645800000013,"max":468.9133750000001},"cpuUserMicros":4814945,"cpuSystemMicros":2214673,"rssPeakDeltaBytes":13533184,"unsubscribeMs":0.8486249999987194,"noCrash":true,"scannerMs":519.8259589999998,"subscribeMs":1.3077499999999418,"totalReadinessMs":707.3090000000002,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":4515,"rssDeltaBytes":1245184}],"summary":{"scannerMs":{"p50":519.8259589999998,"p95":519.8259589999998,"max":519.8259589999998},"subscribeMs":{"p50":1.3077499999999418,"p95":1.3077499999999418,"max":1.3077499999999418},"totalReadinessMs":{"p50":707.3090000000002,"p95":707.3090000000002,"max":707.3090000000002},"mutationLatencyMs":{"p50":350.99145899999985,"p95":379.68645800000013,"max":468.9133750000001},"rssPeakDeltaBytes":{"p50":13533184,"p95":13533184,"max":13533184},"cpuUserMicros":{"p50":4814945,"p95":4814945,"max":4814945},"cpuSystemMicros":{"p50":2214673,"p95":2214673,"max":2214673},"unsubscribeMs":{"p50":0.8486249999987194,"p95":0.8486249999987194,"max":0.8486249999987194},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"a84bb134-7161-4610-b39f-3fe9ebd0dcde","recordedAt":"2026-08-01T10:42:18.205Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":5000,"dirs":500,"runs":1,"mutations":20,"shape":"deep"},"trials":[{"run":1,"firstScannerMs":73.53487499999983,"mutationLatencyMs":{"p50":220.2696249999999,"p95":243.0526660000005,"max":270.14083400000027},"cpuUserMicros":2393131,"cpuSystemMicros":1271039,"rssPeakDeltaBytes":15482880,"unsubscribeMs":0.7272499999999127,"noCrash":true,"scannerMs":316.2553739999994,"subscribeMs":0.9982079999999769,"totalReadinessMs":501.364834,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":2475,"rssDeltaBytes":3342336}],"summary":{"scannerMs":{"p50":316.2553739999994,"p95":316.2553739999994,"max":316.2553739999994},"subscribeMs":{"p50":0.9982079999999769,"p95":0.9982079999999769,"max":0.9982079999999769},"totalReadinessMs":{"p50":501.364834,"p95":501.364834,"max":501.364834},"mutationLatencyMs":{"p50":220.2696249999999,"p95":243.0526660000005,"max":270.14083400000027},"rssPeakDeltaBytes":{"p50":15482880,"p95":15482880,"max":15482880},"cpuUserMicros":{"p50":2393131,"p95":2393131,"max":2393131},"cpuSystemMicros":{"p50":1271039,"p95":1271039,"max":1271039},"unsubscribeMs":{"p50":0.7272499999999127,"p95":0.7272499999999127,"max":0.7272499999999127},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"f29d2c0f-dc2d-4628-a102-98703675d72c","recordedAt":"2026-08-01T10:46:50.510Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":10000,"dirs":1000,"runs":3,"mutations":100,"shape":"broad"},"trials":[{"run":1,"firstScannerMs":289.2975409999999,"mutationLatencyMs":{"p50":803.4051250000011,"p95":1022.7138749999867,"max":2452.330124999993},"cpuUserMicros":69507625,"cpuSystemMicros":20216391,"rssPeakDeltaBytes":18137088,"unsubscribeMs":0.9033749999944121,"noCrash":true,"scannerMs":1148.6772089999995,"subscribeMs":2.266167000000678,"totalReadinessMs":1339.8733329999995,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":9075,"rssDeltaBytes":2195456},{"run":2,"firstScannerMs":274.4470000000001,"mutationLatencyMs":{"p50":840.2149170000048,"p95":974.1514160000079,"max":1292.3432089999842},"cpuUserMicros":69131792,"cpuSystemMicros":20273974,"rssPeakDeltaBytes":12075008,"unsubscribeMs":1.0169999999925494,"noCrash":true,"scannerMs":1141.5642079999961,"subscribeMs":5.9947919999976875,"totalReadinessMs":1337.378125000003,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":9075,"rssDeltaBytes":-1392640},{"run":3,"firstScannerMs":342.84645800001454,"mutationLatencyMs":{"p50":841.1064999999944,"p95":935.354250000004,"max":1106.917207999999},"cpuUserMicros":68650352,"cpuSystemMicros":20070614,"rssPeakDeltaBytes":21463040,"unsubscribeMs":0.8917080000392161,"noCrash":true,"scannerMs":1204.8111250000366,"subscribeMs":3.4280000000144355,"totalReadinessMs":1397.330541000003,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":9075,"rssDeltaBytes":9732096}],"summary":{"scannerMs":{"p50":1148.6772089999995,"p95":1204.8111250000366,"max":1204.8111250000366},"subscribeMs":{"p50":3.4280000000144355,"p95":5.9947919999976875,"max":5.9947919999976875},"totalReadinessMs":{"p50":1339.8733329999995,"p95":1397.330541000003,"max":1397.330541000003},"mutationLatencyMs":{"p50":836.224749999994,"p95":977.6555000000008,"max":2452.330124999993},"rssPeakDeltaBytes":{"p50":18137088,"p95":21463040,"max":21463040},"cpuUserMicros":{"p50":69131792,"p95":69507625,"max":69507625},"cpuSystemMicros":{"p50":20216391,"p95":20273974,"max":20273974},"unsubscribeMs":{"p50":0.9033749999944121,"p95":1.0169999999925494,"max":1.0169999999925494},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"8f5d4170-45d2-4ab3-93fa-e6878c8ea8a3","recordedAt":"2026-08-01T10:47:05.103Z","kind":"benchmark","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"benchmark-cell","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"dependency":{"parcelWatcher":"2.6.0"},"fixture":{"files":10000,"dirs":1000,"runs":1,"mutations":20,"shape":"deep"},"trials":[{"run":1,"firstScannerMs":164.3427499999998,"mutationLatencyMs":{"p50":397.1784170000001,"p95":489.38133299999936,"max":507.9434170000004},"cpuUserMicros":6068011,"cpuSystemMicros":2477661,"rssPeakDeltaBytes":33554432,"unsubscribeMs":0.8237499999995634,"noCrash":true,"scannerMs":615.2288740000004,"subscribeMs":1.4669999999996435,"totalReadinessMs":802.4062919999997,"reconciliationPasses":4,"physicalSubscriptionCount":1,"eligibleFileCount":5015,"rssDeltaBytes":2441216}],"summary":{"scannerMs":{"p50":615.2288740000004,"p95":615.2288740000004,"max":615.2288740000004},"subscribeMs":{"p50":1.4669999999996435,"p95":1.4669999999996435,"max":1.4669999999996435},"totalReadinessMs":{"p50":802.4062919999997,"p95":802.4062919999997,"max":802.4062919999997},"mutationLatencyMs":{"p50":397.1784170000001,"p95":489.38133299999936,"max":507.9434170000004},"rssPeakDeltaBytes":{"p50":33554432,"p95":33554432,"max":33554432},"cpuUserMicros":{"p50":6068011,"p95":6068011,"max":6068011},"cpuSystemMicros":{"p50":2477661,"p95":2477661,"max":2477661},"unsubscribeMs":{"p50":0.8237499999995634,"p95":0.8237499999995634,"max":0.8237499999995634},"physicalSubscriptionCount":{"min":1,"max":1},"noCrash":true}},"failure":null},{"id":"61efb3e9-5dd3-4446-930d-bc3970472167","recordedAt":"2026-08-01T10:49:23.566Z","kind":"standalone","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"standalone-smoke","compileFlags":["build","--compile","--bytecode","--format=esm","--target=bun-darwin-arm64"],"isolatedDirectory":true,"dynamic":{"success":false,"build":{"success":true,"exitCode":0,"signal":null,"timedOut":false,"stdout":"[27ms]  bundle  20 modules\n [164ms] compile  /var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-parcel-standalone-69XjNv/parcel-dynamic","stderr":""},"run":{"success":false,"exitCode":1,"signal":null,"timedOut":false,"stdout":"","stderr":"4631 |     binding = (()=>{throw new Error(\"Cannot require module \"+\"./build/Release/watcher.node\");})();\nerror: Cannot require module ./build/Release/watcher.node"},"binaryBytes":62604944,"binaryContainsWatcherNode":true,"persistentExtractedNodeFiles":[],"nativeLoaderLines":["4631 |     binding = (()=>{throw new Error(\"Cannot require module \"+\"./build/Release/watcher.node\");})();","error: Cannot require module ./build/Release/watcher.node"],"workspaceNodeModulesDenied":true,"addonDisposition":"runtime failed while workspace node_modules was denied"},"static":{"success":true,"build":{"success":true,"exitCode":0,"signal":null,"timedOut":false,"stdout":"[10ms]  bundle  11 modules\n [158ms] compile  /var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-parcel-standalone-69XjNv/parcel-static","stderr":""},"run":{"success":true,"exitCode":0,"signal":null,"timedOut":false,"stdout":"{\"mutationObserved\":true,\"staticPackage\":\"@parcel/watcher-darwin-arm64\"}","stderr":""},"binaryBytes":61614224,"binaryContainsWatcherNode":true,"persistentExtractedNodeFiles":[],"nativeLoaderLines":[],"workspaceNodeModulesDenied":true,"addonDisposition":"embedded or runtime-extracted by Bun; workspace node_modules was denied and no persistent addon remained"},"staticPackage":"@parcel/watcher-darwin-arm64"},"failure":null},{"id":"2f2bda2b-ff9d-412c-9bc5-28f5dd4ab12e","recordedAt":"2026-08-01T14:38:54.905Z","kind":"decision","runtime":{"name":"bun","version":"1.3.10","platform":"darwin","arch":"arm64","osRelease":"25.5.0"},"result":{"command":"approval-decision","dependency":{"parcelWatcher":"2.6.0"},"watcherPruning":{"physicalRequired":false,"scannerTraversalStrict":true,"collectionMembershipStrict":true},"targets":[{"target":"darwin-arm64","environment":"native","correctnessScenarios":11,"repeatRuns":3,"repeatPassed":3,"staticStandaloneMutationPassed":true,"staticStandaloneCleanExitPassed":true,"withoutSourceNodeModules":true},{"target":"darwin-x64","environment":"rosetta","correctnessScenarios":11,"repeatRuns":3,"repeatPassed":3,"staticStandaloneMutationPassed":true,"staticStandaloneCleanExitPassed":true,"withoutSourceNodeModules":true},{"target":"linux-arm64","environment":"native-architecture-docker","correctnessScenarios":11,"repeatRuns":3,"repeatPassed":3,"staticStandaloneMutationPassed":true,"staticStandaloneCleanExitPassed":true,"withoutSourceNodeModules":true},{"target":"linux-x64","environment":"emulation","correctnessScenarios":11,"repeatRuns":3,"repeatPassed":3,"staticStandaloneMutationPassed":true,"staticStandaloneCleanExitPassed":true,"withoutSourceNodeModules":true}],"standalonePackaging":{"computedDynamicRequireBundles":false,"generatedPlatformStaticBinding":true,"parcelCreateWrapper":true},"linuxConsistency":{"consistencyIntervalMs":60000,"configurable":true,"disableable":true,"normalEventsImmediate":true,"authoritativePolicyAwareScanner":true},"selectedFileInvalidation":{"backendDeliveredEvents":"best-effort","sameMetadataRewriteGuarantee":false},"performance":{"darwinArm64Native":{"fullBroadDeepMatrixPassed":true,"tenKBroadRuns":3,"mutationsPerRun":100},"linuxArm64Container":{"tenKBroadRuns":3,"mutationsPerRun":100,"noCrash":true},"nonNativeTimings":"behavioral-only"},"ownerApproval":{"approved":true,"approvedAt":"2026-08-01"}},"failure":null}]}
```

<!-- parcel-feasibility:evidence:end -->
