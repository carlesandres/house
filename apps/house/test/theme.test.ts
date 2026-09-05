import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { colors, setActiveTheme } from "../src/theme/colors.ts"
import { getThemeDefinition, isThemeId, themeDefinitions } from "../src/theme/registry.ts"
import { isThemeJson, resolveColorValue, resolveTheme } from "../src/theme/resolve.ts"
import type { ThemeJson } from "../src/theme/types.ts"

const minimalTheme: ThemeJson = {
	name: "Minimal",
	defs: { primary: "#abcdef", panel: "#222222" },
	theme: {
		primary: "primary",
		text: { dark: "#ffffff", light: "#000000" },
		background: { dark: "#111111", light: "#fafafa" },
		backgroundPanel: "panel",
	},
}

const luminance = (hex: string): number => {
	const normalized = hex.replace("#", "")
	const [r, g, b] = [0, 2, 4].map((offset) => {
		const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrastRatio = (a: string, b: string): number => {
	const l1 = luminance(a)
	const l2 = luminance(b)
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

describe("isThemeJson", () => {
	test("accepts an object with a theme object", () => {
		expect(isThemeJson({ theme: {} })).toBe(true)
		expect(isThemeJson({ theme: { primary: "#fff" }, defs: {} })).toBe(true)
	})
	test("rejects non-objects and missing theme", () => {
		expect(isThemeJson(null)).toBe(false)
		expect(isThemeJson("nope")).toBe(false)
		expect(isThemeJson({})).toBe(false)
		expect(isThemeJson({ theme: "string" })).toBe(false)
	})
})

describe("resolveColorValue", () => {
	test("resolves a hex literal directly", () => {
		expect(resolveColorValue("#abc", "dark")).toBe("#aabbcc")
		expect(resolveColorValue("#abcd", "dark")).toBe("#aabbccdd")
		expect(resolveColorValue("#abcdef", "dark")).toBe("#abcdef")
		expect(resolveColorValue("#e4e4e45e", "dark")).toBe("#e4e4e45e")
		expect(resolveColorValue("#E4E4E45E", "dark")).toBe("#e4e4e45e")
	})
	test("resolves a defs ref via the defs map", () => {
		expect(resolveColorValue("blue", "dark", { blue: "#0000ff" })).toBe("#0000ff")
	})
	test("resolves a {dark, light} variant for the requested tone", () => {
		const v = { dark: "#111111", light: "#eeeeee" }
		expect(resolveColorValue(v, "dark")).toBe("#111111")
		expect(resolveColorValue(v, "light")).toBe("#eeeeee")
	})
	test("returns null for unknown defs refs", () => {
		expect(resolveColorValue("nope", "dark", {})).toBe(null)
	})
})

describe("resolveTheme", () => {
	test("populates every token (fallbacks fill missing ones)", () => {
		const r = resolveTheme({ theme: {} }, "dark")
		expect(r.background).toMatch(/^#[0-9a-f]{6}$/)
		expect(r.text).toMatch(/^#[0-9a-f]{6}$/)
		expect(r.markdownHeading).toMatch(/^#[0-9a-f]{6}$/)
		expect(r.syntaxKeyword).toMatch(/^#[0-9a-f]{6}$/)
	})
	test("uses theme values where provided", () => {
		const r = resolveTheme(minimalTheme, "dark")
		expect(r.primary).toBe("#abcdef")
		expect(r.text).toBe("#ffffff")
		expect(r.background).toBe("#111111")
		expect(r.backgroundPanel).toBe("#222222")
	})
	test("token-fallback chain: markdownText falls back to text", () => {
		const r = resolveTheme({ theme: { text: "#aaaaaa" } }, "dark")
		expect(r.markdownText).toBe("#aaaaaa")
	})
	test("tone selection picks the right side of variants", () => {
		const dark = resolveTheme(minimalTheme, "dark")
		const light = resolveTheme(minimalTheme, "light")
		expect(dark.background).toBe("#111111")
		expect(light.background).toBe("#fafafa")
	})

	test("Cursor muted and border tokens keep alpha so they stay distinct from text", () => {
		const cursor = getThemeDefinition("cursor")!
		const dark = resolveTheme(cursor.source, "dark")
		const light = resolveTheme(cursor.source, "light")

		expect(dark.text).toBe("#e4e4e4")
		expect(dark.textMuted).toBe("#e4e4e45e")
		expect(dark.border).toBe("#e4e4e413")
		expect(dark.textMuted).not.toBe(dark.text)
		expect(dark.border).not.toBe(dark.text)
		expect(dark.border).not.toBe(dark.textMuted)

		expect(light.text).toBe("#141414")
		expect(light.textMuted).toBe("#141414ad")
		expect(light.border).toBe("#14141413")
		expect(light.textMuted).not.toBe(light.text)
		expect(light.border).not.toBe(light.text)
		expect(light.border).not.toBe(light.textMuted)

		const muted = RGBA.fromHex(dark.textMuted)
		const text = RGBA.fromHex(dark.text)
		expect(muted.equals(text)).toBe(false)
		expect(muted.a).toBeLessThan(text.a)
	})
})

describe("registry", () => {
	test("ships the bundled themes", () => {
		const ids = themeDefinitions.map((t) => t.id)
		expect(ids).toContain("nord")
		expect(ids).toContain("opencode")
	})
	test("isThemeId narrows known ids", () => {
		expect(isThemeId("nord")).toBe(true)
		expect(isThemeId("opencode")).toBe(true)
		expect(isThemeId("does-not-exist")).toBe(false)
		expect(isThemeId(42)).toBe(false)
	})
	test("getThemeDefinition returns the definition or undefined", () => {
		expect(getThemeDefinition("nord")?.id).toBe("nord")
		expect(getThemeDefinition("nope")).toBeUndefined()
	})

	test("bundled themes have distinct pane and selection chrome", () => {
		for (const definition of themeDefinitions) {
			for (const tone of ["dark", "light"] as const) {
				const resolved = resolveTheme(definition.source, tone)
				expect(resolved.background, `${definition.id}:${tone} active pane bg`).not.toBe(
					resolved.backgroundPanel,
				)
				expect(resolved.backgroundElement, `${definition.id}:${tone} selected row bg`).not.toBe(
					resolved.background,
				)
				expect(resolved.backgroundElement, `${definition.id}:${tone} selected row bg`).not.toBe(
					resolved.backgroundPanel,
				)
				expect(resolved.selectedListItemText, `${definition.id}:${tone} selected row fg`).not.toBe(
					resolved.backgroundElement,
				)
				expect(
					contrastRatio(resolved.selectedListItemText, resolved.backgroundElement),
					`${definition.id}:${tone} selected row contrast`,
				).toBeGreaterThanOrEqual(3)
			}
		}
	})
})

describe("setActiveTheme", () => {
	test("mutates the singleton in place; reference stays stable", () => {
		const ref = colors
		const opencode = getThemeDefinition("opencode")!
		const nord = getThemeDefinition("nord")!

		setActiveTheme(opencode, "dark")
		const opencodeBg = colors.background
		expect(colors).toBe(ref)

		setActiveTheme(nord, "dark")
		expect(colors).toBe(ref)
		expect(colors.background).not.toBe(opencodeBg)
	})

	test("tone changes the resolved palette", () => {
		const nord = getThemeDefinition("nord")!
		setActiveTheme(nord, "dark")
		const darkBg = colors.background
		setActiveTheme(nord, "light")
		const lightBg = colors.background
		expect(darkBg).not.toBe(lightBg)
	})

	test("syntax map is fully populated for any theme", () => {
		const nord = getThemeDefinition("nord")!
		setActiveTheme(nord, "dark")
		expect(colors.syntax["keyword"]).toBeDefined()
		expect(colors.syntax["markup.heading.1"]).toBeDefined()
		expect(colors.syntax["markup.raw"]).toBeDefined()
		expect(colors.syntax["default"]).toBeDefined()
	})

	test("syntax map keeps alpha-bearing colours from the resolved palette", () => {
		const cursor = getThemeDefinition("cursor")!
		setActiveTheme(cursor, "dark")
		expect(colors.textMuted).toBe("#e4e4e45e")
		expect(colors.border).toBe("#e4e4e413")
		expect(colors.syntax["markup.strikethrough"]?.fg).toBe("#e4e4e45e")
		expect(colors.syntax.default?.fg).toBe("#e4e4e4")
		expect(RGBA.fromHex(String(colors.syntax["markup.strikethrough"]?.fg)).a).toBeLessThan(1)
	})
})
