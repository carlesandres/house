/**
 * PTY-backed smoke check for the real footer discovery-warning popover trigger.
 *
 * Off by default. Run with: `HOUSE_PTY=1 bun test test/pty/status-popover.test.ts`.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { launchTerminal, type Session } from "tuistory"

const HOUSE_ENTRY = new URL("../../src/index.tsx", import.meta.url).pathname
const RUN = process.env.HOUSE_PTY === "1"

setDefaultTimeout(20_000)

const tempDirs: string[] = []
const lockedDirs: string[] = []
const sessions: Session[] = []

afterAll(() => {
	for (const s of sessions) s.close()
	for (const d of lockedDirs) {
		try {
			chmodSync(d, 0o755)
		} catch {}
	}
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function makeFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "house-popover-pty-"))
	const locked = join(dir, "x")
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "README.md"), "# hello\n")
	mkdirSync(locked)
	writeFileSync(join(locked, "secret.md"), "# secret\n")
	chmodSync(locked, 0o000)
	lockedDirs.push(locked)
	return dir
}

async function waitForSnapshot(
	session: Session,
	predicate: (text: string) => boolean,
	timeoutMs = 5_000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs
	let text = ""
	while (Date.now() < deadline) {
		text = await session.text({ immediate: true, trimEnd: true })
		if (predicate(text)) return text
		await new Promise<void>((resolve) => setTimeout(resolve, 50))
	}
	return text
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
	test("clicking the partial discovery warning opens and closes the popover", async () => {
		const dir = makeFixture()
		const session = await launchHouse(dir)

		await session.waitForText(/README\.md/, { timeout: 5_000 })
		await session.waitForText(/!/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		const compact = await session.text({ immediate: true, trimEnd: true })
		expect(compact).not.toContain("scan incomplete: skipped 1 directory: x")

		await session.clickAt(1, 23)
		await session.waitIdle({ timeout: 500 }).catch(() => {})
		const open = await session.waitForText(/scan incomplete: skipped 1 directory: x/, {
			timeout: 5_000,
		})
		expect(open).not.toContain(dir)

		await session.clickAt(1, 23)
		await session.waitIdle({ timeout: 500 }).catch(() => {})
		const closed = await waitForSnapshot(
			session,
			(text) => !text.includes("scan incomplete: skipped 1 directory: x"),
		)
		expect(closed).not.toContain("scan incomplete: skipped 1 directory: x")
	})
})
