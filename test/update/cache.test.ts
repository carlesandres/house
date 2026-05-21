import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readCache, writeCache } from "../../src/update/cache.ts"

let tmp: string
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "house-cache-"))
})
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true })
})

describe("update cache IO", () => {
	test("write then read round-trips the record", async () => {
		const path = join(tmp, "nested", "update-check.json")
		await writeCache({ checkedAt: 123, latestVersion: "0.5.0", tarballOk: true }, path)
		const r = await readCache(path)
		expect(r).toEqual({ checkedAt: 123, latestVersion: "0.5.0", tarballOk: true })
	})

	test("missing file reads as null without throwing", async () => {
		const r = await readCache(join(tmp, "absent.json"))
		expect(r).toBeNull()
	})

	test("malformed JSON reads as null", async () => {
		const path = join(tmp, "bad.json")
		await Bun.write(path, "not json{{{")
		const r = await readCache(path)
		expect(r).toBeNull()
	})

	test("missing required fields reads as null", async () => {
		const path = join(tmp, "partial.json")
		await Bun.write(path, JSON.stringify({ checkedAt: 1, latestVersion: "0.5.0" }))
		const r = await readCache(path)
		expect(r).toBeNull()
	})

	test("write is atomic — no .tmp file lingers, and the target is either complete or untouched", async () => {
		const path = join(tmp, "update-check.json")
		// Seed the file with a known-good value.
		await writeCache({ checkedAt: 1, latestVersion: "0.4.0", tarballOk: true }, path)
		// Overwrite — atomic rename should replace the file in one step.
		await writeCache({ checkedAt: 2, latestVersion: "0.5.0", tarballOk: true }, path)
		const r = await readCache(path)
		expect(r).toEqual({ checkedAt: 2, latestVersion: "0.5.0", tarballOk: true })
		// No `.tmp` siblings should be left behind in the cache dir.
		const leftovers = readdirSync(tmp).filter((f) => f.endsWith(".tmp"))
		expect(leftovers).toEqual([])
	})
})
