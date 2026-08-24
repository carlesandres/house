import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEmptyFileExclusive } from "../src/io/createFile.ts"

describe("createEmptyFileExclusive", () => {
	test("creates a 0-byte file and refuses to overwrite", async () => {
		const dir = mkdtempSync(join(tmpdir(), "house-create-"))
		try {
			const path = join(dir, "fresh.md")
			expect(await createEmptyFileExclusive(path)).toEqual({ ok: true })
			expect(readFileSync(path).length).toBe(0)

			writeFileSync(path, "keep me")
			expect(await createEmptyFileExclusive(path)).toEqual({
				ok: false,
				reason: "already-exists",
			})
			expect(readFileSync(path, "utf8")).toBe("keep me")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test("treats an existing directory as already exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "house-create-dir-"))
		try {
			const path = join(dir, "notes.md")
			mkdirSync(path)
			expect(await createEmptyFileExclusive(path)).toEqual({
				ok: false,
				reason: "already-exists",
			})
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test("surfaces other IO failures", async () => {
		const dir = mkdtempSync(join(tmpdir(), "house-create-io-"))
		try {
			const path = join(dir, "missing", "nested.md")
			const result = await createEmptyFileExclusive(path)
			expect(result.ok).toBe(false)
			if (result.ok || result.reason !== "io") throw new Error("expected io failure")
			expect(result.message.length).toBeGreaterThan(0)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
