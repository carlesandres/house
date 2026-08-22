/**
 * PTY-backed: pressing `N` suspends opentui, hands the TTY to `$EDITOR`
 * with cwd = Discovery Root and no file path. A fake editor writes a new
 * markdown file in cwd and exits. After resume the sidebar shows that
 * file and the previously selected file stays selected.
 *
 * Off by default. Run with: `HOUSE_PTY=1 bun test test/pty/`.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "bun:test"
import { launchTerminal, type Session } from "tuistory"

const HOUSE_ENTRY = new URL("../../src/index.tsx", import.meta.url).pathname
const RUN = process.env.HOUSE_PTY === "1"

const tempDirs: string[] = []
const sessions: Session[] = []

afterAll(() => {
	for (const s of sessions) s.close()
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function makeFixture(): { vault: string; editorCmd: string } {
	const dir = mkdtempSync(join(tmpdir(), "house-pty-new-"))
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "note.md"), "# original\n")

	const script = join(dir, "fake-editor.ts")
	writeFileSync(
		script,
		`#!/usr/bin/env bun
await Bun.write("created.md", "# created\\n")
`,
	)
	chmodSync(script, 0o755)
	return { vault: dir, editorCmd: `${process.execPath} ${script}` }
}

async function launchHouse(cwd: string, editorCmd: string): Promise<Session> {
	const session = await launchTerminal({
		command: process.execPath,
		args: ["run", HOUSE_ENTRY, "--root", cwd],
		cols: 80,
		rows: 24,
		env: {
			...process.env,
			HOUSE_THEME: "opencode",
			HOUSE_TONE: "dark",
			EDITOR: editorCmd,
			VISUAL: "",
		},
	})
	sessions.push(session)
	return session
}

describe.skipIf(!RUN)(
	"`N` suspends, creates in cwd, resumes without changing selection (PTY)",
	() => {
		test("sidebar shows the new file and note.md stays selected", async () => {
			const { vault, editorCmd } = makeFixture()
			const session = await launchHouse(vault, editorCmd)

			await session.waitForText(/note\.md/, { timeout: 5_000 })
			await session.waitIdle({ timeout: 500 }).catch(() => {})

			await session.press(["shift", "n"])
			await session.waitIdle({ timeout: 1_000 }).catch(() => {})
			await session.waitForText(/created\.md/, { timeout: 10_000 })

			const frame = await session.text({ trimEnd: true })
			expect(frame).toContain("created.md")
			expect(frame).toContain("note.md")
			expect(frame).toContain("note.md")
			// Header names the selected file; it must stay on the original row.
			expect(frame).toMatch(/note\.md/)
			expect(frame).not.toMatch(/· created\.md/)
		})
	},
)
