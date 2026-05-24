import { describe, expect, test } from "bun:test"
import type { FileEntry } from "../src/discovery/walk.ts"
import { filterFiles, fuzzyScore } from "../src/discovery/filter.ts"

const files = (paths: readonly string[]): FileEntry[] =>
	paths.map((rel) => ({
		path: `/abs/${rel}`,
		relativePath: rel,
		name: rel.split("/").pop() ?? rel,
	}))

const paths = (xs: readonly FileEntry[]): string[] => xs.map((x) => x.relativePath)

describe("fuzzyScore", () => {
	test("empty query scores zero", () => {
		expect(fuzzyScore("", "anything.md")).toBe(0)
	})

	test("subsequence matches", () => {
		expect(fuzzyScore("drm", "docs/readme.md")).not.toBeNull()
	})

	test("non-subsequence returns null", () => {
		expect(fuzzyScore("xyz", "docs/readme.md")).toBeNull()
	})

	test("case-insensitive", () => {
		expect(fuzzyScore("README", "docs/readme.md")).not.toBeNull()
		expect(fuzzyScore("readme", "DOCS/README.MD")).not.toBeNull()
	})

	test("word-boundary match scores higher than mid-word", () => {
		// 'r' at start of 'readme' (after `/`) should beat 'r' inside 'foo-r.md'
		const boundary = fuzzyScore("r", "docs/readme.md")!
		const midWord = fuzzyScore("r", "docs/foo-r.md")!
		expect(boundary).toBeGreaterThan(midWord)
	})

	test("consecutive match scores higher than scattered", () => {
		const consecutive = fuzzyScore("ead", "head.md")!
		const scattered = fuzzyScore("ead", "extra-and-dispersed.md")!
		expect(consecutive).toBeGreaterThan(scattered)
	})
})

describe("filterFiles", () => {
	test("empty query returns input unchanged (preserves order)", () => {
		const xs = files(["README.md", "docs/a.md", "zebra.md"])
		expect(filterFiles(xs, "")).toEqual(xs)
	})

	test("non-matching paths are dropped", () => {
		const xs = files(["README.md", "code.md", "notes.md"])
		expect(paths(filterFiles(xs, "zzz"))).toEqual([])
	})

	test("ranks word-boundary matches above mid-word", () => {
		const xs = files(["docs/foo-readme.md", "README.md", "docs/readme-notes.md"])
		const out = paths(filterFiles(xs, "readme"))
		// README.md and docs/readme-notes.md both have a clean boundary match;
		// docs/foo-readme.md has 'readme' mid-word so it should rank last.
		expect(out[out.length - 1]).toBe("docs/foo-readme.md")
		expect(out).toContain("README.md")
		expect(out).toContain("docs/readme-notes.md")
	})

	test("subsequence query (drm) matches docs/readme.md", () => {
		const xs = files(["zebra.md", "docs/readme.md", "alpha.md"])
		const out = paths(filterFiles(xs, "drm"))
		expect(out).toContain("docs/readme.md")
	})

	test("filename matches outrank folder-only matches", () => {
		const xs = files(["readme/notes.md", "docs/readme.md"])
		expect(paths(filterFiles(xs, "readme"))).toEqual(["docs/readme.md", "readme/notes.md"])
	})

	test("current-folder files outrank equally good nested matches", () => {
		const xs = files(["readme.md", "docs/readme.md", "docs/guides/readme.md"])
		expect(paths(filterFiles(xs, "readme")).slice(0, 3)).toEqual([
			"readme.md",
			"docs/readme.md",
			"docs/guides/readme.md",
		])
	})

	test("exact filename match outranks prefix-only variants", () => {
		const xs = files(["readme-old.md", "readme.md", "docs/readme-notes.md"])
		expect(paths(filterFiles(xs, "readme"))[0]).toBe("readme.md")
	})
})
