/**
 * PTY-backed: pressing `N` opens the New-file prompt, creates an empty
 * markdown file at the Discovery Root, selects it, and hands that path to
 * `$EDITOR` (the same Open in editor path as `E`).
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

function makeFixture(): { vault: string; editorCmd: string; targetMarker: string } {
	const dir = mkdtempSync(join(tmpdir(), "house-pty-new-"))
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "note.md"), "# original\n")

	const targetMarker = "CREATED-BY-FAKE-N"
	const script = join(dir, "fake-editor.ts")
	writeFileSync(
		script,
		`#!/usr/bin/env bun
const path = Bun.argv[2]
if (!path) { console.error("no path arg"); process.exit(2) }
const prev = await Bun.file(path).text()
await Bun.write(path, prev + "\\n## ${targetMarker}\\n")
`,
	)
	chmodSync(script, 0o755)
	return { vault: dir, editorCmd: `${process.execPath} ${script}`, targetMarker }
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

describe.skipIf(!RUN)("`N` prompts, creates, selects, and opens in $EDITOR (PTY)", () => {
	test("the new file is selected and the reader reflects the editor edit", async () => {
		const { vault, editorCmd, targetMarker } = makeFixture()
		const session = await launchHouse(vault, editorCmd)

		await session.waitForText(/note\.md/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		await session.press(["shift", "n"])
		await session.waitForText(/New file/, { timeout: 5_000 })
		await session.type("created")
		await session.press("return")

		await session.waitForText(/created\.md/, { timeout: 10_000 })
		await session.waitForText(new RegExp(targetMarker), { timeout: 10_000 })

		const frame = await session.text({ trimEnd: true })
		expect(frame).toContain("created.md")
		expect(frame).toContain(targetMarker)
	})
})
