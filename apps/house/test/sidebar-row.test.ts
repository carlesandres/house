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

	test("middle-truncates the parent when it overflows", () => {
		const rel = "site-packages/conda-23.7.4.dist-info/licenses/AUTHORS.md"
		const out = formatSidebarRow(rel, 40)
		expect(out.basename).toBe("AUTHORS.md")
		expect(out.parent).toBe("site-packages/…-info/licenses")
	})

	test("preserves the start and end of the parent path", () => {
		const rel = "site-packages/conda_libmamba_solver-23.7.0.dist-info/licenses/AUTHORS.md"
		const out = formatSidebarRow(rel, 70)
		expect(out.basename).toBe("AUTHORS.md")
		expect(out.parent.startsWith("site-packages")).toBe(true)
		expect(out.parent.endsWith("/licenses")).toBe(true)
		expect(out.parent.includes("…")).toBe(true)
	})

	test("when the parent still overflows, it truncates to the available width", () => {
		const out = formatSidebarRow("abc/xyz/foo-1.2.3.dist-info/LICENSE.md", 31)
		expect(out.basename).toBe("LICENSE.md")
		expect(out.parent.length).toBeLessThanOrEqual(20)
		expect(out.parent).toContain("…")
	})

	test("short widths still keep the basename when the parent disappears", () => {
		const rel = "dir/this-segment-is-very-long-indeed/LICENSE.md"
		const out = formatSidebarRow(rel, 25)
		expect(out.basename).toBe("LICENSE.md")
		expect(out.parent.length).toBeGreaterThan(0)
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
