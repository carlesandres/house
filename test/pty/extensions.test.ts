/**
 * PTY-backed smoke check for extension allow-list wiring.
 *
 * Off by default. Run with: `HOUSE_PTY=1 bun test test/pty/extensions.test.ts`.
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
	const dir = mkdtempSync(join(tmpdir(), "house-ext-pty-"))
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "README.md"), "# hello\n")
	writeFileSync(join(dir, "notes.note"), "# note\n")
	writeFileSync(join(dir, "draft.txt"), "# draft\n")
	return dir
}

async function launchHouse(
	cwd: string,
	options: { extArg?: string; env?: Record<string, string | undefined> } = {},
): Promise<Session> {
	const session = await launchTerminal({
		command: process.execPath,
		args: [
			"run",
			HOUSE_ENTRY,
			"--focus=sidebar",
			"--root",
			cwd,
			...(options.extArg ? ["--ext", options.extArg] : []),
		],
		cols: 80,
		rows: 24,
		env: {
			...process.env,
			HOUSE_THEME: "opencode",
			HOUSE_TONE: "dark",
			...options.env,
		},
	})
	sessions.push(session)
	return session
}

describe.skipIf(!RUN)("extension allow-list (PTY)", () => {
	test("includes configured extensions in discovery", async () => {
		const dir = makeFixture()
		const session = await launchHouse(dir, "note,txt")

		await session.waitForText(/README\.md/, { timeout: 5_000 })
		await session.waitForText(/notes\.note/, { timeout: 5_000 })
		await session.waitForText(/draft\.txt/, { timeout: 5_000 })

		const text = await session.text({ immediate: true, trimEnd: true })
		expect(text).toContain("README.md")
		expect(text).toContain("notes.note")
		expect(text).toContain("draft.txt")
	})

	test("honors extensions from config file", async () => {
		const dir = makeFixture()
		const configRoot = mkdtempSync(join(tmpdir(), "house-ext-pty-cfg-"))
		tempDirs.push(configRoot)
		mkdirSync(join(configRoot, "house"), { recursive: true })
		writeFileSync(join(configRoot, "house", "config.toml"), `extensions = ["note"]\n`)
		const session = await launchHouse(dir, { env: { XDG_CONFIG_HOME: configRoot } })

		await session.waitForText(/notes\.note/, { timeout: 5_000 })
		const text = await session.text({ immediate: true, trimEnd: true })
		expect(text).toContain("notes.note")
		expect(text).not.toContain("draft.txt")
	})
})
