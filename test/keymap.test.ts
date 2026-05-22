import { describe, expect, test } from "bun:test"
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
