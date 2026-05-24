/**
 * Browser keymap — the data backing `Browser.tsx`'s `useKeyboard` handler
 * and (next iteration) the `?` help overlay.
 */

import type { FileEntry } from "../discovery/walk.ts"
import type { KeyBinding } from "./keymap.ts"

export type BrowserFocus = "sidebar" | "reader"

export interface BrowserCtx {
	readonly files: readonly FileEntry[]
	/** True iff `files[selectedIndex]` resolves to an entry. The honest
	 *  predicate for File-group actions (`o`, `e`, `[`, `]`): with debounced
	 *  filter and sticky auto-select, `files.length > 0` can be true while
	 *  `selectedIndex` is invalid for the displayed list. See #115. */
	readonly hasSelected: boolean
	readonly focus: BrowserFocus
	/** User's sticky sidebar preference. Visibility is `shown || focus==="sidebar"`. */
	readonly sidebarShown: boolean
	readonly helpVisible: boolean
	readonly filterOpen: boolean
	/** Current applied/edited filter query. Used by `filter.clearOrOpen`'s
	 *  hint gate so the hint only appears when there is something to clear. */
	readonly filterQuery: string
	readonly paletteOpen: boolean
	readonly setFocus: (next: BrowserFocus | ((prev: BrowserFocus) => BrowserFocus)) => void
	readonly setSelectedIndex: (updater: (prev: number) => number) => void
	/** Toggle `shown` and adjust focus per DESIGN.md §7.1 (see s-behavior table). */
	readonly toggleShown: () => void
	readonly setHelpVisible: (updater: (prev: boolean) => boolean) => void
	readonly openFilter: () => void
	/** Clear the current filter query and open the filter modal in a single
	 *  action. Bound to `\` so users can reset a stranded zero-match filter
	 *  without first reopening with `/` and backspacing. */
	readonly clearAndOpenFilter: () => void
	readonly openPalette: () => void
	readonly cycleTheme: (delta: 1 | -1) => void
	readonly toggleTone: () => void
	readonly quit: () => void
	/** Start (or retarget) the HTML preview server on the focused file. */
	readonly serveCurrent: () => void
	/** Suspend the TUI, hand the TTY to `$EDITOR`, resume and re-read on
	 *  exit. No-op when nothing is selected; gating is the binding's job. */
	readonly editCurrent: () => void
	/** Toggle hidden + gitignored discovery axes together (#145 — UI sugar
	 *  for `shift+a`; the underlying flags stay independent everywhere
	 *  else). Snapshots the current selected path so it can be restored
	 *  once the re-walk completes. */
	readonly toggleAll: () => void
}

/** Step size for shift+j/k and the space/b/page keys. Constant for v1; could
 *  later be derived from the visible window height. */
const JUMP = 8

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const lastIndex = (c: BrowserCtx) => Math.max(0, c.files.length - 1)
const haveFiles = (c: BrowserCtx) => c.files.length > 0
const hasSelected = (c: BrowserCtx) => c.hasSelected
const stepBy = (c: BrowserCtx, delta: number) =>
	c.setSelectedIndex((i) => clamp(i + delta, 0, lastIndex(c)))

const inSidebar = (c: BrowserCtx) => c.focus === "sidebar"
const filterClosed = (c: BrowserCtx) => !c.filterOpen
const paletteClosed = (c: BrowserCtx) => !c.paletteOpen
const inReader = (c: BrowserCtx) => c.focus === "reader"
const inSidebarWithFiles = (c: BrowserCtx) => inSidebar(c) && haveFiles(c)
/** Reader-only sibling-step gate: needs a current selection plus a sibling
 *  to step to. `hasSelected` implies `files.length >= 1`, so `>= 2` is the
 *  meaningful extra condition. */
const inReaderWithSibling = (c: BrowserCtx) => inReader(c) && hasSelected(c) && c.files.length >= 2

export const browserBindings: readonly KeyBinding<BrowserCtx>[] = [
	// Global
	{
		id: "quit",
		group: "Global",
		description: "Quit",
		hint: "quit",
		keys: ["q", "ctrl+c"],
		run: (c) => c.quit(),
	},
	{
		id: "focus.toggle",
		group: "Global",
		description: "Toggle focus (sidebar ↔ reader)",
		hint: "focus",
		keys: ["tab"],
		run: (c) => c.setFocus((f) => (f === "sidebar" ? "reader" : "sidebar")),
	},
	{
		id: "sidebar.toggle",
		group: "Global",
		description: "Toggle sidebar visibility",
		hint: "sidebar",
		keys: ["s"],
		run: (c) => c.toggleShown(),
	},
	{
		id: "help.toggle",
		group: "Global",
		description: "Show / dismiss help",
		hint: "help",
		keys: ["?"],
		run: (c) => c.setHelpVisible((v) => !v),
	},
	{
		id: "filter.open",
		group: "Sidebar",
		description: "Filter files (fuzzy match on path)",
		hint: "filter",
		keys: ["/"],
		// Fires from anywhere except inside an already-open filter. `openFilter`
		// itself force-opens the sidebar and moves focus there, so the binding
		// no longer needs to gate on focus or sidebar visibility.
		when: filterClosed,
		run: (c) => c.openFilter(),
	},
	{
		id: "filter.clearOrOpen",
		group: "Sidebar",
		description: "Clear filter",
		hint: "clear",
		keys: ["ctrl+\\"],
		// Fires from anywhere outside the filter modal via the keymap.
		// Inside the filter modal it's intercepted directly in Browser.tsx
		// (the filter mode owns key handling), but the action is the same —
		// clear input, keep modal open. Palette/help branches short-circuit
		// dispatch in Browser.tsx, so we don't need to gate on them for
		// behavior; the `hintWhen` gate keeps the footer chip from showing
		// when there's nothing to clear or when a modal owns the input.
		// Chord chosen over single `\` so the binding works inside the
		// filter input without colliding with the typed character; ctrl+u
		// is deliberately left to its reader/sidebar half-page-up role to
		// avoid overload.
		when: filterClosed,
		hintWhen: (c) =>
			filterClosed(c) && !c.paletteOpen && !c.helpVisible && c.filterQuery.length > 0,
		run: (c) => c.clearAndOpenFilter(),
	},
	{
		id: "palette.open",
		group: "Global",
		description: "Command palette",
		hint: "palette",
		keys: ["ctrl+p"],
		// Filter swallows ctrl+p as a typed character in its own branch, so this
		// `when` only matters when the palette is already open (which it
		// shouldn't re-open). #70 Q2 — fires from everywhere except the filter,
		// closes help on its way in (handled in Browser.tsx).
		when: paletteClosed,
		run: (c) => c.openPalette(),
	},
	{
		id: "discovery.toggleAll",
		group: "Sidebar",
		description: "Show / hide hidden and gitignored files",
		// No footer hint: shift+a is help/palette only. The footer hint row is
		// already at width capacity on narrow viewports, and the toggle isn't
		// a per-row action you reach for constantly.
		keys: ["shift+a"],
		// Selection-preservation logic lives in Browser.tsx — see the
		// `pendingSelectionPath` ref. The toggle itself is session-only and
		// does not write back to the TOML config.
		run: (c) => c.toggleAll(),
	},
	{
		id: "theme.next",
		group: "Global",
		description: "Next theme",
		hint: "theme",
		keys: ["t"],
		run: (c) => c.cycleTheme(1),
	},
	{
		id: "theme.prev",
		group: "Global",
		description: "Previous theme",
		keys: ["shift+t"],
		run: (c) => c.cycleTheme(-1),
	},
	{
		id: "theme.toneToggle",
		group: "Global",
		description: "Toggle dark / light tone",
		keys: ["shift+l"],
		run: (c) => c.toggleTone(),
	},

	// Sidebar
	{
		id: "sidebar.down",
		group: "Sidebar",
		description: "Move selection down",
		keys: ["j", "down"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, 1),
	},
	{
		id: "sidebar.up",
		group: "Sidebar",
		description: "Move selection up",
		keys: ["k", "up"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, -1),
	},
	{
		id: "sidebar.jumpDown",
		group: "Sidebar",
		description: `Jump down ${JUMP}`,
		keys: ["shift+j"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, JUMP),
	},
	{
		id: "sidebar.jumpUp",
		group: "Sidebar",
		description: `Jump up ${JUMP}`,
		keys: ["shift+k"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, -JUMP),
	},
	{
		id: "sidebar.pageDown",
		group: "Sidebar",
		description: "Page down",
		keys: ["space", "pagedown", "ctrl+d"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, JUMP),
	},
	{
		id: "sidebar.pageUp",
		group: "Sidebar",
		description: "Page up",
		keys: ["b", "pageup", "ctrl+u"],
		when: inSidebarWithFiles,
		run: (c) => stepBy(c, -JUMP),
	},
	{
		id: "sidebar.top",
		group: "Sidebar",
		description: "Jump to first file",
		keys: ["g"],
		when: inSidebarWithFiles,
		run: (c) => c.setSelectedIndex(() => 0),
	},
	{
		id: "sidebar.bottom",
		group: "Sidebar",
		description: "Jump to last file",
		keys: ["shift+g"],
		when: inSidebarWithFiles,
		run: (c) => c.setSelectedIndex(() => lastIndex(c)),
	},
	{
		id: "sidebar.open",
		group: "Sidebar",
		description: "Open file (focus reader)",
		hint: "open",
		keys: ["return", "right", "l"],
		when: inSidebar,
		run: (c) => c.setFocus("reader"),
	},

	// File — actions on the currently-selected file. Gated on `hasSelected`
	// (per #115) so they're available exactly when the reader has something
	// to act on, regardless of focus or filter state.
	{
		id: "serve.current",
		group: "File",
		description: "Open current file in browser as HTML",
		hint: "html",
		keys: ["o"],
		when: hasSelected,
		run: (c) => c.serveCurrent(),
	},
	{
		id: "file.edit",
		group: "File",
		description: "Open current file in $EDITOR",
		hint: "edit",
		keys: ["e"],
		when: hasSelected,
		run: (c) => c.editCurrent(),
	},
	{
		// `[`/`]` keep the `inReader` clause so they're only typed from the
		// reader (sidebar uses j/k for stepping). The File-group predicate is
		// additive: needs a selection *and* a sibling to step to.
		id: "reader.prevFile",
		group: "File",
		description: "Prev file",
		hint: "prev",
		keys: ["["],
		when: inReaderWithSibling,
		run: (c) => stepBy(c, -1),
	},
	{
		id: "reader.nextFile",
		group: "File",
		description: "Next file",
		hint: "next",
		keys: ["]"],
		when: inReaderWithSibling,
		run: (c) => stepBy(c, 1),
	},

	// Reader
	{
		id: "reader.back",
		group: "Reader",
		description: "Back to sidebar",
		hint: "back",
		keys: ["escape", "left", "h"],
		when: inReader,
		run: (c) => c.setFocus("sidebar"),
	},
]
