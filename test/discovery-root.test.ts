import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	formatPartialDiscoveryStatus,
	resolveDiscoveryRoot,
	validateDiscoveryRoot,
} from "../src/index.tsx"

let dir: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "house-root-"))
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

describe("resolveDiscoveryRoot", () => {
	test("returns cliRoot when provided", async () => {
		const resolved = await resolveDiscoveryRoot({ cliRoot: "docs", defaultRoot: "git", cwd: dir })
		expect(resolved).toBe("docs")
	})

	test('defaultRoot="cwd" returns cwd', async () => {
		const resolved = await resolveDiscoveryRoot({ cliRoot: null, defaultRoot: "cwd", cwd: dir })
		expect(resolved).toBe(dir)
	})

	test('defaultRoot="git" finds the repo root from nested cwd', async () => {
		await mkdir(join(dir, ".git"))
		const nested = join(dir, "docs", "deep")
		await mkdir(nested, { recursive: true })
		const resolved = await resolveDiscoveryRoot({ cliRoot: null, defaultRoot: "git", cwd: nested })
		expect(resolved).toBe(dir)
	})

	test('defaultRoot="git" falls back to cwd when no repo root is found', async () => {
		const nested = join(dir, "docs", "deep")
		await mkdir(nested, { recursive: true })
		const resolved = await resolveDiscoveryRoot({ cliRoot: null, defaultRoot: "git", cwd: nested })
		expect(resolved).toBe(nested)
	})
})

describe("validateDiscoveryRoot", () => {
	test("accepts an existing directory", async () => {
		await expect(validateDiscoveryRoot(dir)).resolves.toBeUndefined()
	})

	test("rejects a missing path", async () => {
		await expect(validateDiscoveryRoot(join(dir, "missing"))).rejects.toThrow(
			/cannot access discovery root/,
		)
	})

	test("rejects a file path", async () => {
		const file = join(dir, "README.md")
		await writeFile(file, "x", "utf8")
		await expect(validateDiscoveryRoot(file)).rejects.toThrow(/discovery root must be a directory/)
	})
})

describe("formatPartialDiscoveryStatus", () => {
	test("returns null when nothing was skipped", () => {
		expect(formatPartialDiscoveryStatus({ skippedCount: 0, lastSkippedPath: null })).toBeNull()
	})

	test("includes the path when exactly one directory was skipped", () => {
		expect(formatPartialDiscoveryStatus({ skippedCount: 1, lastSkippedPath: "/tmp/locked" })).toBe(
			"scan incomplete: skipped 1 directory: /tmp/locked",
		)
	})

	test("uses a plural summary for multiple skipped directories", () => {
		expect(formatPartialDiscoveryStatus({ skippedCount: 2, lastSkippedPath: "/tmp/locked" })).toBe(
			"scan incomplete: skipped 2 directories",
		)
	})
})
