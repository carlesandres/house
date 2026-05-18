import { readdir, readFile } from "node:fs/promises"
import { extname, join, relative, resolve } from "node:path"
import { Data, Effect, Stream } from "effect"
import ignore, { type Ignore } from "ignore"

export interface FileEntry {
	/** Absolute path on disk. */
	readonly path: string
	/** Path relative to the discovery root, with forward slashes. */
	readonly relativePath: string
	/** File basename. */
	readonly name: string
}

export type SortOrder = "dirs-first" | "files-first"

export interface WalkOptions {
	/** Include hidden files and gitignored entries. Hard skips still apply. */
	readonly all?: boolean
	/** Group order within each directory. Default `dirs-first`. */
	readonly sort?: SortOrder
}

export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
	readonly root: string
	readonly cause: unknown
}> {}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"])
const HARD_SKIP_DIRS = new Set(["node_modules", ".git", ".venv"])

interface IgnoreLevel {
	readonly dir: string
	readonly ig: Ignore
}

const isIgnored = (
	entryPath: string,
	isDirectory: boolean,
	levels: readonly IgnoreLevel[],
): boolean => {
	for (const { dir, ig } of levels) {
		const rel = relative(dir, entryPath)
		if (!rel || rel.startsWith("..")) continue
		const candidate = isDirectory ? `${rel}/` : rel
		if (ig.ignores(candidate)) return true
	}
	return false
}

const tryLoadGitignore = async (dir: string): Promise<Ignore | null> => {
	try {
		const content = await readFile(join(dir, ".gitignore"), "utf8")
		return ignore().add(content)
	} catch {
		return null
	}
}

const sortEntries = <T extends { name: string; isDirectory: () => boolean }>(
	entries: readonly T[],
	order: SortOrder,
): T[] =>
	[...entries].sort((a, b) => {
		const aDir = a.isDirectory()
		const bDir = b.isDirectory()
		if (aDir !== bDir) {
			if (order === "files-first") return aDir ? 1 : -1
			return aDir ? -1 : 1
		}
		return a.name.localeCompare(b.name)
	})

/**
 * DFS generator. Yields each markdown FileEntry as it is discovered, before
 * descending further. Per-directory sort still happens before yielding so
 * arrival order within a directory matches the configured sort.
 *
 * Cancellation: `signal.aborted` is checked between syscalls. Node's
 * `readdir` doesn't accept an AbortSignal, so a single in-flight `readdir`
 * on a slow filesystem still runs to completion before we notice — the
 * generator only exits at the next checkpoint.
 */
async function* walkDirGen(
	dirPath: string,
	rootPath: string,
	parentLevels: readonly IgnoreLevel[],
	opts: { all: boolean; sort: SortOrder },
	signal: AbortSignal,
): AsyncGenerator<FileEntry, void, void> {
	if (signal.aborted) return

	let levels = parentLevels
	if (!opts.all) {
		const ig = await tryLoadGitignore(dirPath)
		if (signal.aborted) return
		if (ig) levels = [...parentLevels, { dir: dirPath, ig }]
	}

	const raw = await readdir(dirPath, { withFileTypes: true })
	if (signal.aborted) return

	for (const entry of sortEntries(raw, opts.sort)) {
		if (signal.aborted) return

		// Never follow symlinks — cycle hazard, and a markdown reader doesn't
		// need them. May be relaxed (files only) in a later iteration.
		if (entry.isSymbolicLink()) continue

		const entryPath = join(dirPath, entry.name)

		if (entry.isDirectory()) {
			if (HARD_SKIP_DIRS.has(entry.name)) continue
			if (!opts.all && entry.name.startsWith(".")) continue
			if (!opts.all && isIgnored(entryPath, true, levels)) continue
			yield* walkDirGen(entryPath, rootPath, levels, opts, signal)
			continue
		}

		if (!entry.isFile()) continue
		if (!opts.all && entry.name.startsWith(".")) continue
		if (!MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
		if (!opts.all && isIgnored(entryPath, false, levels)) continue

		yield {
			path: entryPath,
			relativePath: relative(rootPath, entryPath),
			name: entry.name,
		}
	}
}

/**
 * Stream markdown files under `root`. Entries arrive in DFS order respecting
 * the per-directory sort. The stream is interruptible at syscall boundaries:
 * the consumer's teardown trips an AbortController, and the generator exits
 * at its next `signal.aborted` check.
 *
 * Rules (see DESIGN.md §6):
 * - Extensions: `.md`, `.markdown`, `.mdx`.
 * - Hard skips (always): `node_modules`, `.git`, `.venv`.
 * - Hidden files/dirs (leading `.`) skipped unless `all: true`.
 * - `.gitignore` honored, including nested `.gitignore` files.
 * - Symlinks not followed.
 * - Sort: alphabetical within each group; directories before files
 *   (`dirs-first`, default) or files before directories (`files-first`).
 */
export const walk = (
	root: string,
	options: WalkOptions = {},
): Stream.Stream<FileEntry, DiscoveryError> => {
	const absRoot = resolve(root)
	const opts = {
		all: options.all ?? false,
		sort: options.sort ?? ("dirs-first" as SortOrder),
	}
	const controller = new AbortController()
	const iterable: AsyncIterable<FileEntry> = {
		[Symbol.asyncIterator]() {
			const gen = walkDirGen(absRoot, absRoot, [], opts, controller.signal)
			return {
				next: () => gen.next(),
				return: async (value?: void) => {
					controller.abort()
					return gen.return(value as void)
				},
			}
		},
	}
	return Stream.fromAsyncIterable(iterable, (cause) => new DiscoveryError({ root, cause }))
}

/**
 * Test/convenience helper: collect the full walk into an array. Mirrors the
 * pre-streaming `walk()` signature so call sites that don't need streaming
 * (notably tests) stay terse.
 */
export const walkToArray = (
	root: string,
	options: WalkOptions = {},
): Effect.Effect<readonly FileEntry[], DiscoveryError> =>
	Stream.runCollect(walk(root, options)).pipe(Effect.map((chunk) => Array.from(chunk)))
