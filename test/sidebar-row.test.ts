import { describe, expect, test } from "bun:test"
import { formatSidebarRow, SIDEBAR_ROW_SEPARATOR } from "../src/layout/sidebarRow.ts"

describe("formatSidebarRow", () => {
	test("root-level file: no separator, basename only", () => {
		const out = formatSidebarRow("README.md", 30)
		expect(out).toEqual({ basename: "README.md", separator: "", parent: "" })
	})

	test("nested file that fits: basename + separator + full parent", () => {
		const out = formatSidebarRow("docs/intro.md", 40)
		expect(out.basename).toBe("intro.md")
		expect(out.separator).toBe(SIDEBAR_ROW_SEPARATOR)
		expect(out.parent).toBe("docs")
	})

	test("full parent shown whole when it fits, no elision marker", () => {
		const out = formatSidebarRow("a/b/c/intro.md", 40)
		expect(out.parent).toBe("a/b/c")
	})

	test("head-elides at segment boundaries with …/ marker when parent overflows", () => {
		const rel = "site-packages/conda-23.7.4.dist-info/licenses/AUTHORS.md"
		// remaining = 40 - 10 - 5 = 25 → parent "site-packages/conda-23.7.4.dist-info/licenses" (45) doesn't fit
		// drop leading segs → "…/conda-23.7.4.dist-info/licenses" (33) still overflows
		// drop more → "…/licenses" (10) fits
		const out = formatSidebarRow(rel, 40)
		expect(out.basename).toBe("AUTHORS.md")
		expect(out.parent).toBe("…/licenses")
	})

	test("never chops a segment mid-character while a boundary fit is reachable", () => {
		const rel = "site-packages/conda_libmamba_solver-23.7.0.dist-info/licenses/AUTHORS.md"
		const out = formatSidebarRow(rel, 70)
		// remaining = 55 → "…/conda_libmamba_solver-23.7.0.dist-info/licenses" (49) fits
		expect(out.basename).toBe("AUTHORS.md")
		expect(out.parent).toBe("…/conda_libmamba_solver-23.7.0.dist-info/licenses")
	})

	test("when even the tail segment with …/ overflows, drop the marker", () => {
		// parent "abc/xyz/foo-1.2.3.dist-info" (27); width 35; remaining 20
		// "…/foo-1.2.3.dist-info" (21) overflows by 1; "foo-1.2.3.dist-info" (19) fits
		const out = formatSidebarRow("abc/xyz/foo-1.2.3.dist-info/LICENSE.md", 35)
		expect(out.basename).toBe("LICENSE.md")
		expect(out.parent).toBe("foo-1.2.3.dist-info")
	})

	test("hard-chops the tail segment from its head as a last resort", () => {
		const rel = "dir/this-segment-is-very-long-indeed/LICENSE.md"
		// remaining = 25 - 10 - 5 = 10; tail "this-segment-is-very-long-indeed" overflows
		// hard-chop from head → "…ng-indeed" (10)
		const out = formatSidebarRow(rel, 25)
		expect(out.basename).toBe("LICENSE.md")
		expect(out.parent.startsWith("…")).toBe(true)
		expect(out.parent.endsWith("indeed")).toBe(true)
		expect(out.parent.length).toBe(10)
	})

	test("when parent budget falls below the floor, drop the parent entirely", () => {
		const out = formatSidebarRow("some/dir/README.md", 12)
		expect(out.basename).toBe("README.md")
		expect(out.separator).toBe("")
		expect(out.parent).toBe("")
	})

	test("when basename itself overflows, truncate basename with trailing ellipsis", () => {
		const out = formatSidebarRow("dir/this-filename-is-way-too-long.md", 12)
		expect(out.separator).toBe("")
		expect(out.parent).toBe("")
		expect(out.basename.endsWith("…")).toBe(true)
		expect(out.basename.length).toBe(12)
	})
})
