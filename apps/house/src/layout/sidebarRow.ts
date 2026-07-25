/**
 * Sidebar row layout — basename-first with a dim parent suffix sized to the
 * available width.
 *
 * Pure per-row formatting: a row's rendered shape depends only on its own
 * path and the column budget — never on neighboring rows. That keeps the
 * sidebar stable as filters change and the file set grows, and keeps the
 * function trivially predictable. Disambiguation against same-basename
 * siblings is the header's job (it shows the full relative path of the
 * selected row); a future auto-scroll on the selected sidebar row can carry
 * the same information without altering layout for the rest.
 *
 * Truncation policy: the basename stays whole when possible; the parent path
 * middle-truncates into `a/…/z`-style output once it exceeds the remaining
 * width. This preserves both the start and the end of the path, which is
 * usually what users need to disambiguate nested docs.
 */

import { middleTruncate } from "../ui/middleTruncate.ts"

export const SIDEBAR_ROW_SEPARATOR = " "
const MIN_PARENT_BUDGET = 3

export interface SidebarRowParts {
	readonly basename: string
	readonly separator: string
	readonly parent: string
}

export const formatSidebarRow = (relativePath: string, totalWidth: number): SidebarRowParts => {
	const slash = relativePath.lastIndexOf("/")
	if (slash < 0) {
		return { basename: fitTail(relativePath, totalWidth), separator: "", parent: "" }
	}

	const basename = relativePath.slice(slash + 1)
	const parentFull = relativePath.slice(0, slash)

	if (basename.length >= totalWidth) {
		return { basename: fitTail(basename, totalWidth), separator: "", parent: "" }
	}

	const remaining = totalWidth - basename.length - SIDEBAR_ROW_SEPARATOR.length
	if (remaining < MIN_PARENT_BUDGET || parentFull.length === 0) {
		return { basename, separator: "", parent: "" }
	}

	if (parentFull.length <= remaining) {
		return row(basename, parentFull)
	}

	return row(basename, middleTruncate(parentFull, remaining))
}

const row = (basename: string, parent: string): SidebarRowParts => ({
	basename,
	separator: SIDEBAR_ROW_SEPARATOR,
	parent,
})

const fitTail = (s: string, width: number): string => {
	if (s.length <= width) return s
	// At width ≤ 1 there's no room for both a character and the ellipsis; emit
	// a single char so the result respects the budget. Callers currently clamp
	// width to ≥ 4, but the helper carries its own floor so a tighter future
	// caller can't silently overflow the column.
	if (width <= 1) return s.slice(0, 1)
	return s.slice(0, width - 1) + "…"
}
