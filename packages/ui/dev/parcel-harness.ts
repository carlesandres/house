import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { release, tmpdir } from "node:os"
import { mkdir, mkdtemp, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises"
import * as parcelWatcher from "@parcel/watcher"
import { scanTopology } from "./backend-harness.ts"
import type {
	FileRecord,
	PhaseHooks,
	Publication,
	RuntimeIdentity,
	ScanPhase,
	ScanPolicy,
	ScanResult,
} from "./backend-harness.ts"

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_RECONCILE_DELAY_MS = 30
const HANDOFF_QUIET_MS = 90
const PARCEL_VERSION = "2.6.0"

export type ParcelGenerationPhase =
	| "before-subscribe"
	| "after-subscribe-ready"
	| "before-reconciliation"
	| "before-confirmation"
	| "before-commit"

export interface ParcelGenerationContext {
	readonly generationId: string
	readonly kind: "initial" | "replacement"
	readonly physicalRoots: readonly string[]
}

export interface ParcelPhaseHooks extends PhaseHooks {
	readonly onParcelPhase?: (
		phase: ParcelGenerationPhase,
		context: ParcelGenerationContext,
	) => Promise<void>
}

export interface ParcelObservedEvent {
	readonly type: parcelWatcher.EventType | "error"
	readonly physicalPath: string
	readonly lexicalPaths: readonly string[]
	readonly generationId: string
	readonly source: "parcel" | "simulated"
}

export interface ParcelGenerationProof {
	readonly generationId: string
	readonly kind: "initial" | "replacement"
	readonly physicalRoots: readonly string[]
	reconciliationPasses: number
	committed: boolean
}

export interface ParcelStartMetrics {
	readonly scannerMs: number
	readonly subscribeMs: number
	readonly totalReadinessMs: number
	readonly reconciliationPasses: number
	readonly physicalSubscriptionCount: number
	readonly eligibleFileCount: number
	readonly rssDeltaBytes: number
}

export interface ParcelAdapterOptions {
	readonly policy: ScanPolicy
	readonly reconcileDelayMs?: number
	readonly periodicReconcileMs?: number
	readonly hooks?: ParcelPhaseHooks
	readonly subscriptionSource?: ParcelSubscriptionSource
}

export interface ParcelSubscriptionSource {
	subscribe(
		directory: string,
		callback: parcelWatcher.SubscribeCallback,
	): Promise<parcelWatcher.AsyncSubscription>
}

interface ParcelGeneration {
	readonly id: string
	readonly kind: "initial" | "replacement"
	readonly roots: readonly string[]
	readonly mapping: ReadonlyMap<string, readonly string[]>
	readonly signature: string
	readonly subscriptions: readonly parcelWatcher.AsyncSubscription[]
	readonly proof: ParcelGenerationProof
}

interface CollectionDiff {
	readonly changed: boolean
	readonly publication: Publication
}

interface ReadyGeneration {
	readonly generation: ParcelGeneration
	readonly scan: ScanResult
	readonly commitVersion: number
	readonly subscribeMs: number
}

export interface ParcelCorrectnessReport {
	readonly command: "correctness"
	readonly runtime: RuntimeIdentity
	readonly dependency: { readonly parcelWatcher: typeof PARCEL_VERSION }
	readonly durationMs: number
	readonly scenarios: readonly string[]
	readonly observedExcludedEvents: number
	readonly publications: number
	readonly replacementGenerations: number
	readonly periodicRecovery: {
		readonly enabled: true
		readonly intervalMs: number
		readonly recoveredPath: string
		readonly recoveryMs: number
	}
}

export interface ParcelRepeatReport {
	readonly command: "repeat"
	readonly runtime: RuntimeIdentity
	readonly runs: number
	readonly passed: number
	readonly failed: number
	readonly durationMs: number
	readonly errors: readonly string[]
}

export interface ParcelBenchmarkOptions {
	readonly files: number
	readonly dirs: number
	readonly runs: number
	readonly mutations: number
	readonly shape: "broad" | "deep"
}

export interface ParcelBenchmarkTrial extends ParcelStartMetrics {
	readonly run: number
	readonly firstScannerMs: number
	readonly mutationLatencyMs: { readonly p50: number; readonly p95: number; readonly max: number }
	readonly cpuUserMicros: number
	readonly cpuSystemMicros: number
	readonly rssPeakDeltaBytes: number
	readonly unsubscribeMs: number
	readonly noCrash: true
}

export interface ParcelBenchmarkReport {
	readonly command: "benchmark-cell"
	readonly runtime: RuntimeIdentity
	readonly dependency: { readonly parcelWatcher: typeof PARCEL_VERSION }
	readonly fixture: ParcelBenchmarkOptions
	readonly trials: readonly ParcelBenchmarkTrial[]
	readonly summary: {
		readonly scannerMs: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly subscribeMs: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly totalReadinessMs: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly mutationLatencyMs: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly rssPeakDeltaBytes: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly cpuUserMicros: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly cpuSystemMicros: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly unsubscribeMs: { readonly p50: number; readonly p95: number; readonly max: number }
		readonly physicalSubscriptionCount: { readonly min: number; readonly max: number }
		readonly noCrash: true
	}
}

interface ParcelBenchmarkTrialResult {
	readonly report: ParcelBenchmarkTrial
	readonly mutationLatencies: readonly number[]
}

const sorted = (values: Iterable<string>): string[] =>
	[...values].sort((left, right) => left.localeCompare(right, "en"))

const sleep = async (durationMs: number): Promise<void> => {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs))
}

const elapsedMs = (startedAt: number): number => performance.now() - startedAt

function assertCondition(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

const isWithin = (parent: string, candidate: string): boolean => {
	const path = relative(parent, candidate)
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}

const recordsByPath = (files: readonly FileRecord[]): Map<string, FileRecord> =>
	new Map(files.map((file): readonly [string, FileRecord] => [file.relativePath, file]))

const pathsIn = (files: readonly FileRecord[]): Set<string> =>
	new Set(files.map((file) => file.relativePath))

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
	for (const path of previous.keys()) if (!next.has(path)) removed.push(path)
	return {
		changed: added.length > 0 || changed.length > 0 || removed.length > 0,
		publication: { added: sorted(added), changed: sorted(changed), removed: sorted(removed) },
	}
}

const collectionSignature = (scan: ScanResult): string =>
	JSON.stringify(scan.files.map(({ relativePath, size, mtimeMs }) => [relativePath, size, mtimeMs]))

const topologyMapping = (scan: ScanResult): Map<string, readonly string[]> =>
	new Map(
		scan.watchDirectories.map((directory): readonly [string, readonly string[]] => [
			directory.physicalPath,
			directory.lexicalPaths,
		]),
	)

export const deriveParcelPhysicalRoots = async (scan: ScanResult): Promise<readonly string[]> => {
	const configuredRoot = await realpath(scan.root)
	const candidates = sorted(
		new Set(
			scan.watchDirectories
				.map((directory) => directory.physicalPath)
				.filter((path) => !isWithin(configuredRoot, path)),
		),
	)
	const externalRoots: string[] = []
	for (const candidate of candidates) {
		if (!externalRoots.some((root) => isWithin(root, candidate))) externalRoots.push(candidate)
	}
	return [configuredRoot, ...externalRoots]
}

const topologySignature = async (scan: ScanResult): Promise<string> =>
	JSON.stringify({
		roots: await deriveParcelPhysicalRoots(scan),
		mapping: scan.watchDirectories.map((directory) => [
			directory.physicalPath,
			directory.lexicalPaths,
		]),
	})

export const mapParcelEventToLexicalPaths = (
	physicalPathInput: string,
	mapping: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
	const physicalPath = resolve(physicalPathInput)
	const lexical = new Set<string>()
	for (const [physicalDirectory, lexicalDirectories] of mapping) {
		if (!isWithin(physicalDirectory, physicalPath)) continue
		const suffix = relative(physicalDirectory, physicalPath)
		for (const lexicalDirectory of lexicalDirectories) {
			lexical.add(suffix === "" ? lexicalDirectory : join(lexicalDirectory, suffix))
		}
	}
	return sorted(lexical)
}

export class ParcelPolicyWatcher {
	readonly root: string
	readonly observedEvents: ParcelObservedEvent[] = []
	readonly publications: Publication[] = []
	readonly generationProofs: ParcelGenerationProof[] = []

	#policy: ScanPolicy
	#activeGeneration: ParcelGeneration | null = null
	readonly #allGenerations = new Set<ParcelGeneration>()
	#collection = new Map<string, FileRecord>()
	#closed = false
	#fatalError: Error | null = null
	#reconcileTimer: ReturnType<typeof setTimeout> | null = null
	#reconcilePromise: Promise<void> | null = null
	#reconcileAgain = false
	#invalidationVersion = 0
	#generationSequence = 0
	#scannerMs = 0
	#reconciliationPasses = 0
	readonly #reconcileDelayMs: number
	readonly #periodicReconcileMs: number | null
	#periodicTimer: ReturnType<typeof setInterval> | null = null
	#dropParcelEvents = false
	readonly #hooks: ParcelPhaseHooks
	readonly #subscriptionSource: ParcelSubscriptionSource

	constructor(root: string, options: ParcelAdapterOptions) {
		this.root = resolve(root)
		this.#policy = options.policy
		this.#reconcileDelayMs = options.reconcileDelayMs ?? DEFAULT_RECONCILE_DELAY_MS
		this.#periodicReconcileMs = options.periodicReconcileMs ?? null
		this.#hooks = options.hooks ?? {}
		this.#subscriptionSource = options.subscriptionSource ?? parcelWatcher
	}

	get closed(): boolean {
		return this.#closed
	}

	get physicalSubscriptionCount(): number {
		return this.#activeGeneration?.roots.length ?? 0
	}

	get reconciliationPasses(): number {
		return this.#reconciliationPasses
	}

	snapshot(): readonly FileRecord[] {
		return [...this.#collection.values()].sort((left, right) =>
			left.relativePath.localeCompare(right.relativePath, "en"),
		)
	}

	async start(): Promise<ParcelStartMetrics> {
		if (this.#activeGeneration !== null || this.#closed)
			throw new Error("watcher cannot be started")
		const startedAt = performance.now()
		const rssBefore = process.memoryUsage.rss()
		try {
			const initial = await this.#scan("initial")
			const baseline = recordsByPath(initial.files)
			await this.#hooks.afterInitialScan?.(initial)
			const ready = await this.#readyGeneration(initial, "initial")
			this.#activeGeneration = ready.generation
			ready.generation.proof.committed = true
			this.#collection = recordsByPath(ready.scan.files)
			const handoffDiff = diffCollections(baseline, this.#collection)
			if (handoffDiff.changed) this.publications.push(handoffDiff.publication)
			if (this.#periodicReconcileMs !== null) {
				this.#periodicTimer = setInterval(
					() => this.#scheduleReconciliation(),
					this.#periodicReconcileMs,
				)
			}
			if (this.#invalidationVersion !== ready.commitVersion) this.#scheduleReconciliation()
			return {
				scannerMs: this.#scannerMs,
				subscribeMs: ready.subscribeMs,
				totalReadinessMs: elapsedMs(startedAt),
				reconciliationPasses: this.#reconciliationPasses,
				physicalSubscriptionCount: ready.generation.roots.length,
				eligibleFileCount: ready.scan.files.length,
				rssDeltaBytes: process.memoryUsage.rss() - rssBefore,
			}
		} catch (error) {
			await this.close()
			throw error
		}
	}

	updatePolicy(policy: ScanPolicy): void {
		if (this.#closed) return
		this.#policy = policy
		this.#invalidationVersion++
		this.#scheduleReconciliation()
	}

	setDropParcelEvents(drop: boolean): void {
		this.#dropParcelEvents = drop
	}

	injectEvents(events: readonly parcelWatcher.Event[]): void {
		const generation = this.#activeGeneration
		if (!generation || this.#closed) return
		this.#handleCallback(generation, null, events, "simulated")
	}

	injectCallbackError(error: Error): void {
		const generation = this.#activeGeneration
		if (!generation || this.#closed) return
		this.#handleCallback(generation, error, [], "simulated")
	}

	async reconcileNow(): Promise<void> {
		if (this.#closed) return
		this.#invalidationVersion++
		if (this.#reconcileTimer) {
			clearTimeout(this.#reconcileTimer)
			this.#reconcileTimer = null
		}
		if (this.#reconcilePromise) {
			this.#reconcileAgain = true
			await this.#reconcilePromise
			return
		}
		this.#reconcilePromise = this.#reconcile().finally(() => {
			this.#reconcilePromise = null
		})
		await this.#reconcilePromise
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

	async waitForObserved(
		predicate: (events: readonly ParcelObservedEvent[]) => boolean,
		description: string,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<void> {
		const startedAt = performance.now()
		while (elapsedMs(startedAt) < timeoutMs) {
			if (this.#fatalError) throw this.#fatalError
			if (predicate(this.observedEvents)) return
			await sleep(15)
		}
		throw new Error(`timed out waiting for ${description}`)
	}

	async waitForSettled(quietMs = 120, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
		const startedAt = performance.now()
		let version = this.#invalidationVersion
		while (elapsedMs(startedAt) < timeoutMs) {
			await sleep(quietMs)
			if (this.#fatalError) throw this.#fatalError
			if (this.#reconcilePromise) await this.#reconcilePromise
			if (
				version === this.#invalidationVersion &&
				this.#reconcileTimer === null &&
				this.#reconcilePromise === null
			) {
				return
			}
			version = this.#invalidationVersion
		}
		throw new Error(`settle timed out after ${timeoutMs}ms`)
	}

	async close(): Promise<number> {
		if (this.#closed) return 0
		const startedAt = performance.now()
		this.#closed = true
		if (this.#reconcileTimer) clearTimeout(this.#reconcileTimer)
		if (this.#periodicTimer) clearInterval(this.#periodicTimer)
		this.#reconcileTimer = null
		this.#periodicTimer = null
		let primaryError: unknown = null
		try {
			if (this.#reconcilePromise) await this.#reconcilePromise
		} catch (error) {
			primaryError = error
		}
		const generations = [...this.#allGenerations]
		this.#activeGeneration = null
		const results = await Promise.allSettled(
			generations.map((generation) => this.#closeGeneration(generation)),
		)
		const rejected = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		if (primaryError === null && rejected) primaryError = rejected.reason
		if (primaryError !== null) throw primaryError
		return elapsedMs(startedAt)
	}

	async #scan(phase: ScanPhase): Promise<ScanResult> {
		const startedAt = performance.now()
		try {
			return await scanTopology(this.root, this.#policy, {
				phase,
				hooks: this.#hooks,
			})
		} finally {
			this.#scannerMs += elapsedMs(startedAt)
			this.#reconciliationPasses++
		}
	}

	#handleCallback(
		generation: ParcelGeneration,
		error: Error | null,
		events: readonly parcelWatcher.Event[],
		source: "parcel" | "simulated",
	): void {
		if (this.#closed || (source === "parcel" && this.#dropParcelEvents)) return
		if (error) {
			this.observedEvents.push({
				type: "error",
				physicalPath: generation.roots[0] ?? this.root,
				lexicalPaths: [],
				generationId: generation.id,
				source,
			})
			this.#fatalError = error
			return
		}
		for (const event of events) {
			this.observedEvents.push({
				type: event.type,
				physicalPath: resolve(event.path),
				lexicalPaths: mapParcelEventToLexicalPaths(event.path, generation.mapping),
				generationId: generation.id,
				source,
			})
		}
		if (events.length === 0) return
		this.#invalidationVersion++
		if (this.#activeGeneration) this.#scheduleReconciliation()
	}

	#scheduleReconciliation(): void {
		if (this.#closed || this.#fatalError) return
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
			let scan = await this.#scan("invalidation")
			if (this.#closed) return
			const active = this.#activeGeneration
			if (!active) return
			if ((await topologySignature(scan)) !== active.signature) {
				const replacement = await this.#readyGeneration(scan, "replacement")
				scan = replacement.scan
				if (this.#closed) return
				this.#activeGeneration = replacement.generation
				replacement.generation.proof.committed = true
				await this.#closeGeneration(active)
				if (this.#invalidationVersion !== replacement.commitVersion) this.#reconcileAgain = true
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
		kind: "initial" | "replacement",
	): Promise<ReadyGeneration> {
		let candidate = initialScan
		let bridge: ParcelGeneration | null = null
		let subscribeMs = 0
		for (let subscriptionAttempt = 0; subscriptionAttempt < 8; subscriptionAttempt++) {
			const subscribeStartedAt = performance.now()
			const generation = await this.#createGeneration(candidate, kind)
			subscribeMs += elapsedMs(subscribeStartedAt)
			if (bridge) await this.#closeGeneration(bridge)
			bridge = generation
			const context = this.#generationContext(generation)
			await this.#hooks.onParcelPhase?.("before-reconciliation", context)
			let previous = await this.#scan(
				kind === "initial" ? "initial-reconciliation" : "replacement-reconciliation",
			)
			await sleep(HANDOFF_QUIET_MS)
			for (let convergence = 0; convergence < 8; convergence++) {
				const versionBefore = this.#invalidationVersion
				await this.#hooks.onParcelPhase?.("before-confirmation", context)
				const confirmation = await this.#scan(
					kind === "initial" ? "initial-convergence" : "replacement-convergence",
				)
				await this.#hooks.onParcelPhase?.("before-commit", context)
				await sleep(HANDOFF_QUIET_MS)
				const final = await this.#scan(
					kind === "initial" ? "initial-convergence" : "replacement-convergence",
				)
				const finalTopology = await topologySignature(final)
				generation.proof.reconciliationPasses += 2
				if (finalTopology !== generation.signature) {
					candidate = final
					break
				}
				if (
					collectionSignature(previous) === collectionSignature(confirmation) &&
					collectionSignature(confirmation) === collectionSignature(final) &&
					versionBefore === this.#invalidationVersion
				) {
					return {
						generation,
						scan: final,
						commitVersion: this.#invalidationVersion,
						subscribeMs,
					}
				}
				previous = final
				if (convergence === 7) candidate = final
			}
		}
		if (bridge) await this.#closeGeneration(bridge)
		throw new Error("Parcel subscription/scanner handoff did not converge after eight replacements")
	}

	async #createGeneration(
		scan: ScanResult,
		kind: "initial" | "replacement",
	): Promise<ParcelGeneration> {
		const roots = await deriveParcelPhysicalRoots(scan)
		const mapping = topologyMapping(scan)
		const id = `parcel-generation-${++this.#generationSequence}`
		const proof: ParcelGenerationProof = {
			generationId: id,
			kind,
			physicalRoots: roots,
			reconciliationPasses: 0,
			committed: false,
		}
		this.generationProofs.push(proof)
		const signature = await topologySignature(scan)
		const subscriptions: parcelWatcher.AsyncSubscription[] = []
		const generation: ParcelGeneration = {
			id,
			kind,
			roots,
			mapping,
			signature,
			subscriptions,
			proof,
		}
		const context = this.#generationContext(generation)
		await this.#hooks.onParcelPhase?.("before-subscribe", context)
		try {
			for (const root of roots) {
				subscriptions.push(
					await this.#subscriptionSource.subscribe(root, (error, events) => {
						this.#handleCallback(generation, error, events, "parcel")
					}),
				)
			}
		} catch (error) {
			await Promise.allSettled(subscriptions.map((subscription) => subscription.unsubscribe()))
			throw error
		}
		this.#allGenerations.add(generation)
		await this.#hooks.onParcelPhase?.("after-subscribe-ready", context)
		return generation
	}

	#generationContext(generation: ParcelGeneration): ParcelGenerationContext {
		return {
			generationId: generation.id,
			kind: generation.kind,
			physicalRoots: generation.roots,
		}
	}

	async #closeGeneration(generation: ParcelGeneration): Promise<void> {
		if (!this.#allGenerations.delete(generation)) return
		const results = await Promise.allSettled(
			generation.subscriptions.map((subscription) => subscription.unsubscribe()),
		)
		const rejected = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		if (rejected) throw rejected.reason
	}
}

export const defaultParcelPolicy = (overrides: Partial<ScanPolicy> = {}): ScanPolicy => ({
	recursive: true,
	followSymlinks: false,
	ignoreFiles: [".gitignore"],
	excludedDirectoryNames: new Set(["excluded"]),
	...overrides,
})

const withTempDirectory = async <T>(
	name: string,
	run: (directory: string) => Promise<T>,
): Promise<T> => {
	const directory = await mkdtemp(join(tmpdir(), `house-ui-parcel-${name}-`))
	try {
		return await run(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

const publicationCount = (
	publications: readonly Publication[],
	kind: keyof Publication,
	path: string,
): number =>
	publications.reduce((count, publication) => count + Number(publication[kind].includes(path)), 0)

const waitForPublication = async (
	watcher: ParcelPolicyWatcher,
	start: number,
	kind: keyof Publication,
	path: string,
): Promise<void> => {
	await watcher.waitFor(
		() => publicationCount(watcher.publications.slice(start), kind, path) === 1,
		`${kind} publication for ${path}`,
	)
}

export const runParcelHandoffBarrierProof = async (): Promise<void> => {
	await withTempDirectory("handoff", async (root) => {
		await mkdir(join(root, "known"))
		await writeFile(join(root, "known", "baseline.txt"), "baseline")
		const completed = new Set<string>()
		const hooks: ParcelPhaseHooks = {
			afterInitialScan: async () => {
				await writeFile(join(root, "after-initial.txt"), "after initial")
			},
			onParcelPhase: async (phase, context) => {
				if (context.kind !== "initial" || completed.has(phase)) return
				completed.add(phase)
				await writeFile(join(root, `${phase}.txt`), phase)
			},
		}
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy(), hooks })
		await watcher.start()
		try {
			const expected = [
				"after-initial.txt",
				"after-subscribe-ready.txt",
				"before-commit.txt",
				"before-confirmation.txt",
				"before-reconciliation.txt",
				"before-subscribe.txt",
			]
			assertCondition(
				expected.every((path) => pathsIn(watcher.snapshot()).has(path)),
				"initial handoff barriers missed final membership",
			)
			for (const path of expected) {
				assertCondition(
					publicationCount(watcher.publications, "added", path) === 1,
					`${path} was not published once`,
				)
			}
		} finally {
			await watcher.close()
		}
	})
}

export const runParcelReplacementBarrierProof = async (): Promise<void> => {
	await withTempDirectory("replacement", async (root) => {
		const external = join(dirname(root), `${root.split(sep).at(-1)}-external`)
		await mkdir(external)
		await writeFile(join(external, "before.txt"), "before")
		const completed = new Set<string>()
		const hooks: ParcelPhaseHooks = {
			onParcelPhase: async (phase, context) => {
				if (context.kind !== "replacement" || completed.has(phase)) return
				completed.add(phase)
				await writeFile(join(external, `${phase}.txt`), phase)
			},
		}
		const watcher = new ParcelPolicyWatcher(root, {
			policy: defaultParcelPolicy({ followSymlinks: true }),
			hooks,
		})
		await watcher.start()
		try {
			await symlink(external, join(root, "external"), "dir")
			await watcher.waitFor(
				(files) => pathsIn(files).has("external/before-commit.txt"),
				"replacement barriers",
				12_000,
			)
			const replacement = watcher.generationProofs.find(
				(proof) => proof.kind === "replacement" && proof.committed,
			)
			assertCondition(replacement !== undefined, "replacement generation did not commit")
			assertCondition(
				replacement.physicalRoots.includes(await realpath(external)),
				"external target was not subscribed",
			)
		} finally {
			await watcher.close()
			await rm(external, { recursive: true, force: true })
		}
	})
}

const runRecursiveCorrectness = async (): Promise<{
	readonly observedExcludedEvents: number
	readonly publications: number
	readonly replacementGenerations: number
}> =>
	withTempDirectory("correctness", async (root) => {
		await Promise.all([
			mkdir(join(root, "included")),
			mkdir(join(root, "excluded")),
			mkdir(join(root, "ignored")),
		])
		await Promise.all([
			writeFile(join(root, ".gitignore"), "ignored/\n"),
			writeFile(join(root, "change.txt"), "aaaa"),
			writeFile(join(root, "atomic.txt"), "old!"),
			writeFile(join(root, "delete.txt"), "delete"),
			writeFile(join(root, "excluded", "secret.txt"), "secret"),
			writeFile(join(root, "ignored", "hidden.txt"), "hidden"),
		])
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
		await watcher.start()
		try {
			await watcher.waitForSettled()
			assertCondition(
				!pathsIn(watcher.snapshot()).has("excluded/secret.txt"),
				"excluded file entered initial membership",
			)
			assertCondition(
				!pathsIn(watcher.snapshot()).has("ignored/hidden.txt"),
				"ignored file entered initial membership",
			)

			let start = watcher.publications.length
			await writeFile(join(root, "created.txt"), "created")
			await waitForPublication(watcher, start, "added", "created.txt")

			await sleep(10)
			start = watcher.publications.length
			await writeFile(join(root, "change.txt"), "bbbb")
			await waitForPublication(watcher, start, "changed", "change.txt")

			start = watcher.publications.length
			await writeFile(join(root, ".replacement"), "new!")
			await rename(join(root, ".replacement"), join(root, "atomic.txt"))
			await waitForPublication(watcher, start, "changed", "atomic.txt")

			start = watcher.publications.length
			await unlink(join(root, "delete.txt"))
			await waitForPublication(watcher, start, "removed", "delete.txt")

			start = watcher.publications.length
			await mkdir(join(root, "new-directory"))
			await writeFile(join(root, "new-directory", "immediate.txt"), "immediate")
			await waitForPublication(watcher, start, "added", "new-directory/immediate.txt")

			const excludedEventStart = watcher.observedEvents.length
			const excludedPublicationStart = watcher.publications.length
			await Promise.all([
				writeFile(join(root, "excluded", "event-only.txt"), "excluded"),
				writeFile(join(root, "ignored", "event-only.txt"), "ignored"),
			])
			await watcher.waitForObserved(
				(events) =>
					events
						.slice(excludedEventStart)
						.some((event) => event.lexicalPaths.some((path) => path.endsWith("event-only.txt"))),
				"broad Parcel subscription to observe excluded invalidations",
			)
			assertCondition(
				!pathsIn(watcher.snapshot()).has("excluded/event-only.txt") &&
					!pathsIn(watcher.snapshot()).has("ignored/event-only.txt"),
				"observed excluded event injected membership",
			)
			assertCondition(
				watcher.publications.length === excludedPublicationStart,
				"excluded event caused a logical publication",
			)

			watcher.injectEvents([{ type: "create", path: join(root, "excluded", "phantom.txt") }])
			await watcher.waitForSettled()
			assertCondition(
				!pathsIn(watcher.snapshot()).has("excluded/phantom.txt"),
				"event-only path injected membership",
			)

			start = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "")
			await waitForPublication(watcher, start, "added", "ignored/hidden.txt")
			start = watcher.publications.length
			await writeFile(join(root, ".gitignore"), "ignored/\n")
			await waitForPublication(watcher, start, "removed", "ignored/hidden.txt")

			start = watcher.publications.length
			watcher.updatePolicy(defaultParcelPolicy({ excludedDirectoryNames: new Set() }))
			await waitForPublication(watcher, start, "added", "excluded/secret.txt")
			start = watcher.publications.length
			watcher.updatePolicy(defaultParcelPolicy())
			await waitForPublication(watcher, start, "removed", "excluded/secret.txt")

			const burst = ["burst-a.txt", "burst-b.txt", "burst-c.txt"]
			start = watcher.publications.length
			await Promise.all(burst.map((path) => writeFile(join(root, path), path)))
			await watcher.waitFor(
				(files) => burst.every((path) => pathsIn(files).has(path)),
				"coalesced burst",
			)
			await watcher.waitForSettled()
			const burstPublications = watcher.publications
				.slice(start)
				.filter((publication) => burst.every((path) => publication.added.includes(path)))
			assertCondition(
				burstPublications.length === 1,
				"burst did not coalesce into one scanner publication",
			)

			return {
				observedExcludedEvents: watcher.observedEvents.length - excludedEventStart,
				publications: watcher.publications.length,
				replacementGenerations: watcher.generationProofs.filter(
					(proof) => proof.kind === "replacement",
				).length,
			}
		} finally {
			await watcher.close()
			const events = watcher.observedEvents.length
			const publications = watcher.publications.length
			await writeFile(join(root, "late.txt"), "late")
			await sleep(150)
			assertCondition(watcher.observedEvents.length === events, "event arrived after unsubscribe")
			assertCondition(
				watcher.publications.length === publications,
				"publication arrived after unsubscribe",
			)
		}
	})

const runNonrecursiveCorrectness = async (): Promise<void> => {
	await withTempDirectory("nonrecursive", async (root) => {
		await mkdir(join(root, "nested"))
		await Promise.all([
			writeFile(join(root, "root.txt"), "root"),
			writeFile(join(root, "nested", "before.txt"), "nested"),
		])
		const watcher = new ParcelPolicyWatcher(root, {
			policy: defaultParcelPolicy({ recursive: false }),
		})
		await watcher.start()
		try {
			assertCondition(pathsIn(watcher.snapshot()).has("root.txt"), "root file was missing")
			assertCondition(
				!pathsIn(watcher.snapshot()).has("nested/before.txt"),
				"nonrecursive scan crossed boundary",
			)
			const observed = watcher.observedEvents.length
			await writeFile(join(root, "nested", "after.txt"), "after")
			await watcher.waitForObserved(
				(events) =>
					events
						.slice(observed)
						.some((event) => event.lexicalPaths.includes(join(root, "nested", "after.txt"))),
				"broad subscription to observe nested event",
			)
			assertCondition(
				!pathsIn(watcher.snapshot()).has("nested/after.txt"),
				"nested event injected membership",
			)
		} finally {
			await watcher.close()
		}
	})
}

const runSymlinkCorrectness = async (): Promise<void> => {
	await withTempDirectory("symlink", async (container) => {
		const physicalRoot = join(container, "physical")
		const lexicalRoot = join(container, "lexical")
		const external = join(container, "external")
		await Promise.all([mkdir(physicalRoot), mkdir(external)])
		await Promise.all([
			writeFile(join(physicalRoot, "root.txt"), "root"),
			writeFile(join(external, "outside.txt"), "outside"),
		])
		await symlink(physicalRoot, lexicalRoot, "dir")
		await symlink(external, join(physicalRoot, "nested-link"), "dir")

		const disabled = new ParcelPolicyWatcher(lexicalRoot, { policy: defaultParcelPolicy() })
		await disabled.start()
		try {
			assertCondition(
				disabled.snapshot().find((file) => file.relativePath === "root.txt")?.absolutePath ===
					join(lexicalRoot, "root.txt"),
				"lexical symlink root identity was lost",
			)
			assertCondition(
				!pathsIn(disabled.snapshot()).has("nested-link/outside.txt"),
				"nested symlink followed while disabled",
			)
		} finally {
			await disabled.close()
		}

		await symlink(physicalRoot, join(external, "cycle"), "dir")
		const followed = new ParcelPolicyWatcher(lexicalRoot, {
			policy: defaultParcelPolicy({ followSymlinks: true }),
		})
		await followed.start()
		try {
			assertCondition(
				followed.physicalSubscriptionCount === 2,
				"external target did not receive a separate subscription",
			)
			assertCondition(
				pathsIn(followed.snapshot()).has("nested-link/outside.txt"),
				"external target was not scanned",
			)
			assertCondition(
				!followed.snapshot().some((file) => file.relativePath.includes("cycle/")),
				"symlink cycle was traversed",
			)
			const start = followed.publications.length
			await writeFile(join(external, "new.txt"), "new")
			await waitForPublication(followed, start, "added", "nested-link/new.txt")
			assertCondition(
				followed.observedEvents.some((event) =>
					event.lexicalPaths.includes(join(lexicalRoot, "nested-link", "new.txt")),
				),
				"external physical event was not mapped to the lexical path",
			)
		} finally {
			await followed.close()
		}
	})
}

export const runParcelPeriodicRecoveryProof = async (): Promise<
	ParcelCorrectnessReport["periodicRecovery"]
> =>
	withTempDirectory("periodic", async (root) => {
		const intervalMs = 100
		const watcher = new ParcelPolicyWatcher(root, {
			policy: defaultParcelPolicy(),
			periodicReconcileMs: intervalMs,
		})
		await watcher.start()
		try {
			watcher.setDropParcelEvents(true)
			const startedAt = performance.now()
			await writeFile(join(root, "dropped.txt"), "dropped")
			await watcher.waitFor(
				(files) => pathsIn(files).has("dropped.txt"),
				"periodic dropped-event recovery",
			)
			return {
				enabled: true,
				intervalMs,
				recoveredPath: "dropped.txt",
				recoveryMs: elapsedMs(startedAt),
			}
		} finally {
			await watcher.close()
		}
	})

export const runParcelCallbackErrorProof = async (): Promise<void> => {
	await withTempDirectory("callback-error", async (root) => {
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
		await watcher.start()
		try {
			watcher.injectCallbackError(new Error("simulated Parcel callback failure"))
			let surfaced = false
			try {
				await watcher.waitFor(() => false, "callback error", 250)
			} catch (error) {
				surfaced = error instanceof Error && error.message === "simulated Parcel callback failure"
			}
			assertCondition(surfaced, "Parcel callback error was not surfaced")
		} finally {
			await watcher.close()
		}
	})
}

export const runParcelCorrectness = async (): Promise<ParcelCorrectnessReport> => {
	const startedAt = performance.now()
	const recursive = await runRecursiveCorrectness()
	await runNonrecursiveCorrectness()
	await runParcelHandoffBarrierProof()
	await runParcelReplacementBarrierProof()
	await runSymlinkCorrectness()
	await runParcelCallbackErrorProof()
	const periodicRecovery = await runParcelPeriodicRecoveryProof()
	return {
		command: "correctness",
		runtime: runtimeIdentity(),
		dependency: { parcelWatcher: PARCEL_VERSION },
		durationMs: elapsedMs(startedAt),
		scenarios: [
			"scanner-only-membership-under-broad-events",
			"root-create-change-atomic-delete",
			"directory-immediate-child",
			"ignore-and-policy-both-directions",
			"deterministic-coalescing-unsubscribe-no-late-publication",
			"initial-handoff-barriers",
			"readiness-bearing-replacement-barriers",
			"nonrecursive-observed-not-published",
			"lexical-root-external-target-mapping-and-cycle",
			"callback-error",
			"periodic-authoritative-dropped-event-recovery",
		],
		observedExcludedEvents: recursive.observedExcludedEvents,
		publications: recursive.publications,
		replacementGenerations: recursive.replacementGenerations,
		periodicRecovery,
	}
}

export const runParcelRepeat = async (runs: number): Promise<ParcelRepeatReport> => {
	const startedAt = performance.now()
	const errors: string[] = []
	for (let run = 1; run <= runs; run++) {
		try {
			await runParcelCorrectness()
		} catch (error) {
			errors.push(`run ${run}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	return {
		command: "repeat",
		runtime: runtimeIdentity(),
		runs,
		passed: runs - errors.length,
		failed: errors.length,
		durationMs: elapsedMs(startedAt),
		errors,
	}
}

const percentileSummary = (
	values: readonly number[],
): { readonly p50: number; readonly p95: number; readonly max: number } => {
	const ordered = [...values].sort((left, right) => left - right)
	const at = (percentile: number): number =>
		ordered[
			Math.max(0, Math.min(ordered.length - 1, Math.ceil(ordered.length * percentile) - 1))
		] ?? 0
	return { p50: at(0.5), p95: at(0.95), max: ordered.at(-1) ?? 0 }
}

const seedBenchmark = async (root: string, options: ParcelBenchmarkOptions): Promise<void> => {
	const directories: string[] = []
	if (options.shape === "broad") {
		for (let index = 0; index < options.dirs; index++)
			directories.push(join(root, `dir-${index.toString().padStart(4, "0")}`))
	} else {
		const branches = Math.max(1, Math.ceil(options.dirs / 8))
		for (let branch = 0; branch < branches && directories.length < options.dirs; branch++) {
			let current = join(root, `branch-${branch.toString().padStart(4, "0")}`)
			for (let depth = 0; depth < 8 && directories.length < options.dirs; depth++) {
				directories.push(current)
				current = join(current, `level-${depth.toString().padStart(2, "0")}`)
			}
		}
	}
	for (const directory of directories) await mkdir(directory, { recursive: true })
	const ignored = directories
		.filter((_, index) => index % 10 === 0)
		.map((directory) => `${relative(root, directory).split(sep).join("/")}/`)
	await writeFile(join(root, ".gitignore"), `${ignored.join("\n")}\n`)
	const destinations = directories.length > 0 ? directories : [root]
	for (let start = 0; start < options.files; start += 100) {
		await Promise.all(
			Array.from({ length: Math.min(100, options.files - start) }, (_, offset) => {
				const index = start + offset
				return writeFile(
					join(
						destinations[index % destinations.length]!,
						`file-${index.toString().padStart(6, "0")}.txt`,
					),
					`seed:${index}\n`,
				)
			}),
		)
	}
	for (let index = 0; index < options.mutations; index++) {
		if (index % 4 === 0) continue
		const prefix = index % 4 === 1 ? "rewrite" : index % 4 === 2 ? "atomic" : "delete"
		await writeFile(join(root, `mutation-${prefix}-${index}.txt`), "aaaa")
	}
}

const runBenchmarkTrial = async (
	options: ParcelBenchmarkOptions,
	run: number,
): Promise<ParcelBenchmarkTrialResult> =>
	withTempDirectory("benchmark", async (root) => {
		await seedBenchmark(root, options)
		const firstScanStartedAt = performance.now()
		await scanTopology(root, defaultParcelPolicy())
		const firstScannerMs = elapsedMs(firstScanStartedAt)
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
		const rssBefore = process.memoryUsage.rss()
		let rssPeak = rssBefore
		const cpuBefore = process.cpuUsage()
		const metrics = await watcher.start()
		const latencies: number[] = []
		let unsubscribeMs = 0
		try {
			for (let index = 0; index < options.mutations; index++) {
				const mode = index % 4
				const prefix =
					mode === 0 ? "create" : mode === 1 ? "rewrite" : mode === 2 ? "atomic" : "delete"
				const path = `mutation-${prefix}-${index}.txt`
				const absolutePath = join(root, path)
				const publicationStart = watcher.publications.length
				const mutationStartedAt = performance.now()
				if (mode === 0) await writeFile(absolutePath, "aaaa")
				else if (mode === 1) await writeFile(absolutePath, "bbbb")
				else if (mode === 2) {
					await writeFile(join(root, `.replacement-${index}`), "bbbb")
					await rename(join(root, `.replacement-${index}`), absolutePath)
				} else await unlink(absolutePath)
				await waitForPublication(
					watcher,
					publicationStart,
					mode === 0 ? "added" : mode === 3 ? "removed" : "changed",
					path,
				)
				latencies.push(elapsedMs(mutationStartedAt))
				rssPeak = Math.max(rssPeak, process.memoryUsage.rss())
			}
		} finally {
			unsubscribeMs = await watcher.close()
		}
		const cpu = process.cpuUsage(cpuBefore)
		return {
			report: {
				run,
				firstScannerMs,
				mutationLatencyMs: percentileSummary(latencies),
				cpuUserMicros: cpu.user,
				cpuSystemMicros: cpu.system,
				rssPeakDeltaBytes: rssPeak - rssBefore,
				unsubscribeMs,
				noCrash: true,
				...metrics,
			},
			mutationLatencies: latencies,
		}
	})

export const runParcelBenchmark = async (
	options: ParcelBenchmarkOptions,
): Promise<ParcelBenchmarkReport> => {
	await runBenchmarkTrial({ ...options, mutations: Math.min(4, options.mutations) }, 0)
	const results: ParcelBenchmarkTrialResult[] = []
	for (let run = 1; run <= options.runs; run++) results.push(await runBenchmarkTrial(options, run))
	const trials = results.map((result) => result.report)
	const metric = (select: (trial: ParcelBenchmarkTrial) => number) =>
		percentileSummary(trials.map(select))
	return {
		command: "benchmark-cell",
		runtime: runtimeIdentity(),
		dependency: { parcelWatcher: PARCEL_VERSION },
		fixture: options,
		trials,
		summary: {
			scannerMs: metric((trial) => trial.scannerMs),
			subscribeMs: metric((trial) => trial.subscribeMs),
			totalReadinessMs: metric((trial) => trial.totalReadinessMs),
			mutationLatencyMs: percentileSummary(results.flatMap((result) => result.mutationLatencies)),
			rssPeakDeltaBytes: metric((trial) => trial.rssPeakDeltaBytes),
			cpuUserMicros: metric((trial) => trial.cpuUserMicros),
			cpuSystemMicros: metric((trial) => trial.cpuSystemMicros),
			unsubscribeMs: metric((trial) => trial.unsubscribeMs),
			physicalSubscriptionCount: {
				min: Math.min(...trials.map((trial) => trial.physicalSubscriptionCount)),
				max: Math.max(...trials.map((trial) => trial.physicalSubscriptionCount)),
			},
			noCrash: true,
		},
	}
}

export const runtimeIdentity = (): RuntimeIdentity => ({
	name: process.versions.bun === undefined ? "node" : "bun",
	version: process.versions.bun ?? process.versions.node,
	platform: process.platform,
	arch: process.arch,
	osRelease: release(),
})

export const runParcelStandaloneChild = async (): Promise<{
	readonly mutationObserved: true
	readonly physicalSubscriptions: number
}> =>
	withTempDirectory("standalone", async (root) => {
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
		await watcher.start()
		try {
			await writeFile(join(root, "standalone.txt"), "standalone")
			await watcher.waitFor((files) => pathsIn(files).has("standalone.txt"), "standalone mutation")
			return { mutationObserved: true, physicalSubscriptions: watcher.physicalSubscriptionCount }
		} finally {
			await watcher.close()
		}
	})

export const runParcelStartCloseChild = async (): Promise<{
	readonly started: true
	readonly closeMs: number
}> =>
	withTempDirectory("start-close", async (root) => {
		const watcher = new ParcelPolicyWatcher(root, { policy: defaultParcelPolicy() })
		await watcher.start()
		return { started: true, closeMs: await watcher.close() }
	})
