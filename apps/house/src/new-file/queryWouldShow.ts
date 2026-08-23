/**
 * Same matching rule as `@house/ui`'s `fuzzySearch`: fuzzysort.single on a
 * lowercased query vs a lowercased relative path. Used to warn when creating
 * a Discovery-Root file that the current filter would hide.
 */

import { fuzzySearch } from "@house/ui/file-navigator"
import type { FileRecord } from "@house/ui/file-navigator"

export const queryWouldShowRelativePath = (query: string, relativePath: string): boolean => {
	if (query.length === 0) return true
	const file: FileRecord = {
		absolutePath: relativePath,
		relativePath,
		basename: relativePath,
		extension: ".md",
		size: 0,
		mtimeMs: 0,
	}
	return fuzzySearch.score(query, file) !== null
}
