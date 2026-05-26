import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveDiscoveryRoot } from "../src/index.tsx"

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
