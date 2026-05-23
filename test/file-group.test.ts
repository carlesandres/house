/**
 * #115 — File keymap group, gated on `hasSelected`.
 *
 * Drives `browserBindings` through the dispatcher with a synthetic
 * BrowserCtx so we cover gating without spinning up <Browser>.
 */

import { describe, expect, test } from "bun:test"
import type { FileEntry } from "../src/discovery/walk.ts"
import { browserBindings, type BrowserCtx, type BrowserFocus } from "../src/keymap/browser.ts"
import { dispatch, type KeyMatch } from "../src/keymap/keymap.ts"

const noop = () => {}
const noopSetIndex = (_: (prev: number) => number) => {}
const noopSetFocus = (_: BrowserFocus | ((prev: BrowserFocus) => BrowserFocus)) => {}
const noopSetHelp = (_: (prev: boolean) => boolean) => {}

const makeFiles = (n: number): readonly FileEntry[] =>
	Array.from({ length: n }, (_, i) => ({
		path: `/v/${i}.md`,
		relativePath: `${i}.md`,
		name: `${i}.md`,
	}))

interface CtxOverrides {
	readonly files?: readonly FileEntry[]
	readonly hasSelected?: boolean
	readonly focus?: BrowserFocus
	readonly filterOpen?: boolean
	readonly paletteOpen?: boolean
	readonly onServe?: () => void
	readonly setSelectedIndex?: (u: (prev: number) => number) => void
}

const makeCtx = (o: CtxOverrides = {}): BrowserCtx => ({
	files: o.files ?? makeFiles(3),
	hasSelected: o.hasSelected ?? true,
	focus: o.focus ?? "sidebar",
	sidebarShown: true,
	helpVisible: false,
	filterOpen: o.filterOpen ?? false,
	paletteOpen: o.paletteOpen ?? false,
	setFocus: noopSetFocus,
	setSelectedIndex: o.setSelectedIndex ?? noopSetIndex,
	toggleShown: noop,
	setHelpVisible: noopSetHelp,
	openFilter: noop,
	openPalette: noop,
	cycleTheme: noop,
	toggleTone: noop,
	quit: noop,
	serveCurrent: o.onServe ?? noop,
})

const k = (name: string): KeyMatch => ({ name, shift: false, ctrl: false, meta: false })

describe("File group — `o` (open in browser as HTML)", () => {
	test("fires when hasSelected", () => {
		let fired = false
		const ctx = makeCtx({ hasSelected: true, onServe: () => (fired = true) })
		const result = dispatch(browserBindings, ctx, k("o"))
		expect(result?.id).toBe("serve.current")
		expect(fired).toBe(true)
	})

	test("does not fire when !hasSelected, even if files.length > 0", () => {
		// The exact bug #115 calls out: filtered list is non-empty but the
		// current selectedIndex is stale and resolves to undefined.
		let fired = false
		const ctx = makeCtx({
			files: makeFiles(5),
			hasSelected: false,
			onServe: () => (fired = true),
		})
		const result = dispatch(browserBindings, ctx, k("o"))
		expect(result).toBeNull()
		expect(fired).toBe(false)
	})

	test("fires from the reader (focus-agnostic, only hasSelected matters)", () => {
		let fired = false
		const ctx = makeCtx({
			focus: "reader",
			hasSelected: true,
			onServe: () => (fired = true),
		})
		expect(dispatch(browserBindings, ctx, k("o"))?.id).toBe("serve.current")
		expect(fired).toBe(true)
	})
})

describe("File group — `[` / `]` (prev/next file)", () => {
	test("do not fire from the sidebar (inReader clause still applies)", () => {
		let steps = 0
		const ctx = makeCtx({
			focus: "sidebar",
			files: makeFiles(3),
			setSelectedIndex: () => steps++,
		})
		expect(dispatch(browserBindings, ctx, k("["))).toBeNull()
		expect(dispatch(browserBindings, ctx, k("]"))).toBeNull()
		expect(steps).toBe(0)
	})

	test("do not fire when only one file is displayed (no sibling to step to)", () => {
		let steps = 0
		const ctx = makeCtx({
			focus: "reader",
			files: makeFiles(1),
			setSelectedIndex: () => steps++,
		})
		expect(dispatch(browserBindings, ctx, k("["))).toBeNull()
		expect(dispatch(browserBindings, ctx, k("]"))).toBeNull()
		expect(steps).toBe(0)
	})

	test("fire from the reader when there is a sibling and a selection", () => {
		let steps = 0
		const ctx = makeCtx({
			focus: "reader",
			files: makeFiles(2),
			setSelectedIndex: () => steps++,
		})
		expect(dispatch(browserBindings, ctx, k("]"))?.id).toBe("reader.nextFile")
		expect(dispatch(browserBindings, ctx, k("["))?.id).toBe("reader.prevFile")
		expect(steps).toBe(2)
	})

	test("do not fire when !hasSelected even from the reader", () => {
		let steps = 0
		const ctx = makeCtx({
			focus: "reader",
			files: makeFiles(3),
			hasSelected: false,
			setSelectedIndex: () => steps++,
		})
		expect(dispatch(browserBindings, ctx, k("]"))).toBeNull()
		expect(steps).toBe(0)
	})
})

describe("File group — array layout", () => {
	test("`o`, `[`, `]` all carry group=\"File\"", () => {
		const ids = ["serve.current", "reader.prevFile", "reader.nextFile"] as const
		for (const id of ids) {
			const b = browserBindings.find((x) => x.id === id)
			expect(b?.group).toBe("File")
		}
	})
})
