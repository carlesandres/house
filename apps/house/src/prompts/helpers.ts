/**
 * Pure helpers shared by New file and Rename prompt flows in Browser.
 * React state, overlay dispatch, and membership waits stay in Browser.
 *
 * See docs/adr/0003-rename-basename-prompt.md.
 */

import { readdirSync } from "node:fs"
import { dirname } from "node:path"
import type { FileRecord } from "@house/ui/file-navigator"
import { queryWouldShowRelativePath } from "../new-file/queryWouldShow.ts"
import { resolveMarkdownBasename, type ResolveNameMode } from "../new-file/resolveName.ts"
import type { PromptStatus } from "../PromptModal.tsx"

export type PromptPurpose = "new-file" | "rename"

export interface ActionTarget {
	readonly absolutePath: string
	readonly parentDir: string
	readonly relativePath: string
	readonly basename: string
	/** Parent of `relativePath` using `/` separators; empty at discovery root. */
	readonly parentRelative: string
}

export const parentRelativeOf = (relativePath: string): string => {
	const idx = relativePath.lastIndexOf("/")
	return idx === -1 ? "" : relativePath.slice(0, idx)
}

export const destinationRelativePath = (parentRelative: string, newBasename: string): string =>
	parentRelative.length === 0 ? newBasename : `${parentRelative}/${newBasename}`

export const captureActionTarget = (file: FileRecord): ActionTarget => ({
	absolutePath: file.absolutePath,
	parentDir: dirname(file.absolutePath),
	relativePath: file.relativePath,
	basename: file.basename,
	parentRelative: parentRelativeOf(file.relativePath),
})

export const siblingExistsExact = (
	parentDir: string,
	name: string,
	exceptBasename?: string,
): boolean => {
	try {
		const entries = readdirSync(parentDir)
		return entries.includes(name) && name !== exceptBasename
	} catch {
		return false
	}
}

export const promptLiveStatus = (
	raw: string,
	mode: ResolveNameMode,
	query: string,
	matchRelativePath: string,
	destExists: boolean,
): PromptStatus | null => {
	const resolved = resolveMarkdownBasename(raw, mode)
	if (!resolved.ok) {
		if (resolved.error === "name required") return null
		return { kind: "error", lines: [resolved.error] }
	}
	const lines = [...resolved.warnings]
	if (query.length > 0 && !queryWouldShowRelativePath(query, matchRelativePath)) {
		lines.push(`filter will change to ${resolved.basename}`)
	}
	if (destExists) lines.push("already exists")
	if (lines.length === 0) return null
	return { kind: "warning", lines }
}

/** Retarget HTML preview only when it is serving the renamed Action Target. */
export const retargetPreviewIfNeeded = (
	preview: { currentTarget(): string; setTarget(path: string): void } | null | undefined,
	sourcePath: string,
	destPath: string,
): void => {
	if (preview?.currentTarget() === sourcePath) preview.setTarget(destPath)
}
