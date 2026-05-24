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
		helpVisible: false,
		filterOpen: false,
		filterQuery: "",
		paletteOpen: false,
		setFocus: noop,
		setSelectedIndex: noop,
		toggleShown: noop,
		setHelpVisible: noop,
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
})
