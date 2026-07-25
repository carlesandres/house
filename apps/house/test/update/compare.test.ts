import { describe, expect, test } from "bun:test"
import { isNewer } from "../../src/update/compare.ts"

describe("isNewer", () => {
	test("returns true when candidate is strictly greater", () => {
		expect(isNewer("0.5.0", "0.4.0")).toBe(true)
		expect(isNewer("1.0.0", "0.99.99")).toBe(true)
		expect(isNewer("0.4.1", "0.4.0")).toBe(true)
		expect(isNewer("0.10.0", "0.9.0")).toBe(true) // numeric, not lexicographic
	})

	test("returns false for equal or older", () => {
		expect(isNewer("0.4.0", "0.4.0")).toBe(false)
		expect(isNewer("0.4.0", "0.4.1")).toBe(false)
		expect(isNewer("0.3.9", "0.4.0")).toBe(false)
	})

	test("strips pre-release tail before compare", () => {
		// Local dev build of 0.5.0-dev.3 is "the same version" as published 0.5.0.
		expect(isNewer("0.5.0", "0.5.0-dev.3")).toBe(false)
		expect(isNewer("0.5.0-rc.1", "0.5.0")).toBe(false)
	})

	test("missing minor/patch segments treated as zero", () => {
		expect(isNewer("1", "0.99.99")).toBe(true)
		expect(isNewer("1.0", "1")).toBe(false)
	})

	test("malformed input returns false rather than throwing", () => {
		expect(isNewer("not-a-version", "0.4.0")).toBe(false)
		expect(isNewer("0.4.0", "garbage")).toBe(false)
	})
})
