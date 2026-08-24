import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renameMarkdownFile } from "../src/io/renameFile.ts"

const withDir = async (run: (dir: string) => Promise<void>) => {
	const dir = mkdtempSync(join(tmpdir(), "house-rename-"))
	try {
		await run(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

describe("renameMarkdownFile", () => {
	test("renames within the same parent and refuses overwrite", async () => {
		await withDir(async (dir) => {
			const source = join(dir, "old.md")
			const other = join(dir, "taken.md")
			writeFileSync(source, "hello")
			writeFileSync(other, "keep")

			expect(
				await renameMarkdownFile({
					discoveryRoot: dir,
					sourcePath: source,
					parentDir: dir,
					newBasename: "new.md",
				}),
			).toMatchObject({ ok: true, to: join(dir, "new.md") })
			expect(readFileSync(join(dir, "new.md"), "utf8")).toBe("hello")
			expect(readdirSync(dir).includes("old.md")).toBe(false)

			expect(
				await renameMarkdownFile({
					discoveryRoot: dir,
					sourcePath: join(dir, "new.md"),
					parentDir: dir,
					newBasename: "taken.md",
				}),
			).toEqual({ ok: false, reason: "already-exists", message: "already exists" })
			expect(readFileSync(other, "utf8")).toBe("keep")
		})
	})

	test("identical basename is a successful no-op", async () => {
		await withDir(async (dir) => {
			const source = join(dir, "same.md")
			writeFileSync(source, "x")
			const result = await renameMarkdownFile({
				discoveryRoot: dir,
				sourcePath: source,
				parentDir: dir,
				newBasename: "same.md",
			})
			expect(result).toMatchObject({ ok: true, noop: true })
			expect(readFileSync(source, "utf8")).toBe("x")
		})
	})

	test("nested files stay in their parent", async () => {
		await withDir(async (dir) => {
			const parent = join(dir, "notes")
			mkdirSync(parent)
			const source = join(parent, "foo.md")
			writeFileSync(source, "nested")
			const result = await renameMarkdownFile({
				discoveryRoot: dir,
				sourcePath: source,
				parentDir: parent,
				newBasename: "bar.md",
			})
			expect(result).toMatchObject({ ok: true, to: join(parent, "bar.md") })
			expect(readFileSync(join(parent, "bar.md"), "utf8")).toBe("nested")
			expect(readdirSync(dir)).toEqual(["notes"])
		})
	})

	test("missing or moved targets report non-retryable errors", async () => {
		await withDir(async (dir) => {
			const missing = await renameMarkdownFile({
				discoveryRoot: dir,
				sourcePath: join(dir, "gone.md"),
				parentDir: dir,
				newBasename: "next.md",
			})
			expect(missing).toEqual({ ok: false, reason: "target-missing", message: "target missing" })

			const parent = join(dir, "notes")
			mkdirSync(parent)
			const source = join(dir, "root.md")
			writeFileSync(source, "x")
			const changed = await renameMarkdownFile({
				discoveryRoot: dir,
				sourcePath: source,
				parentDir: parent,
				newBasename: "next.md",
			})
			expect(changed).toEqual({ ok: false, reason: "target-changed", message: "target changed" })
		})
	})

	test("case-only rename succeeds via a temporary sibling", async () => {
		await withDir(async (dir) => {
			const source = join(dir, "meeting.md")
			writeFileSync(source, "agenda")
			const result = await renameMarkdownFile({
				discoveryRoot: dir,
				sourcePath: source,
				parentDir: dir,
				newBasename: "Meeting.md",
			})
			expect(result.ok).toBe(true)
			const entries = readdirSync(dir)
			expect(entries).toContain("Meeting.md")
			expect(entries.some((e) => e.includes("house-rename-"))).toBe(false)
			expect(readFileSync(join(dir, "Meeting.md"), "utf8")).toBe("agenda")
		})
	})
})
