import { basename, extname, join, relative, resolve, sep } from "node:path"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import ignore, { type Ignore } from "ignore"
import type { DiscoveryPolicy, FileMetadata, FileRecord, ScanOptions, ScanResult } from "./types.ts"

interface IgnoreLevel {
	readonly directory: string
	readonly matcher: Ignore
}
interface Topology {
	readonly files: Map<string, FileRecord>
	readonly directories: Map<string, Set<string>>
}

const DEFAULT_BATCH_SIZE = 64
const slash = (value: string): string => value.split(sep).join("/")
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)
const missing = (error: unknown): boolean =>
	typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const inside = (root: string, path: string): boolean => {
	const candidate = relative(root, path)
	return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== "..")
}
const thenable = <T>(value: T | Promise<T>): value is Promise<T> =>
	typeof value === "object" && value !== null && typeof (value as Promise<T>).then === "function"
const readStat = async (path: string): Promise<FileMetadata> => {
	const value = await stat(path)
	return { size: value.size, mtimeMs: value.mtimeMs }
}

const frozenRecord = (path: string, root: string, metadata: FileMetadata): FileRecord =>
	Object.freeze({
		absolutePath: path,
		relativePath: slash(relative(root, path)),
		basename: basename(path),
		extension: extname(path).toLowerCase(),
		size: metadata.size,
		mtimeMs: metadata.mtimeMs,
	})

const ignored = (path: string, directory: boolean, levels: readonly IgnoreLevel[]): boolean => {
	let result = false
	for (const level of levels) {
		const candidate = slash(relative(level.directory, path))
		if (!candidate || candidate === ".." || candidate.startsWith("../")) continue
		const match = level.matcher.test(directory ? `${candidate}/` : candidate)
		if (match.ignored) result = true
		if (match.unignored) result = false
	}
	return result
}

const loadLevels = async (
	physical: string,
	lexical: string,
	ignoreFiles: readonly string[],
	parent: readonly IgnoreLevel[],
): Promise<readonly IgnoreLevel[]> => {
	let levels = parent
	for (const filename of ignoreFiles) {
		try {
			levels = [
				...levels,
				{
					directory: lexical,
					matcher: ignore().add(await readFile(join(physical, filename), "utf8")),
				},
			]
		} catch (error) {
			if (!missing(error)) throw error
		}
	}
	return levels
}

const abort = (signal?: AbortSignal): void => {
	if (signal?.aborted) throw new DOMException("scan aborted", "AbortError")
}

export const normalizeRoot = (input: string): string => resolve(input)

export const physicalWatchRoot = async (input: string): Promise<string> => {
	const root = normalizeRoot(input)
	const rootStat = await stat(root)
	if (!rootStat.isDirectory()) throw new Error(`root is not a directory: ${root}`)
	return realpath(root)
}

export const scanFiles = async (
	input: string,
	policyInput: DiscoveryPolicy,
	options: ScanOptions = {},
): Promise<ScanResult> => {
	const root = normalizeRoot(input)
	const policy = {
		recursive: policyInput.recursive ?? true,
		followSymlinks: policyInput.followSymlinks ?? false,
		ignoreFiles: policyInput.ignoreFiles ?? [],
		includeFile: policyInput.includeFile ?? (() => true),
		includeDirectory: policyInput.includeDirectory ?? (() => true),
	}
	const controlFiles = new Set(policy.ignoreFiles)
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
	const physicalRoot = await physicalWatchRoot(input)
	const topology: Topology = { files: new Map(), directories: new Map() }
	const extraRoots: string[] = []
	const metadata = options.metadata ?? readStat
	const batches: FileRecord[] = []
	const publish = (complete: boolean, withdrawn = false): void | Promise<void> => {
		if (batches.length === 0 && !complete && !withdrawn) return
		const next = batches.splice(0, batches.length)
		return options.onBatch?.(Object.freeze(next), complete, withdrawn)
	}
	const record = async (
		path: string,
		lexical: string,
		isFile: boolean,
		levels: readonly IgnoreLevel[],
	): Promise<FileRecord | null> => {
		abort(options.signal)
		if (ignored(lexical, false, levels)) return null
		const allowed = (isFile ? policy.includeFile : policy.includeDirectory)(lexical)
		if (thenable(allowed) ? !(await allowed) : !allowed) return null
		if (!isFile) return null
		const value = metadata(path)
		const next = frozenRecord(lexical, root, thenable(value) ? await value : value)
		return inside(root, next.absolutePath) ? next : null
	}
	const add = (next: FileRecord | null): void | Promise<void> => {
		if (!next) return
		topology.files.set(next.relativePath, next)
		batches.push(next)
		if (batches.length >= batchSize) return publish(false)
	}
	const eligible: { path: string; lexical: string }[] = []
	const flushEligible = async (): Promise<void> => {
		const pending = eligible.splice(0)
		if (pending.length === 0) return
		const records: (FileRecord | null)[] = Array.from({ length: pending.length }, () => null)
		const pendingMetadata: Promise<void>[] = []
		for (let index = 0; index < pending.length; index++) {
			const { path, lexical } = pending[index]!
			const apply = (value: FileMetadata): void => {
				const next = frozenRecord(lexical, root, value)
				records[index] = inside(root, next.absolutePath) ? next : null
			}
			const value = metadata(path)
			if (thenable(value)) pendingMetadata.push(value.then(apply))
			else apply(value)
		}
		if (pendingMetadata.length) await Promise.all(pendingMetadata)
		for (const next of records) {
			const value = add(next)
			if (thenable(value)) await value
		}
	}
	const watchExternal = async (target: string): Promise<void> => {
		if (inside(physicalRoot, target) || extraRoots.some((path) => inside(path, target))) return
		extraRoots.push(target)
		const notified = options.onWatchRoot?.(target)
		if (thenable(notified)) await notified
	}
	const walk = async (
		physical: string,
		lexical: string,
		ancestry: Set<string>,
		parents: readonly IgnoreLevel[],
		isRoot = false,
	): Promise<void> => {
		abort(options.signal)
		if (!isRoot) {
			const allowed = policy.includeDirectory(lexical)
			if (thenable(allowed) ? !(await allowed) : !allowed) return
		}
		topology.directories.set(
			physical,
			new Set([...(topology.directories.get(physical) ?? []), lexical]),
		)
		const beforeRead = options.barrier?.("before-read", lexical)
		if (thenable(beforeRead)) await beforeRead
		const entries = (await readdir(physical, { withFileTypes: true })).sort((a, b) =>
			compare(a.name, b.name),
		)
		const afterRead = options.barrier?.("after-read", lexical)
		if (thenable(afterRead)) await afterRead
		const present = new Set<string>()
		const files = [] as typeof entries
		const directories = [] as typeof entries
		for (const entry of entries) {
			present.add(entry.name)
			;(entry.isDirectory() || entry.isSymbolicLink() ? directories : files).push(entry)
		}
		const levels = await loadLevels(
			physical,
			lexical,
			policy.ignoreFiles.filter((filename) => present.has(filename)),
			parents,
		)
		for (const entry of files) {
			if (options.topologyOnly) continue
			const path = join(physical, entry.name)
			const lexicalPath = join(lexical, entry.name)
			try {
				if (controlFiles.has(entry.name) || ignored(lexicalPath, false, levels)) continue
				const allowed = policy.includeFile(lexicalPath)
				if (thenable(allowed) ? await allowed : allowed)
					eligible.push({ path, lexical: lexicalPath })
			} catch (error) {
				await flushEligible()
				throw error
			}
			if (eligible.length < batchSize) continue
			await flushEligible()
		}
		if (!policy.recursive) return
		for (const entry of directories) {
			abort(options.signal)
			if (controlFiles.has(entry.name)) continue
			const physicalPath = join(physical, entry.name)
			const lexicalPath = join(lexical, entry.name)
			try {
				if (entry.isSymbolicLink() && !policy.followSymlinks) continue
				const target = entry.isSymbolicLink() ? await realpath(physicalPath) : physicalPath
				const targetStat = await stat(target)
				if (targetStat.isDirectory()) {
					if (ignored(lexicalPath, true, levels) || ancestry.has(target)) continue
					if ((targetStat.mode & 0o777) === 0) {
						options.onDiagnostic?.(new Error(`skipped directory: ${basename(lexicalPath)}`))
						continue
					}
					try {
						if (entry.isSymbolicLink()) await watchExternal(target)
						ancestry.add(target)
						try {
							await walk(target, lexicalPath, ancestry, levels)
						} finally {
							ancestry.delete(target)
						}
					} catch (error) {
						if (missing(error)) continue
						options.onDiagnostic?.(new Error(`skipped directory: ${basename(lexicalPath)}`))
					}
				} else if (targetStat.isFile() && !entry.isDirectory()) {
					if (!options.topologyOnly) {
						const value = add(await record(target, lexicalPath, true, levels))
						if (thenable(value)) await value
					}
				}
			} catch (error) {
				if (missing(error)) continue
				options.onDiagnostic?.(new Error(`skipped directory: ${basename(lexicalPath)}`))
			}
		}
	}
	try {
		const includeRoot = policy.includeDirectory(root)
		if (thenable(includeRoot) ? await includeRoot : includeRoot)
			await walk(physicalRoot, root, new Set([physicalRoot]), [], true)
		await flushEligible()
		const complete = publish(true)
		if (thenable(complete)) await complete
	} catch (error) {
		if (batches.length) batches.splice(0, batches.length)
		throw error
	}
	return {
		root,
		files: Object.freeze(
			[...topology.files.values()].sort((a, b) => compare(a.relativePath, b.relativePath)),
		),
		watchDirectories: Object.freeze(
			[...topology.directories.entries()].map(([physicalPath, lexicalPaths]) => ({
				physicalPath,
				lexicalPaths: Object.freeze([...lexicalPaths].sort(compare)),
			})),
		),
		watchRoots: Object.freeze([
			physicalRoot,
			...[...topology.directories.keys()]
				.filter((path) => path !== physicalRoot && !inside(physicalRoot, path))
				.filter(
					(path, index, paths) => !paths.slice(0, index).some((parent) => inside(parent, path)),
				)
				.sort(compare),
		]),
	}
}
