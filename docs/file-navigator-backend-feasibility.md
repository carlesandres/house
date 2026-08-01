# File Navigator Backend Feasibility

## Conclusion

**Rejected.** Chokidar 5.0.0 on Bun 1.3.10/darwin-arm64 crashes reproducibly while starting the
10,000-file, 1,000-directory broad event-mode benchmark. This fails a required host cell, so the
remaining native/runtime matrix is unnecessary until a different backend or runtime is chosen.
Unavailable cells remain `incomplete`; the validator derives cell state from artifacts and never
treats an incomplete or rejected cell as passed.

This document records spike evidence only. The package-private topology scanner is not the planned
production File Navigator scanner. Node probes dynamically import only Chokidar, fuzzysort, and
ignore; they do not claim Node can import `@house/ui` TypeScript/TSX source.

Package-local TypeScript 6 invocation:

```bash
(cd packages/ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.spike.json)
```

The Node probe runner invokes package-local TypeScript 6, emits only under
unique `packages/ui/node_modules/.cache/house-ui-node-probe-*` directories, and removes only its own
directory in `finally`. Import, event, and polling probes may therefore run concurrently:

```bash
bun packages/ui/dev/backend-feasibility.ts node-probe imports --record
bun packages/ui/dev/backend-feasibility.ts node-probe correctness --record
bun packages/ui/dev/backend-feasibility.ts node-probe correctness --polling --record
bun packages/ui/dev/backend-feasibility.ts node-probe benchmark-matrix --record
bun packages/ui/dev/backend-feasibility.ts node-probe benchmark-matrix --polling --record
```

Each emitted Node child has a hard timeout (`--timeout-ms`, default 120 seconds). The parent sends
`SIGTERM`, escalates to `SIGKILL` after one second when needed, awaits child exit, and records success
only after exit code 0 and valid JSON. Emit, startup, timeout, nonzero-exit, and malformed-output
failures are recorded by the parent against the requested Node runtime and mode.

## Topology Sequence

Every topology is derived by the policy scanner. The harness creates a fresh generation with the
complete physical directory set and depth-0 semantics, attaches event buffering, awaits that
generation's initial `ready`, scans authoritatively while the prior and replacement generations are
both live, and runs convergence scans until the topology matches and no invalidation arrived across a
scan. It then makes the replacement active, commits the reconciled collection, compares the final
invalidation version, schedules another reconciliation when necessary, and only then closes the old
generation. It never uses `getWatched()` as registration proof.

Correctness artifacts include generation IDs, complete requested physical directories, parent
`addDir` invalidations, reconciliation-pass counts, exact one-time logical additions for mutations at
every replacement phase, and a subsequent mutation after the committed generation is ready.

## Host-Local Outcome

The evidence below distinguishes source runs from Bun-compiled executable runs. Source correctness
and repeat artifacts use provenance `source`; standalone and compiled child artifacts use provenance
`compiled`; the TypeScript-emitted Node ESM import and watch probes use provenance `emitted-node`.

On Bun 1.3.10/darwin-arm64, source correctness passed once per mode and source stress passed 3/3 per
mode. The compiled executable passed 3/3 standalone stress per mode, and compiled child correctness
processes exited successfully in event and polling modes within the 20-second timeout. Package-local
TypeScript 6 emitted JavaScript that Node 24.18.0 on darwin-arm64 used to directly import and execute
all three dependencies and pass the complete event and polling correctness baseline. These host-local
artifacts do not satisfy cells whose required platform is Linux.

Node 24 also recorded bounded broad/event and broad/polling matrix artifacts at 1,000 files, one
trial, and 20 mixed mutations. They prove the emitted Node benchmark path and mode attribution without
claiming the required 1k/5k/10k, broad/deep, three-trial, 100-mutation matrix.

An earlier run of the exact Bun command
`bun packages/ui/dev/backend-feasibility.ts benchmark --matrix --record` kept the entire matrix in one
Bun 1.3.10 process. After approximately 842 seconds that process terminated with a segmentation fault
and recorded no matrix artifact. Bun report:
<https://bun.report/1.3.10/Ma130e609egDgkggC_+mjrP+/o3iB2xlziB2hm6tB______u7sm/C+y04qCm62lvCm+gomB__u7sm/Cmi0kjCm7r9nCA2A0M>.
The crashing matrix cell was not identified, so this is recorded as an unsuccessful harness attempt,
not a backend-cell failure. It motivated the process-isolated rerun below.

The process-isolated matrix completed the first eight 1k/5k broad/deep event/polling cells, then the
10k broad/event child terminated with `SIGTRAP` and a Bun segmentation fault after approximately 11
seconds. Running that exact cell directly reproduced the segmentation fault after approximately 10
seconds. Reports:

- <https://bun.report/1.3.10/Ma130e609egDgkggC_+mjrP+/o3iB2xlziB2hm6tB_______u7sm/C+y04qCm62lvCm+gomB__u7sm/Cmi0kjCA2A0M>
- <https://bun.report/1.3.10/Ma130e609egDgkggC_u5jrP+/o3iB2xlziB2hm6tB_______u7sm/C+y04qCm62lvCm+gomB__u7sm/Cmi0kjCA2Ag+l6lgB>

Because the failure is reproduced in an isolated required cell, it is backend adoption evidence, not
only a matrix-orchestrator defect.

The same exact command now launches each size/shape/mode cell in a fresh Bun process, records each
validated cell atomically before starting the next, and prints the cell key to stderr. Each cell has a
configurable hard timeout (`--cell-timeout-ms`, default 900 seconds). A rerun skips complete matching
cells; `--force` explicitly replaces resume behavior with re-execution. Based on the prior elapsed time
and process-isolation overhead, allow approximately 15-25 minutes for a clean first rerun.

The practical broad/event benchmark seeds 1,000 ordinary files plus 75 mutation fixtures, for 1,075
physical data files. Its authoritative initial scan has 975 eligible files and therefore 100 pruned
files. The fixture also has 121 physical ignore-control files. Recorded trials retain every mixed
mutation latency sample. This practical run is not the required three-trial 1k/5k/10k,
broad/deep, event/polling matrix, so it cannot complete either host cell.

Upstream status checked through the GitHub API on 2026-07-31:

- Chokidar issue [#1471](https://github.com/paulmillr/chokidar/issues/1471) is open. It reports the
  scan-before-watch new-directory race in 5.0.0.
- Proposed fix [#1473](https://github.com/paulmillr/chokidar/pull/1473) is open and unmerged. The
  installed 5.0.0 therefore cannot be presumed fixed.

## Structured Evidence

`verify-evidence` derives each required cell from exact artifact runtime, version, platform,
architecture, mode, and provenance. Bun watch cells require source correctness/repeat, compiled
repeat/child exit, a direct dependency-import artifact, and a complete mode-specific benchmark matrix
whose every trial has at least 100 raw mutation samples. Node watch cells instead require
TypeScript-emitted Node import and correctness artifacts plus a mode-specific Node benchmark matrix.
Thrown recorded commands remain failure artifacts and derive a rejected matching cell.

Every artifact carries an explicit kind, mode, runtime identity, derived cell identity, and affected
cell identities. Only recognized failures affect a cell: a Bun dependency-import failure affects both
watch modes for that exact runtime/platform/architecture; emitted Node import failures affect only the
matching import cell; Node correctness and matrix failures affect the exact event or polling baseline;
and unknown command failures remain durable without rejecting a backend cell. Node emit and entry
startup failures are recorded by the orchestrator with the requested Node runtime and mode rather than
the Bun/source identity of the parent process.

Evidence append uses an atomic protocol: acquire an adjacent lock directory with a 10-second bound and
30-second stale-lock recovery, read and append while holding the lock, write a same-directory temporary
file, atomically rename it over the Markdown document, then release the lock. Concurrent recorded
probes therefore preserve every artifact and never expose partial Markdown/JSON.

Complete Bun matrix evidence may be supplied by one legacy validated matrix artifact or by six
validated per-cell artifacts for each mode: 1k/5k/10k files crossed with broad/deep shape, each with
three trials and 100 raw mixed-mutation samples. Per-cell crash, timeout, nonzero exit, and malformed
output failures retain the exact runtime, mode, size, and shape. Already recorded cells survive a
later parent crash and are resumed without duplication.

<!-- backend-feasibility:evidence:start -->

```json
{
	"schemaVersion": 2,
	"conclusion": "rejected",
	"updatedAt": "2026-07-31T22:43:09.076Z",
	"artifacts": [
		{
			"id": "2026-07-31T21:16:08.087Z-correctness-source",
			"recordedAt": "2026-07-31T21:16:08.087Z",
			"kind": "correctness",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": false,
				"durationMs": 3726.335208,
				"replacementProof": {
					"usePolling": false,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-1FokCs",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-1FokCs/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-1FokCs/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:16:14.352Z-correctness-source",
			"recordedAt": "2026-07-31T21:16:14.352Z",
			"kind": "correctness",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": true,
				"durationMs": 6232.279750000001,
				"replacementProof": {
					"usePolling": true,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-uTBKZd",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-uTBKZd/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-uTBKZd/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-polling",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:16:25.586Z-repeat-source",
			"recordedAt": "2026-07-31T21:16:25.586Z",
			"kind": "repeat",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "repeat",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": false,
				"runs": 3,
				"passed": 3,
				"failed": 0,
				"durationMs": 11197.354000000001,
				"errors": []
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:16:44.361Z-repeat-source",
			"recordedAt": "2026-07-31T21:16:44.361Z",
			"kind": "repeat",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"result": {
				"command": "repeat",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": true,
				"runs": 3,
				"passed": 3,
				"failed": 0,
				"durationMs": 18740.939042,
				"errors": []
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-polling",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:17:29.722Z-benchmark-source",
			"recordedAt": "2026-07-31T21:17:29.722Z",
			"kind": "benchmark",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 1000,
					"dirs": 120,
					"runs": 3,
					"mutations": 100,
					"usePolling": false,
					"shape": "broad"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 30.846166999999923,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 94.31962500000009
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 78.52070800000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 77.93137500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 176.0858340000002
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 94.44308300000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 78.25037500000008
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 77.90374999999995
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 175.38875000000007
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 94.28475000000026
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 77.02270799999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 77.35674999999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 172.821958
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 95.01145799999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 79.2752089999999
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 77.5511660000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 190.8050830000002
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 95.39654199999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 77.73241600000028
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 77.09420899999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 173.80600000000004
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 93.85541599999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 77.76904100000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 77.73524999999972
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 173.90954199999987
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 95.03445800000009
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 78.29595800000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.30516700000044
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 174.05475000000024
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 94.7665420000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 77.90100000000075
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 77.49104100000022
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 173.76758400000017
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 94.83654200000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 78.26074999999946
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 77.0595000000003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 172.88079199999993
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 94.30608399999983
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 77.79320900000039
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 107.3130000000001
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 174.39091699999972
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 108.48474999999962
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 76.75954199999978
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 76.69316600000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 188.20608399999946
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 94.6987079999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 77.59562499999993
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 77.21362499999941
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 171.96787500000028
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 95.18349999999919
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 77.97737499999948
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 76.98700000000008
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 173.61062500000025
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 92.94254100000035
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 77.99170800000047
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 77.74675000000025
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 188.47845899999993
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 93.80624999999964
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 77.06629100000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 77.77516699999978
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 191.25204200000007
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 94.31216700000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 78.30733299999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 78.00333299999966
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 172.54383300000063
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 93.87395800000013
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 92.6219170000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 92.42841699999917
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 187.70524999999907
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 94.7367919999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 78.17320800000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 78.60408300000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 174.4072500000002
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 95.05262500000026
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 76.80420799999956
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 77.66020799999933
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 190.707124999999
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 93.85983399999895
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 77.781332999999
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 77.36895800000093
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 174.62937500000044
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 93.39583399999901
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 109.68841599999905
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 109.42912499999875
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 174.46212500000001
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 94.82083299999977
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 77.98262500000055
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 77.2730419999989
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 188.70091599999978
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 93.85849999999846
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 78.04312500000015
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 94.97437499999978
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 174.363292
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 94.8100830000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 77.14225000000079
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 94.66758300000038
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 173.87012499999946
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 93.90608299999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 76.36158299999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 78.28608400000121
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 189.14879199999996
							}
						],
						"latencyMs": {
							"p50": 93.85849999999846,
							"p95": 188.47845899999993,
							"max": 191.25204200000007
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2461970,
						"cpuSystemMicros": 2963814,
						"closeMs": 1.8045409999995172,
						"firstScanMs": 36.24133299999994,
						"watcherReadyMs": 91.55008300000009,
						"reconciliationMs": 172.796834,
						"totalReadinessMs": 300.96720900000014,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 12533760
					},
					{
						"run": 2,
						"firstScanResultMs": 32.50200000000041,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 94.70425000000068
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 77.45475000000079
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 80.96758399999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 190.89970800000083
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 93.40224999999919
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 77.94795799999883
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 77.52812500000073
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 190.80883299999914
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 94.5086250000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 76.62620799999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 77.47158299999865
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 174.15941700000076
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 95.30041600000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 76.9338749999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 93.06395800000064
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 189.73099999999977
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 94.89079200000015
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 77.62329200000022
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 79.10095899999942
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 190.04500000000007
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 94.82508299999972
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 78.00087499999972
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 77.10720899999978
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 188.74487500000032
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 109.47654200000034
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 82.23687500000051
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.56450000000041
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 207.00987499999974
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 94.72295799999847
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 77.72566600000027
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 77.90979100000004
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 189.15633399999933
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 95.20074999999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 76.68466699999772
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 78.41474999999991
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 173.4564169999976
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 94.49829200000022
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 93.7689590000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 110.36866599999848
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 188.7062079999996
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 94.12787499999831
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 77.67258399999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 77.88516700000037
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 190.40250000000015
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 93.31762500000332
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 77.77058300000135
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 93.69437500000276
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 179.58583400000134
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 94.50141699999949
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 78.24599999999919
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 77.79533300000185
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 191.143250000001
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 124.97483400000056
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 92.70566599999802
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 80.33858299999702
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 190.70741700000144
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 94.68945900000108
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 78.44604099999924
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 92.66425000000163
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 189.71841700000004
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 94.10987499999828
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 77.74829099999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 78.10683400000198
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 176.00966600000174
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 94.53716599999825
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 77.14729100000113
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 92.8179170000003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 190.3922500000008
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 95.43487500000265
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 76.85475000000224
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 76.97929199999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 173.627625000001
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 93.66133300000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 93.86924999999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 93.11516699999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 174.08745799999815
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 94.48912500000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 93.64912499999991
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 78.02487499999916
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 190.65899999999965
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 96.28704199999993
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 78.30779199999961
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 77.51758400000108
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 174.30262500000026
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 94.2597910000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 77.45383299999958
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 78.79695899999933
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 175.02283299999908
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 94.90833300000304
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 77.03220800000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 76.97070800000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 189.39154100000087
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 94.43154199999844
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 76.32745799999975
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 77.43529099999796
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 190.5914589999993
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 96.61637499999779
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 93.37062499999956
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 79.96445799999856
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 174.77329200000167
							}
						],
						"latencyMs": {
							"p50": 93.69437500000276,
							"p95": 190.65899999999965,
							"max": 207.00987499999974
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2397921,
						"cpuSystemMicros": 3041261,
						"closeMs": 2.0667909999974654,
						"firstScanMs": 37.17275000000154,
						"watcherReadyMs": 94.95045799999934,
						"reconciliationMs": 169.07141700000102,
						"totalReadinessMs": 302.19066699999894,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 6029312
					},
					{
						"run": 3,
						"firstScanResultMs": 34.76104199999827,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 95.30454200000167
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 77.33404199999859
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 77.51420800000051
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 175.10145799999736
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 95.35183399999733
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 93.1677090000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 94.06004199999734
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 189.0761249999996
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 95.11904200000208
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 94.10679099999834
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 124.53920899999866
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 173.25312499999927
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 114.58283300000039
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 77.40233300000182
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 77.59733300000153
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 174.19895800000086
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 93.59154200000194
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 77.15695899999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 78.26854100000128
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 188.153624999999
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 96.02016600000206
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 77.60558299999684
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 78.56429199999911
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 190.3316670000022
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 108.48745899999994
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 92.41929200000232
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 92.85987500000192
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 190.83345899999767
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 124.63929199999984
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 92.48170899999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 77.72087499999907
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 189.80012500000157
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 130.31574999999793
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 124.83270800000173
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 79.64050000000134
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 175.02420800000255
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 95.18037499999991
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 107.89508299999943
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 77.94162499999948
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 175.89120799999728
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 93.62925000000178
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 78.34862500000236
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 77.90820800000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 190.87687500000175
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 93.68962499999907
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 77.39762500000143
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 92.99637500000244
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 172.78499999999985
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 94.20216699999946
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 77.15995899999689
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 78.22204099999726
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 175.35258299999987
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 93.34749999999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 77.93883300000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 78.03808299999946
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 173.83812500000204
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 94.78295900000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 78.20104199999696
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 92.66883400000006
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 191.39820900000268
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 95.02129100000093
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 77.96879199999967
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 78.29262499999822
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 175.28170899999895
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 94.5188339999986
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 77.98858400000245
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 78.43458399999872
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 173.6110000000008
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 94.046875
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 77.73666700000103
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 77.4720410000009
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 174.78337499999907
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 94.98399999999674
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 78.58795800000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 77.32333299999664
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 175.77337499999703
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 95.50604200000089
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 77.86858300000313
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 78.99366600000212
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 175.61891699999978
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 93.518167000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 77.88479100000404
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 78.4732920000024
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 172.48662499999773
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 93.69837499999994
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 76.75370799999655
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 79.85750000000553
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 173.3163329999952
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 95.21920900000259
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 77.4140419999967
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 78.69287500000064
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 190.49037500000122
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 94.61349999999948
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 76.81399999999849
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 77.48875000000407
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 172.3978750000024
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 93.99133299999812
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 78.44783299999835
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 77.39300000000367
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 172.6959579999966
							}
						],
						"latencyMs": {
							"p50": 93.68962499999907,
							"p95": 189.80012500000157,
							"max": 191.39820900000268
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2393864,
						"cpuSystemMicros": 3007482,
						"closeMs": 1.8625000000029104,
						"firstScanMs": 35.050333999999566,
						"watcherReadyMs": 99.33304199999839,
						"reconciliationMs": 188.16300000000047,
						"totalReadinessMs": 322.98775000000023,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 2932736
					}
				],
				"latencyMs": {
					"p50": 93.80624999999964,
					"p95": 190.3922500000008,
					"max": 207.00987499999974
				}
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:17:40.667Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T21:17:40.667Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null,
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:18:10.318Z-standalone-smoke-compiled",
			"recordedAt": "2026-07-31T21:18:10.318Z",
			"kind": "standalone-smoke",
			"provenance": "compiled",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "repeat",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": false,
				"runs": 3,
				"passed": 3,
				"failed": 0,
				"durationMs": 11220.122208,
				"errors": []
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:18:29.080Z-standalone-smoke-compiled",
			"recordedAt": "2026-07-31T21:18:29.080Z",
			"kind": "standalone-smoke",
			"provenance": "compiled",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"result": {
				"command": "repeat",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": true,
				"runs": 3,
				"passed": 3,
				"failed": 0,
				"durationMs": 18709.553417,
				"errors": []
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-polling",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:18:32.899Z-child-exit-compiled",
			"recordedAt": "2026-07-31T21:18:32.899Z",
			"kind": "child-exit",
			"provenance": "compiled",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "child-exit",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": false,
				"exitCode": 0,
				"durationMs": 3769.470542
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:18:39.264Z-child-exit-compiled",
			"recordedAt": "2026-07-31T21:18:39.264Z",
			"kind": "child-exit",
			"provenance": "compiled",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"result": {
				"command": "child-exit",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"usePolling": true,
				"exitCode": 0,
				"durationMs": 6343.240917
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-polling",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:19:37.179Z-imports-source",
			"recordedAt": "2026-07-31T21:19:37.179Z",
			"kind": "imports",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"result": {
				"command": "imports",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null,
			"cellIdentity": "bun-1.3.10-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:29:37.657Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T21:29:37.657Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null,
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:29:41.517Z-node-baseline-emitted-node",
			"recordedAt": "2026-07-31T21:29:41.517Z",
			"kind": "node-baseline",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": false,
				"durationMs": 3793.103166,
				"replacementProof": {
					"usePolling": false,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-63vhsG",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-63vhsG/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-63vhsG/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"cellIdentity": "node-24.18.0-darwin-arm64-event-baseline",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:29:47.875Z-node-baseline-emitted-node",
			"recordedAt": "2026-07-31T21:29:47.875Z",
			"kind": "node-baseline",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": true,
				"durationMs": 6293.2762920000005,
				"replacementProof": {
					"usePolling": true,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-t4XDUq",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-t4XDUq/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-t4XDUq/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"cellIdentity": "node-24.18.0-darwin-arm64-polling-baseline",
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:40:27.487Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T21:40:27.487Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null,
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:40:31.987Z-node-baseline-emitted-node",
			"recordedAt": "2026-07-31T21:40:31.987Z",
			"kind": "node-baseline",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "node-24.18.0-darwin-arm64-event-baseline",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": false,
				"durationMs": 3762.579917,
				"replacementProof": {
					"usePolling": false,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-7lCdoF",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-7lCdoF/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-7lCdoF/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:40:39.253Z-node-baseline-emitted-node",
			"recordedAt": "2026-07-31T21:40:39.253Z",
			"kind": "node-baseline",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"cellIdentity": "node-24.18.0-darwin-arm64-polling-baseline",
			"result": {
				"command": "correctness",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"usePolling": true,
				"durationMs": 6520.865750000001,
				"replacementProof": {
					"usePolling": true,
					"generation": {
						"generationId": "generation-2",
						"kind": "replacement",
						"requestedPhysicalDirectories": [
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-dHbfEV",
							"/private/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-dHbfEV/new-directory"
						],
						"parentInvalidations": [
							"/var/folders/20/3lpbx2mx2l17h63z6cb6ky4r0000gn/T/house-ui-replacement-phases-dHbfEV/new-directory"
						],
						"reconciliationPasses": 3,
						"committed": true
					},
					"expectedAdditions": [
						"new-directory/after-create.txt",
						"new-directory/after-ready.txt",
						"new-directory/before-commit.txt",
						"new-directory/before-create.txt",
						"new-directory/before-reconciliation.txt",
						"new-directory/during-convergence.txt",
						"new-directory/immediate-child.txt"
					],
					"logicalPublication": {
						"added": [
							"new-directory/after-create.txt",
							"new-directory/after-ready.txt",
							"new-directory/before-commit.txt",
							"new-directory/before-create.txt",
							"new-directory/before-reconciliation.txt",
							"new-directory/during-convergence.txt",
							"new-directory/immediate-child.txt"
						],
						"changed": [],
						"removed": []
					},
					"postReadyAddition": "new-directory/post-ready.txt",
					"postReadyPublication": {
						"added": ["new-directory/post-ready.txt"],
						"changed": [],
						"removed": []
					}
				},
				"scenarios": [
					"policy-pruned-depth-zero-topology",
					"authoritative-ready-reconciliation",
					"deterministic-phase-interleavings",
					"readiness-bearing-replacement-phase-interleavings",
					"create-equal-size-rewrite-atomic-remove",
					"ignore-control-and-new-directory-handoff",
					"single-publication-burst-coalescing-and-async-close",
					"nonrecursive-boundary",
					"symlink-root-and-followed-external-cycle"
				]
			},
			"failure": null,
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:40:43.769Z-node-benchmark-matrix-emitted-node",
			"recordedAt": "2026-07-31T21:40:43.769Z",
			"kind": "node-benchmark-matrix",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "node-24.18.0-darwin-arm64-event-baseline",
			"result": {
				"command": "benchmark-matrix",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"reports": [
					{
						"command": "benchmark",
						"runtime": {
							"name": "node",
							"version": "24.18.0",
							"platform": "darwin",
							"arch": "arm64",
							"osRelease": "25.5.0"
						},
						"dependencies": {
							"chokidar": "5.0.0",
							"fuzzysort": "3.1.0",
							"ignore": "7.0.5"
						},
						"fixture": {
							"files": 1000,
							"dirs": 120,
							"runs": 1,
							"mutations": 20,
							"usePolling": false,
							"shape": "broad"
						},
						"trials": [
							{
								"run": 1,
								"firstScanResultMs": 34.21208300000012,
								"latencySamples": [
									{
										"kind": "add",
										"path": "mutation-create-0.txt",
										"ms": 96.06758300000001
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-1.txt",
										"ms": 80.67641600000002
									},
									{
										"kind": "change",
										"path": "mutation-atomic-2.txt",
										"ms": 79.26304099999993
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-3.txt",
										"ms": 179.63441699999998
									},
									{
										"kind": "add",
										"path": "mutation-create-4.txt",
										"ms": 94.351042
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-5.txt",
										"ms": 78.52700000000004
									},
									{
										"kind": "change",
										"path": "mutation-atomic-6.txt",
										"ms": 78.4586670000001
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-7.txt",
										"ms": 178.738875
									},
									{
										"kind": "add",
										"path": "mutation-create-8.txt",
										"ms": 96.13733300000013
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-9.txt",
										"ms": 77.49412500000017
									},
									{
										"kind": "change",
										"path": "mutation-atomic-10.txt",
										"ms": 77.81750000000011
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-11.txt",
										"ms": 191.91754200000014
									},
									{
										"kind": "add",
										"path": "mutation-create-12.txt",
										"ms": 97.09416699999974
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-13.txt",
										"ms": 76.60466700000006
									},
									{
										"kind": "change",
										"path": "mutation-atomic-14.txt",
										"ms": 78.27570800000012
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-15.txt",
										"ms": 192.30250000000024
									},
									{
										"kind": "add",
										"path": "mutation-create-16.txt",
										"ms": 97.2839170000002
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-17.txt",
										"ms": 79.26324999999997
									},
									{
										"kind": "change",
										"path": "mutation-atomic-18.txt",
										"ms": 78.65970800000014
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-19.txt",
										"ms": 182.54066600000033
									}
								],
								"latencyMs": {
									"p50": 80.67641600000002,
									"p95": 191.91754200000014,
									"max": 192.30250000000024
								},
								"physicalFileCount": 1015,
								"eligibleFileCount": 915,
								"prunedFileCount": 100,
								"controlFileCount": 121,
								"cpuUserMicros": 808365,
								"cpuSystemMicros": 515208,
								"closeMs": 57.31012499999997,
								"firstScanMs": 37.85416699999996,
								"watcherReadyMs": 53.57291699999996,
								"reconciliationMs": 185.68545799999993,
								"totalReadinessMs": 277.70545800000014,
								"directoryCount": 109,
								"watchCount": 109,
								"rssDeltaBytes": 6520832
							}
						],
						"latencyMs": {
							"p50": 80.67641600000002,
							"p95": 191.91754200000014,
							"max": 192.30250000000024
						}
					}
				],
				"usePolling": false
			},
			"failure": null,
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:40:49.037Z-node-benchmark-matrix-emitted-node",
			"recordedAt": "2026-07-31T21:40:49.037Z",
			"kind": "node-benchmark-matrix",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "polling",
			"cellIdentity": "node-24.18.0-darwin-arm64-polling-baseline",
			"result": {
				"command": "benchmark-matrix",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"reports": [
					{
						"command": "benchmark",
						"runtime": {
							"name": "node",
							"version": "24.18.0",
							"platform": "darwin",
							"arch": "arm64",
							"osRelease": "25.5.0"
						},
						"dependencies": {
							"chokidar": "5.0.0",
							"fuzzysort": "3.1.0",
							"ignore": "7.0.5"
						},
						"fixture": {
							"files": 1000,
							"dirs": 120,
							"runs": 1,
							"mutations": 20,
							"usePolling": true,
							"shape": "broad"
						},
						"trials": [
							{
								"run": 1,
								"firstScanResultMs": 32.46199999999999,
								"latencySamples": [
									{
										"kind": "add",
										"path": "mutation-create-0.txt",
										"ms": 112.0094160000001
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-1.txt",
										"ms": 111.7761660000001
									},
									{
										"kind": "change",
										"path": "mutation-atomic-2.txt",
										"ms": 95.20504199999982
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-3.txt",
										"ms": 200.806875
									},
									{
										"kind": "add",
										"path": "mutation-create-4.txt",
										"ms": 113.36587499999996
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-5.txt",
										"ms": 94.04799999999977
									},
									{
										"kind": "change",
										"path": "mutation-atomic-6.txt",
										"ms": 112.12374999999975
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-7.txt",
										"ms": 213.962583
									},
									{
										"kind": "add",
										"path": "mutation-create-8.txt",
										"ms": 156.544042
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-9.txt",
										"ms": 157.639584
									},
									{
										"kind": "change",
										"path": "mutation-atomic-10.txt",
										"ms": 131.23445900000024
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-11.txt",
										"ms": 182.9409169999999
									},
									{
										"kind": "add",
										"path": "mutation-create-12.txt",
										"ms": 127.27679199999966
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-13.txt",
										"ms": 128.56799999999976
									},
									{
										"kind": "change",
										"path": "mutation-atomic-14.txt",
										"ms": 112.68329199999971
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-15.txt",
										"ms": 193.5045839999998
									},
									{
										"kind": "add",
										"path": "mutation-create-16.txt",
										"ms": 96.39737500000001
									},
									{
										"kind": "change",
										"path": "mutation-rewrite-17.txt",
										"ms": 109.4566249999998
									},
									{
										"kind": "change",
										"path": "mutation-atomic-18.txt",
										"ms": 125.3219999999992
									},
									{
										"kind": "unlink",
										"path": "mutation-remove-19.txt",
										"ms": 222.46129199999996
									}
								],
								"latencyMs": {
									"p50": 125.3219999999992,
									"p95": 213.962583,
									"max": 222.46129199999996
								},
								"physicalFileCount": 1015,
								"eligibleFileCount": 915,
								"prunedFileCount": 100,
								"controlFileCount": 121,
								"cpuUserMicros": 802671,
								"cpuSystemMicros": 914073,
								"closeMs": 2.8699169999999867,
								"firstScanMs": 34.00233299999991,
								"watcherReadyMs": 42.13695800000005,
								"reconciliationMs": 326.9537499999999,
								"totalReadinessMs": 403.52654099999995,
								"directoryCount": 109,
								"watchCount": 109,
								"rssDeltaBytes": 10092544
							}
						],
						"latencyMs": {
							"p50": 125.3219999999992,
							"p95": 213.962583,
							"max": 222.46129199999996
						}
					}
				],
				"usePolling": true
			},
			"failure": null,
			"affectedCellIdentities": [],
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T21:48:39.449Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T21:48:39.449Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null,
			"benchmarkCell": null
		},
		{
			"id": "2026-07-31T22:31:47.309Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T22:31:47.309Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"benchmarkCell": null,
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:33:39.544Z-node-import-emitted-node",
			"recordedAt": "2026-07-31T22:33:39.544Z",
			"kind": "node-import",
			"provenance": "emitted-node",
			"runtime": {
				"name": "node",
				"version": "24.18.0",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "imports",
			"cellIdentity": "node-24.18.0-darwin-arm64-imports",
			"affectedCellIdentities": [],
			"benchmarkCell": null,
			"result": {
				"command": "node-import",
				"runtime": {
					"name": "node",
					"version": "24.18.0",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"imports": {
					"chokidar": true,
					"fuzzysort": true,
					"ignore": true
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:35:16.104Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:35:16.104Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 1000,
				"shape": "broad",
				"mode": "event",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 1000,
					"dirs": 120,
					"runs": 3,
					"mutations": 100,
					"usePolling": false,
					"shape": "broad"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 26.82208300000002,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 80.36712499999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 80.30195800000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 78.96166700000003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 178.9391250000001
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 79.37437499999987
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 79.73512499999993
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 78.68579199999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 177.07729200000017
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 79.4426669999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 80.33349999999973
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 79.91308400000025
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 179.65712500000018
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 81.22762499999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 78.949208
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 80.49870800000008
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 183.52604199999996
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 80.19020799999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 76.91924999999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 79.96316699999988
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 177.6260830000001
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 97.2664579999996
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 80.25708399999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 80.6112919999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 176.9890830000004
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 79.94358299999976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 79.3038330000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.58762500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 178.47175000000016
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 95.74395800000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 80.20074999999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 79.54570899999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 178.7524169999997
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 95.50645900000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 77.97862500000065
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 63.51249999999982
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 175.53879099999995
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 80.21470800000043
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 79.79791699999987
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 79.13291600000048
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 176.84562499999993
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 81.07104200000049
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 79.5293330000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 77.46112499999981
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 178.3307080000004
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 80.5292500000005
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 76.938083
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 78.71708299999955
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 180.22379199999978
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 81.07491700000082
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 79.17504199999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 78.76566600000024
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 181.06137500000023
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 81.3260420000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 80.18870900000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 78.9633329999997
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 178.67524999999932
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 94.16029099999923
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 81.18033399999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 79.43962499999998
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 180.47920899999917
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 78.44641700000011
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 80.27454100000068
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 79.36566599999969
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 175.89970900000026
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 80.66529099999934
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 77.60704100000021
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 79.10387499999888
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 180.1697499999991
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 95.36049999999886
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 78.56108400000085
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 78.7038330000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 165.9965000000011
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 79.3504580000008
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 77.9516249999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 79.90029099999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 179.92354200000045
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 79.05437500000153
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 80.02708299999904
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 80.20366699999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 180.39720800000032
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 95.28512500000033
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 78.77016700000058
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 77.95249999999942
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 181.85458300000028
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 96.50849999999991
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 79.30316700000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 79.06833299999926
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 181.95479200000045
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 94.15183400000024
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 79.98087499999929
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 77.7706249999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 178.47612500000105
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 97.46762499999932
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 78.88229199999842
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 79.36770799999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 178.14958300000035
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 93.40745799999968
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 80.96979099999953
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 80.20566599999984
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 177.00683299999946
							}
						],
						"latencyMs": {
							"p50": 80.21470800000043,
							"p95": 180.39720800000032,
							"max": 183.52604199999996
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2066088,
						"cpuSystemMicros": 2489072,
						"closeMs": 1.9439999999995052,
						"firstScanMs": 31.31683399999997,
						"watcherReadyMs": 91.0324169999999,
						"reconciliationMs": 158.26858399999992,
						"totalReadinessMs": 281.02708299999995,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 11894784
					},
					{
						"run": 2,
						"firstScanResultMs": 24.155250000001615,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 92.20575000000099
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 78.38908300000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 80.06433300000026
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 177.45737500000178
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 95.8813339999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 80.10033300000032
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 80.11787499999991
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 179.58437500000036
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 97.40458300000137
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 79.07820900000115
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 77.47508300000118
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 180.51124999999956
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 95.05495800000062
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 79.3877080000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 78.441417
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 166.4974999999995
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 79.94087500000023
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 78.30104199999914
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 78.98591600000145
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 180.56825000000026
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 93.32758400000057
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 79.14645799999926
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 78.47670899999866
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 181.42849999999999
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 80.48208299999897
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 81.58316700000069
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.12745799999902
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 182.4419170000001
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 80.77870900000016
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 80.82795799999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 78.29833399999916
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 177.04262500000004
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 110.48025000000052
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 80.80416700000023
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 79.67704200000117
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 180.8490410000013
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 79.07099999999991
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 78.96504199999981
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 77.35116700000071
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 180.8295410000028
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 96.52641700000095
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 79.11145800000304
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 77.88612499999726
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 179.19295799999963
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 80.94683399999849
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 81.0427090000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 79.421666000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 178.0905840000014
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 97.40145800000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 77.84545799999978
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 79.26183399999718
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 178.72987499999726
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 97.54570799999783
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 77.36733300000196
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 78.73191600000064
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 175.0983329999981
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 78.8425840000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 79.53800000000047
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 79.16341599999942
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 179.58320900000035
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 110.57387499999822
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 78.14104099999895
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 78.15841699999874
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 178.55495900000096
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 93.36391699999876
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 77.3024579999983
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 77.1404999999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 177.14004099999875
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 79.93037499999991
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 79.32420799999818
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 78.41937499999767
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 175.83266599999843
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 95.43337500000052
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 78.43720799999937
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 78.23412499999904
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 180.79999999999927
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 79.69458400000076
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 78.8558750000011
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 79.50787499999933
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 181.47720800000025
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 81.78350000000137
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 79.22120799999902
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 77.92279100000087
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 178.81433299999844
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 81.17112500000076
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 79.64266700000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 78.62887499999852
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 180.43787499999962
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 80.55791700000191
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 79.73483299999862
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 79.41733300000124
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 175.98666700000103
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 79.29000000000087
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 79.21275000000242
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 79.84029100000043
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 179.43949999999677
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 80.00820899999962
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 78.0915419999983
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 77.9274579999983
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 182.23420800000167
							}
						],
						"latencyMs": {
							"p50": 80.00820899999962,
							"p95": 180.8295410000028,
							"max": 182.4419170000001
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2012887,
						"cpuSystemMicros": 2543962,
						"closeMs": 1.9089160000003176,
						"firstScanMs": 29.138833999999406,
						"watcherReadyMs": 86.43479200000002,
						"reconciliationMs": 165.9658330000002,
						"totalReadinessMs": 281.9569169999995,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 1949696
					},
					{
						"run": 3,
						"firstScanResultMs": 26.27870900000198,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 80.83337499999834
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 80.4855000000025
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 79.49020799999926
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 181.7051250000004
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 81.42566600000282
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 78.93925000000309
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 78.51179199999751
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 183.2294580000016
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 79.16979199999696
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 78.18654199999946
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 78.55241699999897
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 180.10191699999996
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 96.56258400000297
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 79.54604200000176
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 78.48391699999775
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 179.81662499999948
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 79.11166700000103
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 78.33362500000294
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 80.50154199999815
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 177.79675000000134
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 80.03954199999862
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 80.31520900000032
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 78.35649999999805
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 179.06504100000166
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 94.69833400000061
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 78.68462499999805
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.85750000000189
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 178.01174999999785
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 96.7937920000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 79.96762500000114
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 80.08420800000022
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 183.2225839999992
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 95.07116699999824
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 78.44679199999882
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 79.42875000000276
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 179.83241700000144
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 80.58983399999852
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 77.64783300000272
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 96.20045899999968
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 178.54275000000052
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 96.03375000000233
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 77.89158400000088
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 79.15891600000032
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 175.25495800000135
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 80.53570799999943
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 79.39804100000038
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 80.2410000000018
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 177.89112499999828
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 80.72608400000172
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 79.72270900000149
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 79.47658299999966
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 180.28783300000214
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 78.86337500000081
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 79.12208300000202
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 79.7152500000011
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 175.5752500000017
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 95.90954200000124
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 81.1152080000029
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 79.08379100000093
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 182.2770840000012
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 96.34979200000089
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 80.10087500000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 79.91787500000282
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 177.97729099999924
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 80.5804169999974
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 79.95016699999906
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 80.16525000000183
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 181.80958300000202
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 95.37749999999869
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 80.16679199999999
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 80.34929199999897
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 181.04616700000042
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 95.77891699999964
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 80.31741600000169
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 78.32675000000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 179.9630419999994
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 97.16766600000119
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 80.10820800000147
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 78.17775000000256
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 182.72529199999917
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 78.57891599999857
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 77.9789579999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 80.35270799999853
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 180.04845800000112
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 79.71095799999966
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 79.03824999999779
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 79.01995800000077
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 194.86183300000266
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 97.7847499999989
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 80.52454100000614
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 77.38158300000214
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 179.0416250000053
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 80.81158300000243
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 77.26825000000099
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 79.53516700000182
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 178.62441699999908
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 97.21825000000536
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 80.60979100000259
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 80.4522500000021
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 177.0402499999982
							}
						],
						"latencyMs": {
							"p50": 80.4522500000021,
							"p95": 181.80958300000202,
							"max": 194.86183300000266
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2047480,
						"cpuSystemMicros": 2524397,
						"closeMs": 1.709792000001471,
						"firstScanMs": 28.302583999997296,
						"watcherReadyMs": 88.30895899999814,
						"reconciliationMs": 162.13979199999812,
						"totalReadinessMs": 279.12445800000205,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 4751360
					}
				],
				"latencyMs": {
					"p50": 80.27454100000068,
					"p95": 181.04616700000042,
					"max": 194.86183300000266
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:35:58.550Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:35:58.550Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 1000,
				"shape": "broad",
				"mode": "polling",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 1000,
					"dirs": 120,
					"runs": 3,
					"mutations": 100,
					"usePolling": true,
					"shape": "broad"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 25.480000000000018,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 79.81254100000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 128.62429100000008
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 79.53733299999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 214.83662500000014
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 113.06979100000035
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 94.16995799999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 112.54720799999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 208.96487499999967
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 97.0107079999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 112.65570799999978
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 96.6299170000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 209.7584999999999
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 114.22116700000015
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 112.83029100000022
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 95.3189580000003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 201.5624160000002
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 128.3130000000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 94.60833400000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 114.26612499999965
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 208.16612499999974
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 113.39174999999977
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 94.273416
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 99.08383299999969
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 290.16554199999973
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 96.48362499999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 95.04770800000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 112.4270830000005
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 195.2732500000002
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 125.9364999999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 94.19358399999965
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 113.63887500000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 208.1323339999999
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 111.37700000000041
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 96.19775000000027
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 114.26454199999989
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 194.78120800000033
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 127.52745799999957
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 98.17162499999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 95.45329100000072
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 213.14962500000001
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 112.70604100000037
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 96.63000000000011
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 115.36358300000029
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 194.74645800000053
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 127.17541700000038
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 95.23754199999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 110.79433400000016
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 209.1356249999999
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 113.6996250000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 96.59141699999964
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 113.32212499999969
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 196.7703330000004
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 112.66825000000063
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 109.72154199999932
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 112.94916600000033
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 194.97766600000068
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 113.06729200000154
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 112.78029199999946
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 94.73508399999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 223.5010420000017
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 96.20762500000092
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 113.35945899999933
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 96.2970830000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 211.58087499999965
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 96.19887500000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 112.28949999999895
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 113.19024999999965
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 209.68845800000054
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 113.7017909999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 96.98458399999981
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 111.17641700000058
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 192.77395799999977
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 112.0583749999987
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 110.01825000000099
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 113.49575000000004
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 210.2484170000007
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 98.08804099999907
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 115.2758329999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 95.6518329999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 214.4176669999997
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 111.32637500000055
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 96.49666699999943
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 113.68004199999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 194.27700000000004
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 128.85170900000048
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 94.02045800000087
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 111.89654199999859
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 210.49762499999997
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 112.2140840000011
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 93.29620799999975
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 112.85624999999891
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 211.20383299999958
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 95.47870799999873
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 113.27275000000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 113.4854579999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 193.9410829999997
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 113.41720800000076
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 112.15849999999955
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 96.59637500000099
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 213.74041699999907
							}
						],
						"latencyMs": {
							"p50": 112.94916600000033,
							"p95": 213.14962500000001,
							"max": 290.16554199999973
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2078014,
						"cpuSystemMicros": 2862886,
						"closeMs": 1.1170000000001892,
						"firstScanMs": 27.76433299999985,
						"watcherReadyMs": 20.182542000000012,
						"reconciliationMs": 310.016625,
						"totalReadinessMs": 358.36812499999996,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 11943936
					},
					{
						"run": 2,
						"firstScanResultMs": 29.71600000000035,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 81.29804200000035
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 109.28854200000023
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 95.4658330000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 213.22612499999923
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 95.72612499999923
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 113.87537500000144
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 98.86924999999974
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 213.43579200000022
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 114.42033399999855
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 96.96329100000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 112.91687499999898
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 207.60791699999754
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 112.06358399999954
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 97.02950000000055
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 111.39858299999833
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 212.06554099999994
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 95.82629200000156
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 112.48733300000094
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 96.13629099999889
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 223.85654200000135
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 95.28666599999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 113.85995800000092
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 94.88275000000067
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 213.10462499999994
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 116.37549999999828
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 95.83962500000052
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 115.70129199999792
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 195.3466249999983
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 112.20795899999939
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 113.14749999999913
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 96.13524999999936
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 217.32595799999763
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 112.89937500000087
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 94.87666700000045
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 97.65791600000011
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 223.85941699999967
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 111.5916670000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 97.5532499999972
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 113.6374169999981
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 194.86041599999953
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 112.73499999999694
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 113.56666699999914
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 95.40545799999745
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 216.61308400000053
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 112.57312499999898
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 94.29383400000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 113.23716699999932
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 209.2860409999994
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 112.6618750000016
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 111.95479100000011
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 97.26129100000253
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 210.87220799999704
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 97.89304099999936
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 110.3458329999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 112.11462499999834
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 193.15179100000023
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 112.85412499999802
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 112.0411669999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 95.20120799999859
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 214.5846249999995
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 112.49258399999962
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 96.75066700000025
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 108.33012499999677
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 208.51083300000028
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 112.7979579999992
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 111.18600000000151
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 95.0771249999998
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 213.06958400000076
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 112.54891700000007
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 112.16162500000064
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 95.43074999999953
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 228.10383300000103
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 97.76995899999747
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 95.66362500000105
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 110.69141699999818
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 210.26658300000054
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 112.14941700000054
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 94.5367920000026
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 115.72287500000311
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 210.91895800000202
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 97.17516700000124
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 113.37095899999986
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 96.2903750000005
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 209.11149999999907
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 111.08412499999758
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 114.26983300000211
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 94.99825000000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 212.89037500000268
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 114.39345799999865
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 95.6976250000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 111.34045799999876
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 209.4357080000009
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 111.79866699999911
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 97.87633300000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 113.66954100000294
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 209.71154100000058
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 112.41962499999863
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 94.85570799999914
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 114.31320899999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 212.10675000000265
							}
						],
						"latencyMs": {
							"p50": 112.41962499999863,
							"p95": 214.5846249999995,
							"max": 228.10383300000103
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2031580,
						"cpuSystemMicros": 2868506,
						"closeMs": 1.1300000000010186,
						"firstScanMs": 32.89137500000106,
						"watcherReadyMs": 18.966042000000016,
						"reconciliationMs": 309.14158399999906,
						"totalReadinessMs": 361.33970899999986,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 327680
					},
					{
						"run": 3,
						"firstScanResultMs": 34.289458000002924,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 130.70966599999883
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 94.61995899999965
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 114.28512499999852
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 196.24083299999984
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 113.82058400000096
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 111.98720799999865
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 113.08612499999799
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 194.45041700000002
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 113.69837499999994
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 112.47512500000084
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 112.46920900000259
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 197.63904199999888
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 112.93162500000108
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 95.98416700000234
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 113.33908299999894
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 212.95370900000125
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 97.44145799999751
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 113.84812500000044
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 110.95537499999773
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 193.84587499999907
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 145.17929099999674
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 79.75812500000029
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 111.34041699999943
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 212.98849999999948
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 94.66058300000077
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 111.18270800000028
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 112.58491700000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 193.6364999999969
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 112.91237499999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 114.1305829999983
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 96.20387500000652
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 209.05541699999594
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 112.46020799999678
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 114.60908300000301
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 111.24245800000062
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 195.0837920000049
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 114.0616250000021
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 112.59662499999831
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 96.11962499999936
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 214.37495800000033
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 111.68895899999916
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 95.2712920000049
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 113.56170800000109
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 209.84116700000595
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 110.36233400000492
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 95.9765419999967
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 112.71175000000221
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 211.46070899999904
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 110.98745799999597
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 95.53545899999881
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 114.32837499999732
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 195.76637500000652
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 126.0124169999981
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 93.58550000000105
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 114.77862499999901
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 212.61020799999824
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 95.6417500000025
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 110.778916999996
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 97.83287500000006
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 210.078416999997
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 112.89483299999847
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 96.83862500000396
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 125.92554199999722
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 194.49975000000268
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 111.59279199999582
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 114.19350000000122
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 93.40412500000093
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 213.9589580000029
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 110.963874999994
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 96.69712499999878
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 115.51958399999421
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 196.16508299999987
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 126.70341699999699
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 94.9010000000053
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 114.76408300000185
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 209.5219169999982
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 112.1030000000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 95.79112500000338
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 114.00320799999463
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 194.78254200000083
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 111.52670900000521
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 114.79241699999693
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 112.3379999999961
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 197.3223330000037
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 114.61145899999974
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 110.58054099999572
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 97.88062499999796
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 209.96458300000086
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 111.32908300000418
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 93.3763340000005
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 115.00170799999614
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 207.86462500000198
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 111.35495800000353
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 111.09387499999866
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 96.37308399999893
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 210.17266600000585
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 113.75137499999983
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 98.31233399999473
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 114.79733299999498
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 194.50608300000022
							}
						],
						"latencyMs": {
							"p50": 113.08612499999799,
							"p95": 211.46070899999904,
							"max": 214.37495800000033
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 975,
						"prunedFileCount": 100,
						"controlFileCount": 121,
						"cpuUserMicros": 2064681,
						"cpuSystemMicros": 2910432,
						"closeMs": 1.2000419999967562,
						"firstScanMs": 29.42712499999834,
						"watcherReadyMs": 21.015458000001672,
						"reconciliationMs": 311.6181660000002,
						"totalReadinessMs": 362.44079099999726,
						"directoryCount": 109,
						"watchCount": 109,
						"rssDeltaBytes": 720896
					}
				],
				"latencyMs": {
					"p50": 112.7979579999992,
					"p95": 213.14962500000001,
					"max": 290.16554199999973
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:36:34.023Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:36:34.023Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 1000,
				"shape": "deep",
				"mode": "event",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 1000,
					"dirs": 120,
					"runs": 3,
					"mutations": 100,
					"usePolling": false,
					"shape": "deep"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 39.115958999999975,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 95.88104199999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 78.4111660000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 79.23874999999998
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 193.50770899999998
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 95.46270800000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 77.00716599999987
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 95.29041599999982
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 179.99937499999987
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 97.72133299999996
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 79.70979099999977
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 92.87079100000028
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 177.51545799999985
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 96.91791700000022
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 78.74887499999977
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 94.62825000000021
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 178.58925
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 97.08337500000016
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 79.92624999999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 78.0143750000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 180.99816699999974
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 97.83970799999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 78.94075000000021
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 76.84845799999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 180.19220799999994
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 93.74645799999962
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 77.87954099999934
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 79.51808299999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 183.80658399999993
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 94.33300000000054
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 79.3848339999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 80.82675000000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 177.47187500000018
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 96.1294169999992
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 80.11158400000022
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 78.26095799999985
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 181.21166599999924
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 96.62879100000009
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 80.26808400000027
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 77.99012499999935
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 178.3668749999997
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 95.89720800000032
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 80.02937500000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 77.23433300000033
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 191.3915419999994
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 95.65983400000005
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 77.58358399999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 79.08370900000045
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 194.97741700000006
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 95.36099999999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 79.48770800000057
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 80.3585409999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 193.99762499999997
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 94.31412499999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 79.61704199999986
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 80.36654100000032
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 181.96608300000025
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 96.88258300000052
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 78.42650000000049
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 78.50387500000033
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 178.9526249999999
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 95.89791700000023
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 79.234958
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 81.85966700000063
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 178.12887499999852
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 96.50370800000019
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 79.11816700000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 79.58966700000019
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 180.38595899999927
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 93.79579100000046
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 78.95783300000039
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 78.04520899999989
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 182.11225000000013
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 96.14754200000061
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 79.50904199999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 94.89650000000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 177.6170000000002
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 97.40495899999951
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 77.41445799999929
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 76.8760000000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 182.42304200000035
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 96.05391699999927
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 79.53129099999933
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 79.05420799999956
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 194.039166999999
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 96.3572920000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 79.54970800000046
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 78.86645800000042
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 177.85966700000063
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 96.87637499999983
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 79.10087500000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 79.85583299999962
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 181.0310840000002
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 95.43375000000015
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 77.75966599999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 78.78924999999981
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 181.77112500000112
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 95.05604099999982
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 76.59862500000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 76.89937500000087
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 177.00404200000048
							}
						],
						"latencyMs": {
							"p50": 94.31412499999988,
							"p95": 183.80658399999993,
							"max": 194.97741700000006
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2892550,
						"cpuSystemMicros": 2325948,
						"closeMs": 1.6867910000000848,
						"firstScanMs": 43.35229099999992,
						"watcherReadyMs": 82.69266700000003,
						"reconciliationMs": 186.22566699999993,
						"totalReadinessMs": 312.7457499999998,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 12369920
					},
					{
						"run": 2,
						"firstScanResultMs": 54.03229199999987,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 95.21641699999964
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 96.49562500000138
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 94.41941699999916
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 182.33599999999933
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 94.08087500000147
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 80.46687500000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 78.98179199999868
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 181.52879199999916
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 94.58116700000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 77.73033299999952
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 79.11945899999955
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 183.27174999999988
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 96.0583340000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 78.81362500000068
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 78.3941249999989
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 178.33762500000012
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 97.36983300000065
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 80.28591699999924
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 77.72470799999974
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 193.8936250000006
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 96.67970800000148
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 78.7718330000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 79.28770900000018
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 180.53249999999935
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 95.4375
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 79.3130829999991
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 79.33762500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 181.47366599999987
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 97.0393329999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 110.00300000000061
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 95.36283399999957
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 179.40329200000087
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 95.16433300000062
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 79.07233300000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 78.10008399999788
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 196.78933300000062
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 95.16849999999977
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 78.63820900000064
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 79.2388749999991
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 182.82800000000134
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 98.39187500000116
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 81.76941599999918
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 79.64637500000026
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 180.6395420000008
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 97.1162089999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 78.99387500000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 79.98191700000098
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 180.317583
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 94.34795899999881
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 78.69512500000201
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 78.36900000000242
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 176.6858749999992
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 94.66479199999958
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 79.86783300000025
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 93.34070799999972
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 183.16429199999766
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 94.33250000000044
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 80.0427090000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 76.49808299999859
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 181.05008400000224
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 125.50845800000025
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 77.2232920000024
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 79.68845800000054
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 182.0292920000029
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 96.63850000000093
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 79.68108299999949
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 79.95258300000205
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 177.92908399999942
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 97.43858399999954
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 79.26324999999997
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 77.37199999999939
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 180.5452499999992
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 96.53395799999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 79.53550000000178
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 79.7777079999978
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 179.65312500000073
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 97.20445800000016
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 78.1630839999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 79.09108300000298
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 175.84124999999767
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 94.49166700000205
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 78.97787499999686
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 78.96270899999945
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 180.5610000000015
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 95.73333399999683
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 78.88333399999829
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 79.74291699999958
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 226.07641599999988
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 96.26316700000098
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 78.44737499999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 96.14012500000172
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 181.13770899999872
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 92.89037499999904
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 77.45162500000151
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 97.10887500000172
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 176.88487499999974
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 95.95170900000085
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 79.04962499999965
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 80.42933300000004
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 180.50983300000007
							}
						],
						"latencyMs": {
							"p50": 94.49166700000205,
							"p95": 182.82800000000134,
							"max": 226.07641599999988
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2739844,
						"cpuSystemMicros": 2414178,
						"closeMs": 1.8310419999979786,
						"firstScanMs": 43.00654100000065,
						"watcherReadyMs": 78.20091700000012,
						"reconciliationMs": 197.8623750000006,
						"totalReadinessMs": 319.4742499999993,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 3719168
					},
					{
						"run": 3,
						"firstScanResultMs": 31.937667000001966,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 95.60241700000188
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 78.19987500000207
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 78.81587500000023
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 178.99312500000087
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 96.0034169999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 78.3338330000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 78.35620799999742
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 177.59929199999897
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 96.2944580000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 79.0793330000015
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 79.40449999999691
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 178.01050000000032
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 96.85825000000114
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 78.73137499999939
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 80.01579199999833
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 180.0625
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 96.26237500000207
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 77.84395799999766
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 77.57333400000061
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 179.1685839999991
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 96.92900000000009
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 77.10187500000029
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 80.14195800000016
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 181.45979100000113
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 97.16679199999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 79.87254200000098
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 78.08279200000106
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 176.59974999999758
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 94.28362500000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 79.7085420000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 79.90037499999744
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 180.4529999999977
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 95.06995800000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 79.32316699999865
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 77.89920799999891
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 178.49995800000033
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 97.41237499999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 77.8037919999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 77.93599999999788
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 182.96608399999968
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 96.59995799999888
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 77.00804100000096
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 78.69316700000127
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 179.68699999999808
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 95.52454200000284
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 78.97349999999642
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 79.52108299999963
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 196.61433300000135
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 96.52470799999719
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 79.3972909999975
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 78.6606670000001
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 180.56458399999974
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 96.06204099999741
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 77.2564999999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 78.14054100000067
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 181.59079199999906
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 96.14604099999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 79.73029200000019
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 79.23929100000169
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 178.76537499999904
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 96.15704200000255
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 80.01337500000227
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 77.68887499999983
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 179.28804200000013
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 96.25795800000196
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 92.02487499999916
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 79.26087499999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 178.6302080000023
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 95.60199999999895
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 77.4963749999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 77.56829199999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 195.291583000002
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 95.08962500000052
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 80.68950000000041
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 80.81208300000071
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 177.2648330000011
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 97.12583399999858
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 79.49487499999668
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 77.9320000000007
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 179.0042500000054
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 95.31583300000057
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 83.25375000000349
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 79.63820799999667
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 194.7246659999946
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 95.57016700000531
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 77.5
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 79.75595800000156
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 179.53854200000205
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 97.50395799999387
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 79.02724999999919
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 79.79637499999808
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 180.53554200000508
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 94.8503750000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 76.91433400000096
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 78.64616699999897
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 181.24387500000012
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 96.85129099999904
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 78.015833999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 79.62633300000016
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 179.76591600000393
							}
						],
						"latencyMs": {
							"p50": 92.02487499999916,
							"p95": 181.45979100000113,
							"max": 196.61433300000135
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2675087,
						"cpuSystemMicros": 2266816,
						"closeMs": 1.7395420000029844,
						"firstScanMs": 34.91495800000121,
						"watcherReadyMs": 84.42379199999777,
						"reconciliationMs": 177.09875000000102,
						"totalReadinessMs": 296.87366699999984,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 9273344
					}
				],
				"latencyMs": {
					"p50": 94.34795899999881,
					"p95": 182.82800000000134,
					"max": 226.07641599999988
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:37:16.700Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:37:16.700Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 1000,
				"shape": "deep",
				"mode": "polling",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 1000,
					"dirs": 120,
					"runs": 3,
					"mutations": 100,
					"usePolling": true,
					"shape": "deep"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 32.82745799999998,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 131.430834
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 95.63141700000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 98.94529200000011
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 211.60775000000012
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 114.40333299999975
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 95.87804200000028
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 113.03658399999995
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 195.2845830000001
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 112.97775000000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 112.27962500000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 96.30474999999979
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 211.67983300000014
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 111.0741250000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 112.37466700000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 97.134458
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 212.56629199999998
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 111.91637500000024
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 111.16579200000024
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 98.24662499999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 225.00704199999973
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 94.44112500000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 111.76891699999942
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 97.43954200000007
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 210.47708300000068
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 112.42133299999932
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 96.39024999999947
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 113.73891600000024
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 210.19754100000046
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 111.51925000000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 95.06450000000041
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 113.31533300000046
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 213.12204199999996
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 97.28354200000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 112.30783299999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 112.23716700000023
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 196.8095000000003
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 112.91679099999965
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 95.70758399999977
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 115.30262500000026
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 209.6435419999998
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 111.22237500000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 94.09408299999996
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 144.69587500000034
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 225.9115840000004
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 109.79025000000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 114.91895900000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 111.84787500000039
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 195.8936249999997
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 113.75612499999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 113.88595799999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 96.25187499999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 195.5191250000007
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 111.41470800000025
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 112.88237499999923
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 96.77700000000004
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 208.95095799999945
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 113.40995800000019
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 109.41754200000105
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 98.51504100000056
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 209.59116600000016
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 111.22800000000097
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 110.1219170000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 95.23029099999985
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 211.14308400000118
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 112.60120800000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 96.27237500000047
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 111.89858300000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 210.00695799999994
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 127.08187499999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 93.54504199999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 95.93241699999999
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 208.84141699999964
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 110.99745799999982
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 111.56458300000122
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 97.54550000000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 212.39287499999955
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 112.64829199999986
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 96.07324999999946
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 108.71749999999884
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 212.5520830000005
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 111.12254199999916
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 95.64437499999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 113.89741700000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 198.40870799999902
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 109.89208300000064
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 112.62933300000077
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 112.31795899999997
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 196.53408300000046
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 113.90458399999989
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 111.42924999999923
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 96.83683399999973
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 211.49020799999926
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 108.45016699999906
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 111.43254199999865
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 97.31212500000038
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 210.98875000000044
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 111.88404199999968
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 112.9890000000014
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 94.86158400000022
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 210.7065419999999
							}
						],
						"latencyMs": {
							"p50": 112.27962500000012,
							"p95": 212.39287499999955,
							"max": 225.9115840000004
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2857997,
						"cpuSystemMicros": 2733294,
						"closeMs": 1.1334999999999127,
						"firstScanMs": 35.012833,
						"watcherReadyMs": 20.391750000000002,
						"reconciliationMs": 328.39408300000014,
						"totalReadinessMs": 384.247292,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 11223040
					},
					{
						"run": 2,
						"firstScanResultMs": 35.04112499999974,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 113.24925000000076
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 112.39916600000106
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 96.00154099999963
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 215.10312499999964
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 111.7353750000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 95.4892920000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 111.09200000000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 209.36120799999844
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 112.00450000000274
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 96.91658300000199
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 111.7978750000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 207.77458299999853
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 112.49887500000114
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 112.36012499999924
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 95.48737500000061
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 210.7123329999995
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 113.6305420000026
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 94.83050000000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 111.04049999999916
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 196.382916999999
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 113.60545800000182
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 111.41158399999767
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 112.6270829999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 196.3065830000014
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 113.77920799999993
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 110.7989579999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 97.42679200000202
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 208.89649999999892
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 112.84895899999901
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 110.88899999999921
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 109.13958300000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 196.20750000000044
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 111.1628750000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 112.39770900000076
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 113.53637499999968
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 192.41208299999926
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 112.31775000000198
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 111.3842500000028
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 96.1435829999973
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 207.68420799999876
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 110.45766699999876
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 110.6047499999986
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 110.65870899999936
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 197.50420799999847
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 113.36995899999965
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 110.43345899999986
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 110.11083300000246
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 196.42866700000013
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 112.0279589999991
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 111.51933300000019
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 97.31016600000294
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 211.81362499999886
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 110.89312499999869
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 111.50412499999948
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 94.88262500000201
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 211.7780410000014
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 113.30512499999895
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 95.29891700000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 111.64050000000134
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 206.9979170000006
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 110.96020800000042
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 109.36766700000226
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 96.51812499999869
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 205.5776659999974
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 116.43141599999944
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 110.48016700000153
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 96.11787499999991
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 208.4427910000013
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 110.32937499999753
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 112.35870900000009
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 112.90637499999866
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 198.42145900000105
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 112.15887500000099
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 109.58908300000257
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 96.2692500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 214.07574999999997
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 113.90666600000259
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 96.18304199999693
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 111.70237500000076
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 210.6294170000001
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 112.43370800000048
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 94.63883400000122
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 127.66458300000158
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 194.66449999999895
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 109.85995800000092
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 109.3001669999976
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 99.42508299999827
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 208.2380000000012
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 111.70279200000004
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 111.6618329999983
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 96.55995899999834
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 212.92162499999904
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 114.66679199999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 95.51450000000114
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 114.02700000000186
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 211.53108399999837
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 95.52220800000214
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 112.98516599999857
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 110.72620800000004
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 198.33437499999854
							}
						],
						"latencyMs": {
							"p50": 112.00450000000274,
							"p95": 211.53108399999837,
							"max": 215.10312499999964
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2800730,
						"cpuSystemMicros": 2745465,
						"closeMs": 1.224583999999595,
						"firstScanMs": 35.370875000000524,
						"watcherReadyMs": 18.99970899999971,
						"reconciliationMs": 328.6655840000003,
						"totalReadinessMs": 383.50258399999984,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 1310720
					},
					{
						"run": 3,
						"firstScanResultMs": 34.306541999998444,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 96.51308300000164
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 110.22366699999839
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 97.64745799999946
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 211.19075000000157
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 115.78266699999949
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 98.36899999999878
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 109.26908399999957
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 211.4586670000026
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 108.93216699999903
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 96.07937500000116
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 95.45487499999945
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 210.25733399999808
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 113.2688330000019
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 110.36454199999935
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 108.6382080000003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 201.26295799999934
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 110.83654200000092
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 111.02458300000217
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 94.8025000000016
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 206.68249999999898
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 114.37870900000053
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 111.72241700000086
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 98.81137500000114
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 211.15929200000028
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 112.98295900000085
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 93.27458399999887
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 113.97279200000048
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 212.3267909999995
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 112.40408399999433
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 95.04854100000375
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 112.50195800000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 211.0480830000015
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 94.91162500000064
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 112.46795800000109
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 96.28137500000594
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 212.81587500000023
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 112.00062500000058
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 110.497749999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 99.04954099999304
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 210.46966699999757
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 111.57050000000163
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 94.19258299999638
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 113.42145899999741
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 211.88895800000319
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 108.45941599999787
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 95.88825000000361
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 113.62220900000102
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 195.96474999999919
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 113.34850000000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 112.88483300000371
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 111.70091700000194
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 196.2401669999963
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 112.72308299999713
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 93.96966599999723
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 128.63295800000196
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 194.72708300000522
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 112.82966599999781
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 95.74145800000406
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 112.3357079999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 195.85191599999962
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 113.36824999999953
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 161.59474999999657
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 111.75154099999781
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 194.53012500000477
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 112.07416699999885
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 111.87049999999726
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 109.89779200000339
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 194.9388340000005
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 115.43608300000051
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 112.71450000000186
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 95.26224999999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 210.48374999999942
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 112.89737500000047
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 111.2433749999982
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 97.1006669999988
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 210.63391600000614
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 111.61758299999929
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 96.70883400000457
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 112.91691699999501
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 209.12487500000134
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 111.50124999999389
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 111.47616700000071
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 96.39258400000108
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 209.76387499999691
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 110.91670799999702
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 112.18887499999983
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 124.6964999999982
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 232.0642499999958
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 112.78120800000033
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 111.72462499999529
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 97.49504200000229
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 208.9261250000054
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 113.74129099999845
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 113.33237499999814
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 94.09808300000441
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 211.9392910000024
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 112.34883400000399
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 96.49333399999887
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 111.8235829999976
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 197.4277910000019
							}
						],
						"latencyMs": {
							"p50": 112.34883400000399,
							"p95": 211.4586670000026,
							"max": 232.0642499999958
						},
						"physicalFileCount": 1075,
						"eligibleFileCount": 875,
						"prunedFileCount": 200,
						"controlFileCount": 121,
						"cpuUserMicros": 2743683,
						"cpuSystemMicros": 2733934,
						"closeMs": 1.3222919999971054,
						"firstScanMs": 34.72158300000228,
						"watcherReadyMs": 19.987999999997555,
						"reconciliationMs": 344.5828330000004,
						"totalReadinessMs": 399.7062499999993,
						"directoryCount": 97,
						"watchCount": 97,
						"rssDeltaBytes": 7159808
					}
				],
				"latencyMs": {
					"p50": 112.27962500000012,
					"p95": 211.7780410000014,
					"max": 232.0642499999958
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:38:35.399Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:38:35.399Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 5000,
				"shape": "broad",
				"mode": "event",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 5000,
					"dirs": 500,
					"runs": 3,
					"mutations": 100,
					"usePolling": false,
					"shape": "broad"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 177.33229200000005,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 205.69341600000007
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 185.19737499999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 184.25216700000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 287.55091600000014
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 232.48820799999976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 202.01216600000043
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 201.184166
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 303.2082499999997
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 219.25195800000074
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 201.77137500000026
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 201.54120800000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 302.0115000000005
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 202.92704200000026
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 201.42199999999866
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 201.53929099999914
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 303.77820900000006
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 203.02066699999887
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 203.84983300000022
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 201.84420899999895
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 291.804666
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 219.38708299999962
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 203.32737500000076
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 200.43095900000117
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 303.13674999999967
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 216.87866600000052
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 202.0282499999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 202.4007500000007
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 302.4581659999985
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 234.99424999999974
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 204.01429100000132
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 201.32654100000036
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 320.5415830000002
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 221.02249999999913
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 199.6775000000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 202.32820899999933
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 306.95045799999934
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 218.0643340000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 230.53637499999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 185.3612920000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 288.6350000000002
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 216.83983400000034
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 231.39291599999888
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 202.80141700000058
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 302.7470000000012
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 204.65245800000048
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 185.20308300000033
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 185.73754200000076
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 304.6810839999998
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 248.71166599999924
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 202.8848340000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 202.94300000000294
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 289.89887499999895
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 218.69550000000163
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 202.56333300000188
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 202.55770800000028
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 287.21749999999884
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 202.10395900000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 186.88437500000146
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 201.93616699999984
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 288.65070800000103
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 204.62574999999924
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 200.5101250000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 202.83695799999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 298.6897919999974
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 200.68183399999907
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 199.8001669999976
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 203.49958299999707
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 303.18758399999933
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 219.8964159999996
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 202.46670799999993
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 202.3459580000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 290.4930409999979
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 218.34349999999904
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 202.77733300000182
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 186.52562500000204
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 287.3822500000024
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 200.1550419999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 202.94579199999862
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 204.36033300000054
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 306.67974999999933
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 217.3033749999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 201.25424999999814
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 201.79708299999766
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 305.30875000000015
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 202.73925000000236
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 264.5565420000021
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 201.90662499999962
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 303.26483299999745
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 202.31179100000008
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 203.71387500000128
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 202.12087500000052
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 288.89641699999993
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 234.75345799999923
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 218.08312500000102
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 200.88320799999929
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 301.71074999999837
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 200.82587499999863
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 202.01787500000137
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 202.4751670000005
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 305.8084999999992
							}
						],
						"latencyMs": {
							"p50": 203.49958299999707,
							"p95": 304.6810839999998,
							"max": 320.5415830000002
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9452733,
						"cpuSystemMicros": 11556776,
						"closeMs": 16.966457999998966,
						"firstScanMs": 143.92004099999986,
						"watcherReadyMs": 820.4066659999999,
						"reconciliationMs": 395.692959,
						"totalReadinessMs": 1361.9134169999998,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 48218112
					},
					{
						"run": 2,
						"firstScanResultMs": 159.92758400000093,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 221.84850000000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 200.53912500000297
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 202.91729100000157
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 304.66999999999825
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 202.26037499999802
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 202.40004100000078
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 249.89150000000154
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 316.32033299999966
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 217.92241600000125
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 203.62424999999712
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 201.95758300000307
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 287.3678329999966
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 219.01933299999655
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 201.0367499999993
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 202.65245799999684
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 318.87304199999926
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 217.36712499999703
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 185.94520800000464
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 185.17633399999613
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 354.37341699999524
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 219.36475000000064
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 201.65987499999756
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 200.17625000000407
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 304.9950000000026
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 219.0041659999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 199.86970799999835
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 205.46658300000126
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 317.2328750000015
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 219.64395800000057
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 199.549417000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 202.27550000000338
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 308.11145899999974
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 217.07312500000262
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 201.32700000000477
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 202.08470799999486
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 289.979499999994
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 202.70125000000553
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 200.21087499999703
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 202.86270800000057
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 303.2193750000006
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 218.28041700000176
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 203.4018750000032
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 185.93312499999593
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 303.6018330000006
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 205.4474160000027
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 198.9352080000026
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 185.92679200000566
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 286.7245000000039
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 202.4164579999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 202.05145800000173
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 187.14058400000067
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 285.58470800000214
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 219.59504200000083
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 185.0089169999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 202.49145899999712
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 297.1366249999992
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 202.9107090000034
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 185.60974999999598
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 200.89891699999862
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 300.9032920000027
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 218.90325000000303
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 199.7386669999978
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 200.89845799999603
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 314.3154580000046
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 202.02220800000214
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 186.39541699999972
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 184.93700000000536
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 299.9758329999968
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 203.18095899999753
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 187.1521670000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 186.4051660000041
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 284.90658400000393
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 216.09004199999617
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 201.78033300000243
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 203.6125830000019
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 301.4092079999973
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 200.74954199999775
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 185.04312500000378
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 204.75016699999833
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 287.10829200000444
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 204.4190000000017
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 186.80879099999584
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 184.86587499999587
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 286.364834
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 201.82854199999565
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 201.44662500000413
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 184.9425409999967
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 299.9747919999936
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 202.73929099999805
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 185.76054200000362
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 199.8636250000054
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 285.8087910000031
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 218.43612500000017
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 185.5792500000025
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 201.7519170000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 303.48775000000023
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 216.22441699999763
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 199.5684590000019
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 201.6140419999938
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 301.27012500000274
							}
						],
						"latencyMs": {
							"p50": 202.86270800000057,
							"p95": 308.11145899999974,
							"max": 354.37341699999524
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9331720,
						"cpuSystemMicros": 11216053,
						"closeMs": 16.821749999995518,
						"firstScanMs": 146.12375000000247,
						"watcherReadyMs": 716.3234579999989,
						"reconciliationMs": 394.0101250000007,
						"totalReadinessMs": 1258.271417,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 28884992
					},
					{
						"run": 3,
						"firstScanResultMs": 141.06245900000067,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 220.83983399999852
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 200.8551249999946
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 186.39087499999732
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 287.03104200000234
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 219.60549999999785
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 186.68583300000319
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 185.70466699999815
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 332.8159579999992
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 218.98116599999776
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 186.1937919999982
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 201.7852090000015
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 306.65158299999894
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 204.3402500000011
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 184.98958400000265
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 202.1597910000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 288.30708400000003
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 202.90745900000184
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 201.20491700000275
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 216.26991599999747
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 289.63604099999793
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 205.42195899999933
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 201.12950000000274
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 203.00125000000116
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 303.8051670000059
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 202.7299170000042
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 201.4512090000062
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 202.39191700000083
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 288.7649160000001
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 205.14974999999686
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 217.64524999999412
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 186.18012500000623
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 306.3447909999959
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 203.9287919999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 202.54587499999616
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 186.08862499999668
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 302.7720000000045
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 203.32579099999566
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 184.22962499999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 201.69095799999923
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 320.79725000000326
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 233.6160000000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 201.33033299999806
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 281.05291600000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 304.5015419999909
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 216.97754200000782
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 184.80775000000722
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 187.0281249999971
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 288.5845830000035
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 203.19966600000043
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 199.35425000000396
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 202.03929100000823
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 317.63933299999917
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 220.97741700000188
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 202.11395800000173
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 203.1157910000038
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 302.5086670000019
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 219.01687500000116
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 202.9192500000063
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 200.59712500000023
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 303.3676250000135
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 200.71912500000326
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 201.69308399999863
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 199.36887500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 305.14354099999764
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 202.30695800000103
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 201.50712500000373
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 187.55279100000917
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 300.3522079999966
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 199.48241599999892
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 184.31241600000067
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 190.07116699998733
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 304.90166699999827
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 202.57091599999694
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 200.86570900000515
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 205.39812500000698
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 303.7871670000022
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 205.90316699999676
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 201.20212499999616
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 200.53770899999654
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 306.24324999999953
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 203.7373329999973
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 200.40270799999416
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 200.2804579999938
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 303.0167499999952
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 219.3658749999886
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 203.47695899999235
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 218.1466250000085
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 334.84737499999756
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 217.19841700000688
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 186.3480830000044
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 185.5003340000112
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 302.68766699999105
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 203.26558300000033
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 186.22012499999255
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 183.81412500000442
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 282.97341700000106
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 217.46100000001024
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 203.04070800000045
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 200.2412500000064
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 288.7645409999968
							}
						],
						"latencyMs": {
							"p50": 203.1157910000038,
							"p95": 306.3447909999959,
							"max": 334.84737499999756
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9367023,
						"cpuSystemMicros": 11305678,
						"closeMs": 18.789958000008482,
						"firstScanMs": 143.69425000000047,
						"watcherReadyMs": 820.9019159999953,
						"reconciliationMs": 469.45345899999666,
						"totalReadinessMs": 1435.5339160000003,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 10436608
					}
				],
				"latencyMs": {
					"p50": 203.1157910000038,
					"p95": 306.24324999999953,
					"max": 354.37341699999524
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:40:00.857Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:40:00.857Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 5000,
				"shape": "broad",
				"mode": "polling",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 5000,
					"dirs": 500,
					"runs": 3,
					"mutations": 100,
					"usePolling": true,
					"shape": "broad"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 147.29004199999963,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 234.99645800000053
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 235.80233300000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 248.3166659999997
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 334.21420900000066
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 202.95383299999958
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 250.51774999999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 237.67000000000007
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 349.8538330000001
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 201.80050000000028
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 284.3376249999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 201.16720900000018
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 359.6209170000002
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 252.670709
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 237.05637500000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 235.22199999999975
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 300.07316600000104
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 201.25987500000156
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 237.78900000000067
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 236.60149999999885
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 378.95604099999946
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 253.7236669999984
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 232.73541699999987
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 252.11762500000077
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 331.62933300000077
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 202.61779200000092
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 231.54133300000103
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 252.20074999999997
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 339.4897499999988
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 219.56883299999936
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 234.3411670000005
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 236.17245899999944
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 355.088416999999
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 204.84154200000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 234.4135839999999
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 249.17791600000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 334.69554099999914
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 249.11199999999917
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 202.11899999999878
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 255.32720899999913
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 332.95716600000014
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 202.10812499999884
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 233.39674999999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 248.85866700000042
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 333.8079170000001
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 203.7066250000007
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 248.30583299999853
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 251.87012499999946
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 333.16079100000024
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 249.09049999999843
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 263.7435409999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 219.41358300000138
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 347.0639999999985
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 201.77529199999844
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 234.16541700000016
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 235.20679200000086
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 285.2688750000016
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 201.5487920000014
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 239.18116599999848
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 249.89708299999984
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 335.72991700000057
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 203.16154200000165
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 234.32016699999804
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 248.57800000000134
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 333.44395799999984
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 203.75425000000178
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 234.74462499999936
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 251.84570800000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 336.04449999999997
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 201.08237500000178
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 250.75379099999918
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 238.14900000000125
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 330.7424580000006
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 216.5887920000023
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 234.54241700000057
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 247.43604199999754
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 366.8364159999983
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 235.17212500000096
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 233.91800000000148
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 251.65970800000287
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 321.8764999999985
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 218.12429200000042
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 237.63687500000015
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 233.1755830000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 286.2610420000019
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 199.26100000000224
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 265.75987499999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 217.6282089999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 298.30854199999885
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 201.4602500000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 251.7151249999988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 218.57087500000125
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 354.60833399999683
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 202.7764160000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 233.65591700000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 236.05516600000192
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 286.3576670000002
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 203.55058400000053
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 237.1260829999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 249.38970899999913
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 337.39533400000073
							}
						],
						"latencyMs": {
							"p50": 238.14900000000125,
							"p95": 349.8538330000001,
							"max": 378.95604099999946
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9627159,
						"cpuSystemMicros": 14150238,
						"closeMs": 5.113750000000437,
						"firstScanMs": 138.08883399999968,
						"watcherReadyMs": 95.142875,
						"reconciliationMs": 580.2080840000003,
						"totalReadinessMs": 815.3581670000003,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 39501824
					},
					{
						"run": 2,
						"firstScanResultMs": 134.56933299999946,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 200.8655409999992
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 237.38491599999907
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 250.03358399999706
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 334.28058299999975
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 202.52495900000213
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 251.5586669999975
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 237.20708300000115
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 352.51229199999943
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 186.69979199999943
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 267.6120410000003
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 220.21225000000413
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 353.3866670000061
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 200.41475000000355
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 232.55366700000013
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 235.51987499999814
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 297.1805420000019
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 186.8035000000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 185.4208329999965
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 266.3132919999989
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 352.2922499999986
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 234.97362499999872
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 380.4458330000052
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 249.46604200000002
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 337.59387500000594
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 253.6397500000021
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 237.64566600000398
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 247.94625000000087
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 335.2819579999996
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 216.5327499999985
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 236.77495900000213
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 286.4873330000046
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 348.6802910000042
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 220.22508399999788
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 237.2543330000044
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 252.74662499999977
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 332.447791999999
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 221.40816699999414
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 264.158958
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 235.62479200000234
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 334.4722499999989
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 204.7962500000067
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 238.84787500000675
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 235.28283399999782
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 352.4829169999939
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 204.62704200000007
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 233.70962499999587
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 236.20404099999723
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 400.739708000001
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 200.7287090000027
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 254.15520899999683
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 233.0374159999992
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 349.13787500000035
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 201.06054099999892
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 234.8289999999979
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 235.6647079999966
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 349.69179099999747
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 233.06366600000183
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 235.79037499999686
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 220.2141249999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 369.2088750000039
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 253.6649580000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 234.50020799999766
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 238.83516700000473
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 350.4070420000062
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 201.76062500000262
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 219.01454200000444
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 186.43066700000054
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 302.1439590000009
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 252.8159169999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 233.75670900000114
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 248.54841700000543
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 365.42600000000675
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 238.57616699999926
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 249.41145900000265
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 251.0178339999984
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 331.6924169999984
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 202.84962499999529
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 248.22925000000396
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 237.38349999999627
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 362.60629199999676
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 253.11679200000071
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 235.3058749999982
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 255.10779200000252
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 330.525999999998
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 216.67512500000157
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 237.03833299999678
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 249.9858749999985
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 353.95037500000035
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 185.96050000000105
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 266.13154199999553
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 235.59304200000042
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 332.6038749999934
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 201.9450829999987
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 264.97550000000047
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 237.45479099999648
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 346.52525000000605
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 204.5094589999935
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 252.11145899999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 232.2650829999984
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 335.81116699999984
							}
						],
						"latencyMs": {
							"p50": 238.83516700000473,
							"p95": 353.95037500000035,
							"max": 400.739708000001
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9791182,
						"cpuSystemMicros": 14607617,
						"closeMs": 4.725083000004815,
						"firstScanMs": 135.34004099999947,
						"watcherReadyMs": 92.22379200000069,
						"reconciliationMs": 533.1943329999995,
						"totalReadinessMs": 762.2648330000011,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 15220736
					},
					{
						"run": 3,
						"firstScanResultMs": 143.02533299999777,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 206.41283299999486
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 239.60954199999833
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 247.53804200000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 397.6708329999965
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 216.26512499999808
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 238.54137499999342
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 246.65087499999936
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 348.32808300000033
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 202.7896249999976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 250.45875000000524
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 249.79158299999835
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 335.48441700000694
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 200.68070799999987
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 246.52954199999658
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 235.24950000000536
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 351.94024999999965
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 201.02045799999905
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 235.83604099999502
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 264.6183749999982
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 335.2844170000026
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 203.8418329999986
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 236.38354200000322
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 235.89695899999788
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 349.4547909999965
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 200.89804200000071
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 236.3955419999984
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 248.47587499998917
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 332.56612499999756
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 216.31895800000348
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 232.5396250000049
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 280.0730829999957
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 314.14483299999847
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 201.16791699999885
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 238.05529200000456
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 238.8259160000016
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 347.12045899999794
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 203.69899999999325
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 237.42958300000464
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 238.61379200000374
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 379.771499999988
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 237.98399999999674
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 253.35020899999654
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 250.73887500001
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 333.90616600000067
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 203.42112499999348
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 235.153999999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 232.91791699999885
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 300.3311670000112
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 200.21320800000103
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 235.05012500000885
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 252.2359160000051
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 348.5922910000081
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 203.30670899999677
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 234.9336670000048
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 246.92366700001003
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 334.1310839999933
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 201.1916659999988
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 254.78245899999456
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 232.8784580000065
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 350.6256250000006
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 204.13591700000688
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 235.5834590000013
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 248.50516600000265
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 334.1101670000062
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 217.38333299999067
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 237.20058400000562
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 236.4055420000077
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 378.78983300000255
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 266.9851250000065
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 233.53424999999697
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 220.64929200000188
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 346.090750000003
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 201.8092500000057
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 253.31324999999197
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 250.46966699999757
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 333.12145799999416
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 217.79391599999508
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 233.82337500000722
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 238.40224999999919
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 335.5680830000056
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 216.24483399999735
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 236.19545800000196
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 265.09820800001035
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 320.3229999999894
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 218.5447920000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 234.44491700000071
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 235.91591699999117
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 347.7458329999936
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 204.8053329999966
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 250.24970899999607
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 237.83658400000422
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 345.8123750000086
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 204.47433299999102
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 238.87229100000695
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 251.11679200000071
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 366.3842500000028
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 240.03508300000976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 236.36079199999222
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 251.50866600000882
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 337.0263330000016
							}
						],
						"latencyMs": {
							"p50": 238.61379200000374,
							"p95": 350.6256250000006,
							"max": 397.6708329999965
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4575,
						"prunedFileCount": 500,
						"controlFileCount": 501,
						"cpuUserMicros": 9740618,
						"cpuSystemMicros": 14350457,
						"closeMs": 5.257041999997455,
						"firstScanMs": 145.4810839999991,
						"watcherReadyMs": 96.18375000000378,
						"reconciliationMs": 544.4071249999979,
						"totalReadinessMs": 787.9227079999982,
						"directoryCount": 451,
						"watchCount": 451,
						"rssDeltaBytes": 11681792
					}
				],
				"latencyMs": {
					"p50": 238.8259160000016,
					"p95": 353.3866670000061,
					"max": 400.739708000001
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:41:27.234Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:41:27.234Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 5000,
				"shape": "deep",
				"mode": "event",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 5000,
					"dirs": 500,
					"runs": 3,
					"mutations": 100,
					"usePolling": false,
					"shape": "deep"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 168.8212910000002,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 254.82600000000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 232.97258300000067
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 219.74812500000007
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 322.86516699999993
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 237.0383329999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 216.66449999999986
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 218.13174999999956
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 323.0167080000001
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 250.90133399999922
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 236.25429200000053
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 235.05891699999938
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 336.2911669999994
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 253.676292000001
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 269.6764170000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 235.12012500000128
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 339.56933299999946
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 234.07675000000017
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 236.1059580000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 217.54662499999904
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 337.49716700000135
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 235.60433400000147
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 233.74374999999964
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 219.30516699999862
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 322.197791999999
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 254.03450000000157
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 250.3352500000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 232.16916599999968
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 320.1570419999989
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 251.49062500000036
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 219.89854200000082
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 218.6309999999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 321.87624999999935
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 233.96304099999907
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 217.42250000000058
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 266.29862499999945
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 336.9927910000006
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 235.3189999999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 218.83954099999937
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 217.4216669999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 319.74654199999895
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 301.962125
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 238.29299999999967
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 232.45316599999933
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 337.8503750000018
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 235.8573749999996
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 220.60733400000026
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 233.50995799999873
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 323.61541600000055
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 235.88475000000108
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 216.03075000000172
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 218.19583300000158
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 322.8887500000019
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 263.3626669999976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 216.30583300000217
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 221.5560000000005
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 318.0339160000003
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 234.953125
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 217.64120800000092
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 235.6921250000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 322.08245800000077
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 250.15224999999919
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 218.63524999999936
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 218.73229100000026
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 335.71662500000093
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 252.45958299999984
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 237.20624999999927
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 219.3652919999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 338.0661669999972
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 233.8309999999983
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 217.95516700000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 216.80574999999953
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 342.2323329999999
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 235.91512499999953
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 217.07737500000076
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 218.34479199999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 320.0826670000024
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 232.95295799999803
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 217.14279100000203
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 236.71804200000042
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 323.2927079999972
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 266.2562079999989
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 218.24954199999775
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 218.48574999999983
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 322.6867920000004
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 234.31362499999886
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 218.42375000000175
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 216.92620800000077
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 324.5462499999994
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 236.23541699999987
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 220.50166699999681
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 219.79237499999726
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 323.72970799999894
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 269.7328329999982
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 247.44350000000122
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 219.29383299999972
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 323.69304099999863
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 237.36029199999757
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 216.63379200000054
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 232.90929099999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 306.83799999999974
							}
						],
						"latencyMs": {
							"p50": 235.8573749999996,
							"p95": 336.9927910000006,
							"max": 342.2323329999999
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12672686,
						"cpuSystemMicros": 10141824,
						"closeMs": 13.546875,
						"firstScanMs": 168.27737500000012,
						"watcherReadyMs": 660.9051249999998,
						"reconciliationMs": 438.82837500000005,
						"totalReadinessMs": 1269.4933750000005,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 48676864
					},
					{
						"run": 2,
						"firstScanResultMs": 162.15391699999964,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 236.92212499999732
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 220.35724999999366
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 218.80670899999677
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 322.4097079999992
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 237.1551249999975
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 220.01000000000204
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 219.8829160000023
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 322.17749999999796
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 235.7079589999994
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 217.8022090000013
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 218.33470800000214
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 334.45037500000035
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 251.88370900000155
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 235.87950000000274
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 218.74979200000234
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 321.6357500000013
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 233.84208400000352
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 218.85112499999377
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 234.57441699999617
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 332.04920900000434
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 235.1834170000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 234.5072500000024
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 221.17808299999888
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 368.57933400000184
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 235.64491599999747
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 219.0187500000029
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 219.5259589999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 322.237000000001
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 236.48608400000376
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 219.42020800000319
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 220.46133299999929
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 318.6214590000018
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 235.5635409999959
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 219.9501670000027
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 221.09887499999604
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 368.23362500000076
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 249.28016699999716
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 218.54091699999844
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 234.40683300000092
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 317.1894170000014
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 235.22912499999802
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 216.6255419999943
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 222.59437500000058
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 370.9172089999993
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 237.58445800000482
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 217.7037909999999
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 219.7406670000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 322.10941699999967
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 236.6650840000002
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 219.98662499999773
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 220.1821670000063
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 320.23504200000025
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 269.6487500000003
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 220.16779099999985
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 236.39445899999555
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 338.44862500000454
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 235.37012500000128
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 218.203125
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 218.8336249999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 323.2513340000005
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 236.7552910000013
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 218.6400829999984
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 217.5432909999945
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 323.67941599999904
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 234.04779199999757
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 220.83879100000195
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 220.79045800000313
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 319.0621670000037
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 234.44674999999552
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 220.13045799999963
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 216.66195800000423
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 318.15729199999623
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 232.97266600000148
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 218.1125419999953
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 220.05391700000473
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 338.38516700000037
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 234.72675000000163
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 218.94041700000525
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 218.7933750000011
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 324.39279199999874
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 235.54762499999924
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 218.6447079999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 218.41020800000115
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 321.6542499999996
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 251.1520410000012
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 219.27070799999638
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 220.4867499999964
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 322.57179200000246
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 234.47429099999863
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 217.05016700000124
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 216.7084590000013
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 319.734583999998
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 251.48999999999796
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 235.45287500000268
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 218.22995799999626
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 322.2652919999964
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 236.6157910000038
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 219.58250000000407
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 220.15691700000025
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 322.9612080000006
							}
						],
						"latencyMs": {
							"p50": 234.47429099999863,
							"p95": 334.45037500000035,
							"max": 370.9172089999993
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12241833,
						"cpuSystemMicros": 10289714,
						"closeMs": 13.636874999996508,
						"firstScanMs": 185.2824580000015,
						"watcherReadyMs": 664.7055,
						"reconciliationMs": 452.63741700000173,
						"totalReadinessMs": 1304.2533750000002,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 35799040
					},
					{
						"run": 3,
						"firstScanResultMs": 175.1309590000019,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 236.9762499999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 219.55562500000087
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 217.4228329999969
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 322.20874999999796
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 234.3576250000042
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 218.32675000000017
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 283.4583330000023
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 336.3239590000012
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 234.3578750000015
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 217.75945800000045
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 234.6097080000036
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 337.84562500000175
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 234.6897919999974
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 234.826083999993
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 232.82383400000253
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 320.88595799999894
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 236.1943339999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 217.98999999999796
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 216.17899999999645
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 322.6512920000023
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 234.76399999999558
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 217.0827500000014
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 220.45508400000108
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 336.2537080000038
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 252.79804200000945
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 218.92770799998834
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 218.84908300000825
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 319.4089160000003
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 235.25274999999965
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 216.8044579999987
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 219.61716700000397
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 322.1040409999987
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 236.797040999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 233.69841599999927
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 217.87779199999932
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 334.3582500000048
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 236.05166699999245
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 218.08250000000407
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 218.8418329999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 338.91170799999963
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 234.74791599999298
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 217.8011669999978
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 217.94262499999604
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 322.5068750000064
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 236.0553329999966
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 218.83266700000968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 265.5773749999935
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 335.7841250000056
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 234.99504100000195
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 234.3572920000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 220.81704100000206
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 322.9651659999945
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 235.84562500000175
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 283.6947499999951
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 218.18325000000186
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 323.9538339999999
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 238.19224999999278
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 218.90924999999697
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 234.88675000000512
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 321.72733300000255
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 251.01491699999315
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 203.153999999995
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 216.99583299999358
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 320.9737920000043
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 251.3437910000066
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 217.88166599998658
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 221.36699999999837
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 355.3185000000085
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 238.3966250000085
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 219.99112500000047
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 219.61779200000456
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 338.4398329999967
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 233.703290999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 253.52654099999927
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 235.5796249999985
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 318.7840419999993
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 252.19441700000607
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 234.1392499999929
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 235.4751249999972
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 337.356832999998
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 251.81225000000268
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 252.47400000000198
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 236.10795900000085
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 322.39274999999907
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 253.62183299999742
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 266.9756669999915
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 236.9215419999964
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 319.888374999995
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 237.9297499999957
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 219.0336670000106
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 221.37012500000128
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 337.05208299998776
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 235.20237499999348
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 216.89204199999222
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 235.37841599999228
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 339.0646660000057
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 236.59004199999617
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 219.45858299999963
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 236.74087500000314
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 335.95916700000816
							}
						],
						"latencyMs": {
							"p50": 235.5796249999985,
							"p95": 337.356832999998,
							"max": 355.3185000000085
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12537720,
						"cpuSystemMicros": 10342454,
						"closeMs": 13.393332999999984,
						"firstScanMs": 170.5109999999986,
						"watcherReadyMs": 595.7678330000053,
						"reconciliationMs": 456.9512909999976,
						"totalReadinessMs": 1224.8896660000028,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 20807680
					}
				],
				"latencyMs": {
					"p50": 235.37012500000128,
					"p95": 337.356832999998,
					"max": 370.9172089999993
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:42:57.620Z-benchmark-cell-source",
			"recordedAt": "2026-07-31T22:42:57.620Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": [],
			"benchmarkCell": {
				"files": 5000,
				"shape": "deep",
				"mode": "polling",
				"runs": 3,
				"mutations": 100
			},
			"result": {
				"command": "benchmark",
				"runtime": {
					"name": "bun",
					"version": "1.3.10",
					"platform": "darwin",
					"arch": "arm64",
					"osRelease": "25.5.0"
				},
				"dependencies": {
					"chokidar": "5.0.0",
					"fuzzysort": "3.1.0",
					"ignore": "7.0.5"
				},
				"fixture": {
					"files": 5000,
					"dirs": 500,
					"runs": 3,
					"mutations": 100,
					"usePolling": true,
					"shape": "deep"
				},
				"trials": [
					{
						"run": 1,
						"firstScanResultMs": 184.797458,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 251.70533400000022
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 269.2862500000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 254.52358399999957
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 334.60358300000007
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 268.0542089999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 269.8187079999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 274.08808300000055
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 336.6103750000002
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 266.9026250000006
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 235.46549999999934
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 234.92683300000044
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 350.3088749999997
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 255.23445899999933
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 233.62374999999975
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 237.74824999999964
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 349.7298329999994
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 268.18583299999955
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 233.99404200000026
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 237.67766699999993
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 348.3142079999998
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 250.2461660000008
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 232.39700000000084
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 253.62424999999894
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 345.24324999999953
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 253.87387500000114
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 236.2061250000006
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 252.83766600000126
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 333.8537919999999
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 266.77599999999984
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 235.05133299999943
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 266.2389999999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 372.5959590000002
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 250.9801669999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 235.38779199999954
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 253.04137499999888
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 338.2998750000006
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 250.48133299999972
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 252.43820899999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 234.9161669999994
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 352.48291699999936
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 254.47337499999958
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 251.21995799999968
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 252.1006669999988
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 387.51104199999827
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 252.43299999999726
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 253.10283399999753
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 221.07424999999785
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 378.3352500000001
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 219.56045900000026
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 250.04108300000007
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 236.0767080000005
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 351.11933299999873
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 249.48425000000134
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 234.29491699999926
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 250.43237500000032
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 321.2617079999982
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 270.5707079999993
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 247.713458000002
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 236.19712499999878
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 352.39083400000163
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 270.89016699999775
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 219.59625000000233
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 233.25675000000047
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 352.6893339999988
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 249.3248330000024
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 247.7652089999974
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 249.09670899999765
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 331.61699999999837
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 266.8418750000019
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 234.9494169999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 234.65724999999657
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 351.2976250000029
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 269.5549170000013
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 218.0280410000014
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 254.69154200000048
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 331.66062500000044
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 282.5275419999998
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 218.10016600000017
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 250.11820799999987
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 353.288875000002
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 247.9409169999999
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 234.54441699999734
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 235.1307909999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 349.3989580000016
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 249.91683299999931
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 253.94250000000102
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 237.24179200000071
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 348.35920799999803
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 253.4331659999989
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 235.71341699999903
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 248.99387500000012
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 334.2438750000001
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 269.99133399999846
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 233.88187499999913
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 250.20716700000048
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 356.0361669999984
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 251.14616599999863
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 268.729292
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 270.80683299999873
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 320.36266700000124
							}
						],
						"latencyMs": {
							"p50": 253.04137499999888,
							"p95": 352.6893339999988,
							"max": 387.51104199999827
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12731468,
						"cpuSystemMicros": 13725516,
						"closeMs": 9.601291000002675,
						"firstScanMs": 176.13541699999996,
						"watcherReadyMs": 82.23675000000003,
						"reconciliationMs": 607.2880419999997,
						"totalReadinessMs": 867.3799999999997,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 39682048
					},
					{
						"run": 2,
						"firstScanResultMs": 170.6130830000002,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 223.58974999999919
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 239.0008749999979
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 236.23866599999747
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 347.7848339999982
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 250.71537499999977
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 249.70187499999884
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 247.9962499999965
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 331.86529199999495
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 265.8130830000009
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 269.42058299999917
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 269.59570800000074
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 348.775791
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 269.205833
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 247.6004580000008
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 286.96949999999924
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 338.1276249999937
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 268.13516700000037
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 233.45495899999514
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 235.37924999999814
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 354.1497920000038
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 254.53941699999996
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 249.3247080000001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 235.15745900000184
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 347.2244170000049
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 267.9882920000018
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 231.77904200000194
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 239.73254099999758
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 354.53899999999703
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 266.1736249999958
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 217.22262500000215
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 249.1770419999957
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 347.5017089999965
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 253.56925000000047
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 233.83050000000367
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 252.49495800000295
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 335.10233300000255
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 266.44662499999686
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 233.1244579999984
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 265.7387080000044
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 400.16508299999987
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 235.92970799999603
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 248.49583299999358
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 237.53833299999678
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 353.5299159999995
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 252.07887499999924
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 269.6582500000004
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 296.5547080000033
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 385.8549999999959
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 267.9388340000005
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 235.9284170000028
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 286.78600000000006
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 384.53374999999505
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 232.5838750000039
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 251.56650000000081
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 232.45270800000435
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 348.3041249999951
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 268.1701249999969
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 231.07295799999702
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 235.7982919999995
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 354.8003749999989
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 249.29087500000605
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 231.55658299999777
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 250.9834589999955
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 315.57833299999766
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 267.9137499999997
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 255.86108299999614
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 254.39945800000714
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 329.93849999999657
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 270.4649999999965
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 232.14120800000092
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 267.6270420000001
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 372.1209170000002
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 268.1206249999959
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 233.93349999999919
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 250.8604170000035
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 336.8943750000035
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 266.3262909999976
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 233.3327500000014
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 236.484375
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 350.8034589999952
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 269.1247500000027
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 268.07958399999916
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 298.89504199999647
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 368.50045800000225
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 268.1759999999995
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 235.58083299999998
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 265.1202090000006
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 383.3812500000058
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 254.20658299999923
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 236.291999999994
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 249.90879100000166
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 337.2675420000014
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 270.14970800000447
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 234.5426660000012
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 233.48737499999697
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 348.8096250000017
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 252.88320800000656
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 253.19337500000256
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 236.0304580000011
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 354.1200000000026
							}
						],
						"latencyMs": {
							"p50": 265.1202090000006,
							"p95": 368.50045800000225,
							"max": 400.16508299999987
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12992577,
						"cpuSystemMicros": 13757580,
						"closeMs": 4.68525000000227,
						"firstScanMs": 194.64258300000438,
						"watcherReadyMs": 83.35116700000071,
						"reconciliationMs": 606.5297090000022,
						"totalReadinessMs": 886.075667000001,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 11223040
					},
					{
						"run": 3,
						"firstScanResultMs": 161.70437500000116,
						"latencySamples": [
							{
								"kind": "add",
								"path": "mutation-create-0.txt",
								"ms": 234.65945799999463
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-1.txt",
								"ms": 235.54850000000442
							},
							{
								"kind": "change",
								"path": "mutation-atomic-2.txt",
								"ms": 250.79550000000017
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-3.txt",
								"ms": 344.3313330000019
							},
							{
								"kind": "add",
								"path": "mutation-create-4.txt",
								"ms": 251.7925830000022
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-5.txt",
								"ms": 237.09591699999874
							},
							{
								"kind": "change",
								"path": "mutation-atomic-6.txt",
								"ms": 238.89279100000567
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-7.txt",
								"ms": 336.2200840000005
							},
							{
								"kind": "add",
								"path": "mutation-create-8.txt",
								"ms": 268.8162500000035
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-9.txt",
								"ms": 235.19520800000464
							},
							{
								"kind": "change",
								"path": "mutation-atomic-10.txt",
								"ms": 248.5223330000008
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-11.txt",
								"ms": 349.8555000000051
							},
							{
								"kind": "add",
								"path": "mutation-create-12.txt",
								"ms": 250.45554199999606
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-13.txt",
								"ms": 234.93516700000328
							},
							{
								"kind": "change",
								"path": "mutation-atomic-14.txt",
								"ms": 232.58012499999313
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-15.txt",
								"ms": 333.2052920000133
							},
							{
								"kind": "add",
								"path": "mutation-create-16.txt",
								"ms": 270.51808300000266
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-17.txt",
								"ms": 238.68770799999766
							},
							{
								"kind": "change",
								"path": "mutation-atomic-18.txt",
								"ms": 233.16587500000605
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-19.txt",
								"ms": 349.7517089999892
							},
							{
								"kind": "add",
								"path": "mutation-create-20.txt",
								"ms": 253.0568750000093
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-21.txt",
								"ms": 231.16624999999476
							},
							{
								"kind": "change",
								"path": "mutation-atomic-22.txt",
								"ms": 251.5616250000021
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-23.txt",
								"ms": 334.30454199999804
							},
							{
								"kind": "add",
								"path": "mutation-create-24.txt",
								"ms": 269.21687499999825
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-25.txt",
								"ms": 234.25341599999228
							},
							{
								"kind": "change",
								"path": "mutation-atomic-26.txt",
								"ms": 248.36641699999745
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-27.txt",
								"ms": 339.06200000000536
							},
							{
								"kind": "add",
								"path": "mutation-create-28.txt",
								"ms": 252.3451250000071
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-29.txt",
								"ms": 233.83349999999336
							},
							{
								"kind": "change",
								"path": "mutation-atomic-30.txt",
								"ms": 252.72208300000057
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-31.txt",
								"ms": 351.8942079999979
							},
							{
								"kind": "add",
								"path": "mutation-create-32.txt",
								"ms": 269.88758300000336
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-33.txt",
								"ms": 233.9471249999915
							},
							{
								"kind": "change",
								"path": "mutation-atomic-34.txt",
								"ms": 237.14520800000173
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-35.txt",
								"ms": 352.43595800000185
							},
							{
								"kind": "add",
								"path": "mutation-create-36.txt",
								"ms": 253.88250000000698
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-37.txt",
								"ms": 267.1774580000056
							},
							{
								"kind": "change",
								"path": "mutation-atomic-38.txt",
								"ms": 251.64054100000067
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-39.txt",
								"ms": 335.6280000000115
							},
							{
								"kind": "add",
								"path": "mutation-create-40.txt",
								"ms": 266.513958999989
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-41.txt",
								"ms": 250.66920799999207
							},
							{
								"kind": "change",
								"path": "mutation-atomic-42.txt",
								"ms": 235.151165999996
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-43.txt",
								"ms": 331.92849999999453
							},
							{
								"kind": "add",
								"path": "mutation-create-44.txt",
								"ms": 268.1634589999885
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-45.txt",
								"ms": 236.05975000000035
							},
							{
								"kind": "change",
								"path": "mutation-atomic-46.txt",
								"ms": 233.63012499999604
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-47.txt",
								"ms": 354.11683299999277
							},
							{
								"kind": "add",
								"path": "mutation-create-48.txt",
								"ms": 265.72079099999974
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-49.txt",
								"ms": 233.52087500000198
							},
							{
								"kind": "change",
								"path": "mutation-atomic-50.txt",
								"ms": 265.5551669999986
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-51.txt",
								"ms": 378.4483750000072
							},
							{
								"kind": "add",
								"path": "mutation-create-52.txt",
								"ms": 249.4744159999973
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-53.txt",
								"ms": 286.3174169999984
							},
							{
								"kind": "change",
								"path": "mutation-atomic-54.txt",
								"ms": 265.26245900000504
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-55.txt",
								"ms": 332.7289579999924
							},
							{
								"kind": "add",
								"path": "mutation-create-56.txt",
								"ms": 267.56370899999456
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-57.txt",
								"ms": 234.48887500001
							},
							{
								"kind": "change",
								"path": "mutation-atomic-58.txt",
								"ms": 234.0983750000014
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-59.txt",
								"ms": 350.7759159999987
							},
							{
								"kind": "add",
								"path": "mutation-create-60.txt",
								"ms": 268.53125
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-61.txt",
								"ms": 234.6814999999915
							},
							{
								"kind": "change",
								"path": "mutation-atomic-62.txt",
								"ms": 236.56570799999463
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-63.txt",
								"ms": 333.926833000005
							},
							{
								"kind": "add",
								"path": "mutation-create-64.txt",
								"ms": 268.1238750000048
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-65.txt",
								"ms": 235.2755829999951
							},
							{
								"kind": "change",
								"path": "mutation-atomic-66.txt",
								"ms": 250.10725000000093
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-67.txt",
								"ms": 333.64666700000816
							},
							{
								"kind": "add",
								"path": "mutation-create-68.txt",
								"ms": 250.46520799999416
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-69.txt",
								"ms": 249.86554199999955
							},
							{
								"kind": "change",
								"path": "mutation-atomic-70.txt",
								"ms": 252.97299999999814
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-71.txt",
								"ms": 332.4590409999946
							},
							{
								"kind": "add",
								"path": "mutation-create-72.txt",
								"ms": 265.02675000000454
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-73.txt",
								"ms": 234.63833300000988
							},
							{
								"kind": "change",
								"path": "mutation-atomic-74.txt",
								"ms": 254.34175000000687
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-75.txt",
								"ms": 330.929667000004
							},
							{
								"kind": "add",
								"path": "mutation-create-76.txt",
								"ms": 266.63300000000163
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-77.txt",
								"ms": 232.21945899999992
							},
							{
								"kind": "change",
								"path": "mutation-atomic-78.txt",
								"ms": 252.25258299999405
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-79.txt",
								"ms": 330.7397920000076
							},
							{
								"kind": "add",
								"path": "mutation-create-80.txt",
								"ms": 269.46629199999734
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-81.txt",
								"ms": 232.66170799999963
							},
							{
								"kind": "change",
								"path": "mutation-atomic-82.txt",
								"ms": 233.4521250000107
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-83.txt",
								"ms": 350.8105829999986
							},
							{
								"kind": "add",
								"path": "mutation-create-84.txt",
								"ms": 266.42862500000047
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-85.txt",
								"ms": 248.859375
							},
							{
								"kind": "change",
								"path": "mutation-atomic-86.txt",
								"ms": 249.4737909999967
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-87.txt",
								"ms": 319.7292499999894
							},
							{
								"kind": "add",
								"path": "mutation-create-88.txt",
								"ms": 267.24808300001314
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-89.txt",
								"ms": 235.20704199999454
							},
							{
								"kind": "change",
								"path": "mutation-atomic-90.txt",
								"ms": 248.58283300000767
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-91.txt",
								"ms": 335.0096249999915
							},
							{
								"kind": "add",
								"path": "mutation-create-92.txt",
								"ms": 267.8568749999977
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-93.txt",
								"ms": 237.61575000001176
							},
							{
								"kind": "change",
								"path": "mutation-atomic-94.txt",
								"ms": 248.35204199999862
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-95.txt",
								"ms": 348.0739159999939
							},
							{
								"kind": "add",
								"path": "mutation-create-96.txt",
								"ms": 251.43774999999732
							},
							{
								"kind": "change",
								"path": "mutation-rewrite-97.txt",
								"ms": 234.0477910000045
							},
							{
								"kind": "change",
								"path": "mutation-atomic-98.txt",
								"ms": 249.3817090000084
							},
							{
								"kind": "unlink",
								"path": "mutation-remove-99.txt",
								"ms": 329.7429160000029
							}
						],
						"latencyMs": {
							"p50": 252.3451250000071,
							"p95": 350.7759159999987,
							"max": 378.4483750000072
						},
						"physicalFileCount": 5075,
						"eligibleFileCount": 4035,
						"prunedFileCount": 1040,
						"controlFileCount": 501,
						"cpuUserMicros": 12553598,
						"cpuSystemMicros": 13262534,
						"closeMs": 4.494875000003958,
						"firstScanMs": 164.53512499999488,
						"watcherReadyMs": 90.14529200000106,
						"reconciliationMs": 586.2598749999961,
						"totalReadinessMs": 842.4417500000054,
						"directoryCount": 397,
						"watchCount": 397,
						"rssDeltaBytes": 34455552
					}
				],
				"latencyMs": {
					"p50": 253.56925000000047,
					"p95": 354.11683299999277,
					"max": 400.16508299999987
				}
			},
			"failure": null
		},
		{
			"id": "2026-07-31T22:43:09.076Z-benchmark-cell-source-failure",
			"recordedAt": "2026-07-31T22:43:09.076Z",
			"kind": "benchmark-cell",
			"provenance": "source",
			"runtime": {
				"name": "bun",
				"version": "1.3.10",
				"platform": "darwin",
				"arch": "arm64",
				"osRelease": "25.5.0"
			},
			"mode": "event",
			"cellIdentity": "bun-1.3.10-darwin-arm64-event",
			"affectedCellIdentities": ["bun-1.3.10-darwin-arm64-event"],
			"benchmarkCell": {
				"files": 10000,
				"shape": "broad",
				"mode": "event",
				"runs": 3,
				"mutations": 100
			},
			"result": null,
			"failure": "Error: terminated by SIGTRAP: ============================================================\nBun v1.3.10 (30e609e0) macOS Silicon\nmacOS v26.5.1\nCPU: fp aes crc32 atomics\nArgs: \"/Users/carles/.bun/bin/bun\" \"/Users/carles/src/house/packages/ui/dev/backend-feasibility.ts\" \"benchmark-cell\" \"--files\" \"10000\" \"--dirs\" \"1000\" \"--runs\" \"3\" \"--mutations\" \"100\" \"--shape\" \"broad\"\nFeatures: bunfig jsc transpiler_cache tsconfig \nBuiltins: \"bun:main\" \"node:child_process\" \"node:crypto\" \"node:events\" \"node:fs\" \"node:fs/promises\" \"node:os\" \"node:path\" \"node:stream\" \nElapsed: 11413ms | User: 3125ms | Sys: 13052ms\nRSS: 0.22GB | Peak: 0.27GB | Commit: 0.97GB | Faults: 158 | Machine: 17.18GB\n\npanic(main thread): Segmentation fault at address 0xCA\noh no: Bun has crashed. This indicates a bug in Bun, not your code.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n https://bun.report/1.3.10/Ma130e609egDgkggC_+mjrP+/o3iB2xlziB2hm6tB_______u7sm/C+y04qCm62lvCm+gomB__u7sm/Cmi0kjCA2A0M\n    at <anonymous> (/Users/carles/src/house/packages/ui/dev/backend-feasibility.ts:500:9)\n    at <anonymous> (/Users/carles/src/house/packages/ui/dev/benchmark-matrix.ts:86:23)\n    at unknown\n    at unknown\n    at processTicksAndRejections (native:7:39)"
		}
	]
}
```

<!-- backend-feasibility:evidence:end -->
