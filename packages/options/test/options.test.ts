import { describe, expect, test } from "bun:test"
import { defineOptions, formatResolveError } from "../src/index.ts"

const catalog = defineOptions({
	wrap: {
		type: "boolean",
		default: false,
		persist: "session",
	},
	width: {
		type: "number",
		default: 80,
		integer: true,
		min: 1,
	},
	theme: {
		type: "string",
		default: "opencode",
		persist: "file",
		choices: ["opencode", "nord", "tokyonight"],
	},
})

describe("defineOptions.resolve", () => {
	test("returns built-in defaults when no layers are set", () => {
		expect(catalog.resolve()).toEqual({
			ok: true,
			value: { wrap: false, width: 80, theme: "opencode" },
		})
		expect(catalog.defaults).toEqual({ wrap: false, width: 80, theme: "opencode" })
	})

	test("CLI wins over env over file over defaults", () => {
		expect(
			catalog.resolve({
				cli: { wrap: true, width: 100 },
				env: { wrap: "false", width: "88", theme: "nord" },
				file: { wrap: true, width: 72, theme: "tokyonight" },
			}),
		).toEqual({
			ok: true,
			value: { wrap: true, width: 100, theme: "nord" },
		})
	})

	test("treats null and undefined as absent so lower layers can win", () => {
		expect(
			catalog.resolve({
				cli: { wrap: null, width: undefined, theme: null },
				env: { wrap: "true" },
				file: { width: 72, theme: "nord" },
			}),
		).toEqual({
			ok: true,
			value: { wrap: true, width: 72, theme: "nord" },
		})
	})

	test("a present CLI false does not fall through", () => {
		expect(
			catalog.resolve({
				cli: { wrap: false },
				env: { wrap: "true" },
				file: { wrap: true },
			}),
		).toEqual({
			ok: true,
			value: { wrap: false, width: 80, theme: "opencode" },
		})
	})

	test("env booleans accept only true/false strings", () => {
		const result = catalog.resolve({ env: { wrap: "1" } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error).toMatchObject({
			key: "wrap",
			layer: "env",
			message: "expected true or false",
			received: "1",
		})
		expect(formatResolveError(result.error)).toBe('wrap: expected true or false, got "1"')
	})

	test("file booleans reject stringly-typed values", () => {
		const result = catalog.resolve({ file: { wrap: "true" } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error.layer).toBe("file")
		expect(formatResolveError(result.error, "/tmp/config.toml")).toBe(
			"invalid value for wrap in /tmp/config.toml: expected true or false",
		)
	})

	test("env numbers parse digit strings and reject zero when min is 1", () => {
		expect(catalog.resolve({ env: { width: "88" } })).toEqual({
			ok: true,
			value: { wrap: false, width: 88, theme: "opencode" },
		})
		const result = catalog.resolve({ env: { width: "0" } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(formatResolveError(result.error)).toBe('width: expected a positive integer, got "0"')
	})

	test("file numbers reject stringly-typed values and non-integers", () => {
		const asString = catalog.resolve({ file: { width: "80" } })
		expect(asString.ok).toBe(false)
		if (asString.ok) throw new Error("expected failure")
		expect(formatResolveError(asString.error, "/tmp/config.toml")).toBe(
			"invalid value for width in /tmp/config.toml: expected a positive integer",
		)

		const asFloat = catalog.resolve({ file: { width: 80.5 } })
		expect(asFloat.ok).toBe(false)
	})

	test("string choices reject unknown values", () => {
		const result = catalog.resolve({ cli: { theme: "neon" } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error.message).toBe("expected one of opencode, nord, tokyonight")
	})

	test("invalid CLI does not fall through to a valid lower layer", () => {
		const result = catalog.resolve({
			cli: { width: 0 },
			env: { width: "88" },
		})
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error.layer).toBe("cli")
	})
})

describe("defineOptions.createSession", () => {
	test("get returns the seeded values", () => {
		const session = catalog.createSession({
			wrap: true,
			width: 72,
			theme: "nord",
		})
		expect(session.get("wrap")).toBe(true)
		expect(session.get("width")).toBe(72)
		expect(session.get("theme")).toBe("nord")
		expect(session.values).toEqual({ wrap: true, width: 72, theme: "nord" })
	})

	test("set mutates session-only keys without persisting", async () => {
		const persisted: string[] = []
		const session = catalog.createSession(catalog.defaults, {
			persist: (event) => {
				persisted.push(String(event.key))
			},
		})
		await session.set("wrap", true)
		expect(session.get("wrap")).toBe(true)
		expect(persisted).toEqual([])
	})

	test("set notifies subscribers and persists file-policy keys", async () => {
		const seen: Array<{ theme: string }> = []
		const persisted: Array<{ key: string; value: unknown }> = []
		const session = catalog.createSession(catalog.defaults, {
			persist: (event) => {
				persisted.push({ key: event.key, value: event.value })
			},
		})
		const unsubscribe = session.subscribe((values) => {
			seen.push({ theme: values.theme })
		})
		await session.set("theme", "nord")
		expect(session.get("theme")).toBe("nord")
		expect(seen).toEqual([{ theme: "nord" }])
		expect(persisted).toEqual([{ key: "theme", value: "nord" }])
		unsubscribe()
		await session.set("theme", "tokyonight")
		expect(seen).toEqual([{ theme: "nord" }])
	})

	test("set is a no-op when the value is unchanged", async () => {
		let persistCalls = 0
		let notifications = 0
		const session = catalog.createSession(catalog.defaults, {
			persist: () => {
				persistCalls += 1
			},
		})
		session.subscribe(() => {
			notifications += 1
		})
		await session.set("theme", "opencode")
		expect(persistCalls).toBe(0)
		expect(notifications).toBe(0)
	})

	test("set rejects values that fail the spec", async () => {
		const session = catalog.createSession(catalog.defaults)
		await expect(session.set("width", 0)).rejects.toThrow(/width: expected a positive integer/)
		await expect(session.set("theme", "neon")).rejects.toThrow(/expected one of/)
		expect(session.get("width")).toBe(80)
	})
})
