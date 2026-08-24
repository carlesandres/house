import { describe, expect, test } from "bun:test"
import { resolveNewFileName } from "../src/new-file/resolveName.ts"
import { queryWouldShowRelativePath } from "../src/new-file/queryWouldShow.ts"

describe("resolveNewFileName", () => {
	test("rejects control characters before trim", () => {
		expect(resolveNewFileName("foo\u0001")).toEqual({
			ok: false,
			error: "name contains invalid characters",
		})
		expect(resolveNewFileName("\u007Fmd")).toEqual({
			ok: false,
			error: "name contains invalid characters",
		})
	})

	test("empty and whitespace require a name", () => {
		expect(resolveNewFileName("")).toEqual({ ok: false, error: "name required" })
		expect(resolveNewFileName("   ")).toEqual({ ok: false, error: "name required" })
	})

	test("rejects nested or escaping paths and . / ..", () => {
		for (const raw of ["notes/foo", "../x", "/tmp/x", "foo\\bar", ".", ".."]) {
			expect(resolveNewFileName(raw)).toEqual({
				ok: false,
				error: "name must be a single file in the discovery root",
			})
		}
	})

	test("rejects hidden names", () => {
		expect(resolveNewFileName(".notes")).toEqual({
			ok: false,
			error: "hidden names aren't supported yet",
		})
		expect(resolveNewFileName(".md")).toEqual({
			ok: false,
			error: "hidden names aren't supported yet",
		})
	})

	test("appends .md when missing and does not warn for a bare stem", () => {
		expect(resolveNewFileName("foo")).toEqual({ ok: true, basename: "foo.md", warnings: [] })
		expect(resolveNewFileName("  Foo Bar  ")).toEqual({
			ok: true,
			basename: "Foo Bar.md",
			warnings: [],
		})
	})

	test("leaves an exact .md suffix unchanged", () => {
		expect(resolveNewFileName("foo.md")).toEqual({ ok: true, basename: "foo.md", warnings: [] })
	})

	test("normalizes a case-variant .md suffix", () => {
		expect(resolveNewFileName("foo.MD")).toEqual({
			ok: true,
			basename: "foo.md",
			warnings: ["extension will be saved as .md"],
		})
		expect(resolveNewFileName("foo.Md")).toEqual({
			ok: true,
			basename: "foo.md",
			warnings: ["extension will be saved as .md"],
		})
	})

	test("appends .md after another extension and warns", () => {
		expect(resolveNewFileName("foo.txt")).toEqual({
			ok: true,
			basename: "foo.txt.md",
			warnings: ["will be created as foo.txt.md"],
		})
		expect(resolveNewFileName("foo.")).toEqual({
			ok: true,
			basename: "foo..md",
			warnings: ["will be created as foo..md"],
		})
	})
})

describe("queryWouldShowRelativePath", () => {
	test("an empty query would show any basename", () => {
		expect(queryWouldShowRelativePath("", "zzz.md")).toBe(true)
	})

	test("uses the File Navigator fuzzy rule, not a substring check", () => {
		expect(queryWouldShowRelativePath("readme", "foo.md")).toBe(false)
		expect(queryWouldShowRelativePath("foo", "foo.md")).toBe(true)
		expect(queryWouldShowRelativePath("fmd", "foo.md")).toBe(true)
	})
})
