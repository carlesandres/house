/**
 * Layout primitives for the two-pane shape (sidebar + reader).
 *
 * Visibility and width are decoupled (see DESIGN.md §7.1):
 *   visible = shown || focus === "sidebar"
 * Width is a pure function of viewport, independent of visibility:
 *   resolveSidebarWidth(viewport, preferred)
 *
 * Both render code and key handlers consume these primitives — there is no
 * parallel implementation living in JSX.
 */

/** Minimum useful sidebar width; below this, file rows truncate too aggressively. */
export const SIDEBAR_MIN_WIDTH = 28
/** Maximum sidebar width; beyond this, wasted whitespace on wide terminals. */
export const SIDEBAR_MAX_WIDTH = 60
/** Reader pane minimum; below this, prose wraps unpleasantly. */
export const READER_MIN_WIDTH = 40
/** Column gap painted between the two panes when both are inline. */
export const DIVIDER_WIDTH = 1
/** Launch-bucket threshold for `--sidebar=auto`. < this → start hidden. */
export const TIGHT_VIEWPORT_THRESHOLD = 80

/**
 * Continuous clamp. `preferred` is the user's desired width (until #13 lands,
 * derived from viewport). The reader-min ceiling means the sidebar yields
 * space rather than squeezing the reader below readability.
 *
 * Result is not clamped *up* to SIDEBAR_MIN when the viewport itself is too
 * narrow to hold both panes — the caller decides whether to render at all
 * (e.g. drawer instead of inline). See `canFitInline`.
 */
export const resolveSidebarWidth = (viewport: number, preferred: number): number => {
	const ceiling = viewport - DIVIDER_WIDTH - READER_MIN_WIDTH
	const lower = Math.min(SIDEBAR_MIN_WIDTH, Math.max(0, ceiling))
	const upper = Math.max(lower, ceiling)
	return Math.max(lower, Math.min(upper, preferred))
}

/**
 * Default preferred sidebar width, derived from viewport until persistent
 * config (#13) provides a user-set value. Matches the previous inline math.
 */
export const defaultPreferredWidth = (viewport: number): number =>
	Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewport * 0.25)))

/**
 * True when an inline (side-by-side) layout still gives the reader at least
 * READER_MIN_WIDTH. When false, the caller should render the sidebar as a
 * drawer instead — see DESIGN.md §7.1 Q2.
 */
export const canFitInline = (viewport: number): boolean =>
	viewport >= SIDEBAR_MIN_WIDTH + DIVIDER_WIDTH + READER_MIN_WIDTH

/**
 * Launch bucket decision for `--sidebar=auto`. Buckets are consulted once at
 * launch only; subsequent visibility changes go through `shown` + focus.
 */
export const initialShownForAuto = (viewport: number): boolean =>
	viewport >= TIGHT_VIEWPORT_THRESHOLD

/** Minimum terminal height to render the header row.
 *
 *  Derived budget: the header is worth a row when the reader still has a
 *  comfortable reading area after subtracting all chrome. Chrome on a Browser
 *  frame: header (1) + footer (1) = 2 rows (the panes are borderless — see
 *  Browser.tsx). We want the reader to retain ≥16 content rows — about a
 *  screenful of prose at typical paragraph density — so the threshold lands
 *  at 2 + 16 = 18. Below that the header drops so short panes (tmux splits,
 *  etc.) keep the reader breathable.
 *
 *  Width is *not* part of the gate: Header.tsx degrades horizontally by
 *  dropping the version string (then the filename), leaving the brand mark
 *  as a single-cell irreducible identity element. Vertical chrome is the
 *  constrained budget. */
export const HEADER_HEIGHT_THRESHOLD = 18

/** True when the viewport is tall enough to spend a row on the header.
 *  See HEADER_HEIGHT_THRESHOLD for the derivation. */
export const shouldShowHeader = (height: number): boolean => height >= HEADER_HEIGHT_THRESHOLD
