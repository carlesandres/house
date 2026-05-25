/**
 * PTY-backed regression: the sidebar's selection background must extend
 * across the full row, covering both the basename span and the dim parent
 * span introduced in the basename-first layout. Two-span rendering raises
 * the risk that the row-level bg fails to propagate to one of the children;
 * this test catches that by filtering the terminal output by SGR background
 * color and asserting both pieces of the row are painted.
 *
 * Off by default (PTY tests need a real PTY backend and ~seconds per run).
 * Run with: `HOUSE_PTY=1 bun test test/pty/`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "bun:test"
import { launchTerminal, type Session } from "tuistory"
import { resolveTheme } from "../../src/theme/resolve.ts"
import { getThemeDefinition } from "../../src/theme/registry.ts"

const HOUSE_ENTRY = new URL("../../src/index.tsx", import.meta.url).pathname
const RUN = process.env.HOUSE_PTY === "1"

const theme = getThemeDefinition("opencode")!
const resolved = resolveTheme(theme.source, "dark")
const selectedRowBg = resolved.backgroundElement

const tempDirs: string[] = []
const sessions: Session[] = []

afterAll(() => {
	for (const s of sessions) s.close()
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function makeFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "house-pty-"))
	tempDirs.push(dir)
	mkdirSync(join(dir, "docs"), { recursive: true })
	writeFileSync(join(dir, "README.md"), "# root\n")
	writeFileSync(join(dir, "docs", "intro.md"), "# intro\n")
	writeFileSync(join(dir, "docs", "api.md"), "# api\n")
	return dir
}

async function launchHouse(cwd: string, extraArgs: readonly string[] = []): Promise<Session> {
	const session = await launchTerminal({
		command: process.execPath,
		args: ["run", HOUSE_ENTRY, ...extraArgs, cwd],
		cols: 80,
		rows: 24,
		env: {
			...process.env,
			HOUSE_THEME: "opencode",
			HOUSE_TONE: "dark",
		},
	})
	sessions.push(session)
	return session
}

describe.skipIf(!RUN)("sidebar selection background (PTY)", () => {
	test("selection bg covers both basename and dim parent on the selected row", async () => {
		const dir = makeFixture()
		const session = await launchHouse(dir, ["--focus=sidebar"])

		await session.waitForText(/api\.md/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		const onlySelectedBg = await session.text({
			immediate: true,
			only: { background: selectedRowBg },
			trimEnd: true,
		})

		const collapsed = onlySelectedBg.replace(/\s+/g, " ").trim()
		// The selected sidebar row should appear in full: basename + separator
		// + parent. If only the basename is painted with the selection bg, the
		// parent span would be missing here.
		expect(collapsed).toContain("api.md")
		expect(collapsed).toContain("docs")
		expect(collapsed).toMatch(/api\.md\s+·\s+docs/)
	})

	test("tab focuses the reader so j no longer moves the sidebar selection", async () => {
		const dir = mkdtempSync(join(tmpdir(), "house-pty-tab-"))
		tempDirs.push(dir)
		writeFileSync(join(dir, "a.md"), "# a\n")
		writeFileSync(join(dir, "b.md"), "# b\n")

		const session = await launchHouse(dir, ["--focus=sidebar"])
		await session.waitForText(/b\.md/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		await session.press("tab")
		await session.waitIdle({ timeout: 500 }).catch(() => {})
		await session.press("j")
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		const frame = await session.text({
			immediate: true,
			trimEnd: true,
		})

		expect(frame).toContain("⌂ house · a.md")
		expect(frame).toContain("# a")
		expect(frame).not.toContain("⌂ house · b.md")
	})

	test("tab from the startup filter closes it and focuses the reader", async () => {
		const dir = mkdtempSync(join(tmpdir(), "house-pty-filter-tab-"))
		tempDirs.push(dir)
		writeFileSync(join(dir, "a.md"), "# a\n")
		writeFileSync(join(dir, "b.md"), "# b\n")

		const session = await launchHouse(dir)
		await session.waitForText(/> ▏/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		await session.press("tab")
		await session.waitIdle({ timeout: 500 }).catch(() => {})
		await session.press("j")
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		const frame = await session.text({ immediate: true, trimEnd: true })
		expect(frame).not.toContain("> j▏")
		expect(frame).toContain("⌂ house · a.md")
		expect(frame).toContain("# a")
		expect(frame).not.toContain("No files match: j")
	})
})
