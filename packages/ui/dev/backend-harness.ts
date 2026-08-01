import { dirname, join, relative, resolve, sep } from "node:path"
import { release, tmpdir } from "node:os"
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises"
import { watch, type FSWatcher } from "chokidar"
import fuzzysort from "fuzzysort"
import ignore, { type Ignore } from "ignore"
import { runDependencyImportProbe } from "./dependency-import-probe.ts"

const DEPENDENCY_VERSIONS = {
	chokidar: "5.0.0",
	fuzzysort: "3.1.0",
	ignore: "7.0.5",
} as const
const DEFAULT_TIMEOUT_MS = 5_000
const RECONCILE_DELAY_MS = 35

export interface ScanPolicy {
	readonly recursive: boolean
	readonly followSymlinks: boolean
	readonly ignoreFiles: readonly string[]
	readonly excludedDirectoryNames: ReadonlySet<string>
}

export interface FileRecord {
	readonly absolutePath: string
	readonly relativePath: string
	readonly size: number
	readonly mtimeMs: number
}

export interface WatchDirectory {
	readonly physicalPath: string
	readonly lexicalPaths: readonly string[]
}

export interface ScanResult {
	readonly root: string
	readonly files: readonly FileRecord[]
	readonly watchDirectories: readonly WatchDirectory[]
	readonly controlFiles: readonly string[]
}

export interface Publication {
	readonly added: readonly string[]
	readonly changed: readonly string[]
	readonly removed: readonly string[]
}

export interface ObservedEvent {
	readonly event: string
	readonly physicalPath: string
	readonly lexicalPaths: readonly string[]
	readonly generationId: string
}

export interface GenerationProof {
	readonly generationId: string
	readonly kind: "initial" | "replacement"
	readonly requestedPhysicalDirectories: readonly string[]
	readonly parentInvalidations: readonly string[]
	readonly reconciliationPasses: number
	readonly committed: boolean
}

export interface ReplacementProof {
	readonly usePolling: boolean
	readonly generation: GenerationProof
	readonly expectedAdditions: readonly string[]
	readonly logicalPublication: Publication
	readonly postReadyAddition: string
	readonly postReadyPublication: Publication
}

export interface StartMetrics {
	readonly firstScanMs: number
	readonly watcherReadyMs: number
	readonly reconciliationMs: number
	readonly totalReadinessMs: number
	readonly directoryCount: number
	readonly watchCount: number
	readonly rssDeltaBytes: number
}

export interface CorrectnessReport {
	readonly command: "correctness"
	readonly runtime: RuntimeIdentity
	readonly dependencies: typeof DEPENDENCY_VERSIONS
	readonly usePolling: boolean
	readonly durationMs: number
	readonly scenarios: readonly string[]
	readonly replacementProof: ReplacementProof
}

export interface RepeatReport {
	readonly command: "repeat"
	readonly runtime: RuntimeIdentity
	readonly usePolling: boolean
	readonly runs: number
	readonly passed: number
	readonly failed: number
	readonly durationMs: number
	readonly errors: readonly string[]
}

export interface BenchmarkOptions {
	readonly files: number
	readonly dirs: number
	readonly runs: number
	readonly mutations: number
	readonly usePolling: boolean
	readonly shape: "broad" | "deep"
}

export interface MutationLatencySample {
	readonly kind: "add" | "change" | "unlink"
	readonly path: string
	readonly ms: number
}

export interface BenchmarkTrial extends StartMetrics {
	readonly run: number
	readonly firstScanResultMs: number
	readonly latencySamples: readonly MutationLatencySample[]
	readonly latencyMs: { readonly p50: number; readonly p95: number; readonly max: number }
	readonly physicalFileCount: number
	readonly eligibleFileCount: number
	readonly prunedFileCount: number
	readonly controlFileCount: number
	readonly cpuUserMicros: number
	readonly cpuSystemMicros: number
	readonly closeMs: number
}

export interface BenchmarkReport {
	readonly command: "benchmark"
	readonly runtime: RuntimeIdentity
	readonly dependencies: typeof DEPENDENCY_VERSIONS
	readonly fixture: BenchmarkOptions
	readonly trials: readonly BenchmarkTrial[]
	readonly latencyMs: {
		readonly p50: number
		readonly p95: number
		readonly max: number
	}
}

export interface BenchmarkMatrixReport {
	readonly command: "benchmark-matrix"
	readonly runtime: RuntimeIdentity
	readonly reports: readonly BenchmarkReport[]
}

export interface BenchmarkMatrixSelection {
	readonly files: readonly number[]
	readonly shapes: readonly ("broad" | "deep")[]
	readonly modes: readonly boolean[]
	readonly runs: number
	readonly mutations: number
	readonly dirs: number
}

export interface RuntimeIdentity {
	readonly name: "bun" | "node"
	readonly version: string
	readonly platform: NodeJS.Platform
	readonly arch: string
	readonly osRelease: string
}

export type ScanPhase =
	| "initial"
	| "initial-reconciliation"
	| "initial-convergence"
	| "invalidation"
	| "replacement-reconciliation"
	| "replacement-convergence"

export interface ScanPhaseContext {
	readonly phase: ScanPhase
	readonly lexicalDirectory: string
	readonly stage: "before-read" | "after-read"
}

export interface PhaseHooks {
	readonly onScanDirectory?: (context: ScanPhaseContext) => Promise<void>
	readonly afterInitialScan?: (scan: ScanResult) => Promise<void>
	readonly afterWatcherReady?: (scan: ScanResult) => Promise<void>
	readonly onGenerationPhase?: (
		phase: GenerationPhase,
		context: GenerationPhaseContext,
	) => Promise<void>
}

export type GenerationPhase =
	| "before-create"
	| "after-create"
	| "after-ready"
	| "before-reconciliation"
	| "before-commit"

export interface GenerationPhaseContext {
	readonly generationId: string
	readonly kind: "initial" | "replacement"
	readonly requestedPhysicalDirectories: readonly string[]
}

interface ScanOptions {
	readonly phase?: ScanPhase
	readonly hooks?: PhaseHooks
}

interface IgnoreLevel {
	readonly lexicalDirectory: string
	readonly matcher: Ignore
}

interface MutableTopology {
	readonly files: Map<string, FileRecord>
	readonly watchDirectories: Map<string, Set<string>>
	readonly controlFiles: Set<string>
}

interface WatcherOptions {
	readonly policy: ScanPolicy
	readonly usePolling?: boolean
	readonly reconcileDelayMs?: number
	readonly hooks?: PhaseHooks
}

interface CollectionDiff {
	readonly publication: Publication
	readonly changed: boolean
}

const defaultPolicy = (overrides: Partial<ScanPolicy> = {}): ScanPolicy => ({
	recursive: true,
	followSymlinks: false,
	ignoreFiles: [".gitignore"],
	excludedDirectoryNames: new Set<string>(),
	...overrides,
})

const normalizeRelativePath = (path: string): string => path.split(sep).join("/")

const compareStrings = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0

const sorted = (values: Iterable<string>): string[] => [...values].sort(compareStrings)

const sleep = async (durationMs: number): Promise<void> => {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs))
}

const elapsedMs = (startedAt: number): number => performance.now() - startedAt

const withTimeout = async <T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | null = null
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, rejectPromise) => {
				timer = setTimeout(
					() => rejectPromise(new Error(`${label} timed out after ${timeoutMs}ms`)),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

const isMissing = (error: unknown): boolean =>
	error instanceof Error && "code" in error && error.code === "ENOENT"

const assertCondition: (condition: boolean, message: string) => asserts condition = (
	condition,
	message,
) => {
	if (!condition) throw new Error(message)
}

const isIgnored = (
	lexicalPath: string,
	isDirectory: boolean,
	levels: readonly IgnoreLevel[],
): boolean => {
	let ignored = false
	for (const level of levels) {
		const candidate = normalizeRelativePath(relative(level.lexicalDirectory, lexicalPath))
		if (candidate.length === 0 || candidate === ".." || candidate.startsWith("../")) continue
		const result = level.matcher.test(isDirectory ? `${candidate}/` : candidate)
		if (result.ignored) ignored = true
		if (result.unignored) ignored = false
	}
	return ignored
}

const loadIgnoreLevels = async (
	physicalDirectory: string,
	lexicalDirectory: string,
	policy: ScanPolicy,
	parentLevels: readonly IgnoreLevel[],
	topology: MutableTopology,
): Promise<readonly IgnoreLevel[]> => {
	let levels = parentLevels
	for (const filename of policy.ignoreFiles) {
		const physicalPath = join(physicalDirectory, filename)
		try {
			const rules = await readFile(physicalPath, "utf8")
			const lexicalPath = join(lexicalDirectory, filename)
			topology.controlFiles.add(lexicalPath)
			levels = [...levels, { lexicalDirectory, matcher: ignore().add(rules) }]
		} catch (error) {
			if (!isMissing(error)) throw error
		}
	}
	return levels
}

const addWatchDirectory = (
	topology: MutableTopology,
	physicalPath: string,
	lexicalPath: string,
): void => {
	const lexicalPaths = topology.watchDirectories.get(physicalPath) ?? new Set<string>()
	lexicalPaths.add(lexicalPath)
	topology.watchDirectories.set(physicalPath, lexicalPaths)
}

const scanDirectory = async (
	physicalDirectory: string,
	lexicalDirectory: string,
	root: string,
	policy: ScanPolicy,
	parentLevels: readonly IgnoreLevel[],
	physicalAncestry: ReadonlySet<string>,
	topology: MutableTopology,
	options: ScanOptions,
): Promise<void> => {
	addWatchDirectory(topology, physicalDirectory, lexicalDirectory)
	const levels = await loadIgnoreLevels(
		physicalDirectory,
		lexicalDirectory,
		policy,
		parentLevels,
		topology,
	)
	await options.hooks?.onScanDirectory?.({
		phase: options.phase ?? "invalidation",
		lexicalDirectory,
		stage: "before-read",
	})
	const entries = (await readdir(physicalDirectory, { withFileTypes: true })).sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	)
	await options.hooks?.onScanDirectory?.({
		phase: options.phase ?? "invalidation",
		lexicalDirectory,
		stage: "after-read",
	})

	for (const entry of entries) {
		if (policy.ignoreFiles.includes(entry.name)) continue
		const physicalPath = join(physicalDirectory, entry.name)
		const lexicalPath = join(lexicalDirectory, entry.name)

		if (entry.isSymbolicLink()) {
			if (!policy.followSymlinks || !policy.recursive) continue
			let target: string
			try {
				target = await realpath(physicalPath)
				const targetStats = await stat(target)
				if (targetStats.isDirectory()) {
					if (
						policy.excludedDirectoryNames.has(entry.name) ||
						isIgnored(lexicalPath, true, levels) ||
						physicalAncestry.has(target)
					) {
						continue
					}
					await scanDirectory(
						target,
						lexicalPath,
						root,
						policy,
						levels,
						new Set([...physicalAncestry, target]),
						topology,
						options,
					)
					continue
				}
				if (!targetStats.isFile() || isIgnored(lexicalPath, false, levels)) continue
				topology.files.set(normalizeRelativePath(relative(root, lexicalPath)), {
					absolutePath: lexicalPath,
					relativePath: normalizeRelativePath(relative(root, lexicalPath)),
					size: targetStats.size,
					mtimeMs: targetStats.mtimeMs,
				})
			} catch (error) {
				if (!isMissing(error)) throw error
			}
			continue
		}

		if (entry.isDirectory()) {
			if (
				!policy.recursive ||
				policy.excludedDirectoryNames.has(entry.name) ||
				isIgnored(lexicalPath, true, levels)
			) {
				continue
			}
			try {
				const target = await realpath(physicalPath)
				if (physicalAncestry.has(target)) continue
				await scanDirectory(
					target,
					lexicalPath,
					root,
					policy,
					levels,
					new Set([...physicalAncestry, target]),
					topology,
					options,
				)
			} catch (error) {
				if (!isMissing(error)) throw error
			}
			continue
		}

		if (!entry.isFile() || isIgnored(lexicalPath, false, levels)) continue
		try {
			const fileStats = await stat(physicalPath)
			const relativePath = normalizeRelativePath(relative(root, lexicalPath))
			topology.files.set(relativePath, {
				absolutePath: lexicalPath,
				relativePath,
				size: fileStats.size,
				mtimeMs: fileStats.mtimeMs,
			})
		} catch (error) {
			if (!isMissing(error)) throw error
		}
	}
}

/**
 * Spike-only topology scanner. It intentionally proves the policy/watch handoff rather than serving
 * as the production scanner planned for File Navigator.
 */
export const scanTopology = async (
	rootInput: string,
	policy: ScanPolicy,
	options: ScanOptions = {},
): Promise<ScanResult> => {
	const root = resolve(rootInput)
	const physicalRoot = await realpath(root)
	const rootStats = await stat(physicalRoot)
	if (!rootStats.isDirectory()) throw new Error(`root is not a directory: ${root}`)
	const topology: MutableTopology = {
		files: new Map<string, FileRecord>(),
		watchDirectories: new Map<string, Set<string>>(),
		controlFiles: new Set<string>(),
	}
	await scanDirectory(
		physicalRoot,
		root,
		root,
		policy,
		[],
		new Set([physicalRoot]),
		topology,
		options,
	)
	return {
		root,
		files: [...topology.files.values()].sort((left, right) =>
			compareStrings(left.relativePath, right.relativePath),
		),
		watchDirectories: [...topology.watchDirectories.entries()]
			.map(
				([physicalPath, lexicalPaths]): WatchDirectory => ({
					physicalPath,
					lexicalPaths: sorted(lexicalPaths),
				}),
			)
			.sort((left, right) => compareStrings(left.physicalPath, right.physicalPath)),
		controlFiles: sorted(topology.controlFiles),
	}
}

const recordsByPath = (files: readonly FileRecord[]): Map<string, FileRecord> =>
	new Map(files.map((file): readonly [string, FileRecord] => [file.relativePath, file]))

const diffCollections = (
	previous: ReadonlyMap<string, FileRecord>,
	next: ReadonlyMap<string, FileRecord>,
): CollectionDiff => {
	const added: string[] = []
	const changed: string[] = []
	const removed: string[] = []
	for (const [path, record] of next) {
		const prior = previous.get(path)
		if (!prior) added.push(path)
		else if (prior.size !== record.size || prior.mtimeMs !== record.mtimeMs) changed.push(path)
	}
	for (const path of previous.keys()) {
		if (!next.has(path)) removed.push(path)
	}
	return {
		publication: { added: sorted(added), changed: sorted(changed), removed: sorted(removed) },
		changed: added.length > 0 || changed.length > 0 || removed.length > 0,
	}
}

interface WatchGeneration {
	readonly watcher: FSWatcher
	readonly mapping: ReadonlyMap<string, readonly string[]>
	readonly physicalPaths: ReadonlySet<string>
	readonly signature: string
	readonly id: string
	readonly kind: "initial" | "replacement"
	readonly proof: MutableGenerationProof
}

interface MutableGenerationProof {
	readonly generationId: string
	readonly kind: "initial" | "replacement"
	readonly requestedPhysicalDirectories: readonly string[]
	readonly parentInvalidations: string[]
	reconciliationPasses: number
	committed: boolean
}

const topologyMapping = (scan: ScanResult): Map<string, readonly string[]> =>
	new Map(
		scan.watchDirectories.map((directory): readonly [string, readonly string[]] => [
			directory.physicalPath,
			directory.lexicalPaths,
		]),
	)

const topologySignature = (scan: ScanResult): string =>
	JSON.stringify(
		scan.watchDirectories.map((directory) => [directory.physicalPath, directory.lexicalPaths]),
	)

const generationContext = (generation: WatchGeneration): GenerationPhaseContext => ({
	generationId: generation.id,
	kind: generation.kind,
	requestedPhysicalDirectories: sorted(generation.physicalPaths),
})

export class PolicyTopologyWatcher {
	readonly root: string
	readonly policy: ScanPolicy
	readonly usePolling: boolean
	readonly requestedAdds: string[] = []
	readonly requestedRemoves: string[] = []
	readonly observedEvents: ObservedEvent[] = []
	readonly publications: Publication[] = []
	readonly generationProofs: MutableGenerationProof[] = []

	#activeGeneration: WatchGeneration | null = null
	readonly #allWatchers = new Set<FSWatcher>()
	#collection = new Map<string, FileRecord>()
	#reconcileTimer: ReturnType<typeof setTimeout> | null = null
	#reconcilePromise: Promise<void> | null = null
	#reconcileAgain = false
	#closed = false
	#invalidationVersion = 0
	#fatalError: Error | null = null
	readonly #reconcileDelayMs: number
	readonly #hooks: PhaseHooks
	#generationSequence = 0

	constructor(root: string, options: WatcherOptions) {
		this.root = resolve(root)
		this.policy = options.policy
		this.usePolling = options.usePolling ?? false
		this.#reconcileDelayMs = options.reconcileDelayMs ?? RECONCILE_DELAY_MS
		this.#hooks = options.hooks ?? {}
	}

	get closed(): boolean {
		return this.#closed
	}

	get watchCount(): number {
		return this.#activeGeneration?.physicalPaths.size ?? 0
	}

	snapshot(): readonly FileRecord[] {
		return [...this.#collection.values()].sort((left, right) =>
			compareStrings(left.relativePath, right.relativePath),
		)
	}

	async start(): Promise<StartMetrics> {
		if (this.#activeGeneration || this.#closed) throw new Error("watcher cannot be started")
		const totalStartedAt = performance.now()
		try {
			const rssBefore = process.memoryUsage.rss()
			const firstScanStartedAt = performance.now()
			const initial = await scanTopology(this.root, this.policy, {
				phase: "initial",
				hooks: this.#hooks,
			})
			const firstScanMs = elapsedMs(firstScanStartedAt)
			const baseline = recordsByPath(initial.files)
			await this.#hooks.afterInitialScan?.(initial)
			const {
				generation,
				scan: reconciled,
				watcherReadyMs,
				reconciliationMs,
				commitVersion,
			} = await this.#readyGeneration(initial, true)
			this.#activeGeneration = generation
			generation.proof.committed = true
			this.requestedAdds.push(...sorted(generation.physicalPaths))
			this.#collection = recordsByPath(reconciled.files)
			const initialDiff = diffCollections(baseline, this.#collection)
			if (initialDiff.changed) this.publications.push(initialDiff.publication)
			if (this.#invalidationVersion !== commitVersion) this.#scheduleReconciliation()

			return {
				firstScanMs,
				watcherReadyMs,
				reconciliationMs,
				totalReadinessMs: elapsedMs(totalStartedAt),
				directoryCount: reconciled.watchDirectories.reduce(
					(count, directory) => count + directory.lexicalPaths.length,
					0,
				),
				watchCount: reconciled.watchDirectories.length,
				rssDeltaBytes: process.memoryUsage.rss() - rssBefore,
			}
		} catch (error) {
			await this.close()
			throw error
		}
	}

	async waitFor(
		predicate: (files: readonly FileRecord[]) => boolean,
		description: string,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<void> {
		const startedAt = performance.now()
		while (elapsedMs(startedAt) < timeoutMs) {
			if (this.#fatalError) throw this.#fatalError
			if (predicate(this.snapshot())) return
			await sleep(15)
		}
		throw new Error(`timed out waiting for ${description}`)
	}

	async waitForSettled(
		quietMs = this.#reconcileDelayMs * 3,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<void> {
		const startedAt = performance.now()
		let lastVersion = this.#invalidationVersion
		while (true) {
			if (elapsedMs(startedAt) >= timeoutMs)
				throw new Error(`settle timed out after ${timeoutMs}ms`)
			await sleep(quietMs)
			if (this.#fatalError) throw this.#fatalError
			if (this.#reconcilePromise) await this.#reconcilePromise
			if (
				lastVersion === this.#invalidationVersion &&
				this.#reconcileTimer === null &&
				this.#reconcilePromise === null
			) {
				return
			}
			lastVersion = this.#invalidationVersion
		}
	}

	async close(): Promise<number> {
		if (this.#closed) return 0
		const startedAt = performance.now()
		this.#closed = true
		if (this.#reconcileTimer) clearTimeout(this.#reconcileTimer)
		this.#reconcileTimer = null
		let primaryError: unknown = null
		try {
			if (this.#reconcilePromise) {
				await withTimeout(this.#reconcilePromise, DEFAULT_TIMEOUT_MS, "in-flight reconciliation")
			}
		} catch (error) {
			primaryError = error
		} finally {
			this.#activeGeneration = null
			const watchers = [...this.#allWatchers]
			this.#allWatchers.clear()
			try {
				const closing = Promise.allSettled(watchers.map((watcher) => watcher.close())).then(
					(results) => {
						const rejection = results.find(
							(result): result is PromiseRejectedResult => result.status === "rejected",
						)
						if (rejection) throw rejection.reason
					},
				)
				await withTimeout(closing, DEFAULT_TIMEOUT_MS, "watcher close")
			} catch (error) {
				if (primaryError === null) primaryError = error
			}
		}
		if (primaryError !== null) throw primaryError
		return elapsedMs(startedAt)
	}

	#handleInvalidation(
		event: string,
		physicalPathInput: string,
		mapping: ReadonlyMap<string, readonly string[]>,
		generation: WatchGeneration,
	): void {
		if (this.#closed) return
		const physicalPath = resolve(physicalPathInput)
		const lexicalParents = mapping.get(dirname(physicalPath)) ?? []
		const lexicalPaths = lexicalParents.map((parent) =>
			join(parent, physicalPath.slice(dirname(physicalPath).length + 1)),
		)
		this.observedEvents.push({ event, physicalPath, lexicalPaths, generationId: generation.id })
		if (event === "addDir") generation.proof.parentInvalidations.push(...lexicalPaths)
		this.#invalidationVersion++
		if (this.#activeGeneration) this.#scheduleReconciliation()
	}

	#scheduleReconciliation(): void {
		if (this.#closed) return
		if (this.#reconcilePromise) {
			this.#reconcileAgain = true
			return
		}
		if (this.#reconcileTimer) clearTimeout(this.#reconcileTimer)
		this.#reconcileTimer = setTimeout(() => {
			this.#reconcileTimer = null
			this.#reconcilePromise = this.#reconcile().finally(() => {
				this.#reconcilePromise = null
				if (this.#reconcileAgain) {
					this.#reconcileAgain = false
					this.#scheduleReconciliation()
				}
			})
		}, this.#reconcileDelayMs)
	}

	async #reconcile(): Promise<void> {
		try {
			let scan = await scanTopology(this.root, this.policy, { phase: "invalidation" })
			if (this.#closed) return
			const active = this.#activeGeneration
			if (!active) return
			if (topologySignature(scan) !== active.signature) {
				const replacement = await this.#readyGeneration(scan, false)
				scan = replacement.scan
				if (this.#closed) return
				this.#recordTopologyDiff(active.physicalPaths, replacement.generation.physicalPaths)
				this.#activeGeneration = replacement.generation
				replacement.generation.proof.committed = true
				await this.#closeGeneration(active)
				if (this.#invalidationVersion !== replacement.commitVersion) {
					this.#reconcileAgain = true
				}
			}
			if (this.#closed) return
			const next = recordsByPath(scan.files)
			const diff = diffCollections(this.#collection, next)
			this.#collection = next
			if (diff.changed) this.publications.push(diff.publication)
		} catch (error) {
			this.#fatalError = error instanceof Error ? error : new Error(String(error))
		}
	}

	async #readyGeneration(
		initialScan: ScanResult,
		initial: boolean,
	): Promise<{
		readonly generation: WatchGeneration
		readonly scan: ScanResult
		readonly watcherReadyMs: number
		readonly reconciliationMs: number
		readonly commitVersion: number
	}> {
		let candidate = initialScan
		let bridge: WatchGeneration | null = null
		let watcherReadyMs = 0
		let reconciliationMs = 0
		const kind = initial ? "initial" : "replacement"
		for (let attempt = 0; attempt < 8; attempt++) {
			const readyStartedAt = performance.now()
			const generation = await this.#createGeneration(candidate, kind)
			watcherReadyMs += elapsedMs(readyStartedAt)
			if (bridge) await this.#closeGeneration(bridge)
			bridge = generation
			if (initial && attempt === 0) await this.#hooks.afterWatcherReady?.(candidate)
			const reconciliationPhase: ScanPhase = initial
				? "initial-reconciliation"
				: "replacement-reconciliation"
			const convergencePhase: ScanPhase = initial
				? "initial-convergence"
				: "replacement-convergence"
			const reconciliationStartedAt = performance.now()
			await this.#hooks.onGenerationPhase?.("before-reconciliation", generationContext(generation))
			await scanTopology(this.root, this.policy, {
				phase: reconciliationPhase,
				hooks: this.#hooks,
			})
			generation.proof.reconciliationPasses++
			await sleep(this.usePolling ? 125 : 50)
			let converged: ScanResult | null = null
			for (let convergence = 0; convergence < 8; convergence++) {
				const versionBeforeScan = this.#invalidationVersion
				converged = await scanTopology(this.root, this.policy, {
					phase: convergencePhase,
					...(convergence === 0 ? { hooks: this.#hooks } : {}),
				})
				generation.proof.reconciliationPasses++
				if (convergence === 0) {
					await this.#hooks.onGenerationPhase?.("before-commit", generationContext(generation))
				}
				await sleep(this.usePolling ? 125 : 50)
				if (topologySignature(converged) !== generation.signature) break
				if (versionBeforeScan === this.#invalidationVersion) {
					reconciliationMs += elapsedMs(reconciliationStartedAt)
					return {
						generation,
						scan: converged,
						watcherReadyMs,
						reconciliationMs,
						commitVersion: this.#invalidationVersion,
					}
				}
			}
			reconciliationMs += elapsedMs(reconciliationStartedAt)
			assertCondition(converged !== null, "convergence scan did not run")
			candidate = converged
		}
		if (bridge) await this.#closeGeneration(bridge)
		throw new Error("topology did not converge after eight readiness-bearing replacements")
	}

	async #createGeneration(
		scan: ScanResult,
		kind: "initial" | "replacement",
	): Promise<WatchGeneration> {
		const mapping = topologyMapping(scan)
		const physicalPaths = new Set(mapping.keys())
		const id = `generation-${++this.#generationSequence}`
		const proof: MutableGenerationProof = {
			generationId: id,
			kind,
			requestedPhysicalDirectories: sorted(physicalPaths),
			parentInvalidations: [],
			reconciliationPasses: 0,
			committed: false,
		}
		this.generationProofs.push(proof)
		const context: GenerationPhaseContext = {
			generationId: id,
			kind,
			requestedPhysicalDirectories: proof.requestedPhysicalDirectories,
		}
		await this.#hooks.onGenerationPhase?.("before-create", context)
		const watcher = watch(sorted(physicalPaths), {
			ignoreInitial: true,
			followSymlinks: false,
			depth: 0,
			usePolling: this.usePolling,
			interval: 50,
			atomic: true,
		})
		this.#allWatchers.add(watcher)
		const generation: WatchGeneration = {
			watcher,
			mapping,
			physicalPaths,
			signature: topologySignature(scan),
			id,
			kind,
			proof,
		}
		watcher.on("all", (event: string, physicalPath: string): void => {
			this.#handleInvalidation(event, physicalPath, mapping, generation)
		})
		watcher.on("error", (error: unknown): void => {
			this.#fatalError = error instanceof Error ? error : new Error(String(error))
		})
		const ready = new Promise<void>((resolveReady, rejectReady) => {
			watcher.once("ready", resolveReady)
			watcher.once("error", rejectReady)
		})
		await this.#hooks.onGenerationPhase?.("after-create", context)
		await withTimeout(ready, DEFAULT_TIMEOUT_MS, "watcher readiness")
		await this.#hooks.onGenerationPhase?.("after-ready", context)
		return generation
	}

	#recordTopologyDiff(previous: ReadonlySet<string>, next: ReadonlySet<string>): void {
		this.requestedAdds.push(...sorted([...next].filter((path) => !previous.has(path))))
		this.requestedRemoves.push(...sorted([...previous].filter((path) => !next.has(path))))
	}

	async #closeGeneration(generation: WatchGeneration): Promise<void> {
		this.#allWatchers.delete(generation.watcher)
		await withTimeout(generation.watcher.close(), DEFAULT_TIMEOUT_MS, "replaced watcher close")
	}
}

export const verifyDependencyImports = async (): Promise<{
	readonly chokidar: boolean
	readonly fuzzysort: boolean
	readonly ignore: boolean
}> => {
	const imported = await runDependencyImportProbe()
	const fuzzyMatches = fuzzysort.go("rdm", ["README.md", "notes.txt"])
	const ignoreMatches = ignore().add("*.tmp").ignores("scratch.tmp")
	return {
		chokidar: imported.chokidar,
		fuzzysort:
			imported.fuzzysort && fuzzyMatches.length === 1 && fuzzyMatches[0]?.target === "README.md",
		ignore: imported.ignore && ignoreMatches,
	}
}

const withTempDirectory = async <T>(
	name: string,
	run: (directory: string) => Promise<T>,
): Promise<T> => {
	const directory = await mkdtemp(join(tmpdir(), `house-ui-${name}-`))
	try {
		return await run(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

const pathsIn = (files: readonly FileRecord[]): Set<string> =>
	new Set(files.map((file) => file.relativePath))

const publicationCount = (
	publications: readonly Publication[],
	kind: keyof Publication,
	path: string,
): number =>
	publications.reduce((count, publication) => count + Number(publication[kind].includes(path)), 0)

export const runPhaseInterleavingCorrectness = async (usePolling: boolean): Promise<void> => {
	await withTempDirectory("phase-interleavings", async (root) => {
		const known = join(root, "known")
		await mkdir(known)
		await writeFile(join(known, "baseline.txt"), "baseline")
		let initialKnown = false
		let initialRoot = false
		let reconciliationKnown = false
		let reconciliationRoot = false
		let convergenceKnown = false
		let convergenceRoot = false
		const hooks: PhaseHooks = {
			onScanDirectory: async ({ phase, lexicalDirectory, stage }) => {
				if (stage !== "after-read") return
				if (phase === "initial" && lexicalDirectory === known && !initialKnown) {
					initialKnown = true
					await writeFile(join(known, "during-initial.txt"), "initial")
				}
				if (phase === "initial" && lexicalDirectory === root && !initialRoot) {
					initialRoot = true
					await mkdir(join(root, "new-during-initial"))
					await writeFile(join(root, "new-during-initial", "child.txt"), "initial")
				}
				if (
					phase === "initial-reconciliation" &&
					lexicalDirectory === known &&
					!reconciliationKnown
				) {
					reconciliationKnown = true
					await writeFile(join(known, "during-reconciliation.txt"), "reconciliation")
				}
				if (
					phase === "initial-reconciliation" &&
					lexicalDirectory === root &&
					!reconciliationRoot
				) {
					reconciliationRoot = true
					await mkdir(join(root, "new-during-reconciliation"))
					await writeFile(join(root, "new-during-reconciliation", "child.txt"), "reconciliation")
				}
				if (phase === "initial-convergence" && lexicalDirectory === known && !convergenceKnown) {
					convergenceKnown = true
					await writeFile(join(known, "during-convergence.txt"), "convergence")
				}
				if (phase === "initial-convergence" && lexicalDirectory === root && !convergenceRoot) {
					convergenceRoot = true
					await mkdir(join(root, "new-during-convergence"))
					await writeFile(join(root, "new-during-convergence", "child.txt"), "convergence")
				}
			},
			afterInitialScan: async () => {
				await writeFile(join(known, "between-scan-and-ready.txt"), "gap")
				await mkdir(join(root, "new-between-scan-and-ready"))
				await writeFile(join(root, "new-between-scan-and-ready", "child.txt"), "gap")
			},
		}
		const watcher = new PolicyTopologyWatcher(root, {
			policy: defaultPolicy(),
			usePolling,
			hooks,
		})
		await watcher.start()
		try {
			const expected = sorted([
				"known/between-scan-and-ready.txt",
				"known/during-initial.txt",
				"known/during-reconciliation.txt",
				"known/during-convergence.txt",
				"new-between-scan-and-ready/child.txt",
				"new-during-convergence/child.txt",
				"new-during-initial/child.txt",
				"new-during-reconciliation/child.txt",
			])
			assertCondition(
				expected.every((path) => pathsIn(watcher.snapshot()).has(path)),
				"phase interleaving final membership was incomplete",
			)
			assertCondition(watcher.publications.length === 1, "phase mutations did not publish once")
			assertCondition(
				JSON.stringify(watcher.publications[0]) ===
					JSON.stringify({ added: expected, changed: [], removed: [] }),
				"phase mutation publication was not path/kind exact",
			)
		} finally {
			await watcher.close()
		}
	})
}

export const runReplacementPhaseCorrectness = async (
	usePolling: boolean,
): Promise<ReplacementProof> =>
	withTempDirectory("replacement-phases", async (root): Promise<ReplacementProof> => {
		await writeFile(join(root, ".gitignore"), "new-directory/\n")
		const directory = join(root, "new-directory")
		const phaseFiles = new Map<GenerationPhase, string>([
			["before-create", "before-create.txt"],
			["after-create", "after-create.txt"],
			["after-ready", "after-ready.txt"],
			["before-reconciliation", "before-reconciliation.txt"],
			["before-commit", "before-commit.txt"],
		])
		const completedPhases = new Set<GenerationPhase>()
		let convergenceMutation = false
		const hooks: PhaseHooks = {
			onGenerationPhase: async (phase, context) => {
				if (context.kind !== "replacement" || completedPhases.has(phase)) return
				completedPhases.add(phase)
				const filename = phaseFiles.get(phase)
				if (filename) await writeFile(join(directory, filename), phase)
			},
			onScanDirectory: async ({ phase, lexicalDirectory, stage }) => {
				if (
					phase === "replacement-convergence" &&
					lexicalDirectory === directory &&
					stage === "after-read" &&
					!convergenceMutation
				) {
					convergenceMutation = true
					await writeFile(join(directory, "during-convergence.txt"), "convergence")
				}
			},
		}
		const watcher = new PolicyTopologyWatcher(root, {
			policy: defaultPolicy(),
			usePolling,
			hooks,
		})
		await watcher.start()
		try {
			const publicationStart = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "")
			await mkdir(directory)
			await writeFile(join(directory, "immediate-child.txt"), "immediate")
			const expectedAdditions = sorted(
				[...phaseFiles.values(), "during-convergence.txt", "immediate-child.txt"].map(
					(filename) => `new-directory/${filename}`,
				),
			)
			await watcher.waitFor(
				(files) => expectedAdditions.every((path) => pathsIn(files).has(path)),
				"replacement phase additions",
				10_000,
			)
			await watcher.waitForSettled()
			const logicalPublications = watcher.publications
				.slice(publicationStart)
				.filter(
					(publication) =>
						JSON.stringify(publication) ===
						JSON.stringify({ added: expectedAdditions, changed: [], removed: [] }),
				)
			assertCondition(
				logicalPublications.length === 1,
				"replacement phases did not produce one exact logical publication",
			)
			for (const path of expectedAdditions) {
				assertCondition(
					publicationCount(watcher.publications.slice(publicationStart), "added", path) === 1,
					`replacement path ${path} was not added exactly once`,
				)
			}
			const mutableProof = watcher.generationProofs.find(
				(proof) => proof.kind === "replacement" && proof.committed,
			)
			assertCondition(mutableProof !== undefined, "replacement generation did not commit")
			const physicalDirectory = await realpath(directory)
			assertCondition(
				mutableProof.requestedPhysicalDirectories.includes(physicalDirectory),
				"replacement generation did not request the new physical directory",
			)
			const parentInvalidations = sorted(
				new Set(
					watcher.observedEvents
						.filter((event) => event.event === "addDir")
						.flatMap((event) => event.lexicalPaths)
						.filter((path) => path === directory),
				),
			)
			assertCondition(
				parentInvalidations.includes(directory),
				"parent watcher did not invalidate the new directory",
			)
			assertCondition(
				mutableProof.reconciliationPasses >= 2,
				"replacement generation did not reconcile and converge",
			)

			const postReadyAddition = "new-directory/post-ready.txt"
			const postReadyStart = watcher.publications.length
			await writeFile(join(root, postReadyAddition), "post-ready")
			await waitForExactPublication(watcher, postReadyStart, "added", postReadyAddition)
			const postReadyPublication = watcher.publications.find(
				(publication, index) =>
					index >= postReadyStart && publication.added.includes(postReadyAddition),
			)
			assertCondition(postReadyPublication !== undefined, "post-ready publication was missing")
			return {
				usePolling,
				generation: {
					generationId: mutableProof.generationId,
					kind: mutableProof.kind,
					requestedPhysicalDirectories: mutableProof.requestedPhysicalDirectories,
					parentInvalidations,
					reconciliationPasses: mutableProof.reconciliationPasses,
					committed: mutableProof.committed,
				},
				expectedAdditions,
				logicalPublication: logicalPublications[0]!,
				postReadyAddition,
				postReadyPublication,
			}
		} finally {
			await watcher.close()
		}
	})

const runRecursiveCorrectness = async (usePolling: boolean): Promise<void> => {
	await withTempDirectory("correctness", async (root) => {
		await Promise.all([
			mkdir(join(root, "included")),
			mkdir(join(root, "excluded")),
			mkdir(join(root, "ignored")),
			mkdir(join(root, "nested", "deep"), { recursive: true }),
		])
		await Promise.all([
			writeFile(join(root, ".gitignore"), "ignored/\n"),
			writeFile(join(root, "stable.txt"), "aaaa"),
			writeFile(join(root, "atomic.txt"), "old!"),
			writeFile(join(root, "remove.txt"), "remove"),
			writeFile(join(root, "included", "initial.txt"), "initial"),
			writeFile(join(root, "excluded", "secret.txt"), "secret"),
			writeFile(join(root, "ignored", "hidden.txt"), "hidden"),
		])
		const policy = defaultPolicy({ excludedDirectoryNames: new Set(["excluded"]) })
		const initialScan = await scanTopology(root, policy)
		const initialTopology = new Set(
			initialScan.watchDirectories.flatMap((directory) => directory.lexicalPaths),
		)
		assertCondition(
			initialTopology.has(join(root, "included")),
			"included directory was not watched",
		)
		assertCondition(!initialTopology.has(join(root, "excluded")), "excluded directory was watched")
		assertCondition(!initialTopology.has(join(root, "ignored")), "ignored directory was watched")

		const watcher = new PolicyTopologyWatcher(root, { policy, usePolling })
		await watcher.start()
		try {
			const initialPaths = pathsIn(watcher.snapshot())
			assertCondition(initialPaths.has("stable.txt"), "initial root file was missed")
			assertCondition(initialPaths.has("included/initial.txt"), "initial nested file was missed")
			assertCondition(!initialPaths.has("excluded/secret.txt"), "excluded file entered collection")
			assertCondition(!initialPaths.has("ignored/hidden.txt"), "ignored file entered collection")

			let publicationStart = watcher.publications.length
			await writeFile(join(root, "included", "created.txt"), "created")
			await watcher.waitFor(
				(files) => pathsIn(files).has("included/created.txt"),
				"included file creation",
			)
			await waitForExactPublication(watcher, publicationStart, "added", "included/created.txt")

			await sleep(20)
			publicationStart = watcher.publications.length
			await writeFile(join(root, "stable.txt"), "bbbb")
			await waitForExactPublication(watcher, publicationStart, "changed", "stable.txt")
			assertCondition(
				(await readFile(join(root, "stable.txt"), "utf8")) === "bbbb",
				"equal-size rewrite did not reach final disk state",
			)

			await sleep(20)
			publicationStart = watcher.publications.length
			const replacement = join(root, ".atomic-replacement")
			await writeFile(replacement, "new!")
			await rename(replacement, join(root, "atomic.txt"))
			await waitForExactPublication(watcher, publicationStart, "changed", "atomic.txt")
			assertCondition(
				(await readFile(join(root, "atomic.txt"), "utf8")) === "new!",
				"atomic replacement did not reach final disk state",
			)

			publicationStart = watcher.publications.length
			await unlink(join(root, "remove.txt"))
			await watcher.waitFor((files) => !pathsIn(files).has("remove.txt"), "file removal")
			await waitForExactPublication(watcher, publicationStart, "removed", "remove.txt")

			await watcher.waitForSettled()
			const excludedEvents = watcher.observedEvents.length
			const excludedPublications = watcher.publications.length
			await writeFile(join(root, "excluded", "later.txt"), "later")
			await sleep(usePolling ? 250 : 150)
			assertCondition(
				!pathsIn(watcher.snapshot()).has("excluded/later.txt"),
				"excluded mutation entered collection",
			)
			assertCondition(
				watcher.observedEvents.length === excludedEvents,
				"excluded descendant emitted an observed event",
			)
			assertCondition(
				watcher.publications.length === excludedPublications,
				"excluded mutation caused publication",
			)

			publicationStart = watcher.publications.length
			await mkdir(join(root, "new-directory"))
			await writeFile(join(root, "new-directory", "immediate.txt"), "immediate")
			await watcher.waitFor(
				(files) => pathsIn(files).has("new-directory/immediate.txt"),
				"directory and immediate child reconciliation",
			)
			await waitForExactPublication(
				watcher,
				publicationStart,
				"added",
				"new-directory/immediate.txt",
			)
			await watcher.waitForSettled()
			publicationStart = watcher.publications.length
			await writeFile(join(root, "new-directory", "after-ready.txt"), "after")
			await watcher.waitFor(
				(files) => pathsIn(files).has("new-directory/after-ready.txt"),
				"mutation in dynamically registered directory",
			)
			await waitForExactPublication(
				watcher,
				publicationStart,
				"added",
				"new-directory/after-ready.txt",
			)

			const ignorePublication = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "still-ignored/\n")
			await watcher.waitFor(
				(files) => pathsIn(files).has("ignored/hidden.txt"),
				"ignore control-file topology change",
			)
			assertCondition(
				publicationCount(
					watcher.publications.slice(ignorePublication),
					"added",
					"ignored/hidden.txt",
				) === 1,
				"ignore unpruning did not add the expected path exactly once",
			)

			const burst = ["burst-a.txt", "burst-b.txt", "burst-c.txt"] as const
			await Promise.all(burst.map((name) => writeFile(join(root, "included", name), name)))
			await watcher.waitFor(
				(files) => burst.every((name) => pathsIn(files).has(`included/${name}`)),
				"coalesced mutation burst",
			)
			await watcher.waitForSettled()
			for (const name of burst) {
				assertCondition(
					publicationCount(watcher.publications, "added", `included/${name}`) === 1,
					`logical addition for ${name} was not coalesced exactly once`,
				)
			}
			const burstPaths = burst.map((name) => `included/${name}`)
			const burstPublications = watcher.publications.filter(
				(publication) =>
					JSON.stringify(publication) ===
					JSON.stringify({ added: burstPaths, changed: [], removed: [] }),
			)
			assertCondition(
				burstPublications.length === 1,
				"coalesced burst did not appear in one logical publication",
			)

			publicationStart = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "included/\n")
			await watcher.waitFor(
				(files) => !pathsIn(files).has("included/initial.txt"),
				"topology pruning",
			)
			await waitForExactPublication(watcher, publicationStart, "removed", "included/initial.txt")
			await watcher.waitForSettled()
			const includedPhysical = await realpath(join(root, "included"))
			assertCondition(
				watcher.requestedRemoves.filter((path) => path === includedPhysical).length === 1,
				"topology pruning did not request the exact directory removal once",
			)
			const prunedEvents = watcher.observedEvents.length
			const prunedPublications = watcher.publications.length
			await writeFile(join(root, "included", "while-pruned.txt"), "pruned")
			await sleep(usePolling ? 250 : 150)
			assertCondition(
				watcher.observedEvents.length === prunedEvents,
				"pruned descendant emitted an event after replacement readiness",
			)
			assertCondition(
				watcher.publications.length === prunedPublications,
				"pruned descendant caused a publication",
			)

			publicationStart = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "")
			await watcher.waitFor(
				(files) => pathsIn(files).has("included/while-pruned.txt"),
				"topology unpruning",
			)
			await waitForExactPublication(watcher, publicationStart, "added", "included/while-pruned.txt")
			await watcher.waitForSettled()
			publicationStart = watcher.publications.length
			await writeFile(join(root, "included", "after-unprune.txt"), "unpruned")
			await watcher.waitFor(
				(files) => pathsIn(files).has("included/after-unprune.txt"),
				"mutation after topology unpruning readiness",
			)
			await waitForExactPublication(
				watcher,
				publicationStart,
				"added",
				"included/after-unprune.txt",
			)
		} finally {
			await watcher.close()
		}

		const publicationsAfterClose = watcher.publications.length
		const eventsAfterClose = watcher.observedEvents.length
		await writeFile(join(root, "late.txt"), "late")
		await sleep(usePolling ? 200 : 100)
		assertCondition(watcher.closed, "watcher did not close asynchronously")
		assertCondition(
			watcher.publications.length === publicationsAfterClose,
			"watcher published after close",
		)
		assertCondition(
			watcher.observedEvents.length === eventsAfterClose,
			"watcher observed after close",
		)
	})
}

const runNonrecursiveCorrectness = async (usePolling: boolean): Promise<void> => {
	await withTempDirectory("nonrecursive", async (root) => {
		await mkdir(join(root, "nested"))
		await Promise.all([
			writeFile(join(root, "root.txt"), "root"),
			writeFile(join(root, "nested", "before.txt"), "before"),
		])
		const watcher = new PolicyTopologyWatcher(root, {
			policy: defaultPolicy({ recursive: false }),
			usePolling,
		})
		await watcher.start()
		try {
			assertCondition(
				pathsIn(watcher.snapshot()).size === 1 && pathsIn(watcher.snapshot()).has("root.txt"),
				"nonrecursive scan crossed its root boundary",
			)
			assertCondition(watcher.watchCount === 1, "nonrecursive mode watched a nested directory")
			await watcher.waitForSettled()
			const eventsBefore = watcher.observedEvents.length
			await writeFile(join(root, "nested", "after.txt"), "after")
			await sleep(usePolling ? 250 : 150)
			assertCondition(
				watcher.observedEvents.length === eventsBefore,
				"nonrecursive nested mutation emitted an observed event",
			)
			assertCondition(
				!pathsIn(watcher.snapshot()).has("nested/after.txt"),
				"nonrecursive nested mutation entered collection",
			)
		} finally {
			await watcher.close()
		}
	})
}

const runSymlinkCorrectness = async (usePolling: boolean): Promise<void> => {
	await withTempDirectory("symlinks", async (container) => {
		const physicalRoot = join(container, "physical-root")
		const lexicalRoot = join(container, "lexical-root")
		const nestedTarget = join(container, "nested-target")
		await Promise.all([mkdir(physicalRoot), mkdir(nestedTarget)])
		await Promise.all([
			writeFile(join(physicalRoot, "root.txt"), "root"),
			writeFile(join(nestedTarget, "outside.txt"), "outside"),
		])
		await symlink(physicalRoot, lexicalRoot, "dir")
		await symlink(nestedTarget, join(physicalRoot, "nested-link"), "dir")
		await symlink(join(nestedTarget, "outside.txt"), join(physicalRoot, "nested-file-link.txt"))

		const rootWatcher = new PolicyTopologyWatcher(lexicalRoot, {
			policy: defaultPolicy({ followSymlinks: false }),
			usePolling,
		})
		await rootWatcher.start()
		try {
			const rootFile = rootWatcher.snapshot().find((file) => file.relativePath === "root.txt")
			assertCondition(
				rootFile?.absolutePath === join(lexicalRoot, "root.txt"),
				"symlink root lost lexical identity",
			)
			assertCondition(
				!pathsIn(rootWatcher.snapshot()).has("nested-link/outside.txt"),
				"nested symlink was followed while disabled",
			)
			assertCondition(
				!pathsIn(rootWatcher.snapshot()).has("nested-file-link.txt"),
				"nested symlink file was followed while disabled",
			)
			const publicationStart = rootWatcher.publications.length
			await writeFile(join(physicalRoot, "through-root.txt"), "through")
			await rootWatcher.waitFor(
				(files) => pathsIn(files).has("through-root.txt"),
				"mutation through explicit symlink root",
			)
			await waitForExactPublication(rootWatcher, publicationStart, "added", "through-root.txt")
		} finally {
			await rootWatcher.close()
		}

		await symlink(physicalRoot, join(nestedTarget, "cycle"), "dir")
		const followedWatcher = new PolicyTopologyWatcher(physicalRoot, {
			policy: defaultPolicy({ followSymlinks: true }),
			usePolling,
		})
		await followedWatcher.start()
		try {
			assertCondition(
				pathsIn(followedWatcher.snapshot()).has("nested-link/outside.txt"),
				"followed external symlink was not discovered",
			)
			assertCondition(
				!followedWatcher.snapshot().some((file) => file.relativePath.includes("cycle/")),
				"physical ancestry cycle was traversed",
			)
			const publicationStart = followedWatcher.publications.length
			await writeFile(join(nestedTarget, "outside-new.txt"), "new")
			await followedWatcher.waitFor(
				(files) => pathsIn(files).has("nested-link/outside-new.txt"),
				"external symlink target mutation",
			)
			await waitForExactPublication(
				followedWatcher,
				publicationStart,
				"added",
				"nested-link/outside-new.txt",
			)
			const linkedFile = followedWatcher
				.snapshot()
				.find((file) => file.relativePath === "nested-link/outside-new.txt")
			assertCondition(
				linkedFile?.absolutePath === join(physicalRoot, "nested-link", "outside-new.txt"),
				"followed symlink mutation lost lexical identity",
			)
		} finally {
			await followedWatcher.close()
		}
	})
}

export const runCorrectness = async (usePolling: boolean): Promise<CorrectnessReport> => {
	const startedAt = performance.now()
	const imports = await verifyDependencyImports()
	assertCondition(Object.values(imports).every(Boolean), "direct dependency import probe failed")
	await runRecursiveCorrectness(usePolling)
	await runPhaseInterleavingCorrectness(usePolling)
	const replacementProof = await runReplacementPhaseCorrectness(usePolling)
	await runNonrecursiveCorrectness(usePolling)
	await runSymlinkCorrectness(usePolling)
	return {
		command: "correctness",
		runtime: runtimeIdentity(),
		dependencies: DEPENDENCY_VERSIONS,
		usePolling,
		durationMs: elapsedMs(startedAt),
		replacementProof,
		scenarios: [
			"policy-pruned-depth-zero-topology",
			"authoritative-ready-reconciliation",
			"deterministic-phase-interleavings",
			"readiness-bearing-replacement-phase-interleavings",
			"create-equal-size-rewrite-atomic-remove",
			"ignore-control-and-new-directory-handoff",
			"single-publication-burst-coalescing-and-async-close",
			"nonrecursive-boundary",
			"symlink-root-and-followed-external-cycle",
		],
	}
}

export const runRepeat = async (runs: number, usePolling: boolean): Promise<RepeatReport> => {
	const startedAt = performance.now()
	const errors: string[] = []
	for (let run = 1; run <= runs; run++) {
		try {
			await runCorrectness(usePolling)
		} catch (error) {
			errors.push(`run ${run}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	return {
		command: "repeat",
		runtime: runtimeIdentity(),
		usePolling,
		runs,
		passed: runs - errors.length,
		failed: errors.length,
		durationMs: elapsedMs(startedAt),
		errors,
	}
}

interface SeededBenchmark {
	readonly physicalFileCount: number
	readonly controlFileCount: number
}

const seedBenchmark = async (
	root: string,
	files: number,
	dirs: number,
	shape: "broad" | "deep",
	mutations: number,
): Promise<SeededBenchmark> => {
	const directoryPaths: string[] = []
	if (shape === "broad") {
		for (let index = 0; index < dirs; index++) {
			directoryPaths.push(join(root, `dir-${index.toString().padStart(4, "0")}`))
		}
	} else {
		const branchCount = Math.max(1, Math.ceil(dirs / 8))
		for (let branch = 0; branch < branchCount && directoryPaths.length < dirs; branch++) {
			let current = join(root, `branch-${branch.toString().padStart(4, "0")}`)
			for (let depth = 0; depth < 8 && directoryPaths.length < dirs; depth++) {
				directoryPaths.push(current)
				current = join(current, `level-${depth.toString().padStart(2, "0")}`)
			}
		}
	}
	for (const directory of directoryPaths) await mkdir(directory, { recursive: true })
	const ignoredPrefixes =
		shape === "broad"
			? directoryPaths
					.filter((_, index) => index % 10 === 0)
					.map((path) => `${relative(root, path)}/`)
			: sorted(
					new Set(
						directoryPaths
							.filter((path) => relative(root, path).split(sep).length === 1)
							.filter((_, index) => index % 5 === 0)
							.map((path) => `${relative(root, path)}/`),
					),
				)
	await writeFile(join(root, ".gitignore"), `${ignoredPrefixes.join("\n")}\n`)
	for (const directory of directoryPaths) await writeFile(join(directory, ".gitignore"), "")
	const destinations = directoryPaths.length > 0 ? directoryPaths : [root]
	const batchSize = 100
	for (let start = 0; start < files; start += batchSize) {
		const end = Math.min(files, start + batchSize)
		await Promise.all(
			Array.from({ length: end - start }, (_, offset) => {
				const index = start + offset
				const destination = destinations[index % destinations.length] ?? root
				return writeFile(
					join(destination, `file-${index.toString().padStart(6, "0")}.txt`),
					`seed:${index}\n`,
				)
			}),
		)
	}
	let mutationSeedFiles = 0
	for (let index = 0; index < mutations; index++) {
		const kind = index % 4
		if (kind === 0) continue
		const prefix = kind === 1 ? "rewrite" : kind === 2 ? "atomic" : "remove"
		await writeFile(join(root, `mutation-${prefix}-${index}.txt`), "aaaa")
		mutationSeedFiles++
	}
	return {
		physicalFileCount: files + mutationSeedFiles,
		controlFileCount: directoryPaths.length + 1,
	}
}

const percentile = (values: readonly number[], percentage: number): number => {
	const ordered = [...values].sort((left, right) => left - right)
	const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * percentage) - 1)
	return ordered[Math.max(0, index)] ?? 0
}

const latencySummary = (
	values: readonly number[],
): { readonly p50: number; readonly p95: number; readonly max: number } => ({
	p50: percentile(values, 0.5),
	p95: percentile(values, 0.95),
	max: Math.max(...values),
})

const waitForExactPublication = async (
	watcher: PolicyTopologyWatcher,
	startIndex: number,
	kind: keyof Publication,
	path: string,
): Promise<void> => {
	await watcher.waitFor(
		() => publicationCount(watcher.publications.slice(startIndex), kind, path) === 1,
		`${kind} publication for ${path}`,
		10_000,
	)
	assertCondition(
		publicationCount(watcher.publications.slice(startIndex), kind, path) === 1,
		`${kind} publication for ${path} was not exact`,
	)
}

const runBenchmarkTrial = async (
	options: BenchmarkOptions,
	run: number,
	mutations: number,
): Promise<BenchmarkTrial> =>
	withTempDirectory("benchmark", async (root): Promise<BenchmarkTrial> => {
		const seeded = await seedBenchmark(root, options.files, options.dirs, options.shape, mutations)
		const policy = defaultPolicy()
		const scanStartedAt = performance.now()
		const initialScan = await scanTopology(root, policy)
		const firstScanResultMs = elapsedMs(scanStartedAt)
		const watcher = new PolicyTopologyWatcher(root, {
			policy,
			usePolling: options.usePolling,
		})
		const cpuBefore = process.cpuUsage()
		const metrics = await watcher.start()
		const latencySamples: MutationLatencySample[] = []
		let closeMs = 0
		try {
			for (let index = 0; index < mutations; index++) {
				const mode = index % 4
				const kind: keyof Publication = mode === 0 ? "added" : mode === 3 ? "removed" : "changed"
				const eventKind: MutationLatencySample["kind"] =
					mode === 0 ? "add" : mode === 3 ? "unlink" : "change"
				const prefix =
					mode === 0 ? "create" : mode === 1 ? "rewrite" : mode === 2 ? "atomic" : "remove"
				const path = `mutation-${prefix}-${index}.txt`
				const absolutePath = join(root, path)
				const publicationStart = watcher.publications.length
				const mutationStartedAt = performance.now()
				if (mode === 0) await writeFile(absolutePath, "aaaa")
				else if (mode === 1) await writeFile(absolutePath, "bbbb")
				else if (mode === 2) {
					const replacement = join(root, `.benchmark-replacement-${index}`)
					await writeFile(replacement, "bbbb")
					await rename(replacement, absolutePath)
				} else await unlink(absolutePath)
				await waitForExactPublication(watcher, publicationStart, kind, path)
				latencySamples.push({ kind: eventKind, path, ms: elapsedMs(mutationStartedAt) })
			}
		} finally {
			closeMs = await watcher.close()
		}
		const cpu = process.cpuUsage(cpuBefore)
		const values = latencySamples.map((sample) => sample.ms)
		return {
			run,
			firstScanResultMs,
			latencySamples,
			latencyMs: latencySummary(values),
			physicalFileCount: seeded.physicalFileCount,
			eligibleFileCount: initialScan.files.length,
			prunedFileCount: seeded.physicalFileCount - initialScan.files.length,
			controlFileCount: seeded.controlFileCount,
			cpuUserMicros: cpu.user,
			cpuSystemMicros: cpu.system,
			closeMs,
			...metrics,
		}
	})

export const runBenchmark = async (options: BenchmarkOptions): Promise<BenchmarkReport> => {
	await runBenchmarkTrial(options, 0, Math.min(4, options.mutations))
	const trials: BenchmarkTrial[] = []
	for (let run = 1; run <= options.runs; run++) {
		trials.push(await runBenchmarkTrial(options, run, options.mutations))
	}
	const latencies = trials.flatMap((trial) => trial.latencySamples.map((sample) => sample.ms))
	return {
		command: "benchmark",
		runtime: runtimeIdentity(),
		dependencies: DEPENDENCY_VERSIONS,
		fixture: options,
		trials,
		latencyMs: latencySummary(latencies),
	}
}

export const runBenchmarkMatrixSelection = async (
	selection: BenchmarkMatrixSelection,
): Promise<BenchmarkMatrixReport> => {
	const reports: BenchmarkReport[] = []
	for (const files of selection.files) {
		for (const shape of selection.shapes) {
			for (const usePolling of selection.modes) {
				reports.push(
					await runBenchmark({
						files,
						dirs: Math.max(selection.dirs, Math.floor(files / 10)),
						runs: selection.runs,
						mutations: selection.mutations,
						usePolling,
						shape,
					}),
				)
			}
		}
	}
	return { command: "benchmark-matrix", runtime: runtimeIdentity(), reports }
}

export const runBenchmarkMatrix = async (runs: number): Promise<BenchmarkMatrixReport> =>
	runBenchmarkMatrixSelection({
		files: [1_000, 5_000, 10_000],
		shapes: ["broad", "deep"],
		modes: [false, true],
		runs,
		mutations: 100,
		dirs: 120,
	})

export const runtimeIdentity = (): RuntimeIdentity => {
	const bunVersion = process.versions.bun
	return {
		name: bunVersion === undefined ? "node" : "bun",
		version: bunVersion ?? process.versions.node,
		platform: process.platform,
		arch: process.arch,
		osRelease: release(),
	}
}
