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

import type React from "react"
import type { KeyBinding } from "./keymap/keymap.ts"
import { displayKey } from "./keymap/displayKey.ts"
import { Spinner } from "./Spinner.tsx"
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
	/** Test seam: override spinner tick speed so tests don't sleep on the full
	 *  production interval. Ignored when discoveryStatus is null. */
	readonly discoverySpinnerIntervalMs?: number
	readonly discoverySpinnerInitialFrameIndex?: number
	/** Test seam: deterministic footer spinner driver. */
	readonly discoverySpinnerRegisterTick?: ((tick: () => void) => void) | null
}

const normalizeStatusLine = (status: string): string => status.replace(/\s+/g, " ").trim()

const HINT_SEPARATOR = "  "

interface Hint {
	readonly key: string
	readonly label: string
}

const hintWidth = (h: Hint): number => h.key.length + 1 + h.label.length // key + " " + label

const formatHint = <C,>(b: KeyBinding<C>): Hint | null => {
	if (!b.hint) return null
	const first = b.keys[0]
	if (!first) return null
	return { key: displayKey(first), label: b.hint }
}

/** Drop hints from the end until they fit within `width`. If not even the
 *  first hint fits, fall back to the bare key truncated to width, so the row
 *  is never silently blank on tight viewports. */
const fitHints = (hints: readonly Hint[], width: number): Hint[] => {
	if (width <= 0 || hints.length === 0) return []
	const acc: Hint[] = []
	let used = 0
	for (const h of hints) {
		const add = acc.length === 0 ? hintWidth(h) : HINT_SEPARATOR.length + hintWidth(h)
		if (used + add > width) break
		acc.push(h)
		used += add
	}
	if (acc.length > 0) return acc
	const first = hints[0]!
	return [{ key: first.key.slice(0, width), label: "" }]
}

const STATUS_SEPARATOR = " · "

export const Footer = <C,>({
	bindings,
	ctx,
	width,
	notice,
	discoveryStatus,
	discoverySpinnerIntervalMs,
	discoverySpinnerInitialFrameIndex,
	discoverySpinnerRegisterTick,
}: FooterProps<C>) => {
	const usableWidth = Math.max(0, width - 2) // 1-cell horizontal padding each side

	const rowStyle = {
		width,
		height: FOOTER_HEIGHT,
		flexShrink: 0,
		flexDirection: "row",
		paddingLeft: 1,
		paddingRight: 1,
		backgroundColor: colors.backgroundPanel,
	} as const

	const hints: Hint[] = []
	for (const b of bindings) {
		// Hint visibility prefers `hintWhen` (binding-specific) over `when`
		// (dispatch gate). Falling back to `when` keeps the original
		// "hint shows when binding is enabled" behavior for the common case.
		const visibleGate = b.hintWhen ?? b.when
		if (visibleGate && !visibleGate(ctx)) continue
		const h = formatHint(b)
		if (h !== null) hints.push(h)
	}

	// Discovery status sits left of the hints, separated by " · ". On tight
	// viewports it claims its budget first; hints fit into the remainder so
	// the indicator stays visible while less-essential hints drop off.
	const status =
		discoveryStatus && discoveryStatus.length > 0 ? normalizeStatusLine(discoveryStatus) : null
	const statusBudget = status ? Math.min(status.length + STATUS_SEPARATOR.length, usableWidth) : 0
	const hintsWidth = Math.max(0, usableWidth - statusBudget)
	const visibleHints = fitHints(hints, hintsWidth)
	const statusContent = status
		? status.slice(0, Math.max(0, statusBudget - STATUS_SEPARATOR.length))
		: ""

	const noticeContent = notice
		? notice.length > usableWidth
			? notice.slice(0, usableWidth)
			: notice
		: null

	// Two-tone hint row: keys render in `text` (foreground-strength), the
	// `:label` portion in `textMuted`. Matches ghui's footer treatment so
	// the key — the actionable token — visually leads each hint.
	const renderHints = () =>
		visibleHints.flatMap((h, i) => {
			const sep =
				i > 0
					? [
							<text
								key={`s${i}`}
								content={HINT_SEPARATOR}
								wrapMode="none"
								style={{ fg: colors.textMuted }}
							/>,
						]
					: []
			return [
				...sep,
				<text key={`k${i}`} content={h.key} wrapMode="none" style={{ fg: colors.text }} />,
				<text
					key={`l${i}`}
					content={` ${h.label}`}
					wrapMode="none"
					style={{ fg: colors.textMuted }}
				/>,
			]
		})

	// Priority: notice > (status + hints). Discovery status uses the secondary
	// token: active metadata, but not a warning/error event.
	if (noticeContent !== null) {
		return (
			<box style={rowStyle}>
				<text content={noticeContent} wrapMode="none" style={{ fg: colors.primary }} />
			</box>
		)
	}

	if (status !== null) {
		const spinnerProps = {
			fg: colors.secondary,
			...(discoverySpinnerIntervalMs === undefined
				? {}
				: { intervalMs: discoverySpinnerIntervalMs }),
			...(discoverySpinnerInitialFrameIndex === undefined
				? {}
				: { initialFrameIndex: discoverySpinnerInitialFrameIndex }),
			...(discoverySpinnerRegisterTick === undefined
				? {}
				: { registerTick: discoverySpinnerRegisterTick }),
		} satisfies React.ComponentProps<typeof Spinner>

		return (
			<box style={rowStyle}>
				<Spinner {...spinnerProps} />
				<text content=" " wrapMode="none" style={{ fg: colors.textMuted }} />
				<text content={statusContent} wrapMode="none" style={{ fg: colors.secondary }} />
				<text content={STATUS_SEPARATOR} wrapMode="none" style={{ fg: colors.textMuted }} />
				{renderHints()}
			</box>
		)
	}

	return <box style={rowStyle}>{renderHints()}</box>
}
