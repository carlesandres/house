import { describe, expect, test } from "bun:test"
import {
	DIVIDER_WIDTH,
	READER_MIN_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	TIGHT_VIEWPORT_THRESHOLD,
	canFitInline,
	defaultPreferredWidth,
	initialShownForAuto,
	resolveSidebarWidth,
} from "../src/layout/resolve.ts"

describe("resolveSidebarWidth", () => {
	test("returns the preferred width when it fits", () => {
		// 200 col viewport, preferred 40 → far from the reader-min ceiling.
		expect(resolveSidebarWidth(200, 40)).toBe(40)
	})

	test("clamps up to SIDEBAR_MIN_WIDTH when preferred is below it", () => {
		expect(resolveSidebarWidth(200, 10)).toBe(SIDEBAR_MIN_WIDTH)
	})

	test("clamps down to the reader-min ceiling when preferred is too greedy", () => {
		// viewport 90, ceiling = 90 - 1 - 40 = 49.
		expect(resolveSidebarWidth(90, 80)).toBe(49)
	})

	test("ceiling wins over MIN when viewport is narrow", () => {
		// viewport 70, ceiling = 70 - 1 - 40 = 29; MIN is 28; preferred 60 → 29.
		expect(resolveSidebarWidth(70, 60)).toBe(29)
	})

	test("very narrow viewport collapses below SIDEBAR_MIN", () => {
		// viewport 50, ceiling = 50 - 1 - 40 = 9. Result is 9 (caller chooses drawer).
		expect(resolveSidebarWidth(50, 40)).toBe(9)
	})
})

describe("canFitInline", () => {
	test("true when viewport ≥ SIDEBAR_MIN + DIVIDER + READER_MIN", () => {
		const threshold = SIDEBAR_MIN_WIDTH + DIVIDER_WIDTH + READER_MIN_WIDTH
		expect(canFitInline(threshold)).toBe(true)
		expect(canFitInline(threshold + 1)).toBe(true)
	})

	test("false when viewport is one column short of the threshold", () => {
		const threshold = SIDEBAR_MIN_WIDTH + DIVIDER_WIDTH + READER_MIN_WIDTH
		expect(canFitInline(threshold - 1)).toBe(false)
	})
})

describe("defaultPreferredWidth", () => {
	test("25% of viewport, clamped to [SIDEBAR_MIN, SIDEBAR_MAX]", () => {
		expect(defaultPreferredWidth(40)).toBe(SIDEBAR_MIN_WIDTH) // 10 floored, clamped up
		expect(defaultPreferredWidth(160)).toBe(40)
		expect(defaultPreferredWidth(400)).toBe(SIDEBAR_MAX_WIDTH) // 100 clamped down
	})
})

describe("initialShownForAuto", () => {
	test("hidden below the tight threshold, shown at or above it", () => {
		expect(initialShownForAuto(TIGHT_VIEWPORT_THRESHOLD - 1)).toBe(false)
		expect(initialShownForAuto(TIGHT_VIEWPORT_THRESHOLD)).toBe(true)
		expect(initialShownForAuto(TIGHT_VIEWPORT_THRESHOLD + 50)).toBe(true)
	})
})
