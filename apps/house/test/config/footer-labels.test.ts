import { describe, expect, test } from "bun:test"
import { themeDefinitions } from "../../src/theme/registry.ts"
import { uniqueFooterLabels } from "../../src/config/footerLabels.ts"

describe("uniqueFooterLabels", () => {
	test("assigns a distinct two-character label to every id", () => {
		const ids = themeDefinitions.map((theme) => theme.id)
		const labels = uniqueFooterLabels(ids)
		expect(Object.keys(labels).sort()).toEqual([...ids].sort())
		const values = Object.values(labels)
		expect(new Set(values).size).toBe(values.length)
		for (const label of values) {
			expect(label.length).toBe(2)
		}
		expect(labels.opencode).toBe("op")
		expect(labels.nord).toBe("no")
	})

	test("resolves collisions without dropping ids", () => {
		const labels = uniqueFooterLabels(["cat", "catalog", "catch"])
		expect(labels.cat).toBe("ca")
		expect(labels.catalog).not.toBe("ca")
		expect(labels.catch).not.toBe("ca")
		expect(new Set(Object.values(labels)).size).toBe(3)
	})
})
