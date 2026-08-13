import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import type { ParcelBenchmarkReport } from "./parcel-harness.ts"
import { runtimeIdentity } from "./parcel-harness.ts"

const START_MARKER = "<!-- parcel-feasibility:evidence:start -->"
const END_MARKER = "<!-- parcel-feasibility:evidence:end -->"
const FORMAT_IGNORE_MARKER = "<!-- prettier-ignore -->"
const LOCK_TIMEOUT_MS = 10_000

export type ParcelEvidenceConclusion = "approved" | "rejected" | "incomplete"

export interface ParcelEvidenceArtifact {
	readonly id: string
	readonly recordedAt: string
	readonly kind: "correctness" | "repeat" | "standalone" | "benchmark" | "decision"
	readonly runtime: {
		readonly name: string
		readonly version: string
		readonly platform: string
		readonly arch: string
		readonly osRelease: string
	}
	readonly result: unknown | null
	readonly failure: string | null
}

export interface ParcelEvidenceDocument {
	readonly schemaVersion: 1
	readonly conclusion: ParcelEvidenceConclusion
	readonly updatedAt: string
	readonly artifacts: readonly ParcelEvidenceArtifact[]
}

export interface ParcelEvidenceValidation {
	readonly valid: boolean
	readonly conclusion: ParcelEvidenceConclusion
	readonly localBackendConclusion: ParcelEvidenceConclusion
	readonly correctnessPassed: boolean
	readonly standaloneDynamicPassed: boolean
	readonly standaloneStaticPassed: boolean
	readonly completeBenchmarkCells: number
	readonly approvedTargets: number
	readonly ownerApproved: boolean
	readonly linuxConsistencyIntervalMs: number | null
	readonly errors: readonly string[]
}

const APPROVED_TARGETS = {
	"darwin-arm64": "native",
	"darwin-x64": "rosetta",
	"linux-arm64": "native-architecture-docker",
	"linux-x64": "emulation",
} as const

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value)

const errorMessage = (error: unknown): string =>
	error instanceof Error ? (error.stack ?? error.message) : String(error)

const sleep = async (durationMs: number): Promise<void> => {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs))
}

const evidencePath = async (): Promise<string> => {
	const override = process.env.HOUSE_UI_PARCEL_EVIDENCE_PATH
	if (override !== undefined) return resolve(override)
	for (const candidate of [
		resolve(process.cwd(), "docs/file-navigator-parcel-feasibility.md"),
		resolve(process.cwd(), "../../docs/file-navigator-parcel-feasibility.md"),
	]) {
		try {
			await readFile(candidate, "utf8")
			return candidate
		} catch {
			continue
		}
	}
	throw new Error("could not locate docs/file-navigator-parcel-feasibility.md")
}

const parseEvidence = (markdown: string): ParcelEvidenceDocument => {
	const start = markdown.indexOf(START_MARKER)
	const end = markdown.indexOf(END_MARKER)
	if (start < 0 || end <= start) throw new Error("Parcel evidence markers are missing or malformed")
	const block = markdown.slice(start + START_MARKER.length, end).trim()
	const json = block
		.replace(/^<!-- prettier-ignore -->\s*/, "")
		.replace(/^```json\s*/, "")
		.replace(/\s*```$/, "")
	return JSON.parse(json) as ParcelEvidenceDocument
}

const renderEvidence = (markdown: string, evidence: ParcelEvidenceDocument): string => {
	const start = markdown.indexOf(START_MARKER)
	const end = markdown.indexOf(END_MARKER)
	if (start < 0 || end <= start) throw new Error("Parcel evidence markers are missing or malformed")
	const generated = `${START_MARKER}\n\n${FORMAT_IGNORE_MARKER}\n\`\`\`json\n${JSON.stringify(evidence)}\n\`\`\`\n\n`
	return `${markdown.slice(0, start)}${generated}${markdown.slice(end)}`
}

const acquireLock = async (path: string): Promise<() => Promise<void>> => {
	const lockPath = `${path}.lock`
	const startedAt = performance.now()
	while (performance.now() - startedAt < LOCK_TIMEOUT_MS) {
		try {
			await mkdir(lockPath)
			return async () => rm(lockPath, { recursive: true, force: true })
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
			try {
				const lock = await stat(lockPath)
				if (Date.now() - lock.mtimeMs > LOCK_TIMEOUT_MS * 3) {
					await rm(lockPath, { recursive: true, force: true })
					continue
				}
			} catch {
				continue
			}
			await sleep(25)
		}
	}
	throw new Error(`Parcel evidence lock timed out: ${lockPath}`)
}

const benchmarkKey = (result: unknown): string => {
	if (!isRecord(result) || !isRecord(result.fixture)) return "malformed"
	return `${String(result.fixture.files)}-${String(result.fixture.shape)}`
}

const artifactKey = (artifact: ParcelEvidenceArtifact): string => {
	const runtime = `${artifact.runtime.name}-${artifact.runtime.version}-${artifact.runtime.platform}-${artifact.runtime.arch}`
	return `${runtime}:${artifact.kind}:${artifact.kind === "benchmark" ? benchmarkKey(artifact.result) : "latest"}`
}

interface ApprovalDecisionValidation {
	readonly passed: boolean
	readonly approvedTargets: number
	readonly ownerApproved: boolean
	readonly linuxConsistencyIntervalMs: number | null
}

const validateApprovalDecision = (
	result: unknown,
	errors?: string[],
): ApprovalDecisionValidation => {
	const fail = (message: string): ApprovalDecisionValidation => {
		errors?.push(message)
		return {
			passed: false,
			approvedTargets: 0,
			ownerApproved: false,
			linuxConsistencyIntervalMs: null,
		}
	}
	if (
		!isRecord(result) ||
		result.command !== "approval-decision" ||
		!isRecord(result.dependency) ||
		result.dependency.parcelWatcher !== "2.6.0" ||
		!Array.isArray(result.targets)
	) {
		return fail("approval decision header is malformed")
	}
	const targets = new Map<string, Readonly<Record<string, unknown>>>()
	for (const target of result.targets) {
		if (!isRecord(target) || typeof target.target !== "string" || targets.has(target.target)) {
			return fail("approval decision targets are malformed or duplicated")
		}
		targets.set(target.target, target)
	}
	if (targets.size !== Object.keys(APPROVED_TARGETS).length) {
		return fail("approval decision must contain exactly four supported targets")
	}
	for (const [name, environment] of Object.entries(APPROVED_TARGETS)) {
		const target = targets.get(name)
		if (
			target === undefined ||
			target.environment !== environment ||
			target.correctnessScenarios !== 11 ||
			target.repeatRuns !== 3 ||
			target.repeatPassed !== 3 ||
			target.staticStandaloneMutationPassed !== true ||
			target.staticStandaloneCleanExitPassed !== true ||
			target.withoutSourceNodeModules !== true
		) {
			return fail(`approval decision target ${name} did not pass every required gate`)
		}
	}
	if (
		!isRecord(result.standalonePackaging) ||
		result.standalonePackaging.computedDynamicRequireBundles !== false ||
		result.standalonePackaging.generatedPlatformStaticBinding !== true ||
		result.standalonePackaging.parcelCreateWrapper !== true
	) {
		return fail("approval decision does not enforce generated static standalone binding")
	}
	const linuxConsistency = result.linuxConsistency
	const linuxConsistencyIntervalMs =
		isRecord(linuxConsistency) && isFiniteNumber(linuxConsistency.consistencyIntervalMs)
			? linuxConsistency.consistencyIntervalMs
			: null
	if (
		linuxConsistencyIntervalMs !== 60_000 ||
		!isRecord(linuxConsistency) ||
		linuxConsistency.configurable !== true ||
		linuxConsistency.disableable !== true ||
		linuxConsistency.normalEventsImmediate !== true ||
		linuxConsistency.authoritativePolicyAwareScanner !== true
	) {
		return fail("approval decision does not encode the approved Linux consistency policy")
	}
	const ownerApproved =
		isRecord(result.ownerApproval) &&
		result.ownerApproval.approved === true &&
		result.ownerApproval.approvedAt === "2026-08-01"
	if (!ownerApproved) return fail("approval decision lacks the owner's dated approval")
	return {
		passed: true,
		approvedTargets: targets.size,
		ownerApproved,
		linuxConsistencyIntervalMs,
	}
}

const deriveConclusion = (
	artifacts: readonly ParcelEvidenceArtifact[],
): ParcelEvidenceConclusion => {
	if (artifacts.some((artifact) => artifact.failure !== null)) return "rejected"
	const standalone = artifacts.find((artifact) => artifact.kind === "standalone")?.result
	if (isRecord(standalone)) {
		const dynamicSucceeded = isRecord(standalone.dynamic) && standalone.dynamic.success === true
		const staticSucceeded = isRecord(standalone.static) && standalone.static.success === true
		if (!dynamicSucceeded && !staticSucceeded) return "rejected"
	}
	const decision = artifacts.find(
		(artifact) => artifact.kind === "decision" && artifact.failure === null,
	)
	if (decision && validateApprovalDecision(decision.result).passed) return "approved"
	// Host-local and legacy evidence remain valid but cannot approve the four-target release matrix.
	return "incomplete"
}

export const readParcelEvidence = async (): Promise<ParcelEvidenceDocument> =>
	parseEvidence(await readFile(await evidencePath(), "utf8"))

export const recordParcelEvidence = async (
	kind: ParcelEvidenceArtifact["kind"],
	result: unknown | null,
	failure: unknown | null = null,
): Promise<void> => {
	const path = await evidencePath()
	const release = await acquireLock(path)
	try {
		const markdown = await readFile(path, "utf8")
		const current = parseEvidence(markdown)
		const runtime = runtimeIdentity()
		const artifact: ParcelEvidenceArtifact = {
			id: randomUUID(),
			recordedAt: new Date().toISOString(),
			kind,
			runtime,
			result,
			failure: failure === null ? null : errorMessage(failure),
		}
		const key = artifactKey(artifact)
		const artifacts = [...current.artifacts.filter((entry) => artifactKey(entry) !== key), artifact]
		const evidence: ParcelEvidenceDocument = {
			schemaVersion: 1,
			conclusion: deriveConclusion(artifacts),
			updatedAt: new Date().toISOString(),
			artifacts,
		}
		const temporary = resolve(dirname(path), `.${randomUUID()}.parcel-evidence.tmp`)
		await writeFile(temporary, renderEvidence(markdown, evidence))
		await rename(temporary, path)
	} finally {
		await release()
	}
}

const validateBenchmark = (result: unknown, errors: string[]): result is ParcelBenchmarkReport => {
	if (!isRecord(result) || result.command !== "benchmark-cell" || !isRecord(result.fixture)) {
		errors.push("benchmark artifact is not a benchmark-cell report")
		return false
	}
	const fixture = result.fixture
	if (
		!isFiniteNumber(fixture.files) ||
		!isFiniteNumber(fixture.runs) ||
		!isFiniteNumber(fixture.mutations) ||
		(fixture.shape !== "broad" && fixture.shape !== "deep")
	) {
		errors.push("benchmark fixture is malformed")
		return false
	}
	if (!Array.isArray(result.trials) || result.trials.length !== fixture.runs) {
		errors.push(`benchmark ${fixture.files}/${fixture.shape} has the wrong trial count`)
		return false
	}
	for (const trial of result.trials) {
		if (
			!isRecord(trial) ||
			trial.noCrash !== true ||
			!isFiniteNumber(trial.scannerMs) ||
			!isFiniteNumber(trial.subscribeMs) ||
			!isFiniteNumber(trial.totalReadinessMs) ||
			!isFiniteNumber(trial.rssPeakDeltaBytes) ||
			!isFiniteNumber(trial.cpuUserMicros) ||
			!isFiniteNumber(trial.cpuSystemMicros) ||
			!isFiniteNumber(trial.unsubscribeMs) ||
			!isFiniteNumber(trial.physicalSubscriptionCount)
		) {
			errors.push(`benchmark ${fixture.files}/${fixture.shape} has malformed trial measurements`)
			return false
		}
	}
	if (fixture.files === 10_000 && fixture.shape === "broad") {
		if (fixture.runs < 3 || fixture.mutations < 100) {
			errors.push("10k broad benchmark requires at least 3 trials and 100 mutations")
			return false
		}
	} else if (fixture.runs < 1 || fixture.mutations < 20) {
		errors.push("exploratory benchmark requires at least 1 trial and 20 mutations")
		return false
	}
	return true
}

export const validateParcelEvidenceDocument = (
	evidence: ParcelEvidenceDocument,
): ParcelEvidenceValidation => {
	const errors: string[] = []
	if (evidence.schemaVersion !== 1) errors.push("unsupported Parcel evidence schema")
	const successful = evidence.artifacts.filter((artifact) => artifact.failure === null)
	const correctnessPassed = successful.some(
		(artifact) =>
			artifact.kind === "correctness" &&
			isRecord(artifact.result) &&
			Array.isArray(artifact.result.scenarios) &&
			artifact.result.scenarios.length === 11,
	)
	const standalone = successful.find((artifact) => artifact.kind === "standalone")?.result
	const standaloneDynamicPassed =
		isRecord(standalone) && isRecord(standalone.dynamic) && standalone.dynamic.success === true
	const standaloneStaticPassed =
		isRecord(standalone) && isRecord(standalone.static) && standalone.static.success === true
	let completeBenchmarkCells = 0
	for (const artifact of successful.filter((entry) => entry.kind === "benchmark")) {
		if (validateBenchmark(artifact.result, errors)) completeBenchmarkCells++
	}
	const decisionArtifact = successful.find((artifact) => artifact.kind === "decision")
	const decision = decisionArtifact
		? validateApprovalDecision(decisionArtifact.result, errors)
		: {
				passed: false,
				approvedTargets: 0,
				ownerApproved: false,
				linuxConsistencyIntervalMs: null,
			}
	const derived = deriveConclusion(evidence.artifacts)
	if (evidence.conclusion !== derived) {
		errors.push(`recorded conclusion ${evidence.conclusion} does not match derived ${derived}`)
	}
	return {
		valid: errors.length === 0,
		conclusion: evidence.conclusion,
		localBackendConclusion: derived,
		correctnessPassed,
		standaloneDynamicPassed,
		standaloneStaticPassed,
		completeBenchmarkCells,
		approvedTargets: decision.approvedTargets,
		ownerApproved: decision.ownerApproved,
		linuxConsistencyIntervalMs: decision.linuxConsistencyIntervalMs,
		errors,
	}
}

export const validateParcelEvidence = async (): Promise<ParcelEvidenceValidation> =>
	validateParcelEvidenceDocument(await readParcelEvidence())
