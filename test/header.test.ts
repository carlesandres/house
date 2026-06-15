import { describe, expect, test } from "bun:test"
import { BRAND, BRAND_NAME } from "../src/brand.ts"
import { layoutHeaderSegments } from "../src/Header.tsx"

describe("layoutHeaderSegments", () => {
	test("wide rows show brand, file, root, and version", () => {
		expect(
			layoutHeaderSegments({
				width: 100,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/house",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: `${BRAND} ${BRAND_NAME}`, tone: "brand" },
				{ id: "file", text: "docs/intro.md", tone: "primary" },
				{ id: "root", text: "~/src/house", tone: "muted" },
			],
			right: "v1.2.3",
		})
	})

	test("wide rows show the root even when no file is selected", () => {
		expect(
			layoutHeaderSegments({
				width: 100,
				currentFile: null,
				rootLabel: "~/src/house",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: `${BRAND} ${BRAND_NAME}`, tone: "brand" },
				{ id: "root", text: "~/src/house", tone: "muted" },
			],
			right: "v1.2.3",
		})
	})

	test("medium rows truncate root before dropping it", () => {
		expect(
			layoutHeaderSegments({
				width: 46,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/very-long-house-project",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: `${BRAND} ${BRAND_NAME}`, tone: "brand" },
				{ id: "file", text: "docs/intro.md", tone: "primary" },
				{ id: "root", text: "~/src…oject", tone: "muted" },
			],
			right: "v1.2.3",
		})
	})

	test("tight rows drop root before dropping the wordmark", () => {
		expect(
			layoutHeaderSegments({
				width: 35,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/very-long-house-project",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: `${BRAND} ${BRAND_NAME}`, tone: "brand" },
				{ id: "file", text: "docs/intro.md", tone: "primary" },
			],
			right: "v1.2.3",
		})
	})

	test("tighter rows drop the wordmark before dropping version", () => {
		expect(
			layoutHeaderSegments({
				width: 31,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/very-long-house-project",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: BRAND, tone: "brand" },
				{ id: "file", text: "docs/intro.md", tone: "primary" },
			],
			right: "v1.2.3",
		})
	})

	test("very tight rows drop version before truncating the file", () => {
		expect(
			layoutHeaderSegments({
				width: 23,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/very-long-house-project",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: BRAND, tone: "brand" },
				{ id: "file", text: "docs/intro.md", tone: "primary" },
			],
			right: null,
		})
	})

	test("narrowest rows middle-truncate the file after root, wordmark, and version yield", () => {
		expect(
			layoutHeaderSegments({
				width: 14,
				currentFile: "docs/intro.md",
				rootLabel: "~/src/very-long-house-project",
				version: "1.2.3",
			}),
		).toEqual({
			left: [
				{ id: "brand", text: BRAND, tone: "brand" },
				{ id: "file", text: "docs….md", tone: "primary" },
			],
			right: null,
		})
	})
})
