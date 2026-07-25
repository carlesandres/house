/**
 * Fuzzy filter for the sidebar.
 *
 * Matching stays intentionally small and pure: case-insensitive subsequence on
 * the filename and full relative path. Ranking prefers what users usually mean
 * in a sidebar (no configuration, no user knobs):
 *   - filename matches above folder-only matches (zf/fzf-inspired strong bias)
 *   - shallower / current-folder paths win over deep nested ones
 *   - incidental matches purely from deep directory names are heavily demoted
 *     so "nested folders bubbling up" does not happen for typical queries
 *
 * Empty query preserves discovery/tree order.
 *
 * The low-level fuzzyScore uses a "best alignment" scan (try every possible
 * start position for the first query char, complete greedily, take the highest
 * scoring match). This avoids the "early spurious char traps" a pure left-to-right
 * greedy can hit on paths (e.g. "src/r.../readme" for query "readme" must prefer
 * the boundary "r" in the filename, not the "r" in "src"). This draws from fzf's
 * v1 "find occurrence then look for better" idea and the general principle that
 * boundary+consecutive bonuses should win when they exist later in the string.
 * We deliberately do not depend on fuzzysort/fuse/fzf here: the ranking *policy*
 * (heavy filename bias, exact/stem bonuses, depth soft penalty) is application
 * specific to "what makes a sidebar nice" and must be owned so end users get the
 * good experience with zero configuration or thought. See DESIGN.md §7.4 and the
 * filter tests.
 */

import type { FileEntry } from "./walk.ts"

export const fuzzyScore = (query: string, target: string): number | null => {
	if (query.length === 0) return 0
	const q = query.toLowerCase()
	const t = target.toLowerCase()
	if (q.length > t.length) return null

	let best: number | null = null

	// Best-alignment: try every viable start for q[0], then complete the rest
	// greedily from there. Take the alignment that accumulates the most bonus
	// points (word-start after /, consecutives). This is what gives good OOB
	// results on tree paths without the caller doing extra work.
	for (let start = 0; start < t.length; start++) {
		if (t[start] !== q[0]) continue

		let qi = 1
		let score = 0
		let lastMatch = start

		// score first char
		const isWordStart0 = start === 0 || t[start - 1] === "/"
		score += isWordStart0 ? 10 : 1

		let i = start + 1
		for (; i < t.length && qi < q.length; i++) {
			if (t[i] !== q[qi]) continue
			const isWordStart = i === 0 || t[i - 1] === "/"
			score += isWordStart ? 10 : 1
			if (lastMatch === i - 1) score += 5
			lastMatch = i
			qi++
		}

		if (qi === q.length) {
			if (best === null || score > best) best = score
		}
	}

	return best
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

	let score = pathScore * 4
	score += nameScore * 150

	// Filename (and stem) priority — the heart of good sidebar UX.
	// Users almost always mean "the file whose name contains this", not
	// "some directory component that happens to have these letters".
	if (name === q || stem === q) score += 5_000
	else if (name.startsWith(q) || stem.startsWith(q)) score += 2_000
	else if (name.includes(q)) score += 1_000

	// Strong depth bias so less-nested files appear near the top.
	// We want shallow files to win over deep "nested folders" even when
	// the deep file has a decent path match (common with short queries or
	// dir names). The penalty is now large enough to matter vs. the
	// match bonuses. Root gets a big kick. This is the main lever for
	// "position in the tree structure" without any user config.
	if (depth === 0) score += 800
	score -= depth * 120

	// Extra penalty when the match is weak or absent in the *basename*.
	// This aggressively demotes results where the hit is only because the
	// file lives under a matching deep directory ("nested folders bubbling up").
	if (nameScore == null || nameScore < 8) {
		score -= depth * 80
	}

	return score
}

/**
 * Filter and re-rank a file list by a query. Empty query returns the input
 * unchanged (preserves the discovery sort order). Non-empty query keeps
 * matches only, sorted by score desc; ties fall back to the input order so
 * the discovery sort still leaks through.
 *
 * All the "make this feel right for users exploring a tree" logic lives here
 * (and in rankFile) so callers (Browser) and end users never have to think
 * about or configure ranking.
 */
export const filterFiles = (files: readonly FileEntry[], query: string): readonly FileEntry[] => {
	if (query.length === 0) return files
	const scored: { file: FileEntry; score: number; depth: number; index: number }[] = []
	for (let i = 0; i < files.length; i++) {
		const file = files[i]!
		const score = rankFile(query, file)
		if (score === null) continue
		const depth = (file.relativePath.match(/\//g) || []).length
		scored.push({ file, score, depth, index: i })
	}
	// Primary: match quality (fuzzy + name bonuses - depth penalties already in score)
	// Secondary: shallower depth wins (less nested near top)
	// Tertiary: stable original discovery order
	scored.sort((a, b) => b.score - a.score || a.depth - b.depth || a.index - b.index)
	return scored.map((s) => s.file)
}
