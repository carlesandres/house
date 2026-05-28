import { describe, expect, test } from "bun:test"
import { browserBindings, type BrowserCtx } from "../src/keymap/browser.ts"
import { dispatch, type KeyBinding, type KeyMatch } from "../src/keymap/keymap.ts"

const k = (
	name: string,
	mods: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {},
): KeyMatch => ({
	name,
	shift: mods.shift ?? false,
	ctrl: mods.ctrl ?? false,
	meta: mods.meta ?? false,
})

describe("dispatch — basic matching", () => {
	test("fires the first binding whose key matches", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "a", description: "", keys: ["j"], run: () => calls.push("a") },
			{ id: "b", description: "", keys: ["k"], run: () => calls.push("b") },
		]
		const fired = dispatch(bindings, null, k("j"))
		expect(fired?.id).toBe("a")
		expect(calls).toEqual(["a"])
	})

	test("returns null when no binding matches", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "a", description: "", keys: ["j"], run: () => calls.push("a") },
		]
		const fired = dispatch(bindings, null, k("x"))
		expect(fired).toBeNull()
		expect(calls).toEqual([])
	})

	test("a binding can have multiple key aliases", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "down", description: "", keys: ["j", "down"], run: () => calls.push("d") },
		]
		dispatch(bindings, null, k("down"))
		dispatch(bindings, null, k("j"))
		expect(calls).toEqual(["d", "d"])
	})
})

describe("dispatch — modifiers", () => {
	test("ctrl+i is normalized as tab", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "focus", description: "", keys: ["tab"], run: () => calls.push("focus") },
		]
		const fired = dispatch(bindings, null, k("i", { ctrl: true }))
		expect(fired?.id).toBe("focus")
		expect(calls).toEqual(["focus"])
	})

	test("shift+k matches only with shift", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "jump", description: "", keys: ["shift+k"], run: () => calls.push("jump") },
		]
		dispatch(bindings, null, k("k", { shift: true }))
		expect(calls).toEqual(["jump"])

		dispatch(bindings, null, k("k"))
		expect(calls).toEqual(["jump"]) // unchanged — plain k did not match
	})

	test("plain k does not match shift+k", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "plain", description: "", keys: ["k"], run: () => calls.push("plain") },
			{ id: "shift", description: "", keys: ["shift+k"], run: () => calls.push("shift") },
		]
		dispatch(bindings, null, k("k", { shift: true }))
		expect(calls).toEqual(["shift"])
	})

	test("ctrl+c matches only with ctrl", () => {
		const calls: string[] = []
		const bindings: KeyBinding<null>[] = [
			{ id: "quit", description: "", keys: ["ctrl+c"], run: () => calls.push("quit") },
		]
		dispatch(bindings, null, k("c", { ctrl: true }))
		dispatch(bindings, null, k("c"))
		expect(calls).toEqual(["quit"])
	})
})

describe("dispatch — when-gating", () => {
	interface Ctx {
		readonly mode: "a" | "b"
	}
	test("`when` predicate gates whether a binding fires", () => {
		const calls: string[] = []
		const bindings: KeyBinding<Ctx>[] = [
			{
				id: "a-only",
				description: "",
				keys: ["j"],
				when: (c) => c.mode === "a",
				run: () => calls.push("a"),
			},
			{
				id: "b-only",
				description: "",
				keys: ["j"],
				when: (c) => c.mode === "b",
				run: () => calls.push("b"),
			},
		]
		dispatch(bindings, { mode: "a" }, k("j"))
		dispatch(bindings, { mode: "b" }, k("j"))
		expect(calls).toEqual(["a", "b"])
	})

	test("first matching enabled binding wins; later ones are skipped", () => {
		const calls: string[] = []
		const bindings: KeyBinding<Ctx>[] = [
			{
				id: "first",
				description: "",
				keys: ["j"],
				when: () => true,
				run: () => calls.push("first"),
			},
			{ id: "second", description: "", keys: ["j"], run: () => calls.push("second") },
		]
		dispatch(bindings, { mode: "a" }, k("j"))
		expect(calls).toEqual(["first"])
	})
})

describe("browserBindings — discovery.toggleAll", () => {
	const noop = () => {}
	const stubCtx = (overrides: Partial<BrowserCtx> = {}): BrowserCtx => ({
		files: [],
		hasSelected: false,
		focus: "sidebar",
		sidebarShown: true,
		filterOpen: false,
		restoreFilterOnSidebarFocus: false,
		filterQuery: "",
		paletteOpen: false,
		setFocus: noop,
		setSelectedIndex: noop,
		toggleShown: noop,
		openFilter: noop,
		clearAndOpenFilter: noop,
		openPalette: noop,
		cycleTheme: noop,
		toggleTone: noop,
		quit: noop,
		serveCurrent: noop,
		editCurrent: noop,
		toggleAll: noop,
		...overrides,
	})

	test("shift+a dispatches discovery.toggleAll", () => {
		let fired = 0
		const fired_binding = dispatch(
			browserBindings,
			stubCtx({ toggleAll: () => (fired += 1) }),
			k("a", { shift: true }),
		)
		expect(fired_binding?.id).toBe("discovery.toggleAll")
		expect(fired).toBe(1)
	})

	test("plain `a` does not fire discovery.toggleAll", () => {
		let fired = 0
		dispatch(browserBindings, stubCtx({ toggleAll: () => (fired += 1) }), k("a"))
		expect(fired).toBe(0)
	})

	test("the binding is exposed as a command in the palette pipeline", async () => {
		const { buildCommands } = await import("../src/commands/buildCommands.ts")
		const commands = buildCommands(stubCtx())
		expect(commands.find((c) => c.id === "discovery.toggleAll")).toBeTruthy()
	})

	test("all currently enabled actions are available in the palette except palette.open", async () => {
		const { buildCommands } = await import("../src/commands/buildCommands.ts")
		const files = [
			{ path: "/v/0.md", relativePath: "0.md", name: "0.md" },
			{ path: "/v/1.md", relativePath: "1.md", name: "1.md" },
		] as const
		const readerIds = new Set(
			buildCommands(
				stubCtx({
					files,
					hasSelected: true,
					focus: "reader",
					filterQuery: "abc",
				}),
			).map((c) => c.id),
		)
		const sidebarIds = new Set(
			buildCommands(
				stubCtx({
					files,
					hasSelected: true,
					focus: "sidebar",
					filterQuery: "abc",
				}),
			).map((c) => c.id),
		)
		expect(readerIds.has("palette.open")).toBe(false)
		expect(readerIds.has("quit")).toBe(true)
		expect(readerIds.has("focus.toggle")).toBe(true)
		expect(readerIds.has("sidebar.toggle")).toBe(true)
		expect(readerIds.has("filter.open")).toBe(true)
		expect(readerIds.has("filter.clearOrOpen")).toBe(true)
		expect(readerIds.has("discovery.toggleAll")).toBe(true)
		expect(readerIds.has("theme.next")).toBe(true)
		expect(readerIds.has("theme.prev")).toBe(true)
		expect(readerIds.has("theme.toneToggle")).toBe(true)
		expect(readerIds.has("reader.back")).toBe(true)
		expect(readerIds.has("reader.prevFile")).toBe(true)
		expect(readerIds.has("reader.nextFile")).toBe(true)
		expect(readerIds.has("serve.current")).toBe(true)
		expect(readerIds.has("file.edit")).toBe(true)
		expect(sidebarIds.has("sidebar.down")).toBe(true)
		expect(sidebarIds.has("sidebar.up")).toBe(true)
		expect(sidebarIds.has("sidebar.jumpDown")).toBe(true)
		expect(sidebarIds.has("sidebar.jumpUp")).toBe(true)
		expect(sidebarIds.has("sidebar.pageDown")).toBe(true)
		expect(sidebarIds.has("sidebar.pageUp")).toBe(true)
		expect(sidebarIds.has("sidebar.top")).toBe(true)
		expect(sidebarIds.has("sidebar.bottom")).toBe(true)
		expect(sidebarIds.has("sidebar.open")).toBe(true)
	})
})
