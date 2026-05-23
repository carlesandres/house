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
 * Truncation policy (head-elide, segment-aware):
 *   - Full parent fits → render whole.
 *   - Else drop leading segments one at a time, prefixed with `…/`, until
 *     the remainder fits — never chops a segment mid-character.
 *   - When even the tail segment with `…/` overflows, drop the marker.
 *   - When the tail segment alone overflows, hard-truncate it from its head
 *     (leading `…`) as a last resort.
 *
 * Why head-elide: the immediate parent is the segment closest to the file
 * and the most universally meaningful one when context shrinks.
 */

export const SIDEBAR_ROW_SEPARATOR = "  ·  "
const ELISION_PREFIX = "…/"
const MIN_PARENT_BUDGET = 3

export interface SidebarRowParts {
	readonly basename: string
	readonly separator: "" | typeof SIDEBAR_ROW_SEPARATOR
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

	const segments = parentFull.split("/")
	for (let k = segments.length - 1; k >= 1; k--) {
		const candidate = ELISION_PREFIX + segments.slice(segments.length - k).join("/")
		if (candidate.length <= remaining) return row(basename, candidate)
	}

	// Even one segment with the `…/` marker doesn't fit. Try without the marker.
	const tail = segments[segments.length - 1]!
	if (tail.length <= remaining) return row(basename, tail)

	// Hard-chop the tail segment from its head as a last resort.
	return row(basename, "…" + tail.slice(tail.length - remaining + 1))
}

const row = (basename: string, parent: string): SidebarRowParts => ({
	basename,
	separator: SIDEBAR_ROW_SEPARATOR,
	parent,
})

const fitTail = (s: string, width: number): string =>
	s.length <= width ? s : s.slice(0, Math.max(1, width - 1)) + "…"
