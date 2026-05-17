/**
 * Browser keymap — the data backing `Browser.tsx`'s `useKeyboard` handler
 * and (next iteration) the `?` help overlay.
 */

import type { FileEntry } from "../discovery/walk.ts"
import type { KeyBinding } from "./keymap.ts"

export type BrowserFocus = "sidebar" | "reader"

export interface BrowserCtx {
	readonly files: readonly FileEntry[]
	readonly focus: BrowserFocus
	readonly sidebarVisible: boolean
	readonly helpVisible: boolean
	readonly filterOpen: boolean
	readonly setFocus: (next: BrowserFocus | ((prev: BrowserFocus) => BrowserFocus)) => void
	readonly setSelectedIndex: (updater: (prev: number) => number) => void
	readonly setSidebarVisible: (updater: (prev: boolean) => boolean) => void
	readonly setHelpVisible: (updater: (prev: boolean) => boolean) => void
	readonly openFilter: () => void
	readonly cycleTheme: (delta: 1 | -1) => void
	readonly toggleTone: () => void
	readonly quit: () => void
	/** Start (or retarget) the HTML preview server on the focused file. */
	readonly serveCurrent: () => void
}

/** Step size for shift+j/k and the space/b/page keys. Constant for v1; could
 *  later be derived from the visible window height. */
const JUMP = 8

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const lastIndex = (c: BrowserCtx) => Math.max(0, c.files.length - 1)
const haveFiles = (c: BrowserCtx) => c.files.length > 0
const stepBy = (c: BrowserCtx, delta: number) =>
	c.setSelectedIndex((i) => clamp(i + delta, 0, lastIndex(c)))

const inSidebar = (c: BrowserCtx) => c.focus === "sidebar"
const filterClosed = (c: BrowserCtx) => !c.filterOpen
const inReader = (c: BrowserCtx) => c.focus === "reader"
const inSidebarWithFiles = (c: BrowserCtx) => inSidebar(c) && haveFiles(c)
const inReaderWithFiles = (c: BrowserCtx) => inReader(c) && haveFiles(c)

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
		run: (c) => {
			const willHide = c.sidebarVisible
			c.setSidebarVisible((v) => !v)
			// When hiding the sidebar, move focus to the reader so input has a
			// target. When revealing it, move focus back to the sidebar.
			c.setFocus(willHide ? "reader" : "sidebar")
		},
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
		id: "serve.current",
		group: "Global",
		description: "Open current file in browser as HTML",
		hint: "html",
		keys: ["o"],
		when: haveFiles,
		run: (c) => c.serveCurrent(),
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
	{
		id: "reader.prevFile",
		group: "Reader",
		description: "Prev file",
		hint: "prev",
		keys: ["["],
		when: inReaderWithFiles,
		run: (c) => stepBy(c, -1),
	},
	{
		id: "reader.nextFile",
		group: "Reader",
		description: "Next file",
		hint: "next",
		keys: ["]"],
		when: inReaderWithFiles,
		run: (c) => stepBy(c, 1),
	},
]
