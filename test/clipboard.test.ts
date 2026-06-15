import { describe, expect, test } from "bun:test"
import {
	copyTextToClipboard,
	resolveClipboardCommand,
	type ClipboardCommand,
} from "../src/io/clipboard.ts"

describe("resolveClipboardCommand", () => {
	test("uses pbcopy on macOS", () => {
		expect(resolveClipboardCommand("darwin", () => undefined)).toEqual({ cmd: "pbcopy", args: [] })
	})

	test("uses wl-copy on Linux when available", () => {
		expect(resolveClipboardCommand("linux", (cmd) => (cmd === "wl-copy" ? "/usr/bin/wl-copy" : undefined))).toEqual({
			cmd: "wl-copy",
			args: [],
		})
	})

	test("falls back to xclip on Linux", () => {
		expect(resolveClipboardCommand("linux", (cmd) => (cmd === "xclip" ? "/usr/bin/xclip" : undefined))).toEqual({
			cmd: "xclip",
			args: ["-selection", "clipboard"],
		})
	})

	test("returns null when no supported clipboard tool is available", () => {
		expect(resolveClipboardCommand("linux", () => undefined)).toBeNull()
	})
})

describe("copyTextToClipboard", () => {
	test("passes the exact raw text to the clipboard writer over stdin", async () => {
		const writes: Array<{ command: ClipboardCommand; text: string }> = []
		await copyTextToClipboard("# Read me\n\nBody\n", {
			platform: "darwin",
			which: () => undefined,
			spawn: async (command, text) => {
				writes.push({ command, text })
				return 0
			},
		})
		expect(writes).toEqual([
			{ command: { cmd: "pbcopy", args: [] }, text: "# Read me\n\nBody\n" },
		])
	})

	test("fails with a specific message when no clipboard tool exists", async () => {
		await expect(
			copyTextToClipboard("x", {
				platform: "linux",
				which: () => undefined,
				spawn: async () => 0,
			}),
		).rejects.toThrow("no clipboard tool found")
	})

	test("fails with a specific message when the clipboard command exits non-zero", async () => {
		await expect(
			copyTextToClipboard("x", {
				platform: "darwin",
				which: () => undefined,
				spawn: async () => 1,
			}),
		).rejects.toThrow("clipboard command failed")
	})
})
