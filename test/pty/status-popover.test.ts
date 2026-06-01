/**
 * PTY-backed smoke check for the temporary footer StatusPopover trigger.
 *
 * Off by default. Run with: `HOUSE_PTY=1 bun test test/pty/status-popover.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { launchTerminal, type Session } from "tuistory"

const HOUSE_ENTRY = new URL("../../src/index.tsx", import.meta.url).pathname
const RUN = process.env.HOUSE_PTY === "1"

setDefaultTimeout(20_000)

const tempDirs: string[] = []
const sessions: Session[] = []

afterAll(() => {
	for (const s of sessions) s.close()
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function makeFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "house-popover-pty-"))
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "README.md"), "# hello\n")
	return dir
}

async function launchHouse(cwd: string): Promise<Session> {
	const session = await launchTerminal({
		command: process.execPath,
		args: ["run", HOUSE_ENTRY, "--focus=sidebar", "--root", cwd],
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

describe.skipIf(!RUN)("StatusPopover footer trigger (PTY)", () => {
	test("clicking the temporary footer warning opens the popover", async () => {
		const dir = makeFixture()
		const session = await launchHouse(dir)

		await session.waitForText(/README\.md/, { timeout: 5_000 })
		await session.waitForText(/!/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		await session.click(/!/)
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		const frame = await session.text({ immediate: true, trimEnd: true })
		expect(frame).toContain("temporary footer validation")
	})
})
