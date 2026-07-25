/**
 * PTY-backed regression: pressing `E` suspends opentui, hands the TTY
 * to `$EDITOR`, and on exit re-reads the file so the reader reflects
 * the edit. A fake `$EDITOR` script does the mutation deterministically
 * (no real editor in CI) and also exercises the POSIX shell-split path
 * since the env value contains arguments (`bun <script>`).
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

/** Build a fixture dir with one markdown file plus a fake-editor script
 *  that appends a known marker to its target and exits. The script is a
 *  Bun runnable; we invoke it via `bun <script>` from $EDITOR so the
 *  resolver's shell-split is exercised end-to-end. */
function makeFixture(): { vault: string; editorCmd: string; targetMarker: string } {
	const dir = mkdtempSync(join(tmpdir(), "house-pty-edit-"))
	tempDirs.push(dir)
	mkdirSync(dir, { recursive: true })

	const targetMarker = "EDITED-BY-FAKE-99"
	writeFileSync(join(dir, "note.md"), "# original\n\nbefore edit\n")

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

	const editorCmd = `${process.execPath} ${script}`
	return { vault: dir, editorCmd, targetMarker }
}

async function launchHouse(cwd: string, editorCmd: string): Promise<Session> {
	const session = await launchTerminal({
		command: process.execPath,
		args: ["run", HOUSE_ENTRY, cwd],
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

describe.skipIf(!RUN)("`E` suspends, edits, resumes, reloads (PTY)", () => {
	test("the reader reflects an edit made by the fake $EDITOR", async () => {
		const { vault, editorCmd, targetMarker } = makeFixture()
		const session = await launchHouse(vault, editorCmd)

		// Wait for house to come up and discovery to settle so `note.md` is
		// the selected (single) file.
		await session.waitForText(/note\.md/, { timeout: 5_000 })
		await session.waitIdle({ timeout: 500 }).catch(() => {})

		// Focus the reader so the user is looking at the rendered markdown,
		// then press `E`. The fake editor runs synchronously and exits;
		// on resume the reader should re-read and surface the marker.
		await session.press("tab")
		await session.waitIdle({ timeout: 500 }).catch(() => {})
		await session.press(["shift", "e"])

		// Wait specifically for the marker to appear in the rendered
		// content — proves both the editor ran *and* the post-edit reload
		// fired.
		await session.waitForText(new RegExp(targetMarker), { timeout: 5_000 })

		const frame = await session.text({ trimEnd: true })
		expect(frame).toContain(targetMarker)
	})
})
