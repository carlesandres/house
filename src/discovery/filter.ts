/**
 * Fuzzy filter for the sidebar.
 *
 * Matching stays intentionally small and pure: case-insensitive subsequence on
 * the filename and full relative path. Ranking prefers what users usually mean
 * in a sidebar:
 *   - filename matches above folder-only matches
 *   - files in the current folder above equally good nested matches
 *   - shallower paths above deeper ones as a soft tie-break
 *
 * Empty query preserves discovery/tree order.
 */

import type { FileEntry } from "./walk.ts"

export const fuzzyScore = (query: string, target: string): number | null => {
	if (query.length === 0) return 0
	const q = query.toLowerCase()
	const t = target.toLowerCase()
	let qi = 0
	let score = 0
	let lastMatch = -2
	for (let i = 0; i < t.length && qi < q.length; i++) {
		if (t[i] !== q[qi]) continue
		const isWordStart = i === 0 || t[i - 1] === "/"
		score += isWordStart ? 10 : 1
		if (lastMatch === i - 1) score += 5
		lastMatch = i
		qi++
	}
	if (qi < q.length) return null
	return score
}

const splitPath = (relativePath: string): { fileName: string; depth: number } => {
	const slash = relativePath.lastIndexOf("/")
	return {
		fileName: slash >= 0 ? relativePath.slice(slash + 1) : relativePath,
		depth: slash >= 0 ? relativePath.split("/").length - 1 : 0,
	}
}

const fileStem = (fileName: string): string => {
	const dot = fileName.lastIndexOf(".")
	return dot > 0 ? fileName.slice(0, dot) : fileName
}

const rankFile = (query: string, file: FileEntry): number | null => {
	const pathScore = fuzzyScore(query, file.relativePath)
	if (pathScore === null) return null

	const { fileName, depth } = splitPath(file.relativePath)
	const q = query.toLowerCase()
	const name = fileName.toLowerCase()
	const stem = fileStem(fileName).toLowerCase()
	const nameScore = fuzzyScore(query, fileName) ?? 0

	let score = pathScore * 10
	score += nameScore * 100

	if (name === q || stem === q) score += 5_000
	else if (name.startsWith(q) || stem.startsWith(q)) score += 2_000
	else if (name.includes(q)) score += 1_000

	if (depth === 0) score += 300
	score -= depth * 10

	return score
}

/**
 * Filter and re-rank a file list by a query. Empty query returns the input
 * unchanged (preserves the discovery sort order). Non-empty query keeps
 * matches only, sorted by score desc; ties fall back to the input order so
 * the discovery sort still leaks through.
 */
export const filterFiles = (files: readonly FileEntry[], query: string): readonly FileEntry[] => {
	if (query.length === 0) return files
	const scored: { file: FileEntry; score: number; index: number }[] = []
	for (let i = 0; i < files.length; i++) {
		const file = files[i]!
		const score = rankFile(query, file)
		if (score === null) continue
		scored.push({ file, score, index: i })
	}
	scored.sort((a, b) => b.score - a.score || a.index - b.index)
	return scored.map((s) => s.file)
}
