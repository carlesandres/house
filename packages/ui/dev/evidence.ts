import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { release } from "node:os"
import { randomUUID } from "node:crypto"
import type { IsolatedBenchmarkCell } from "./benchmark-matrix.ts"

const START_MARKER = "<!-- backend-feasibility:evidence:start -->"
const END_MARKER = "<!-- backend-feasibility:evidence:end -->"
const LOCK_TIMEOUT_MS = 10_000
const STALE_LOCK_MS = 30_000

export type EvidenceConclusion = "approved" | "rejected" | "incomplete"
export type EvidenceCellStatus = "passed" | "failed" | "incomplete"
export type EvidenceProvenance = "source" | "compiled" | "emitted-node"

export interface EvidenceRuntime {
	readonly name: "bun" | "node"
	readonly version: string
	readonly platform: string
	readonly arch: string
	readonly osRelease: string
}

export interface BenchmarkCellEvidence {
	readonly files: number
	readonly shape: "broad" | "deep"
	readonly mode: "event" | "polling"
	readonly runs: number
	readonly mutations: number
}

export interface EvidenceArtifact {
	readonly id: string
	readonly recordedAt: string
	readonly kind: string
	readonly provenance: EvidenceProvenance
	readonly runtime: EvidenceRuntime
	readonly mode: "event" | "polling" | "imports"
	readonly cellIdentity: string | null
	readonly affectedCellIdentities: readonly string[]
	readonly benchmarkCell: BenchmarkCellEvidence | null
	readonly result: unknown | null
	readonly failure: string | null
}

export interface EvidenceDocument {
	readonly schemaVersion: 2
	readonly conclusion: EvidenceConclusion
	readonly updatedAt: string
	readonly artifacts: readonly EvidenceArtifact[]
}

export interface DerivedCell {
	readonly id: string
	readonly status: EvidenceCellStatus
	readonly missingArtifacts: readonly string[]
}

export interface EvidenceValidation {
	readonly valid: boolean
	readonly conclusion: EvidenceConclusion
	readonly backendGate: EvidenceConclusion
	readonly passedCells: number
	readonly failedCells: number
	readonly incompleteCells: number
	readonly cells: readonly DerivedCell[]
	readonly errors: readonly string[]
}

interface CellSpec {
	readonly id: string
	readonly runtime: "bun" | "node"
	readonly version: string
	readonly platform: string
	readonly arch: string
	readonly mode: "event" | "polling" | "imports"
	readonly watch: boolean
}

const cellSpecs: readonly CellSpec[] = [
	...(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const).flatMap((target) => {
		const [platform, arch] = target.split("-") as [string, string]
		return (["event", "polling"] as const).map(
			(mode): CellSpec => ({
				id: `bun-1.3.10-${target}-${mode}`,
				runtime: "bun",
				version: "1.3.10",
				platform,
				arch,
				mode,
				watch: true,
			}),
		)
	}),
	{
		id: "bun-1.3.14-linux-x64-event",
		runtime: "bun",
		version: "1.3.14",
		platform: "linux",
		arch: "x64",
		mode: "event",
		watch: true,
	},
	...(["22.22.2", "24.18.0"] as const).map(
		(version): CellSpec => ({
			id: `node-${version}-linux-x64-imports`,
			runtime: "node",
			version,
			platform: "linux",
			arch: "x64",
			mode: "imports",
			watch: false,
		}),
	),
	...(["event", "polling"] as const).map(
		(mode): CellSpec => ({
			id: `node-24.18.0-linux-x64-${mode}-baseline`,
			runtime: "node",
			version: "24.18.0",
			platform: "linux",
			arch: "x64",
			mode,
			watch: true,
		}),
	),
]

const artifactCellIdentity = (
	kind: string,
	runtime: EvidenceRuntime,
	mode: EvidenceArtifact["mode"],
): string | null => {
	const base = `${runtime.name}-${runtime.version}-${runtime.platform}-${runtime.arch}`
	if (kind === "node-import" && runtime.name === "node") return `${base}-imports`
	if (kind === "imports") return `${base}-imports`
	if (mode === "imports") return null
	if (runtime.name === "node" && (kind === "node-baseline" || kind === "node-benchmark-matrix")) {
		return `${base}-${mode}-baseline`
	}
	if (
		runtime.name === "bun" &&
		[
			"correctness",
			"repeat",
			"standalone-smoke",
			"child-exit",
			"benchmark",
			"benchmark-cell",
			"benchmark-matrix",
		].includes(kind)
	) {
		return `${base}-${mode}`
	}
	return null
}

const benchmarkCellFromResult = (kind: string, result: unknown): BenchmarkCellEvidence | null => {
	if (kind !== "benchmark-cell" || !isRecord(result) || !isRecord(result.fixture)) return null
	const fixture = result.fixture
	if (
		typeof fixture.files !== "number" ||
		(fixture.shape !== "broad" && fixture.shape !== "deep") ||
		typeof fixture.usePolling !== "boolean" ||
		typeof fixture.runs !== "number" ||
		typeof fixture.mutations !== "number"
	) {
		return null
	}
	return {
		files: fixture.files,
		shape: fixture.shape,
		mode: fixture.usePolling ? "polling" : "event",
		runs: fixture.runs,
		mutations: fixture.mutations,
	}
}

const failureCellIdentities = (
	kind: string,
	runtime: EvidenceRuntime,
	mode: EvidenceArtifact["mode"],
): readonly string[] => {
	const base = `${runtime.name}-${runtime.version}-${runtime.platform}-${runtime.arch}`
	if (kind === "imports" && runtime.name === "bun") {
		return [`${base}-event`, `${base}-polling`]
	}
	const identity = artifactCellIdentity(kind, runtime, mode)
	return identity === null ? [] : [identity]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null

const isErrorCode = (error: unknown, code: string): boolean =>
	error instanceof Error && "code" in error && error.code === code

const sleep = async (durationMs: number): Promise<void> => {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs))
}

const evidencePath = async (): Promise<string> => {
	const override = process.env.HOUSE_UI_EVIDENCE_PATH
	if (override !== undefined) return resolve(override)
	const candidates = [
		resolve(process.cwd(), "docs/file-navigator-backend-feasibility.md"),
		resolve(process.cwd(), "../../docs/file-navigator-backend-feasibility.md"),
	]
	for (const candidate of candidates) {
		try {
			await readFile(candidate, "utf8")
			return candidate
		} catch {
			continue
		}
	}
	throw new Error("could not locate docs/file-navigator-backend-feasibility.md")
}

const acquireEvidenceLock = async (path: string): Promise<() => Promise<void>> => {
	const lockPath = `${path}.lock`
	const startedAt = performance.now()
	while (performance.now() - startedAt < LOCK_TIMEOUT_MS) {
		try {
			await mkdir(lockPath)
			await writeFile(
				resolve(lockPath, "owner.json"),
				JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
			)
			return async () => {
				await rm(lockPath, { recursive: true, force: true })
			}
		} catch (error) {
			if (!isErrorCode(error, "EEXIST")) throw error
			try {
				const lockStats = await stat(lockPath)
				if (Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) {
					await rm(lockPath, { recursive: true, force: true })
					continue
				}
			} catch (statError) {
				if (!isErrorCode(statError, "ENOENT")) throw statError
			}
			await sleep(25)
		}
	}
	throw new Error(`evidence lock timed out after ${LOCK_TIMEOUT_MS}ms: ${lockPath}`)
}

const parseEvidence = (markdown: string): EvidenceDocument => {
	const start = markdown.indexOf(START_MARKER)
	const end = markdown.indexOf(END_MARKER)
	if (start < 0 || end <= start) throw new Error("evidence markers are missing or malformed")
	const generated = markdown.slice(start + START_MARKER.length, end).trim()
	const json = generated.replace(/^```json\s*/, "").replace(/\s*```$/, "")
	const parsed = JSON.parse(json) as EvidenceDocument
	return {
		...parsed,
		artifacts: parsed.artifacts.map((artifact) => ({
			...artifact,
			cellIdentity:
				artifact.cellIdentity ??
				artifactCellIdentity(artifact.kind, artifact.runtime, artifact.mode),
			affectedCellIdentities:
				artifact.affectedCellIdentities ??
				(artifact.failure === null
					? []
					: failureCellIdentities(artifact.kind, artifact.runtime, artifact.mode)),
			benchmarkCell:
				artifact.benchmarkCell ?? benchmarkCellFromResult(artifact.kind, artifact.result),
		})),
	}
}

export const readEvidence = async (): Promise<EvidenceDocument> => {
	const path = await evidencePath()
	return parseEvidence(await readFile(path, "utf8"))
}

const runtimeIdentityMatches = (artifact: EvidenceArtifact, cell: CellSpec): boolean =>
	artifact.runtime.name === cell.runtime &&
	artifact.runtime.version === cell.version &&
	artifact.runtime.platform === cell.platform &&
	artifact.runtime.arch === cell.arch

const runtimeMatches = (artifact: EvidenceArtifact, cell: CellSpec): boolean =>
	runtimeIdentityMatches(artifact, cell) &&
	(artifact.kind === "benchmark-matrix" ||
		artifact.kind === "node-benchmark-matrix" ||
		artifact.mode === cell.mode)

const finiteNumber = (value: unknown, minimum = 0): boolean =>
	typeof value === "number" && Number.isFinite(value) && value >= minimum

const requiredScenarios = [
	"policy-pruned-depth-zero-topology",
	"authoritative-ready-reconciliation",
	"deterministic-phase-interleavings",
	"readiness-bearing-replacement-phase-interleavings",
	"create-equal-size-rewrite-atomic-remove",
	"ignore-control-and-new-directory-handoff",
	"single-publication-burst-coalescing-and-async-close",
	"nonrecursive-boundary",
	"symlink-root-and-followed-external-cycle",
] as const

const expectedReplacementAdditions = [
	"new-directory/after-create.txt",
	"new-directory/after-ready.txt",
	"new-directory/before-commit.txt",
	"new-directory/before-create.txt",
	"new-directory/before-reconciliation.txt",
	"new-directory/during-convergence.txt",
	"new-directory/immediate-child.txt",
] as const

const exactStrings = (value: unknown, expected: readonly string[]): boolean =>
	Array.isArray(value) &&
	value.length === expected.length &&
	value.every((entry, index) => entry === expected[index])

const exactPublication = (value: unknown, added: readonly string[]): boolean =>
	isRecord(value) &&
	exactStrings(value.added, added) &&
	exactStrings(value.changed, []) &&
	exactStrings(value.removed, [])

const successfulRepeat = (artifact: EvidenceArtifact): boolean =>
	isRecord(artifact.result) &&
	finiteNumber(artifact.result.runs, 3) &&
	artifact.result.failed === 0 &&
	artifact.result.passed === artifact.result.runs &&
	Array.isArray(artifact.result.errors) &&
	artifact.result.errors.length === 0 &&
	finiteNumber(artifact.result.durationMs)

const successfulCorrectness = (artifact: EvidenceArtifact): boolean => {
	if (!isRecord(artifact.result) || artifact.result.command !== "correctness") return false
	if (artifact.result.usePolling !== (artifact.mode === "polling")) return false
	const scenarios = artifact.result.scenarios
	if (!finiteNumber(artifact.result.durationMs) || !Array.isArray(scenarios)) return false
	if (!requiredScenarios.every((scenario) => scenarios.includes(scenario))) return false
	const proof = artifact.result.replacementProof
	if (!isRecord(proof) || proof.usePolling !== (artifact.mode === "polling")) return false
	if (!isRecord(proof.generation)) return false
	if (
		typeof proof.generation.generationId !== "string" ||
		!/^generation-\d+$/.test(proof.generation.generationId) ||
		proof.generation.kind !== "replacement" ||
		proof.generation.committed !== true ||
		!finiteNumber(proof.generation.reconciliationPasses, 2) ||
		!Array.isArray(proof.generation.requestedPhysicalDirectories) ||
		proof.generation.requestedPhysicalDirectories.length < 2 ||
		!proof.generation.requestedPhysicalDirectories.every((path) => typeof path === "string") ||
		!Array.isArray(proof.generation.parentInvalidations) ||
		proof.generation.parentInvalidations.length !== 1 ||
		typeof proof.generation.parentInvalidations[0] !== "string"
	) {
		return false
	}
	return (
		exactStrings(proof.expectedAdditions, expectedReplacementAdditions) &&
		exactPublication(proof.logicalPublication, expectedReplacementAdditions) &&
		proof.postReadyAddition === "new-directory/post-ready.txt" &&
		exactPublication(proof.postReadyPublication, ["new-directory/post-ready.txt"])
	)
}

const successfulChildExit = (artifact: EvidenceArtifact): boolean =>
	isRecord(artifact.result) &&
	artifact.result.exitCode === 0 &&
	finiteNumber(artifact.result.durationMs)

const successfulImports = (artifact: EvidenceArtifact): boolean => {
	if (!isRecord(artifact.result) || !isRecord(artifact.result.imports)) return false
	return (
		artifact.result.imports.chokidar === true &&
		artifact.result.imports.fuzzysort === true &&
		artifact.result.imports.ignore === true
	)
}

const validLatencySummary = (value: unknown): boolean =>
	isRecord(value) &&
	finiteNumber(value.p50) &&
	finiteNumber(value.p95) &&
	finiteNumber(value.max) &&
	Number(value.p50) <= Number(value.p95) &&
	Number(value.p95) <= Number(value.max)

const validBenchmarkTrial = (
	trial: unknown,
	mutations: number,
	requireComplete: boolean,
): boolean => {
	if (!isRecord(trial) || !Array.isArray(trial.latencySamples)) return false
	if (
		trial.latencySamples.length !== mutations ||
		trial.latencySamples.length < (requireComplete ? 100 : 1)
	) {
		return false
	}
	if (
		!trial.latencySamples.every(
			(sample) =>
				isRecord(sample) &&
				(sample.kind === "add" || sample.kind === "change" || sample.kind === "unlink") &&
				typeof sample.path === "string" &&
				sample.path.length > 0 &&
				finiteNumber(sample.ms),
		)
	) {
		return false
	}
	const numericNonnegative = [
		trial.firstScanResultMs,
		trial.firstScanMs,
		trial.watcherReadyMs,
		trial.reconciliationMs,
		trial.totalReadinessMs,
		trial.cpuUserMicros,
		trial.cpuSystemMicros,
		trial.closeMs,
	]
	if (!numericNonnegative.every((value) => finiteNumber(value))) return false
	if (!finiteNumber(trial.rssDeltaBytes, Number.NEGATIVE_INFINITY)) return false
	if (
		!finiteNumber(trial.physicalFileCount, 1) ||
		!finiteNumber(trial.eligibleFileCount) ||
		!finiteNumber(trial.prunedFileCount) ||
		!finiteNumber(trial.controlFileCount, 100) ||
		!finiteNumber(trial.directoryCount, 1) ||
		!finiteNumber(trial.watchCount, 1)
	) {
		return false
	}
	if (
		Number(trial.physicalFileCount) - Number(trial.eligibleFileCount) !==
		Number(trial.prunedFileCount)
	) {
		return false
	}
	return validLatencySummary(trial.latencyMs)
}

const benchmarkReportComplete = (
	value: unknown,
	expected?: {
		readonly files: number
		readonly shape: "broad" | "deep"
		readonly mode: "event" | "polling"
	},
	requireComplete = true,
): boolean => {
	if (!isRecord(value) || !isRecord(value.fixture) || !Array.isArray(value.trials)) return false
	const mutations = Number(value.fixture.mutations)
	const runs = Number(value.fixture.runs)
	if (
		!Number.isInteger(mutations) ||
		mutations < (requireComplete ? 100 : 1) ||
		!Number.isInteger(runs) ||
		runs < (requireComplete ? 3 : 1)
	)
		return false
	if (value.trials.length !== runs || value.trials.length < (requireComplete ? 3 : 1)) return false
	if (!finiteNumber(value.fixture.files, 1) || !finiteNumber(value.fixture.dirs, 1)) return false
	if (value.fixture.shape !== "broad" && value.fixture.shape !== "deep") return false
	if (typeof value.fixture.usePolling !== "boolean") return false
	if (expected) {
		if (
			value.fixture.files !== expected.files ||
			value.fixture.shape !== expected.shape ||
			value.fixture.usePolling !== (expected.mode === "polling")
		) {
			return false
		}
	}
	return (
		value.trials.every((trial) => validBenchmarkTrial(trial, mutations, requireComplete)) &&
		validLatencySummary(value.latencyMs)
	)
}

export const validateBenchmarkCellReport = (
	report: unknown,
	cell: IsolatedBenchmarkCell,
): boolean => {
	if (
		!benchmarkReportComplete(report, {
			files: cell.files,
			shape: cell.shape,
			mode: cell.usePolling ? "polling" : "event",
		})
	) {
		return false
	}
	return (
		isRecord(report) &&
		isRecord(report.fixture) &&
		report.fixture.runs === cell.runs &&
		report.fixture.mutations === cell.mutations
	)
}

const benchmarkCellArtifactValid = (artifact: EvidenceArtifact): boolean => {
	const cell = artifact.benchmarkCell
	if (
		cell === null ||
		(cell.files !== 1_000 && cell.files !== 5_000 && cell.files !== 10_000) ||
		cell.runs !== 3 ||
		cell.mutations !== 100
	) {
		return false
	}
	return validateBenchmarkCellReport(artifact.result, {
		files: cell.files,
		shape: cell.shape,
		usePolling: cell.mode === "polling",
		runs: 3,
		mutations: 100,
	})
}

export const hasCompleteBenchmarkCell = (
	evidence: EvidenceDocument,
	runtime: EvidenceRuntime,
	cell: IsolatedBenchmarkCell,
): boolean =>
	evidence.artifacts.some(
		(artifact) =>
			artifact.kind === "benchmark-cell" &&
			artifact.provenance === "source" &&
			artifact.failure === null &&
			artifact.runtime.name === runtime.name &&
			artifact.runtime.version === runtime.version &&
			artifact.runtime.platform === runtime.platform &&
			artifact.runtime.arch === runtime.arch &&
			artifact.benchmarkCell?.files === cell.files &&
			artifact.benchmarkCell.shape === cell.shape &&
			artifact.benchmarkCell.mode === (cell.usePolling ? "polling" : "event") &&
			benchmarkCellArtifactValid(artifact),
	)

const completeBenchmarkCellArtifacts = (
	artifacts: readonly EvidenceArtifact[],
	mode: "event" | "polling",
): boolean => {
	for (const files of [1_000, 5_000, 10_000] as const) {
		for (const shape of ["broad", "deep"] as const) {
			const cell: IsolatedBenchmarkCell = {
				files,
				shape,
				usePolling: mode === "polling",
				runs: 3,
				mutations: 100,
			}
			if (
				!artifacts.some(
					(artifact) =>
						artifact.kind === "benchmark-cell" &&
						artifact.provenance === "source" &&
						artifact.failure === null &&
						validateBenchmarkCellReport(artifact.result, cell),
				)
			) {
				return false
			}
		}
	}
	return true
}

const completeBenchmarkMatrix = (
	artifact: EvidenceArtifact,
	mode: "event" | "polling",
): boolean => {
	if (!isRecord(artifact.result) || !Array.isArray(artifact.result.reports)) return false
	const reports = artifact.result.reports
	for (const files of [1_000, 5_000, 10_000]) {
		for (const shape of ["broad", "deep"] as const) {
			const report = reports.find(
				(candidate) =>
					isRecord(candidate) &&
					isRecord(candidate.fixture) &&
					candidate.fixture.files === files &&
					candidate.fixture.shape === shape &&
					candidate.fixture.usePolling === (mode === "polling"),
			)
			if (!benchmarkReportComplete(report, { files, shape, mode })) return false
		}
	}
	return true
}

const failureRelevantToCell = (artifact: EvidenceArtifact, cell: CellSpec): boolean => {
	if (artifact.failure === null || !artifact.affectedCellIdentities.includes(cell.id)) return false
	if (!cell.watch) return artifact.kind === "node-import"
	if (cell.runtime === "node") {
		return artifact.kind === "node-baseline" || artifact.kind === "node-benchmark-matrix"
	}
	return [
		"imports",
		"correctness",
		"repeat",
		"standalone-smoke",
		"child-exit",
		"benchmark",
		"benchmark-cell",
		"benchmark-matrix",
	].includes(artifact.kind)
}

const deriveCell = (cell: CellSpec, artifacts: readonly EvidenceArtifact[]): DerivedCell => {
	const matching = artifacts.filter((artifact) => runtimeMatches(artifact, cell))
	const matchingRuntime = artifacts.filter((artifact) => runtimeIdentityMatches(artifact, cell))
	if (matchingRuntime.some((artifact) => failureRelevantToCell(artifact, cell))) {
		return { id: cell.id, status: "failed", missingArtifacts: [] }
	}
	if (!cell.watch) {
		const imports = matching.some(
			(artifact) =>
				artifact.kind === "node-import" &&
				artifact.provenance === "emitted-node" &&
				successfulImports(artifact),
		)
		return {
			id: cell.id,
			status: imports ? "passed" : "incomplete",
			missingArtifacts: imports ? [] : ["emitted-node-import"],
		}
	}
	const watchMode: "event" | "polling" = cell.mode === "polling" ? "polling" : "event"
	if (cell.runtime === "node") {
		const requirements = [
			{
				name: "emitted-node-import",
				met: matchingRuntime.some(
					(artifact) =>
						artifact.kind === "node-import" &&
						artifact.provenance === "emitted-node" &&
						successfulImports(artifact),
				),
			},
			{
				name: "emitted-node-correctness",
				met: matching.some(
					(artifact) =>
						artifact.kind === "node-baseline" &&
						artifact.provenance === "emitted-node" &&
						successfulCorrectness(artifact),
				),
			},
			{
				name: "emitted-node-benchmark-matrix",
				met: matchingRuntime.some(
					(artifact) =>
						artifact.kind === "node-benchmark-matrix" &&
						artifact.provenance === "emitted-node" &&
						completeBenchmarkMatrix(artifact, watchMode),
				),
			},
		]
		const missingArtifacts = requirements
			.filter((requirement) => !requirement.met)
			.map(({ name }) => name)
		return {
			id: cell.id,
			status: missingArtifacts.length === 0 ? "passed" : "incomplete",
			missingArtifacts,
		}
	}
	const requirements = [
		{
			name: "direct-import",
			met: matchingRuntime.some(
				(artifact) =>
					((artifact.kind === "imports" && artifact.provenance === "source") ||
						(artifact.kind === "node-import" && artifact.provenance === "emitted-node")) &&
					successfulImports(artifact),
			),
		},
		{
			name: "source-correctness",
			met: matching.some(
				(artifact) =>
					artifact.kind === "correctness" &&
					artifact.provenance === "source" &&
					successfulCorrectness(artifact),
			),
		},
		{
			name: "source-repeat",
			met: matching.some(
				(artifact) =>
					artifact.kind === "repeat" &&
					artifact.provenance === "source" &&
					successfulRepeat(artifact),
			),
		},
		{
			name: "compiled-repeat",
			met: matching.some(
				(artifact) =>
					artifact.kind === "standalone-smoke" &&
					artifact.provenance === "compiled" &&
					successfulRepeat(artifact),
			),
		},
		{
			name: "compiled-child-exit",
			met: matching.some(
				(artifact) =>
					artifact.kind === "child-exit" &&
					artifact.provenance === "compiled" &&
					successfulChildExit(artifact),
			),
		},
		{
			name: "complete-benchmark-matrix",
			met:
				matchingRuntime.some(
					(artifact) =>
						artifact.kind === "benchmark-matrix" &&
						artifact.provenance === "source" &&
						completeBenchmarkMatrix(artifact, watchMode),
				) || completeBenchmarkCellArtifacts(matchingRuntime, watchMode),
		},
	]
	const missingArtifacts = requirements
		.filter((requirement) => !requirement.met)
		.map(({ name }) => name)
	return {
		id: cell.id,
		status: missingArtifacts.length === 0 ? "passed" : "incomplete",
		missingArtifacts,
	}
}

export const validateEvidenceDocument = (evidence: EvidenceDocument): EvidenceValidation => {
	const errors: string[] = []
	if (evidence.schemaVersion !== 2) errors.push("unsupported evidence schema")
	for (const artifact of evidence.artifacts) {
		if (!artifact.id || !artifact.kind || !artifact.recordedAt) errors.push("malformed artifact")
		if (artifact.cellIdentity !== null && typeof artifact.cellIdentity !== "string") {
			errors.push(`artifact ${artifact.id} has invalid cell identity`)
		}
		if (!Array.isArray(artifact.affectedCellIdentities)) {
			errors.push(`artifact ${artifact.id} has invalid affected cell identities`)
		}
		if (artifact.failure !== null) continue
		if (artifact.kind === "correctness" && !successfulCorrectness(artifact)) {
			errors.push(`correctness artifact ${artifact.id} lacks exact scenarios or replacement proof`)
		}
		if (artifact.kind === "node-baseline") {
			if (artifact.provenance !== "emitted-node" || !successfulCorrectness(artifact)) {
				errors.push(`Node baseline artifact ${artifact.id} lacks emitted correctness proof`)
			}
		}
		if (artifact.kind === "repeat" && !successfulRepeat(artifact)) {
			errors.push(`source repeat artifact ${artifact.id} is incomplete`)
		}
		if (artifact.kind === "standalone-smoke") {
			if (artifact.provenance !== "compiled" || !successfulRepeat(artifact)) {
				errors.push(`standalone artifact ${artifact.id} lacks compiled repeat proof`)
			}
		}
		if (artifact.kind === "child-exit") {
			if (artifact.provenance !== "compiled" || !successfulChildExit(artifact)) {
				errors.push(`child artifact ${artifact.id} lacks compiled timely-exit proof`)
			}
		}
		if (artifact.kind === "imports" && !successfulImports(artifact)) {
			errors.push(`source import artifact ${artifact.id} failed validation`)
		}
		if (artifact.kind === "node-import") {
			if (artifact.provenance !== "emitted-node" || !successfulImports(artifact)) {
				errors.push(`Node import artifact ${artifact.id} lacks emitted import proof`)
			}
		}
		if (artifact.kind === "benchmark" && !benchmarkReportComplete(artifact.result)) {
			errors.push(`recorded benchmark artifact ${artifact.id} lacks concrete 100-sample trials`)
		}
		if (artifact.kind === "benchmark-cell" && !benchmarkCellArtifactValid(artifact)) {
			errors.push(`benchmark cell artifact ${artifact.id} failed concrete validation`)
		}
		if (
			(artifact.kind === "benchmark-matrix" || artifact.kind === "node-benchmark-matrix") &&
			(!isRecord(artifact.result) ||
				!Array.isArray(artifact.result.reports) ||
				!artifact.result.reports.every((report) =>
					benchmarkReportComplete(report, undefined, false),
				))
		) {
			errors.push(`benchmark matrix artifact ${artifact.id} contains malformed reports`)
		}
	}
	const cells = cellSpecs.map((cell) => deriveCell(cell, evidence.artifacts))
	const passedCells = cells.filter((cell) => cell.status === "passed").length
	const failedCells = cells.filter((cell) => cell.status === "failed").length
	const incompleteCells = cells.filter((cell) => cell.status === "incomplete").length
	const derivedConclusion: EvidenceConclusion =
		failedCells > 0 ? "rejected" : incompleteCells > 0 ? "incomplete" : "approved"
	if (evidence.conclusion !== derivedConclusion) {
		errors.push(
			`declared conclusion ${evidence.conclusion} disagrees with derived ${derivedConclusion}`,
		)
	}
	return {
		valid: errors.length === 0,
		conclusion: evidence.conclusion,
		backendGate: derivedConclusion,
		passedCells,
		failedCells,
		incompleteCells,
		cells,
		errors,
	}
}

export const validateEvidence = async (): Promise<EvidenceValidation> =>
	validateEvidenceDocument(await readEvidence())

const runtimeFromResult = (result: unknown): EvidenceRuntime => {
	if (isRecord(result) && isRecord(result.runtime)) {
		const runtime = result.runtime
		if (
			(runtime.name === "bun" || runtime.name === "node") &&
			typeof runtime.version === "string" &&
			typeof runtime.platform === "string" &&
			typeof runtime.arch === "string" &&
			typeof runtime.osRelease === "string"
		) {
			return runtime as unknown as EvidenceRuntime
		}
	}
	const bunVersion = process.versions.bun
	return {
		name: bunVersion === undefined ? "node" : "bun",
		version: bunVersion ?? process.versions.node,
		platform: process.platform,
		arch: process.arch,
		osRelease: release(),
	}
}

const modeFromResult = (kind: string, result: unknown): EvidenceArtifact["mode"] => {
	if (kind === "node-import" || kind === "imports") return "imports"
	return isRecord(result) && result.usePolling === true ? "polling" : "event"
}

const sameSuccessfulBenchmarkCell = (
	existing: EvidenceArtifact,
	next: EvidenceArtifact,
): boolean => {
	if (
		existing.kind !== "benchmark-cell" ||
		existing.failure !== null ||
		existing.provenance !== next.provenance ||
		existing.runtime.name !== next.runtime.name ||
		existing.runtime.version !== next.runtime.version ||
		existing.runtime.platform !== next.runtime.platform ||
		existing.runtime.arch !== next.runtime.arch ||
		existing.benchmarkCell === null ||
		next.benchmarkCell === null
	) {
		return false
	}
	return (
		existing.benchmarkCell.files === next.benchmarkCell.files &&
		existing.benchmarkCell.shape === next.benchmarkCell.shape &&
		existing.benchmarkCell.mode === next.benchmarkCell.mode
	)
}

const appendArtifact = async (artifact: EvidenceArtifact): Promise<void> => {
	const path = await evidencePath()
	const releaseLock = await acquireEvidenceLock(path)
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
	try {
		const markdown = await readFile(path, "utf8")
		const evidence = parseEvidence(markdown)
		const retainedArtifacts =
			artifact.kind === "benchmark-cell" && artifact.benchmarkCell !== null
				? evidence.artifacts.filter((existing) => !sameSuccessfulBenchmarkCell(existing, artifact))
				: evidence.artifacts
		const artifacts = [...retainedArtifacts, artifact]
		const provisional: EvidenceDocument = {
			...evidence,
			updatedAt: artifact.recordedAt,
			artifacts,
		}
		const validation = validateEvidenceDocument(provisional)
		const next: EvidenceDocument = {
			...provisional,
			conclusion: validation.backendGate,
		}
		const start = markdown.indexOf(START_MARKER) + START_MARKER.length
		const end = markdown.indexOf(END_MARKER)
		const generated = `\n\n\`\`\`json\n${JSON.stringify(next, null, 2)}\n\`\`\`\n\n`
		await writeFile(temporaryPath, `${markdown.slice(0, start)}${generated}${markdown.slice(end)}`)
		await rename(temporaryPath, path)
	} finally {
		await rm(temporaryPath, { force: true })
		await releaseLock()
	}
}

export const recordLocalEvidence = async (
	kind: string,
	result: unknown,
	provenance: EvidenceProvenance,
): Promise<void> => {
	const recordedAt = new Date().toISOString()
	await appendArtifact({
		id: `${recordedAt}-${kind}-${provenance}`,
		recordedAt,
		kind,
		provenance,
		runtime: runtimeFromResult(result),
		mode: modeFromResult(kind, result),
		cellIdentity: artifactCellIdentity(
			kind,
			runtimeFromResult(result),
			modeFromResult(kind, result),
		),
		affectedCellIdentities: [],
		benchmarkCell: benchmarkCellFromResult(kind, result),
		result,
		failure: null,
	})
}

export const recordFailureEvidence = async (
	kind: string,
	error: unknown,
	provenance: EvidenceProvenance,
	usePolling: boolean,
	runtimeOverride?: EvidenceRuntime,
	modeOverride?: EvidenceArtifact["mode"],
	benchmarkCellOverride?: BenchmarkCellEvidence,
): Promise<void> => {
	const recordedAt = new Date().toISOString()
	const runtime = runtimeOverride ?? runtimeFromResult(null)
	const mode =
		modeOverride ??
		(usePolling ? "polling" : kind === "node-import" || kind === "imports" ? "imports" : "event")
	await appendArtifact({
		id: `${recordedAt}-${kind}-${provenance}-failure`,
		recordedAt,
		kind,
		provenance,
		runtime,
		mode,
		cellIdentity: artifactCellIdentity(kind, runtime, mode),
		affectedCellIdentities: failureCellIdentities(kind, runtime, mode),
		benchmarkCell: benchmarkCellOverride ?? null,
		result: null,
		failure: error instanceof Error ? (error.stack ?? error.message) : String(error),
	})
}
