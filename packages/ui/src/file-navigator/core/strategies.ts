import fuzzysort from "fuzzysort"
import type { BrowseOrder, BrowseStrategy, FileRecord, SearchStrategy } from "./types.ts"

const pathCompare = (a: FileRecord, b: FileRecord): number =>
	a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0
const segmentCache = new WeakMap<FileRecord, readonly string[]>()
const segmentsOf = (file: FileRecord): readonly string[] => {
	const cached = segmentCache.get(file)
	if (cached) return cached
	const value = file.relativePath.split("/")
	segmentCache.set(file, value)
	return value
}
const treeCompare = (a: FileRecord, b: FileRecord): number => {
	const left = segmentsOf(a)
	const right = segmentsOf(b)
	const limit = Math.min(left.length, right.length)
	for (let index = 0; index < limit; index++) {
		if (left[index] === right[index]) continue
		const leftFile = index === left.length - 1
		const rightFile = index === right.length - 1
		if (leftFile !== rightFile) return leftFile ? -1 : 1
		return left[index]! < right[index]! ? -1 : 1
	}
	return left.length - right.length || pathCompare(a, b)
}

export const treeOrder: BrowseStrategy = Object.freeze({ id: "tree", compare: treeCompare })
export const recentlyModifiedOrder: BrowseStrategy = Object.freeze({
	id: "recently-modified",
	compare: (a: FileRecord, b: FileRecord) =>
		b.mtimeMs - a.mtimeMs || treeCompare(a, b) || pathCompare(a, b),
})
export const resolveBrowse = (order: BrowseOrder = "tree"): BrowseStrategy =>
	typeof order === "string" ? (order === "tree" ? treeOrder : recentlyModifiedOrder) : order
export const fuzzySearch: SearchStrategy = Object.freeze({
	id: "fuzzy",
	score: (query: string, file: FileRecord) => {
		const result = fuzzysort.single(query.toLowerCase(), file.relativePath.toLowerCase())
		return result === null ? null : result.score
	},
})

export const projectFiles = (
	files: readonly FileRecord[],
	query: string,
	order: BrowseOrder = "tree",
	search: SearchStrategy = fuzzySearch,
): readonly FileRecord[] => {
	const strategy = resolveBrowse(order)
	const compare = (a: FileRecord, b: FileRecord): number => {
		const value = strategy.compare(a, b)
		if (!Number.isFinite(value)) throw new Error("browse strategy returned a non-finite comparison")
		return value || pathCompare(a, b)
	}
	const browse = [...files].sort(compare)
	if (!query) return Object.freeze(browse)
	const scored = browse.flatMap((file, index) => {
		const score = search.score(query, file)
		return score === null ? [] : [{ file, score, index }]
	})
	scored.sort((a, b) => b.score - a.score || a.index - b.index || pathCompare(a.file, b.file))
	if (scored.some((entry) => !Number.isFinite(entry.score)))
		throw new Error("search strategy returned a non-finite score")
	return Object.freeze(scored.map((entry) => entry.file))
}
