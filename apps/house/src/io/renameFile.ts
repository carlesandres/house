/**
 * Basename rename of an Action Target. Re-verifies the target, refuses
 * overwrite of a different sibling, and performs a two-step rename for
 * case-only changes on case-insensitive volumes.
 *
 * ADR: Basename Rename via reused PromptModal
 * See: docs/adr/0003-rename-basename-prompt.md
 */

import { rename, readdir, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export type RenameFileResult =
	| { readonly ok: true; readonly from: string; readonly to: string; readonly noop?: true }
	| {
			readonly ok: false
			readonly reason: "target-missing" | "target-changed" | "already-exists" | "io"
			readonly message: string
	  }

export interface RenameFileRequest {
	readonly discoveryRoot: string
	readonly sourcePath: string
	readonly parentDir: string
	readonly newBasename: string
}

const isPathInsideRoot = (root: string, absolutePath: string): boolean => {
	const resolvedRoot = resolve(root)
	const resolvedPath = resolve(absolutePath)
	const rel = relative(resolvedRoot, resolvedPath)
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

const uniqueTempBasename = async (
	entries: readonly string[],
	finalBasename: string,
): Promise<string> => {
	const stem = finalBasename.endsWith(".md") ? finalBasename.slice(0, -3) : finalBasename
	const lower = new Set(entries.map((e) => e.toLowerCase()))
	for (let i = 0; i < 1000; i++) {
		const candidate = `${stem}.house-rename-${process.pid}-${Date.now()}-${i}.tmp`
		if (!lower.has(candidate.toLowerCase())) return candidate
	}
	throw new Error("could not allocate a temporary rename name")
}

export const renameMarkdownFile = async (request: RenameFileRequest): Promise<RenameFileResult> => {
	const discoveryRoot = resolve(request.discoveryRoot)
	const sourcePath = resolve(request.sourcePath)
	const parentDir = resolve(request.parentDir)
	const newBasename = request.newBasename
	const destPath = join(parentDir, newBasename)
	const sourceBasename = basename(sourcePath)

	if (sourceBasename === newBasename && dirname(sourcePath) === parentDir) {
		return { ok: true, from: sourcePath, to: destPath, noop: true }
	}

	let sourceStat
	try {
		sourceStat = await stat(sourcePath)
	} catch {
		return { ok: false, reason: "target-missing", message: "target missing" }
	}
	if (!sourceStat.isFile()) {
		return { ok: false, reason: "target-changed", message: "target changed" }
	}
	if (!isPathInsideRoot(discoveryRoot, sourcePath)) {
		return { ok: false, reason: "target-changed", message: "target changed" }
	}
	if (dirname(sourcePath) !== parentDir) {
		return { ok: false, reason: "target-changed", message: "target changed" }
	}

	let entries: string[]
	try {
		entries = await readdir(parentDir)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, reason: "io", message: `rename failed: ${message}` }
	}

	if (!entries.includes(sourceBasename)) {
		return { ok: false, reason: "target-changed", message: "target changed" }
	}

	const exactDest = entries.includes(newBasename)
	const caseFoldDest = entries.find((e) => e.toLowerCase() === newBasename.toLowerCase())
	const caseOnly =
		sourceBasename.toLowerCase() === newBasename.toLowerCase() && sourceBasename !== newBasename

	// Exact or case-folded collision with a *different* sibling — never overwrite.
	if (exactDest || (caseFoldDest !== undefined && caseFoldDest !== sourceBasename)) {
		return { ok: false, reason: "already-exists", message: "already exists" }
	}

	try {
		if (caseOnly) {
			const tempBasename = await uniqueTempBasename(entries, newBasename)
			const tempPath = join(parentDir, tempBasename)
			await rename(sourcePath, tempPath)
			try {
				await rename(tempPath, destPath)
			} catch (err) {
				try {
					await rename(tempPath, sourcePath)
				} catch {
					// Best-effort restore; surface the original failure.
				}
				throw err
			}
		} else {
			await rename(sourcePath, destPath)
		}
		return { ok: true, from: sourcePath, to: destPath }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, reason: "io", message: `rename failed: ${message}` }
	}
}
