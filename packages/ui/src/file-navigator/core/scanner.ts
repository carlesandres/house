import { basename, extname, join, relative, resolve, sep } from "node:path"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import ignore, { type Ignore } from "ignore"
import type { DiscoveryPolicy, FileRecord, ScanOptions, ScanResult } from "./types.ts"

interface IgnoreLevel {
	readonly directory: string
	readonly matcher: Ignore
}
interface Topology {
	readonly files: Map<string, FileRecord>
	readonly directories: Map<string, Set<string>>
}

const slash = (value: string): string => value.split(sep).join("/")
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)
const missing = (error: unknown): boolean =>
	typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const inside = (root: string, path: string): boolean => {
	const candidate = relative(root, path)
	return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== "..")
}

const frozenRecord = (
	path: string,
	root: string,
	metadata: { readonly size: number; readonly mtimeMs: number },
): FileRecord =>
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

export const scanFiles = async (
	input: string,
	policyInput: DiscoveryPolicy,
	options: ScanOptions = {},
): Promise<ScanResult> => {
	const root = normalizeRoot(input)
	const rootStat = await stat(root)
	if (!rootStat.isDirectory()) throw new Error(`root is not a directory: ${root}`)
	const policy = {
		recursive: policyInput.recursive ?? true,
		followSymlinks: policyInput.followSymlinks ?? false,
		ignoreFiles: policyInput.ignoreFiles ?? [],
		includeFile: policyInput.includeFile ?? (() => true),
		includeDirectory: policyInput.includeDirectory ?? (() => true),
	}
	const physicalRoot = await realpath(root)
	const topology: Topology = { files: new Map(), directories: new Map() }
	const metadata =
		options.metadata ??
		(async (path: string) => {
			const value = await stat(path)
			return { size: value.size, mtimeMs: value.mtimeMs }
		})
	const batches: FileRecord[] = []
	const publish = async (complete: boolean, withdrawn = false): Promise<void> => {
		if (batches.length === 0 && !complete && !withdrawn) return
		const next = batches.splice(0, batches.length)
		await options.onBatch?.(Object.freeze(next), complete, withdrawn)
	}
	const record = async (
		path: string,
		lexical: string,
		isFile: boolean,
		levels: readonly IgnoreLevel[],
	): Promise<FileRecord | null> => {
		abort(options.signal)
		if (ignored(lexical, false, levels)) return null
		if (!(await (isFile ? policy.includeFile(lexical) : policy.includeDirectory(lexical))))
			return null
		if (!isFile) return null
		const next = frozenRecord(lexical, root, await metadata(path))
		return inside(root, next.absolutePath) ? next : null
	}
	const add = async (next: FileRecord | null): Promise<void> => {
		if (!next) return
		topology.files.set(next.relativePath, next)
		batches.push(next)
		if (batches.length >= (options.batchSize ?? 64)) await publish(false)
	}
	const eligible: { path: string; lexical: string }[] = []
	const flushEligible = async (): Promise<void> => {
		const records = await Promise.all(
			eligible.splice(0).map(async ({ path, lexical }) => {
				const next = frozenRecord(lexical, root, await metadata(path))
				return inside(root, next.absolutePath) ? next : null
			}),
		)
		for (const next of records) await add(next)
	}
	const walk = async (
		physical: string,
		lexical: string,
		ancestry: ReadonlySet<string>,
		parents: readonly IgnoreLevel[],
		isRoot = false,
	): Promise<void> => {
		abort(options.signal)
		if (!isRoot && !(await policy.includeDirectory(lexical))) return
		topology.directories.set(
			physical,
			new Set([...(topology.directories.get(physical) ?? []), lexical]),
		)
		const levels = await loadLevels(physical, lexical, policy.ignoreFiles, parents)
		await options.barrier?.("before-read", lexical)
		const entries = (await readdir(physical, { withFileTypes: true })).sort((a, b) =>
			compare(a.name, b.name),
		)
		await options.barrier?.("after-read", lexical)
		const files = [] as typeof entries
		const directories = [] as typeof entries
		for (const entry of entries) {
			;(entry.isDirectory() || entry.isSymbolicLink() ? directories : files).push(entry)
		}
		for (const entry of files) {
			if (options.topologyOnly) continue
			const path = join(physical, entry.name)
			const lexicalPath = join(lexical, entry.name)
			try {
				if (
					!policy.ignoreFiles.includes(entry.name) &&
					!ignored(lexicalPath, false, levels) &&
					(await policy.includeFile(lexicalPath))
				)
					eligible.push({ path, lexical: lexicalPath })
			} catch (error) {
				await flushEligible()
				throw error
			}
			if (eligible.length < (options.batchSize ?? 64)) continue
			await flushEligible()
		}
		if (!policy.recursive) return
		for (const entry of directories) {
			abort(options.signal)
			if (policy.ignoreFiles.includes(entry.name)) continue
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
						await walk(target, lexicalPath, new Set([...ancestry, target]), levels)
					} catch (error) {
						if (missing(error)) continue
						options.onDiagnostic?.(new Error(`skipped directory: ${basename(lexicalPath)}`))
					}
				} else if (targetStat.isFile() && !entry.isDirectory()) {
					if (!options.topologyOnly) await add(await record(target, lexicalPath, true, levels))
				}
			} catch (error) {
				if (missing(error)) continue
				options.onDiagnostic?.(new Error(`skipped directory: ${basename(lexicalPath)}`))
			}
		}
	}
	try {
		if (await policy.includeDirectory(root))
			await walk(physicalRoot, root, new Set([physicalRoot]), [], true)
		await flushEligible()
		await publish(true)
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
