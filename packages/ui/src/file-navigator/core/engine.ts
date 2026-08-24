import { platform } from "node:os"
import { relative, resolve } from "node:path"
import type {
	BrowseOrder,
	Diagnostic,
	DiscoveryPolicy,
	FileRecord,
	ParcelEvent,
	Publication,
	SearchStrategy,
	ScanOptions,
} from "./types.ts"
import { normalizeRoot, physicalWatchRoot, scanFiles } from "./scanner.ts"
import { fuzzySearch, projectFiles } from "./strategies.ts"
import type { InternalSubscription, InternalWatcher } from "./parcel-adapter.ts"

export interface NavigatorOptions {
	readonly root: string
	readonly policy: DiscoveryPolicy
	readonly watch?: boolean
	readonly order?: BrowseOrder
	readonly search?: SearchStrategy
	readonly consistencyIntervalMs?: number | null
	readonly batchSize?: number
	readonly metadata?: ScanOptions["metadata"]
	readonly barrier?: ScanOptions["barrier"]
	readonly onBatch?: ScanOptions["onBatch"]
	readonly onSnapshot?: (files: readonly FileRecord[]) => void
	readonly onPublication?: (publication: Publication) => void
	readonly onComplete?: () => void
	readonly onSelectedInvalidation?: (file: FileRecord, event?: ParcelEvent) => void
	readonly onSelectionChange?: (file: FileRecord | null) => void
	readonly onDiagnostic?: (diagnostic: Diagnostic) => void
	readonly initialSelectedPath?: string | null
}

interface Generation {
	readonly token: number
	readonly root: string
	readonly policy: DiscoveryPolicy
	readonly query: string
	readonly order: BrowseOrder
	readonly search: SearchStrategy
	readonly subscriptions: InternalSubscription[]
	readonly subscriptionPaths: Map<string, InternalSubscription>
	readonly subscriptionTasks: Set<Promise<void>>
	readonly subscribed: Set<string>
	readonly buffers: ParcelEvent[]
	readonly batches: { files: readonly FileRecord[]; complete: boolean }[]
	readonly streamed: FileRecord[]
	readonly events: ParcelEvent[]
	ready: boolean
	invalidated: boolean
	closed: boolean
	closePromise: Promise<void> | null
	watchDirectories: readonly { physicalPath: string; lexicalPaths: readonly string[] }[]
	watchRoots: readonly string[]
}

const STREAM_SNAPSHOT = 256
const errorValue = (value: unknown): Error =>
	value instanceof Error ? value : new Error(String(value))
const afterPaint = (value: void | Promise<void>): Promise<void> =>
	Promise.resolve(value).then(() => new Promise<void>((resolve) => setImmediate(resolve)))
const byPath = (files: readonly FileRecord[]): Map<string, FileRecord> =>
	new Map(files.map((file) => [file.relativePath, file]))
const publication = (
	previous: ReadonlyMap<string, FileRecord>,
	next: ReadonlyMap<string, FileRecord>,
): Publication => {
	const added: string[] = [],
		changed: string[] = [],
		removed: string[] = []
	for (const [path, file] of next) {
		const old = previous.get(path)
		if (!old) added.push(path)
		else if (old.size !== file.size || old.mtimeMs !== file.mtimeMs) changed.push(path)
	}
	for (const path of previous.keys()) if (!next.has(path)) removed.push(path)
	return { added: added.sort(), changed: changed.sort(), removed: removed.sort() }
}
const sameTopology = (
	left: Generation["watchDirectories"],
	right: Generation["watchDirectories"],
): boolean => JSON.stringify(left) === JSON.stringify(right)
const snapshotPolicy = (policy: DiscoveryPolicy): DiscoveryPolicy =>
	Object.freeze({
		...policy,
		ignoreFiles: Object.freeze([...(policy.ignoreFiles ?? [])]),
	})

export class FileNavigatorCore {
	#root: string
	#policy: DiscoveryPolicy
	#watch: boolean
	#order: BrowseOrder
	#search: SearchStrategy
	#files: readonly FileRecord[] = Object.freeze([])
	#projection: readonly FileRecord[] = Object.freeze([])
	#query = ""
	#selectedPath: string | null = null
	#selectionReady = false
	#generation = 0
	#active: Generation | null = null
	#candidate: Generation | null = null
	#watcher: InternalWatcher | undefined
	#consistencyInterval: number | null | undefined
	#refreshPromise: Promise<void> | null = null
	#closed = false
	#diagnosticSequence = 0
	#diagnostics: Diagnostic[] = []
	#timer: ReturnType<typeof setInterval> | null = null
	readonly #options: NavigatorOptions

	constructor(options: NavigatorOptions, watcher?: InternalWatcher) {
		this.#root = normalizeRoot(options.root)
		this.#policy = snapshotPolicy(options.policy)
		this.#watch = options.watch ?? true
		this.#order = options.order ?? "tree"
		this.#search = options.search ?? fuzzySearch
		this.#watcher = watcher
		this.#consistencyInterval = options.consistencyIntervalMs
		this.#options = options
		this.#selectedPath = options.initialSelectedPath ?? null
	}

	get files(): readonly FileRecord[] {
		return this.#files
	}
	get root(): string {
		return this.#root
	}
	get projection(): readonly FileRecord[] {
		return this.#projection
	}
	get selected(): FileRecord | null {
		return this.#files.find((file) => file.absolutePath === this.#selectedPath) ?? null
	}
	get selectedIndex(): number | null {
		const selected = this.#selectedPath
		if (selected === null) return null
		const index = this.#projection.findIndex((file) => file.absolutePath === selected)
		return index < 0 ? null : index
	}
	get diagnostics(): readonly Diagnostic[] {
		return Object.freeze([...this.#diagnostics])
	}
	get watching(): boolean {
		return this.#watch && this.#active?.ready === true
	}

	async start(): Promise<void> {
		if (this.#closed) throw new Error("navigator is closed")
		if (this.#watch) this.#requireWatcher()
		if (this.#watch) await this.#replaceGeneration(true)
		else {
			await this.#scanStatic(true)
			this.#restoreInitialSelection()
			this.#selectionReady = true
			this.#announceSelection()
		}
		this.#startConsistencyTimer()
	}

	setQuery(query: string): void {
		this.#query = query
		this.#reproject()
	}
	setOrder(order: BrowseOrder): void {
		this.#order = order
		this.#reproject()
	}
	setSearch(search: SearchStrategy): void {
		this.#search = search
		this.#reproject()
	}

	selectIndex(index: number): void {
		const next =
			this.#projection.length === 0
				? null
				: this.#projection[Math.max(0, Math.min(index, this.#projection.length - 1))]!.absolutePath
		this.#setSelected(next)
	}
	selectPath(path: string): void {
		if (this.#projection.some((file) => file.absolutePath === path)) this.#setSelected(path)
	}

	refresh(): Promise<void> {
		if (this.#refreshPromise) return this.#refreshPromise
		const generation = this.#active
		this.#refreshPromise = (
			generation ? this.#reconcile(generation) : this.#scanStatic(false)
		).finally(() => {
			this.#refreshPromise = null
		})
		return this.#refreshPromise
	}

	async updatePolicy(policy: DiscoveryPolicy): Promise<void> {
		if (policy.revision === this.#policy.revision && policy.recursive === this.#policy.recursive)
			return
		this.#policy = snapshotPolicy(policy)
		this.#selectionReady = false
		if (this.#watch) await this.#replaceGeneration(false)
		else {
			await this.#scanStatic(false)
			this.#selectionReady = true
			this.#announceSelection()
		}
	}

	async updateRoot(root: string): Promise<void> {
		const next = normalizeRoot(root)
		if (next === this.#root) return
		this.#root = next
		this.#selectedPath = null
		this.#selectionReady = false
		if (this.#watch) await this.#replaceGeneration(true)
		else {
			await this.#scanStatic(true)
			this.#selectionReady = true
			this.#announceSelection()
		}
	}

	async setWatch(watch: boolean, consistencyIntervalMs = this.#consistencyInterval): Promise<void> {
		const intervalChanged = consistencyIntervalMs !== this.#consistencyInterval
		if (this.#watch === watch && !intervalChanged) return
		if (watch) this.#requireWatcher()
		this.#selectionReady = false
		this.#watch = watch
		this.#consistencyInterval = consistencyIntervalMs
		this.#stopConsistencyTimer()
		if (watch) await this.#replaceGeneration(false)
		else {
			const old = this.#active
			const candidate = this.#invalidateCandidate()
			this.#active = null
			if (old) void this.#closeGeneration(old)
			if (candidate) await this.#closeGeneration(candidate)
		}
		this.#startConsistencyTimer(consistencyIntervalMs)
		if (!watch) {
			this.#selectionReady = true
			this.#announceSelection()
		}
	}

	async close(): Promise<void> {
		this.#closed = true
		this.#stopConsistencyTimer()
		const generation = this.#active
		const candidate = this.#candidate
		this.#active = null
		if (generation) await this.#closeGeneration(generation)
		if (candidate && candidate !== generation) await this.#closeGeneration(candidate)
	}

	async #scanStatic(initial: boolean): Promise<void> {
		const previous = byPath(this.#files)
		this.#clearPhase("scan")
		try {
			const streamed: FileRecord[] = []
			const result = await scanFiles(this.#root, this.#policy, {
				...(this.#options.batchSize === undefined ? {} : { batchSize: this.#options.batchSize }),
				...(this.#options.metadata === undefined ? {} : { metadata: this.#options.metadata }),
				...(this.#options.barrier === undefined ? {} : { barrier: this.#options.barrier }),
				onDiagnostic: (error) => this.#diagnose("scan", error),
				onBatch: async (files, complete) => {
					if (initial && !complete) {
						streamed.push(...files)
						this.#publishFiles(streamed, true)
					}
					await this.#options.onBatch?.(files, complete)
				},
			})
			this.#commit(result.files, previous, !initial)
			this.#options.onComplete?.()
		} catch (error) {
			if (initial) {
				await this.#options.onBatch?.([], true, true)
				this.#files = Object.freeze([])
				this.#projection = Object.freeze([])
				this.#selectedPath = null
				this.#options.onSnapshot?.(this.#files)
			}
			this.#diagnose("scan", error)
			throw error
		}
	}

	async #replaceGeneration(initial: boolean): Promise<void> {
		this.#selectionReady = false
		this.#clearPhase("scan")
		const old = this.#active
		const abandoned = this.#invalidateCandidate()
		if (abandoned) void this.#closeGeneration(abandoned)
		const token = ++this.#generation
		const generation: Generation = {
			token,
			root: this.#root,
			policy: this.#policy,
			query: this.#query,
			order: this.#order,
			search: this.#search,
			subscriptions: [],
			subscriptionPaths: new Map(),
			subscriptionTasks: new Set(),
			subscribed: new Set(),
			buffers: [],
			batches: [],
			streamed: [],
			events: [],
			ready: false,
			invalidated: false,
			closed: false,
			closePromise: null,
			watchDirectories: [],
			watchRoots: [],
		}
		this.#candidate = generation
		try {
			generation.watchRoots = Object.freeze([await physicalWatchRoot(generation.root)])
			await this.#subscribe(generation, generation.watchRoots)
			this.#clearPhase("scan")
			let topology: Generation["watchDirectories"] | null = null
			let finalFiles: readonly FileRecord[] = []
			for (;;) {
				generation.invalidated = false
				generation.batches.length = 0
				if (initial && generation.streamed.length) {
					generation.streamed.length = 0
					this.#publishFiles([], true)
				}
				const result = await scanFiles(generation.root, generation.policy, {
					...(initial && this.#options.batchSize !== undefined
						? { batchSize: this.#options.batchSize }
						: {}),
					...(this.#options.metadata === undefined ? {} : { metadata: this.#options.metadata }),
					...(this.#options.barrier === undefined ? {} : { barrier: this.#options.barrier }),
					onDiagnostic: (error) => this.#diagnose("scan", error),
					onWatchRoot: async (path) => {
						if (!this.#isCurrentCandidate(generation) || generation.subscribed.has(path)) return
						generation.watchRoots = Object.freeze(
							[...generation.watchRoots, path].sort((left, right) =>
								left < right ? -1 : left > right ? 1 : 0,
							),
						)
						await this.#subscribe(generation, generation.watchRoots)
					},
					onBatch: (files, complete) => {
						if (!(initial && this.#isCurrentCandidate(generation))) {
							generation.batches.push({ files: Object.freeze([...files]), complete })
							return
						}
						if (files.length) generation.streamed.push(...files)
						const count = generation.streamed.length
						const snapshot =
							files.length > 0 && (count === files.length || count % STREAM_SNAPSHOT < files.length)
						if (snapshot) this.#publishFiles(generation.streamed, true)
						const callback = this.#options.onBatch?.(files, complete)
						return snapshot ? afterPaint(callback) : callback
					},
				})
				finalFiles = result.files
				if (!this.#isCurrentCandidate(generation)) throw new Error("stale generation")
				if (
					generation.invalidated ||
					(topology !== null && !sameTopology(topology, result.watchDirectories))
				) {
					topology = result.watchDirectories
					generation.watchRoots = result.watchRoots
					await this.#subscribe(generation, generation.watchRoots)
					continue
				}
				generation.watchDirectories = result.watchDirectories
				generation.watchRoots = result.watchRoots
				break
			}
			if (!this.#isCurrentCandidate(generation)) throw new Error("stale generation")
			generation.ready = true
			this.#active = generation
			this.#candidate = null
			if (!this.#isCurrentGeneration(generation)) throw new Error("stale generation")
			this.#clearPhase("watch")
			this.#commit(
				finalFiles,
				byPath(this.#active === null ? [] : this.#files),
				!initial || Boolean(old),
				generation,
			)
			await this.#deliverBatches(generation)
			if (initial) this.#restoreInitialSelection()
			this.#options.onComplete?.()
			this.#selectionReady = true
			this.#announceSelection()
			if (old && old !== generation) void this.#closeGeneration(old)
		} catch (error) {
			const current = this.#isCurrentGeneration(generation)
			if (initial) {
				await this.#options.onBatch?.([], true, true)
				if (current && !this.#active) {
					this.#files = Object.freeze([])
					this.#projection = Object.freeze([])
					this.#selectedPath = null
					this.#options.onSnapshot?.(this.#files)
				}
			}
			if (this.#candidate === generation) this.#candidate = null
			await this.#closeGeneration(generation)
			if (current) this.#diagnose("watch", error)
			throw error
		}
	}

	async #subscribe(generation: Generation, watchRoots: readonly string[]): Promise<void> {
		const watcher = this.#requireWatcher()
		const roots = new Set(watchRoots)
		for (const [path, subscription] of generation.subscriptionPaths) {
			if (!roots.has(path)) {
				await subscription.unsubscribe()
				generation.subscriptionPaths.delete(path)
				generation.subscribed.delete(path)
			}
		}
		for (const path of roots) {
			if (generation.closed) return
			if (generation.subscribed.has(path)) continue
			const task = (async () => {
				const subscription = await watcher.subscribe(path, (error, events) => {
					this.#invalidate(generation, error, events)
				})
				if (generation.closed) await subscription.unsubscribe()
				else {
					generation.subscriptions.push(subscription)
					generation.subscriptionPaths.set(path, subscription)
					generation.subscribed.add(path)
				}
			})()
			generation.subscriptionTasks.add(task)
			await task.finally(() => generation.subscriptionTasks.delete(task))
		}
	}
	#requireWatcher(): InternalWatcher {
		if (!this.#watcher) {
			throw new Error("FileNavigatorCore requires an InternalWatcher when watch is enabled")
		}
		return this.#watcher
	}
	async #deliverBatches(generation: Generation): Promise<void> {
		for (const batch of generation.batches) {
			if (!this.#isCurrentGeneration(generation)) throw new Error("stale generation")
			await this.#options.onBatch?.(batch.files, batch.complete)
		}
		generation.batches.length = 0
	}

	async #reconcile(generation: Generation): Promise<void> {
		if (generation.closed || this.#active !== generation || this.#candidate) return
		generation.invalidated = false
		const previous = byPath(this.#files)
		try {
			const result = await scanFiles(this.#root, generation.policy, {
				...(this.#options.metadata === undefined ? {} : { metadata: this.#options.metadata }),
				...(this.#options.barrier === undefined ? {} : { barrier: this.#options.barrier }),
				onDiagnostic: (error) => this.#diagnose("scan", error),
			})
			if (generation.invalidated) {
				return this.#reconcile(generation)
			}
			if (!sameTopology(generation.watchDirectories, result.watchDirectories)) {
				return this.#replaceGeneration(false)
			}
			this.#commit(result.files, previous, true)
			this.#options.onComplete?.()
		} catch (error) {
			this.#diagnose("scan", error)
			throw error
		}
	}

	#invalidate(generation: Generation, error: Error | null, events: readonly ParcelEvent[]): void {
		if (
			this.#closed ||
			generation.closed ||
			(this.#active !== generation && this.#candidate !== generation)
		)
			return
		if (this.#candidate && this.#candidate !== generation) return
		if (error) {
			this.#diagnose("watch", error)
			return
		}
		generation.invalidated = true
		generation.events.push(...events)
		if (!generation.ready) {
			generation.buffers.push(...events)
			return
		}
		void this.refresh().catch(() => {})
	}

	#publishFiles(files: readonly FileRecord[], streaming: boolean): void {
		this.#files = Object.freeze(files.slice())
		if (streaming && this.#query === "" && this.#order === "tree") {
			this.#projection = this.#files
			this.#syncSelection()
		} else this.#reproject()
		if (streaming) this.#options.onSnapshot?.(this.#files)
	}
	#isCurrentCandidate(generation: Generation): boolean {
		return (
			!this.#closed &&
			!generation.closed &&
			this.#candidate === generation &&
			generation.token === this.#generation &&
			this.#watch &&
			this.#root === generation.root &&
			this.#policy.revision === generation.policy.revision
		)
	}
	#isCurrentGeneration(generation: Generation): boolean {
		return (
			this.#isCurrentCandidate(generation) ||
			(!this.#closed &&
				this.#active === generation &&
				this.#watch &&
				this.#root === generation.root &&
				this.#policy.revision === generation.policy.revision)
		)
	}
	#invalidateCandidate(): Generation | null {
		const candidate = this.#candidate
		if (!candidate) return null
		candidate.invalidated = true
		this.#candidate = null
		return candidate
	}
	#commit(
		files: readonly FileRecord[],
		previous: ReadonlyMap<string, FileRecord>,
		notify: boolean,
		generation: Generation | null = this.#active,
	): void {
		const next = Object.freeze([...files]),
			diff = publication(previous, byPath(next))
		this.#files = next
		this.#reproject()
		this.#options.onSnapshot?.(next)
		if (diff.added.length || diff.changed.length || diff.removed.length)
			this.#options.onPublication?.(diff)
		const selected = this.selected
		const event = generation?.events.find(
			(entry) => this.#eventRelative(entry.path, generation) === selected?.relativePath,
		)
		if (
			notify &&
			selected &&
			(event ||
				diff.added.includes(selected.relativePath) ||
				diff.changed.includes(selected.relativePath))
		)
			this.#options.onSelectedInvalidation?.(selected, event)
		if (generation) generation.events.length = 0
	}
	#eventRelative(path: string, generation: Generation | null = this.#active): string {
		if (path === this.#root) return ""
		if (path.startsWith(this.#root + "/")) return relative(this.#root, resolve(path))
		if (generation)
			for (const directory of generation.watchDirectories)
				for (const lexical of directory.lexicalPaths) {
					const suffix = relative(directory.physicalPath, path)
					if (suffix === "" || (!suffix.startsWith("..") && !suffix.startsWith("/")))
						return relative(this.#root, resolve(lexical, suffix))
				}
		return path
	}
	#reproject(): void {
		try {
			this.#projection = projectFiles(this.#files, this.#query, this.#order, this.#search)
			this.#clearPhase("projection")
		} catch (error) {
			this.#diagnose("projection", error)
			return
		}
		this.#syncSelection()
	}
	#syncSelection(): void {
		const previousSelection = this.#selectedPath
		if (
			!this.#selectedPath ||
			!this.#projection.some((file) => file.absolutePath === this.#selectedPath)
		)
			this.#selectedPath = this.#projection[0]?.absolutePath ?? null
		if (this.#selectionReady && this.#selectedPath !== previousSelection)
			this.#options.onSelectionChange?.(this.selected)
	}
	#setSelected(path: string | null): void {
		if (path === this.#selectedPath) return
		this.#selectedPath = path
		if (this.#selectionReady) this.#options.onSelectionChange?.(this.selected)
	}
	#announceSelection(): void {
		this.#options.onSelectionChange?.(this.selected)
	}
	#restoreInitialSelection(): void {
		const initial = this.#options.initialSelectedPath
		if (initial && this.#projection.some((file) => file.absolutePath === initial))
			this.#selectedPath = initial
	}
	async #closeGeneration(generation: Generation): Promise<void> {
		if (!generation.closePromise)
			generation.closePromise = (async () => {
				generation.closed = true
				await Promise.allSettled(generation.subscriptionTasks)
				await Promise.allSettled(
					[...generation.subscriptionPaths.values()].map((subscription) =>
						subscription.unsubscribe(),
					),
				)
			})()
		await generation.closePromise
	}
	#diagnose(phase: Diagnostic["phase"], value: unknown): void {
		const error = errorValue(value)
		if (
			this.#diagnostics.some(
				(entry) => entry.phase === phase && entry.error.message === error.message,
			)
		)
			return
		const diagnostic = { phase, sequence: ++this.#diagnosticSequence, error }
		this.#diagnostics = [...this.#diagnostics, diagnostic]
		this.#options.onDiagnostic?.(diagnostic)
	}
	#clearPhase(phase: Diagnostic["phase"]): void {
		this.#diagnostics = this.#diagnostics.filter((entry) => entry.phase !== phase)
	}
	#stopConsistencyTimer(): void {
		if (this.#timer) clearInterval(this.#timer)
		this.#timer = null
	}
	#startConsistencyTimer(
		interval = this.#consistencyInterval ?? (platform() === "linux" ? 60_000 : null),
	): void {
		if (!this.#watch || interval === null || interval <= 0) return
		this.#timer = setInterval(() => void this.refresh().catch(() => {}), interval)
	}
}
