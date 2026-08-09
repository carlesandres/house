import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
	runCorrectness,
	runPhaseInterleavingCorrectness,
	runReplacementPhaseCorrectness,
	scanTopology,
	verifyDependencyImports,
} from "../dev/backend-harness.ts"
import type { ScanPolicy } from "../dev/backend-harness.ts"
import { validateEvidence, validateEvidenceDocument } from "../dev/evidence.ts"
import type { EvidenceArtifact, EvidenceDocument, EvidenceRuntime } from "../dev/evidence.ts"
import { benchmarkCellKey, runIsolatedBenchmarkMatrix } from "../dev/benchmark-matrix.ts"
import type { IsolatedBenchmarkCell, MatrixChildOutcome } from "../dev/benchmark-matrix.ts"

const evidenceRuntime: EvidenceRuntime = {
	name: "bun",
	version: "1.3.10",
	platform: "darwin",
	arch: "arm64",
	osRelease: "test",
}

const benchmarkReport = (files: number, shape: "broad" | "deep", usePolling: boolean): unknown => {
	const latencySamples = Array.from({ length: 100 }, (_, index) => ({
		kind: index % 4 === 3 ? "unlink" : index % 4 === 0 ? "add" : "change",
		path: `mutation-${index}.txt`,
		ms: 10,
	}))
	const trial = (run: number) => ({
		run,
		firstScanResultMs: 10,
		latencySamples,
		latencyMs: { p50: 10, p95: 10, max: 10 },
		physicalFileCount: files + 75,
		eligibleFileCount: files - 25,
		prunedFileCount: 100,
		controlFileCount: 121,
		cpuUserMicros: 10,
		cpuSystemMicros: 10,
		closeMs: 1,
		firstScanMs: 10,
		watcherReadyMs: 10,
		reconciliationMs: 10,
		totalReadinessMs: 30,
		directoryCount: 100,
		watchCount: 100,
		rssDeltaBytes: 1024,
	})
	return {
		command: "benchmark",
		runtime: evidenceRuntime,
		fixture: { files, dirs: 120, runs: 3, mutations: 100, usePolling, shape },
		trials: [trial(1), trial(2), trial(3)],
		latencyMs: { p50: 10, p95: 10, max: 10 },
	}
}

const artifact = (overrides: Partial<EvidenceArtifact>): EvidenceArtifact => ({
	id: "artifact",
	recordedAt: new Date(0).toISOString(),
	kind: "benchmark-matrix",
	provenance: "source",
	runtime: evidenceRuntime,
	mode: "event",
	cellIdentity: null,
	affectedCellIdentities: [],
	benchmarkCell: null,
	result: null,
	failure: null,
	...overrides,
})

const runNodeProbe = async (args: readonly string[], evidencePath?: string): Promise<number> =>
	new Promise<number>((resolveExit, rejectExit) => {
		const child = spawn(
			process.execPath,
			[join(process.cwd(), "dev/backend-feasibility.ts"), "node-probe", ...args],
			{
				cwd: process.cwd(),
				stdio: "ignore",
				env: {
					...process.env,
					...(evidencePath === undefined ? {} : { HOUSE_UI_EVIDENCE_PATH: evidencePath }),
				},
			},
		)
		child.once("error", rejectExit)
		child.once("exit", (code) => resolveExit(code ?? -1))
	})

const evidenceTest = process.env.HOUSE_UI_RUN_REJECTED_BACKEND_EVIDENCE === "1" ? test : test.skip

const emptyEvidenceMarkdown = `# Test Evidence

<!-- backend-feasibility:evidence:start -->

\`\`\`json
{"schemaVersion":2,"conclusion":"incomplete","updatedAt":"1970-01-01T00:00:00.000Z","artifacts":[]}
\`\`\`

<!-- backend-feasibility:evidence:end -->
`

const parseEvidenceMarkdown = async (path: string): Promise<EvidenceDocument> => {
	const markdown = await readFile(path, "utf8")
	const match = markdown.match(
		/<!-- backend-feasibility:evidence:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- backend-feasibility:evidence:end -->/,
	)
	if (!match?.[1]) throw new Error("test evidence markdown is malformed")
	return JSON.parse(match[1]) as EvidenceDocument
}

const eventCell: IsolatedBenchmarkCell = {
	files: 1_000,
	shape: "broad",
	usePolling: false,
	runs: 3,
	mutations: 100,
}

const pollingCell: IsolatedBenchmarkCell = { ...eventCell, usePolling: true }

const policy = (recursive: boolean): ScanPolicy => ({
	recursive,
	followSymlinks: false,
	ignoreFiles: [".gitignore"],
	excludedDirectoryNames: new Set(["excluded"]),
})

describe("backend feasibility orchestration", () => {
	test("imports and minimally executes every direct dependency", async () => {
		expect(await verifyDependencyImports()).toEqual({
			chokidar: true,
			fuzzysort: true,
			ignore: true,
		})
	})

	test("derives deterministic policy-pruned and nonrecursive topologies", async () => {
		const root = await mkdtemp(join(tmpdir(), "house-ui-topology-test-"))
		try {
			await Promise.all([
				mkdir(join(root, "included")),
				mkdir(join(root, "excluded")),
				mkdir(join(root, "ignored")),
			])
			await Promise.all([
				writeFile(join(root, ".gitignore"), "ignored/\n"),
				writeFile(join(root, "root.txt"), "root"),
				writeFile(join(root, "included", "file.txt"), "included"),
				writeFile(join(root, "excluded", "file.txt"), "excluded"),
				writeFile(join(root, "ignored", "file.txt"), "ignored"),
			])

			const recursive = await scanTopology(root, policy(true))
			expect(recursive.files.map((file) => file.relativePath)).toEqual([
				"included/file.txt",
				"root.txt",
			])
			expect(recursive.watchDirectories.flatMap((directory) => directory.lexicalPaths)).toEqual([
				root,
				join(root, "included"),
			])

			const nonrecursive = await scanTopology(root, policy(false))
			expect(nonrecursive.files.map((file) => file.relativePath)).toEqual(["root.txt"])
			expect(nonrecursive.watchDirectories).toHaveLength(1)

			await writeFile(join(root, ".gitignore"), "*.tmp\n")
			await Promise.all([
				writeFile(join(root, "included", ".gitignore"), "!keep.tmp\n"),
				writeFile(join(root, "included", "keep.tmp"), "keep"),
				writeFile(join(root, "included", "drop.tmp"), "drop"),
			])
			const negated = await scanTopology(root, policy(true))
			expect(negated.files.map((file) => file.relativePath)).toContain("included/keep.tmp")
			expect(negated.files.map((file) => file.relativePath)).not.toContain("included/drop.tmp")
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	evidenceTest(
		"proves real event-mode filesystem correctness",
		async () => {
			const report = await runCorrectness(false)
			expect(report.usePolling).toBe(false)
			expect(report.scenarios).toContain("symlink-root-and-followed-external-cycle")
		},
		30_000,
	)

	evidenceTest(
		"forces every initial handoff phase in polling mode",
		async () => {
			await runPhaseInterleavingCorrectness(true)
		},
		10_000,
	)

	evidenceTest(
		"proves readiness-bearing replacement phases in event and polling modes",
		async () => {
			for (const usePolling of [false, true]) {
				const proof = await runReplacementPhaseCorrectness(usePolling)
				expect(proof.generation).toMatchObject({
					kind: "replacement",
					committed: true,
				})
				expect(proof.generation.generationId).toMatch(/^generation-\d+$/)
				expect(proof.generation.parentInvalidations).toHaveLength(1)
				expect(proof.logicalPublication.added).toEqual(proof.expectedAdditions)
				expect(proof.postReadyPublication.added).toEqual([proof.postReadyAddition])
			}
		},
		20_000,
	)

	test("recognizes the durable evidence as truthful and rejected", async () => {
		expect(await validateEvidence()).toMatchObject({
			valid: true,
			conclusion: "rejected",
			backendGate: "rejected",
			failedCells: 1,
		})
	})

	test("rejects benchmark labels unsupported by required samples", () => {
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				{
					id: "invalid-benchmark",
					recordedAt: new Date(0).toISOString(),
					kind: "benchmark",
					provenance: "source",
					runtime: {
						name: "bun",
						version: "1.3.10",
						platform: "darwin",
						arch: "arm64",
						osRelease: "test",
					},
					mode: "event",
					cellIdentity: "bun-1.3.10-darwin-arm64-event",
					affectedCellIdentities: [],
					benchmarkCell: null,
					result: { fixture: { mutations: 100 }, trials: [] },
					failure: null,
				},
			],
		}
		expect(validateEvidenceDocument(evidence)).toMatchObject({ valid: false })
	})

	test("keeps event-only matrix evidence out of the polling cell", () => {
		const reports = [1_000, 5_000, 10_000].flatMap((files) =>
			(["broad", "deep"] as const).map((shape) => benchmarkReport(files, shape, false)),
		)
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [artifact({ result: { command: "benchmark-matrix", reports } })],
		}
		const validation = validateEvidenceDocument(evidence)
		const eventCell = validation.cells.find((cell) => cell.id === "bun-1.3.10-darwin-arm64-event")
		const pollingCell = validation.cells.find(
			(cell) => cell.id === "bun-1.3.10-darwin-arm64-polling",
		)
		expect(validation.valid).toBe(true)
		expect(eventCell?.missingArtifacts).not.toContain("complete-benchmark-matrix")
		expect(pollingCell?.missingArtifacts).toContain("complete-benchmark-matrix")
	})

	test("rejects shallow correctness and invalid standalone/import provenance", () => {
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact({
					id: "shallow-correctness",
					kind: "correctness",
					result: { command: "correctness", usePolling: false, scenarios: [] },
				}),
				artifact({
					id: "source-standalone",
					kind: "standalone-smoke",
					result: { runs: 3, passed: 3, failed: 0, errors: [], durationMs: 1 },
				}),
				artifact({
					id: "source-node-import",
					kind: "node-import",
					result: { imports: { chokidar: true, fuzzysort: true, ignore: true } },
				}),
			],
		}
		const validation = validateEvidenceDocument(evidence)
		expect(validation.valid).toBe(false)
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining("exact scenarios"),
				expect.stringContaining("compiled repeat proof"),
				expect.stringContaining("emitted import proof"),
			]),
		)
	})

	test("rejects malformed benchmark counts and numeric measurements", () => {
		const malformed = benchmarkReport(1_000, "broad", false) as {
			trials: Array<Record<string, unknown>>
		}
		malformed.trials[0]!.rssDeltaBytes = "unknown"
		malformed.trials[1]!.prunedFileCount = 99
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [artifact({ id: "malformed-benchmark", kind: "benchmark", result: malformed })],
		}
		expect(validateEvidenceDocument(evidence)).toMatchObject({ valid: false })
	})

	test("derives rejection from a retained emitted-Node import failure", () => {
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "rejected",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact({
					id: "node-import-failure",
					kind: "node-import",
					provenance: "emitted-node",
					runtime: {
						name: "node",
						version: "24.18.0",
						platform: "linux",
						arch: "x64",
						osRelease: "test",
					},
					mode: "imports",
					cellIdentity: "node-24.18.0-linux-x64-imports",
					affectedCellIdentities: ["node-24.18.0-linux-x64-imports"],
					failure: "ERR_MODULE_NOT_FOUND",
				}),
			],
		}
		const validation = validateEvidenceDocument(evidence)
		expect(validation).toMatchObject({
			valid: true,
			backendGate: "rejected",
			failedCells: 1,
		})
		expect(
			validation.cells.find((cell) => cell.id === "node-24.18.0-linux-x64-event-baseline")?.status,
		).toBe("incomplete")
	})

	test("does not attribute unknown command failures to an event cell", () => {
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact({
					id: "unknown-failure",
					kind: "unknown-command",
					mode: "event",
					cellIdentity: null,
					affectedCellIdentities: [],
					failure: "unknown command",
				}),
			],
		}
		expect(validateEvidenceDocument(evidence)).toMatchObject({
			valid: true,
			backendGate: "incomplete",
			failedCells: 0,
		})
	})

	test("attributes emitted Node correctness failure only to its matching mode", () => {
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "rejected",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact({
					id: "node-event-failure",
					kind: "node-baseline",
					provenance: "emitted-node",
					runtime: {
						name: "node",
						version: "24.18.0",
						platform: "linux",
						arch: "x64",
						osRelease: "test",
					},
					mode: "event",
					cellIdentity: "node-24.18.0-linux-x64-event-baseline",
					affectedCellIdentities: ["node-24.18.0-linux-x64-event-baseline"],
					failure: "correctness failed",
				}),
			],
		}
		const validation = validateEvidenceDocument(evidence)
		expect(
			validation.cells.find((cell) => cell.id === "node-24.18.0-linux-x64-event-baseline")?.status,
		).toBe("failed")
		expect(
			validation.cells.find((cell) => cell.id === "node-24.18.0-linux-x64-polling-baseline")
				?.status,
		).toBe("incomplete")
	})

	test("attributes a Bun dependency import failure to both watch modes", () => {
		const eventCell = "bun-1.3.10-darwin-arm64-event"
		const pollingCell = "bun-1.3.10-darwin-arm64-polling"
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "rejected",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact({
					id: "bun-import-failure",
					kind: "imports",
					mode: "imports",
					cellIdentity: "bun-1.3.10-darwin-arm64-imports",
					affectedCellIdentities: [eventCell, pollingCell],
					failure: "dependency import failed",
				}),
			],
		}
		const validation = validateEvidenceDocument(evidence)
		expect(validation.failedCells).toBe(2)
		expect(validation.cells.find((cell) => cell.id === eventCell)?.status).toBe("failed")
		expect(validation.cells.find((cell) => cell.id === pollingCell)?.status).toBe("failed")
	})

	test("isolated matrix coordinator records success and resumes completed cells", async () => {
		const recorded: string[] = []
		const executed: string[] = []
		const report = benchmarkReport(1_000, "broad", true)
		const summary = await runIsolatedBenchmarkMatrix([eventCell, pollingCell], false, {
			isComplete: async (cell) => !cell.usePolling,
			runChild: async (cell): Promise<MatrixChildOutcome> => {
				executed.push(benchmarkCellKey(cell))
				return {
					kind: "exit",
					exitCode: 0,
					signal: null,
					stdout: JSON.stringify(report),
					stderr: "",
				}
			},
			validateReport: (_value, cell) => cell.usePolling,
			recordSuccess: async (cell) => {
				recorded.push(benchmarkCellKey(cell))
			},
			recordFailure: async () => {
				throw new Error("unexpected failure")
			},
			progress: () => {},
		})
		expect(summary).toEqual({ completed: 1, skipped: 1, failed: 0 })
		expect(executed).toEqual([benchmarkCellKey(pollingCell)])
		expect(recorded).toEqual([benchmarkCellKey(pollingCell)])
	})

	test("isolated matrix coordinator attributes crash, nonzero, timeout, and malformed output", async () => {
		const outcomes: readonly MatrixChildOutcome[] = [
			{ kind: "exit", exitCode: -1, signal: "SIGSEGV", stdout: "", stderr: "crash" },
			{ kind: "exit", exitCode: 7, signal: null, stdout: "", stderr: "nonzero" },
			{ kind: "timeout", timeoutMs: 50, stderr: "hung" },
			{ kind: "exit", exitCode: 0, signal: null, stdout: "not-json", stderr: "" },
		]
		const cells = [eventCell, pollingCell, eventCell, pollingCell]
		const failures: Array<{ readonly key: string; readonly reason: string }> = []
		for (let index = 0; index < outcomes.length; index++) {
			const cell = cells[index]!
			const outcome = outcomes[index]!
			const summary = await runIsolatedBenchmarkMatrix([cell], true, {
				isComplete: async () => false,
				runChild: async () => outcome,
				validateReport: () => true,
				recordSuccess: async () => {
					throw new Error("unexpected success")
				},
				recordFailure: async (failedCell, reason) => {
					failures.push({ key: benchmarkCellKey(failedCell), reason })
				},
				progress: () => {},
			})
			expect(summary.failed).toBe(1)
		}
		expect(failures.map(({ key }) => key)).toEqual(cells.map(benchmarkCellKey))
		expect(failures.map(({ reason }) => reason)).toEqual([
			expect.stringContaining("SIGSEGV"),
			expect.stringContaining("exited 7"),
			expect.stringContaining("timed out after 50ms"),
			expect.stringContaining("malformed JSON"),
		])
	})

	test("aggregates complete per-cell artifacts by mode", () => {
		const eventArtifacts = [1_000, 5_000, 10_000].flatMap((files) =>
			(["broad", "deep"] as const).map((shape, index) =>
				artifact({
					id: `event-cell-${files}-${shape}-${index}`,
					kind: "benchmark-cell",
					cellIdentity: "bun-1.3.10-darwin-arm64-event",
					benchmarkCell: { files, shape, mode: "event", runs: 3, mutations: 100 },
					result: benchmarkReport(files, shape, false),
				}),
			),
		)
		const evidence: EvidenceDocument = {
			schemaVersion: 2,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: eventArtifacts,
		}
		const validation = validateEvidenceDocument(evidence)
		const event = validation.cells.find((cell) => cell.id === "bun-1.3.10-darwin-arm64-event")
		const polling = validation.cells.find((cell) => cell.id === "bun-1.3.10-darwin-arm64-polling")
		expect(validation.valid).toBe(true)
		expect(event?.missingArtifacts).not.toContain("complete-benchmark-matrix")
		expect(polling?.missingArtifacts).toContain("complete-benchmark-matrix")
	})

	evidenceTest(
		"serializes concurrent recorded Node probes without output collisions",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "house-ui-concurrent-evidence-"))
			const evidencePath = join(directory, "evidence.md")
			try {
				await writeFile(evidencePath, emptyEvidenceMarkdown)
				const exitCodes = await Promise.all([
					runNodeProbe(["imports", "--record"], evidencePath),
					runNodeProbe(["correctness", "--record"], evidencePath),
					runNodeProbe(["correctness", "--polling", "--record"], evidencePath),
				])
				expect(exitCodes).toEqual([0, 0, 0])
				const evidence = await parseEvidenceMarkdown(evidencePath)
				expect(evidence.artifacts).toHaveLength(3)
				expect(evidence.artifacts.map((entry) => `${entry.kind}:${entry.mode}`).sort()).toEqual([
					"node-baseline:event",
					"node-baseline:polling",
					"node-import:imports",
				])
				expect(validateEvidenceDocument(evidence).valid).toBe(true)
				const cacheEntries = await readdir(join(process.cwd(), "node_modules/.cache"))
				expect(cacheEntries.filter((entry) => entry.startsWith("house-ui-node-probe-"))).toEqual([])
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		},
		30_000,
	)

	evidenceTest(
		"times out a hanging Node child, records failure, and leaves no child or output",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "house-ui-timeout-evidence-"))
			const evidencePath = join(directory, "evidence.md")
			const pidPath = join(directory, "child.pid")
			try {
				await writeFile(evidencePath, emptyEvidenceMarkdown)
				const startedAt = performance.now()
				const exitCode = await runNodeProbe(
					["imports", "--hang", "--pid-file", pidPath, "--timeout-ms", "1000", "--record"],
					evidencePath,
				)
				expect(exitCode).not.toBe(0)
				expect(performance.now() - startedAt).toBeLessThan(10_000)
				const childPid = Number(await readFile(pidPath, "utf8"))
				let childAlive = true
				try {
					process.kill(childPid, 0)
				} catch {
					childAlive = false
				}
				expect(childAlive).toBe(false)
				const evidence = await parseEvidenceMarkdown(evidencePath)
				expect(evidence.artifacts).toHaveLength(1)
				expect(evidence.artifacts[0]).toMatchObject({
					kind: "node-import",
					provenance: "emitted-node",
					mode: "imports",
					result: null,
				})
				expect(evidence.artifacts[0]?.failure).toContain("timed out after 1000ms")
				const cacheEntries = await readdir(join(process.cwd(), "node_modules/.cache"))
				expect(cacheEntries.filter((entry) => entry.startsWith("house-ui-node-probe-"))).toEqual([])
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		},
		15_000,
	)
})
