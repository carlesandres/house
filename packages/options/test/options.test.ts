import { describe, expect, test } from "bun:test"
import {
	defineOptions,
	footerControlActive,
	footerControlGlyph,
	footerKeys,
	formatResolveError,
	isFooterOption,
	nextFooterValue,
} from "../src/index.ts"

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

	test("set rejects unknown keys", async () => {
		const session = catalog.createSession(catalog.defaults)
		await expect(session.set("missing" as "wrap", true)).rejects.toThrow(/unknown option "missing"/)
	})

	test("set updates keys that omit persist without writing", async () => {
		const session = catalog.createSession(catalog.defaults)
		await session.set("width", 72)
		await session.set("theme", "nord")
		expect(session.get("width")).toBe(72)
		expect(session.get("theme")).toBe("nord")
	})
})

describe("formatResolveError", () => {
	const envError = (received: unknown): Parameters<typeof formatResolveError>[0] => ({
		key: "wrap",
		layer: "env",
		message: "expected true or false",
		received,
	})

	test("stringifies numbers, booleans, null, and other types", () => {
		expect(formatResolveError(envError(1))).toBe("wrap: expected true or false, got 1")
		expect(formatResolveError(envError(true))).toBe("wrap: expected true or false, got true")
		expect(formatResolveError(envError(null))).toBe("wrap: expected true or false, got null")
		expect(formatResolveError(envError({}))).toBe("wrap: expected true or false, got object")
	})

	test("omits the path when a file error has none", () => {
		expect(
			formatResolveError({
				key: "wrap",
				layer: "file",
				message: "expected true or false",
				received: "true",
			}),
		).toBe("invalid value for wrap: expected true or false")
	})
})

describe("decode variants beyond the House-shaped catalog", () => {
	const variants = defineOptions({
		count: {
			type: "number",
			default: 0,
			integer: true,
		},
		rate: {
			type: "number",
			default: 1.5,
		},
		volume: {
			type: "number",
			default: 5,
			min: 0,
			max: 10,
		},
		label: {
			type: "string",
			default: "ok",
		},
		theme: {
			type: "string",
			default: "nord",
			choices: ["nord", "dark"],
		},
	})

	test("integer numbers reject env floats and non-numeric strings", () => {
		const float = variants.resolve({ env: { count: "1.5" } })
		expect(float.ok).toBe(false)
		if (float.ok) throw new Error("expected failure")
		expect(float.error.message).toBe("expected an integer")

		const garbage = variants.resolve({ env: { count: "abc" } })
		expect(garbage.ok).toBe(false)

		const notString = variants.resolve({ env: { count: 3 } })
		expect(notString.ok).toBe(false)
	})

	test("unbounded numbers parse env floats and reject non-finite file values", () => {
		expect(variants.resolve({ env: { rate: "3.14" } })).toEqual({
			ok: true,
			value: { count: 0, rate: 3.14, volume: 5, label: "ok", theme: "nord" },
		})
		const infinite = variants.resolve({ file: { rate: Number.POSITIVE_INFINITY } })
		expect(infinite.ok).toBe(false)
		if (infinite.ok) throw new Error("expected failure")
		expect(infinite.error.message).toBe("expected a number")
	})

	test("min and max reject out-of-range file numbers", () => {
		const high = variants.resolve({ file: { volume: 11 } })
		expect(high.ok).toBe(false)
		const low = variants.resolve({ file: { volume: -1 } })
		expect(low.ok).toBe(false)
	})

	test("unconstrained strings reject non-strings", () => {
		const result = variants.resolve({ file: { label: 12 } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error.message).toBe("expected a string")
	})

	test("choice strings reject non-strings", () => {
		const result = variants.resolve({ file: { theme: true } })
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.error.message).toBe("expected one of nord, dark")
	})
})

describe("footer opt-in", () => {
	const withFooter = defineOptions({
		wrap: {
			type: "boolean",
			default: false,
			persist: "session",
			footer: { icon: "W" },
		},
		theme: {
			type: "string",
			default: "opencode",
			choices: ["opencode", "nord", "tokyonight"],
			footer: {
				icon: "T",
				labels: { opencode: "op", nord: "no", tokyonight: "to" },
			},
		},
		width: {
			type: "number",
			default: 80,
			integer: true,
			min: 1,
		},
	})

	test("footerKeys lists opted-in keys in declaration order", () => {
		expect(footerKeys(withFooter.specs)).toEqual(["wrap", "theme"])
		expect(isFooterOption(withFooter.specs.wrap)).toBe(true)
		expect(isFooterOption(withFooter.specs.width)).toBe(false)
	})

	test("nextFooterValue toggles booleans and cycles choices", () => {
		expect(nextFooterValue(withFooter.specs.wrap, false)).toBe(true)
		expect(nextFooterValue(withFooter.specs.wrap, true)).toBe(false)
		expect(nextFooterValue(withFooter.specs.theme, "opencode")).toBe("nord")
		expect(nextFooterValue(withFooter.specs.theme, "tokyonight")).toBe("opencode")
		expect(nextFooterValue(withFooter.specs.theme, "missing")).toBe("opencode")
		expect(footerControlActive(withFooter.specs.wrap, false)).toBe(false)
		expect(footerControlActive(withFooter.specs.wrap, true)).toBe(true)
		expect(footerControlActive(withFooter.specs.theme, "nord")).toBe(true)
	})

	test("footerControlGlyph uses labels for choices and icon for booleans", () => {
		expect(footerControlGlyph(withFooter.specs.wrap, true)).toBe("W")
		expect(footerControlGlyph(withFooter.specs.theme, "nord")).toBe("no")
		expect(footerControlGlyph(withFooter.specs.theme, "missing")).toBe("T")
	})

	test("defineOptions rejects footer on numbers without a strategy", () => {
		expect(() =>
			defineOptions({
				width: {
					type: "number",
					default: 80,
					footer: { icon: "N" },
				},
			}),
		).toThrow(/footer requires activate/)
	})

	test("defineOptions rejects empty footer icons", () => {
		expect(() =>
			defineOptions({
				wrap: {
					type: "boolean",
					default: false,
					footer: { icon: "" },
				},
			}),
		).toThrow(/footer.icon must be non-empty/)
	})

	test("defineOptions rejects cycle without choices", () => {
		expect(() =>
			defineOptions({
				label: {
					type: "string",
					default: "x",
					footer: { icon: "L", activate: "cycle" },
				},
			}),
		).toThrow(/cycle.*choices/)
	})

	test("defineOptions rejects toggle on non-booleans", () => {
		expect(() =>
			defineOptions({
				theme: {
					type: "string",
					default: "a",
					choices: ["a", "b"],
					footer: { icon: "T", activate: "toggle" },
				},
			}),
		).toThrow(/toggle.*boolean/)
	})

	test("defineOptions rejects choice footer without labels for every choice", () => {
		expect(() =>
			defineOptions({
				theme: {
					type: "string",
					default: "a",
					choices: ["a", "b"],
					footer: { icon: "T" },
				},
			}),
		).toThrow(/footer.labels is required/)

		expect(() =>
			defineOptions({
				theme: {
					type: "string",
					default: "a",
					choices: ["a", "b"],
					footer: { icon: "T", labels: { a: "a" } },
				},
			}),
		).toThrow(/missing entry for "b"/)
	})
})
