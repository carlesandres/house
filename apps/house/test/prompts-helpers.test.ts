import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileRecord } from "@house/ui/file-navigator"
import {
	captureActionTarget,
	destinationRelativePath,
	parentRelativeOf,
	promptLiveStatus,
	retargetPreviewIfNeeded,
	siblingExistsExact,
} from "../src/prompts/helpers.ts"

const file = (relativePath: string, root = "/vault"): FileRecord => {
	const basename = relativePath.includes("/")
		? relativePath.slice(relativePath.lastIndexOf("/") + 1)
		: relativePath
	return {
		absolutePath: `${root}/${relativePath}`,
		relativePath,
		basename,
		extension: ".md",
		size: 0,
		mtimeMs: 0,
	}
}

describe("prompts helpers — paths", () => {
	test("parentRelativeOf strips the basename", () => {
		expect(parentRelativeOf("foo.md")).toBe("")
		expect(parentRelativeOf("notes/foo.md")).toBe("notes")
		expect(parentRelativeOf("a/b/c.md")).toBe("a/b")
	})

	test("destinationRelativePath joins under the parent", () => {
		expect(destinationRelativePath("", "bar.md")).toBe("bar.md")
		expect(destinationRelativePath("notes", "bar.md")).toBe("notes/bar.md")
	})

	test("captureActionTarget freezes path fields", () => {
		expect(captureActionTarget(file("notes/foo.md"))).toEqual({
			absolutePath: "/vault/notes/foo.md",
			parentDir: "/vault/notes",
			relativePath: "notes/foo.md",
			basename: "foo.md",
			parentRelative: "notes",
		})
	})

	test("siblingExistsExact sees siblings and respects exceptBasename", () => {
		const dir = mkdtempSync(join(tmpdir(), "house-sibling-"))
		mkdirSync(join(dir, "nested"))
		writeFileSync(join(dir, "nested", "a.md"), "x")
		writeFileSync(join(dir, "nested", "b.md"), "y")
		expect(siblingExistsExact(join(dir, "nested"), "a.md")).toBe(true)
		expect(siblingExistsExact(join(dir, "nested"), "a.md", "a.md")).toBe(false)
		expect(siblingExistsExact(join(dir, "nested"), "missing.md")).toBe(false)
	})
})

describe("prompts helpers — live status", () => {
	test("returns null for an empty name", () => {
		expect(promptLiveStatus("", "rename", "", "a.md", false)).toBeNull()
	})

	test("surfaces resolve errors and filter / collision warnings", () => {
		expect(promptLiveStatus("notes/x", "rename", "", "x.md", false)).toEqual({
			kind: "error",
			lines: ["name must be a single file name"],
		})
		expect(promptLiveStatus("bar.md", "rename", "zzz", "notes/bar.md", false)).toEqual({
			kind: "warning",
			lines: ["filter will change to bar.md"],
		})
		expect(promptLiveStatus("bar.md", "rename", "", "bar.md", true)).toEqual({
			kind: "warning",
			lines: ["already exists"],
		})
	})
})

describe("prompts helpers — preview retarget", () => {
	test("retargets only when the preview serves the source path", () => {
		const calls: string[] = []
		const preview = {
			currentTarget: () => "/vault/a.md",
			setTarget: (path: string) => calls.push(path),
		}
		retargetPreviewIfNeeded(preview, "/vault/a.md", "/vault/b.md")
		expect(calls).toEqual(["/vault/b.md"])

		calls.length = 0
		retargetPreviewIfNeeded(preview, "/vault/other.md", "/vault/b.md")
		expect(calls).toEqual([])

		retargetPreviewIfNeeded(null, "/vault/a.md", "/vault/b.md")
		expect(calls).toEqual([])
	})
})
