import { describe, expect, test } from "bun:test"
import { fitSidebarEmptyValue } from "../src/layout/sidebarEmptyState.ts"

describe("fitSidebarEmptyValue", () => {
	test("keeps short values unchanged", () => {
		expect(fitSidebarEmptyValue("/repo/docs", 80)).toBe("/repo/docs")
	})

	test("right-anchors long values", () => {
		expect(fitSidebarEmptyValue("/very/long/path/to/the/current/docs", 12)).toBe(
			"…urrent/docs",
		)
	})
})
