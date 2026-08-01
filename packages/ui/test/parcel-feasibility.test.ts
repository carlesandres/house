import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { scanTopology } from "../dev/backend-harness.ts"
import {
	ParcelPolicyWatcher,
	defaultParcelPolicy,
	deriveParcelPhysicalRoots,
	mapParcelEventToLexicalPaths,
	runParcelCallbackErrorProof,
	runParcelCorrectness,
	runParcelHandoffBarrierProof,
	runParcelPeriodicRecoveryProof,
	runParcelReplacementBarrierProof,
} from "../dev/parcel-harness.ts"
import { recordParcelEvidence, validateParcelEvidenceDocument } from "../dev/parcel-evidence.ts"
import type { ParcelEvidenceArtifact, ParcelEvidenceDocument } from "../dev/parcel-evidence.ts"

const runStartCloseChild = async (): Promise<{
	readonly exitCode: number
	readonly stdout: string
}> => {
	const child = spawn(
		process.execPath,
		[join(process.cwd(), "dev/parcel-feasibility.ts"), "start-close-child"],
		{ cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
	)
	let stdout = ""
	let stderr = ""
	child.stdout.setEncoding("utf8")
	child.stderr.setEncoding("utf8")
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk
	})
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk
	})
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		child.kill("SIGKILL")
	}, 5_000)
	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit)
		child.once("exit", (code) => resolveExit(code ?? -1))
	}).finally(() => clearTimeout(timer))
	if (timedOut) throw new Error("process-isolated Parcel start/close timed out after 5000ms")
	if (exitCode !== 0) throw new Error(`start/close child exited ${exitCode}: ${stderr.trim()}`)
	return { exitCode, stdout: stdout.trim() }
}

const withTempDirectory = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
	const root = await mkdtemp(join(tmpdir(), "house-ui-parcel-test-"))
	try {
		return await run(root)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

const pathsIn = (watcher: ParcelPolicyWatcher): Set<string> =>
	new Set(watcher.snapshot().map((file) => file.relativePath))

const runtime = {
	name: "bun",
	version: "1.3.10",
	platform: "darwin",
	arch: "arm64",
	osRelease: "test",
} as const

const artifact = (
	kind: ParcelEvidenceArtifact["kind"],
	result: unknown,
	overrides: Partial<Pick<ParcelEvidenceArtifact, "id" | "failure">> = {},
): ParcelEvidenceArtifact => ({
	id: overrides.id ?? `${kind}-artifact`,
	recordedAt: new Date(0).toISOString(),
	kind,
	runtime,
	result,
	failure: overrides.failure ?? null,
})

const approvalDecision = (
	targetOverride: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
	command: "approval-decision",
	dependency: { parcelWatcher: "2.6.0" },
	targets: [
		["darwin-arm64", "native"],
		["darwin-x64", "rosetta"],
		["linux-arm64", "native-architecture-docker"],
		["linux-x64", "emulation"],
	].map(([target, environment], index) => ({
		target,
		environment,
		correctnessScenarios: 11,
		repeatRuns: 3,
		repeatPassed: 3,
		staticStandaloneMutationPassed: true,
		staticStandaloneCleanExitPassed: true,
		withoutSourceNodeModules: true,
		...(index === 0 ? targetOverride : {}),
	})),
	standalonePackaging: {
		computedDynamicRequireBundles: false,
		generatedPlatformStaticBinding: true,
		parcelCreateWrapper: true,
	},
	linuxConsistency: {
		consistencyIntervalMs: 60_000,
		configurable: true,
		disableable: true,
		normalEventsImmediate: true,
		authoritativePolicyAwareScanner: true,
	},
	ownerApproval: { approved: true, approvedAt: "2026-08-01" },
})

const benchmarkReport = (
	files: number,
	shape: "broad" | "deep",
	runs: number,
	mutations: number,
): unknown => ({
	command: "benchmark-cell",
	runtime,
	dependency: { parcelWatcher: "2.6.0" },
	fixture: { files, dirs: Math.max(120, files / 10), runs, mutations, shape },
	trials: Array.from({ length: runs }, (_, index) => ({
		run: index + 1,
		firstScannerMs: 1,
		mutationLatencyMs: { p50: 1, p95: 2, max: 3 },
		cpuUserMicros: 1,
		cpuSystemMicros: 1,
		rssPeakDeltaBytes: 1,
		unsubscribeMs: 1,
		noCrash: true,
		scannerMs: 1,
		subscribeMs: 1,
		totalReadinessMs: 1,
		reconciliationPasses: 3,
		physicalSubscriptionCount: 1,
		eligibleFileCount: files,
		rssDeltaBytes: 1,
	})),
	summary: {},
})

describe("Parcel watcher feasibility", () => {
	test("derives broad configured and external physical roots with lexical mapping", async () => {
		await withTempDirectory(async (container) => {
			const physical = join(container, "physical")
			const lexical = join(container, "lexical")
			const external = join(container, "external")
			await Promise.all([mkdir(physical), mkdir(external)])
			await symlink(physical, lexical, "dir")
			await symlink(external, join(physical, "external-link"), "dir")
			await writeFile(join(external, "outside.txt"), "outside")
			const scan = await scanTopology(lexical, defaultParcelPolicy({ followSymlinks: true }))
			expect(await deriveParcelPhysicalRoots(scan)).toEqual([
				await realpath(physical),
				await realpath(external),
			])
			const mapping = new Map(
				scan.watchDirectories.map((directory) => [directory.physicalPath, directory.lexicalPaths]),
			)
			expect(
				mapParcelEventToLexicalPaths(await realpath(join(external, "outside.txt")), mapping),
			).toContain(join(lexical, "external-link", "outside.txt"))
		})
	})

	test("observed nested and excluded events cannot inject nonrecursive membership", async () => {
		await withTempDirectory(async (root) => {
			await Promise.all([mkdir(join(root, "nested")), mkdir(join(root, "excluded"))])
			await writeFile(join(root, "root.txt"), "root")
			const watcher = new ParcelPolicyWatcher(root, {
				policy: defaultParcelPolicy({ recursive: false }),
			})
			await watcher.start()
			try {
				const observedBefore = watcher.observedEvents.length
				watcher.injectEvents([
					{ type: "create", path: join(root, "nested", "phantom.txt") },
					{ type: "create", path: join(root, "excluded", "phantom.txt") },
				])
				await watcher.waitForSettled()
				expect(watcher.observedEvents).toHaveLength(observedBefore + 2)
				expect([...pathsIn(watcher)]).toEqual(["root.txt"])
				expect(watcher.publications).toEqual([])
			} finally {
				await watcher.close()
			}
		})
	})

	test("forces initial and readiness-bearing replacement barriers on real directories", async () => {
		await runParcelHandoffBarrierProof()
		await runParcelReplacementBarrierProof()
	}, 30_000)

	test("recovers a simulated dropped event only through periodic authoritative reconciliation", async () => {
		const proof = await runParcelPeriodicRecoveryProof()
		expect(proof).toMatchObject({
			enabled: true,
			intervalMs: 100,
			recoveredPath: "dropped.txt",
		})
		expect(proof.recoveryMs).toBeGreaterThan(0)
	}, 10_000)

	test("surfaces callback errors and unsubscribes without late publication", async () => {
		await runParcelCallbackErrorProof()
		await withTempDirectory(async (root) => {
			const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
			await watcher.start()
			await watcher.close()
			const publications = watcher.publications.length
			const events = watcher.observedEvents.length
			await writeFile(join(root, "late.txt"), "late")
			await Bun.sleep(150)
			expect(watcher.closed).toBe(true)
			expect(watcher.publications).toHaveLength(publications)
			expect(watcher.observedEvents).toHaveLength(events)
		})
	})

	test("invokes every native unsubscribe and exits a process-isolated start/close", async () => {
		await withTempDirectory(async (root) => {
			let subscriptions = 0
			let unsubscriptions = 0
			const watcher = new ParcelPolicyWatcher(root, {
				policy: defaultParcelPolicy(),
				subscriptionSource: {
					async subscribe() {
						subscriptions++
						return {
							async unsubscribe() {
								unsubscriptions++
							},
						}
					},
				},
			})
			await watcher.start()
			await watcher.close()
			expect(subscriptions).toBe(1)
			expect(unsubscriptions).toBe(subscriptions)
		})

		const child = await runStartCloseChild()
		expect(child.exitCode).toBe(0)
		expect(JSON.parse(child.stdout)).toMatchObject({ started: true })
	}, 10_000)

	test("runs the complete source correctness suite", async () => {
		const report = await runParcelCorrectness()
		expect(report.scenarios).toHaveLength(11)
		expect(report.scenarios).toContain("scanner-only-membership-under-broad-events")
		expect(report.scenarios).toContain("lexical-root-external-target-mapping-and-cycle")
		expect(report.observedExcludedEvents).toBeGreaterThan(0)
	}, 60_000)

	test("validates compact evidence and enforces the required 10k broad sample", () => {
		const correctness = {
			command: "correctness",
			scenarios: Array.from({ length: 11 }, (_, index) => `scenario-${index}`),
		}
		const standalone = {
			command: "standalone-smoke",
			dynamic: { success: false },
			static: { success: true },
		}
		const evidence: ParcelEvidenceDocument = {
			schemaVersion: 1,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [
				artifact("correctness", correctness),
				artifact("standalone", standalone),
				artifact("benchmark", benchmarkReport(1_000, "deep", 1, 20)),
				artifact("benchmark", benchmarkReport(10_000, "broad", 3, 100)),
			],
		}
		expect(validateParcelEvidenceDocument(evidence)).toMatchObject({
			valid: true,
			conclusion: "incomplete",
			localBackendConclusion: "incomplete",
			correctnessPassed: true,
			standaloneDynamicPassed: false,
			standaloneStaticPassed: true,
			completeBenchmarkCells: 2,
			approvedTargets: 0,
			ownerApproved: false,
			linuxConsistencyIntervalMs: null,
		})

		const invalid: ParcelEvidenceDocument = {
			...evidence,
			artifacts: [artifact("benchmark", benchmarkReport(10_000, "broad", 1, 20))],
		}
		expect(validateParcelEvidenceDocument(invalid)).toMatchObject({ valid: false })
	})

	test("requires the complete matrix, Linux policy, and owner decision for approval", () => {
		const approved: ParcelEvidenceDocument = {
			schemaVersion: 1,
			conclusion: "approved",
			updatedAt: "2026-08-01T00:00:00.000Z",
			artifacts: [artifact("decision", approvalDecision())],
		}
		expect(validateParcelEvidenceDocument(approved)).toMatchObject({
			valid: true,
			conclusion: "approved",
			localBackendConclusion: "approved",
			approvedTargets: 4,
			ownerApproved: true,
			linuxConsistencyIntervalMs: 60_000,
		})

		for (const result of [
			{ ...approvalDecision(), targets: [] },
			approvalDecision({ correctnessScenarios: 10 }),
			approvalDecision({ repeatPassed: 2 }),
			approvalDecision({ staticStandaloneMutationPassed: false }),
			{
				...approvalDecision(),
				linuxConsistency: { consistencyIntervalMs: 0 },
			},
			{ ...approvalDecision(), ownerApproval: { approved: false, approvedAt: "2026-08-01" } },
		]) {
			const incomplete: ParcelEvidenceDocument = {
				...approved,
				conclusion: "incomplete",
				artifacts: [artifact("decision", result)],
			}
			expect(validateParcelEvidenceDocument(incomplete)).toMatchObject({
				valid: false,
				localBackendConclusion: "incomplete",
			})
		}
	})

	test("keeps legacy incomplete and rejected evidence representable", () => {
		const incomplete: ParcelEvidenceDocument = {
			schemaVersion: 1,
			conclusion: "incomplete",
			updatedAt: new Date(0).toISOString(),
			artifacts: [artifact("correctness", { scenarios: Array.from({ length: 11 }) })],
		}
		expect(validateParcelEvidenceDocument(incomplete)).toMatchObject({
			valid: true,
			localBackendConclusion: "incomplete",
		})

		const rejected: ParcelEvidenceDocument = {
			...incomplete,
			conclusion: "rejected",
			artifacts: [artifact("correctness", null, { failure: "crash" })],
		}
		expect(validateParcelEvidenceDocument(rejected)).toMatchObject({
			valid: true,
			localBackendConclusion: "rejected",
		})
	})

	test("atomically replaces same-cell evidence instead of accumulating raw samples", async () => {
		await withTempDirectory(async (root) => {
			const path = join(root, "evidence.md")
			await writeFile(
				path,
				`# Evidence\n\n<!-- parcel-feasibility:evidence:start -->\n\n\`\`\`json\n{"schemaVersion":1,"conclusion":"incomplete","updatedAt":"1970-01-01T00:00:00.000Z","artifacts":[]}\n\`\`\`\n\n<!-- parcel-feasibility:evidence:end -->\n`,
			)
			const previous = process.env.HOUSE_UI_PARCEL_EVIDENCE_PATH
			process.env.HOUSE_UI_PARCEL_EVIDENCE_PATH = path
			try {
				await recordParcelEvidence("benchmark", benchmarkReport(1_000, "broad", 1, 20))
				await recordParcelEvidence("benchmark", benchmarkReport(1_000, "broad", 1, 20))
				const markdown = await readFile(path, "utf8")
				const json = markdown.match(/```json\n([^\n]+)\n```/)?.[1]
				expect(json).toBeDefined()
				const evidence = JSON.parse(json!) as ParcelEvidenceDocument
				expect(evidence.artifacts).toHaveLength(1)
				expect(validateParcelEvidenceDocument(evidence).valid).toBe(true)
			} finally {
				if (previous === undefined) delete process.env.HOUSE_UI_PARCEL_EVIDENCE_PATH
				else process.env.HOUSE_UI_PARCEL_EVIDENCE_PATH = previous
			}
		})
	})
})
