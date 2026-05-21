/**
 * Footer — single-row chrome under the two-pane area.
 *
 * Renders either a notice line (when one is active) or a compact hint row
 * derived from the keymap. Hints are filtered by each binding's `when`
 * against the current context, so the row reflects what the user can
 * actually do right now. Overflow is handled by truncating from the right
 * (later-in-array bindings drop off first).
 *
 * Empty vault: the footer renders normally even when no markdown files
 * were discovered. Intentional — `q:quit` and `?:help` are exactly what an
 * empty-vault user needs as an exit and discoverability anchor.
 *
 * The filter input does not live here — it renders as a row inside the
 * sidebar (see Browser.tsx). The pattern mirrors ghui's PR list, where the
 * filter is part of the list it filters.
 *
 * Width math assumes hint labels are ASCII plus a small set of single-cell
 * BMP glyphs (see `displayKey`). `fitHints` and notice clipping use string
 * length as a proxy for cell count; introducing a CJK or emoji label would
 * require a real cell-width counter (e.g. East Asian Width).
 */

import type { KeyBinding } from "./keymap/keymap.ts"
import { colors } from "./theme/colors.ts"

/** Rows the Footer occupies. Importers use it for layout math so a future
 *  taller footer doesn't require touching two files. */
export const FOOTER_HEIGHT = 1

export interface FooterProps<C> {
	readonly bindings: readonly KeyBinding<C>[]
	readonly ctx: C
	readonly width: number
	readonly notice?: string | null
	/** Persistent status line (e.g. "indexing… 42"). Distinct from `notice`:
	 *  no TTL, cleared by the caller when the underlying activity finishes.
	 *  Loses to `notice` when both are set so transient toasts still surface. */
	readonly discoveryStatus?: string | null
	/** When a filter is applied but the input is closed, surface a chip in the
	 *  hint row so the user remembers `[`/`]` walks the filtered set. Pass null
	 *  while the filter input is open (the sidebar already shows the query) or
	 *  when no filter is applied. */
	readonly filterQuery?: string | null
}

const HINT_SEPARATOR = "  "

/** Display form for the first key of a binding. Picks the first chord and
 *  rewrites a few names to terminal-friendly shorthands.
 *
 *  Footer policy: only the first key is shown, even when a binding has
 *  aliases (e.g. `sidebar.open` accepts `return`/`right`/`l`). The footer
 *  is a narrow real-estate budget, and listing every alias would push out
 *  other bindings on tight viewports. The full alias list lives in the
 *  help overlay (`?`). */
const displayKey = (raw: string): string => {
	switch (raw) {
		case "return":
			return "↵"
		case "escape":
			return "esc"
		case "space":
			return "␣"
		case "pageup":
			return "pgup"
		case "pagedown":
			return "pgdn"
		default:
			return raw
	}
}

const formatHint = <C,>(b: KeyBinding<C>): string | null => {
	if (!b.hint) return null
	const first = b.keys[0]
	if (!first) return null
	return `${displayKey(first)}:${b.hint}`
}

/** Drop hints from the end until the joined string fits within `width`.
 *  If not even the first hint fits, fall back to the bare key portion so
 *  the user still sees a discoverability anchor (e.g. `?` instead of an
 *  empty row on an 8-column terminal). */
const fitHints = (hints: readonly string[], width: number): string => {
	if (width <= 0 || hints.length === 0) return ""
	let acc = ""
	for (const h of hints) {
		const next = acc.length === 0 ? h : `${acc}${HINT_SEPARATOR}${h}`
		if (next.length > width) break
		acc = next
	}
	if (acc.length > 0) return acc
	// Nothing fit. Render just the first hint's key (everything before `:`)
	// truncated to width, so the row is never silently blank.
	const firstKey = hints[0]!.split(":")[0] ?? ""
	return firstKey.slice(0, width)
}

const STATUS_SEPARATOR = " · "

export const Footer = <C,>({
	bindings,
	ctx,
	width,
	notice,
	discoveryStatus,
	filterQuery,
}: FooterProps<C>) => {
	const usableWidth = Math.max(0, width - 2) // 1-cell horizontal padding each side

	const rowStyle = {
		width,
		height: FOOTER_HEIGHT,
		flexShrink: 0,
		flexDirection: "row",
		paddingLeft: 1,
		paddingRight: 1,
		backgroundColor: colors.surface,
	} as const

	const hints: string[] = []
	// The filter chip prepends to the hint row when a filter is applied and the
	// input is closed. Bracketed to avoid looking like a `key:hint` binding —
	// "filter" is not a key. Surfaces the otherwise-invisible invariant that
	// `[`/`]` walks the filtered set. See DESIGN.md §7.1 Q1.
	if (filterQuery && filterQuery.length > 0) {
		hints.push(`[filter: ${filterQuery}]`)
	}
	for (const b of bindings) {
		if (b.when && !b.when(ctx)) continue
		const h = formatHint(b)
		if (h !== null) hints.push(h)
	}

	// Discovery status sits left of the hints, separated by " · ". On tight
	// viewports it claims its budget first; hints fit into the remainder so
	// the indicator stays visible while less-essential hints drop off.
	const status = discoveryStatus && discoveryStatus.length > 0 ? discoveryStatus : null
	const statusBudget = status ? Math.min(status.length + STATUS_SEPARATOR.length, usableWidth) : 0
	const hintsWidth = Math.max(0, usableWidth - statusBudget)
	const hintContent = fitHints(hints, hintsWidth)
	const statusContent = status
		? status.slice(0, Math.max(0, statusBudget - STATUS_SEPARATOR.length))
		: ""

	const noticeContent = notice
		? notice.length > usableWidth
			? notice.slice(0, usableWidth)
			: notice
		: null

	// Priority: notice > (status + hints). Notice fg is strong; status sits
	// at the muted level so it reads as ambient state, not an event.
	if (noticeContent !== null) {
		return (
			<box style={rowStyle}>
				<text content={noticeContent} wrapMode="none" style={{ fg: colors.textStrong }} />
			</box>
		)
	}

	if (status !== null) {
		return (
			<box style={rowStyle}>
				<text content={statusContent} wrapMode="none" style={{ fg: colors.textMuted }} />
				<text content={STATUS_SEPARATOR} wrapMode="none" style={{ fg: colors.textMuted }} />
				<text content={hintContent} wrapMode="none" style={{ fg: colors.textMuted }} />
			</box>
		)
	}

	return (
		<box style={rowStyle}>
			<text content={hintContent} wrapMode="none" style={{ fg: colors.textMuted }} />
		</box>
	)
}
