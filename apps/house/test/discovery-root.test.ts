import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	formatFatalDiscoveryStatus,
	formatPartialDiscoveryStatus,
	resolveInitialQuery,
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
		expect(resolved).toBe(join(dir, "docs"))
	})

	test("normalizes equivalent cliRoot spellings to the same absolute root", async () => {
		await mkdir(join(dir, "docs"))
		const bare = await resolveDiscoveryRoot({ cliRoot: "docs", defaultRoot: "cwd", cwd: dir })
		const dotted = await resolveDiscoveryRoot({ cliRoot: "./docs", defaultRoot: "cwd", cwd: dir })
		const absolute = await resolveDiscoveryRoot({
			cliRoot: join(dir, "docs"),
			defaultRoot: "cwd",
			cwd: dir,
		})

		expect(bare).toBe(join(dir, "docs"))
		expect(dotted).toBe(bare)
		expect(absolute).toBe(bare)
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

describe("resolveInitialQuery", () => {
	test("returns empty query when no positional was given", () => {
		expect(resolveInitialQuery({ pathArg: null, discoveryRoot: dir, cwd: dir })).toBe("")
	})

	test("converts a relative file inside the root into a relative query", async () => {
		const nested = join(dir, "docs")
		await mkdir(nested, { recursive: true })
		expect(resolveInitialQuery({ pathArg: "./docs/intro.md", discoveryRoot: dir, cwd: dir })).toBe(
			"docs/intro.md",
		)
	})

	test("converts an absolute path inside the root into a relative query", async () => {
		const file = join(dir, "docs", "intro.md")
		await mkdir(join(dir, "docs"), { recursive: true })
		await writeFile(file, "x", "utf8")
		expect(resolveInitialQuery({ pathArg: file, discoveryRoot: dir, cwd: dir })).toBe(
			"docs/intro.md",
		)
	})

	test("preserves a path outside the discovery root", () => {
		expect(resolveInitialQuery({ pathArg: "../elsewhere.md", discoveryRoot: dir, cwd: dir })).toBe(
			"../elsewhere.md",
		)
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

	test.skipIf(process.getuid?.() === 0)("rejects an unreadable directory", async () => {
		const locked = join(dir, "locked")
		await mkdir(locked)
		await chmod(locked, 0o000)
		try {
			await expect(validateDiscoveryRoot(locked)).rejects.toThrow(/cannot read discovery root/)
		} finally {
			await chmod(locked, 0o700)
		}
	})
})

describe("house --root", () => {
	test("reports an invalid root on stderr before the TUI starts", async () => {
		const file = join(dir, "README.md")
		await writeFile(file, "x", "utf8")
		const entry = fileURLToPath(new URL("../src/index.tsx", import.meta.url))
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith("HOUSE_")),
		)
		const child = Bun.spawn([process.execPath, entry, "--root", file, "--no-update-check"], {
			cwd: dir,
			env: { ...env, XDG_CONFIG_HOME: dir },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})
		expect(await child.exited).toBe(1)
		expect(await new Response(child.stderr).text()).toContain(
			`house: discovery root must be a directory, got file ${file}`,
		)
		expect(await new Response(child.stdout).text()).toBe("")
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

describe("formatFatalDiscoveryStatus", () => {
	test("returns a short user-facing status without raw diagnostics", () => {
		const status = formatFatalDiscoveryStatus()
		expect(status).toBe("scan failed: unable to read discovery root")
		expect(status).not.toContain("\n")
		expect(status).not.toContain("Cause")
		expect(status).not.toContain("DiscoveryError")
	})
})
