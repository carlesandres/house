import { describe, expect, test } from "bun:test"
import { isShowCategory, parseShowList, SHOW_CATEGORIES } from "../../src/discovery/show.ts"

describe("isShowCategory", () => {
	test("accepts every member of the vocabulary", () => {
		for (const c of SHOW_CATEGORIES) {
			expect(isShowCategory(c)).toBe(true)
		}
	})
	test("rejects unknown strings", () => {
		expect(isShowCategory("nope")).toBe(false)
		expect(isShowCategory("")).toBe(false)
		expect(isShowCategory("HIDDEN")).toBe(false) // case-sensitive
	})
})

describe("parseShowList", () => {
	test("empty string yields the empty list", () => {
		expect(parseShowList("")).toEqual({ ok: true, value: [] })
	})
	test("single category", () => {
		expect(parseShowList("hidden")).toEqual({ ok: true, value: ["hidden"] })
	})
	test("comma-separated list, order preserved", () => {
		expect(parseShowList("gitignored,hidden")).toEqual({
			ok: true,
			value: ["gitignored", "hidden"],
		})
	})
	test("whitespace and empty tokens are tolerated", () => {
		expect(parseShowList(" hidden , , gitignored , ")).toEqual({
			ok: true,
			value: ["hidden", "gitignored"],
		})
	})
	test("duplicates are dropped (first occurrence wins)", () => {
		expect(parseShowList("hidden,hidden,gitignored,hidden")).toEqual({
			ok: true,
			value: ["hidden", "gitignored"],
		})
	})
	test("unknown tokens fail with the bad list", () => {
		const r = parseShowList("hidden,bogus,gitignored,wat")
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.invalid).toEqual(["bogus", "wat"])
	})
})
