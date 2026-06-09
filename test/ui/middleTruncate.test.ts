import { describe, expect, test } from "bun:test"
import { middleTruncate } from "../../src/ui/middleTruncate.ts"

describe("middleTruncate", () => {
	test("returns empty string for non-positive widths", () => {
		expect(middleTruncate("abcdef", 0)).toBe("")
		expect(middleTruncate("abcdef", -1)).toBe("")
	})

	test("returns the original string when it fits", () => {
		expect(middleTruncate("abc", 3)).toBe("abc")
		expect(middleTruncate("abc", 10)).toBe("abc")
	})

	test("uses a single ellipsis when truncating", () => {
		expect(middleTruncate("abcdefgh", 5)).toBe("ab…gh")
		expect(middleTruncate("abcdefgh", 6)).toBe("abc…gh")
	})

	test("keeps both ends visible and balances the middle", () => {
		const out = middleTruncate("feature/redesign-dashboard-navigation", 18)
		expect(out.startsWith("feature")).toBe(true)
		expect(out.endsWith("tion")).toBe(true)
		expect(out.includes("…")).toBe(true)
		expect(out.length).toBe(18)
	})

	test("supports a custom ellipsis string", () => {
		expect(middleTruncate("abcdefgh", 5, { ellipsis: "..." })).toBe("a...h")
	})

	test("uses the shortest possible truncation when width is tiny", () => {
		expect(middleTruncate("abcdef", 1)).toBe("a")
		expect(middleTruncate("abcdef", 2, { ellipsis: ".." })).toBe("ab")
	})
})
