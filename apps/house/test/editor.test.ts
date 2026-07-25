/**
 * Tests for the `$VISUAL` / `$EDITOR` resolver and POSIX shell-split.
 *
 * Spawn behavior is intentionally out of scope — exercised by the PTY
 * smoke test once `E` is wired into Browser.
 */

import { describe, expect, test } from "bun:test"
import { resolveEditor, splitEditorString } from "../src/io/editor.ts"

describe("splitEditorString", () => {
	test("bare command", () => {
		expect(splitEditorString("vim")).toEqual(["vim"])
	})

	test("command with flags", () => {
		expect(splitEditorString("code --wait")).toEqual(["code", "--wait"])
		expect(splitEditorString("nvim -u NONE -p")).toEqual(["nvim", "-u", "NONE", "-p"])
	})

	test("collapses runs of whitespace and tabs", () => {
		expect(splitEditorString("vim   --noplugin\t-u\tNONE")).toEqual([
			"vim",
			"--noplugin",
			"-u",
			"NONE",
		])
	})

	test("double-quoted path with spaces", () => {
		expect(splitEditorString('"/Applications/Sublime Text/subl" --wait')).toEqual([
			"/Applications/Sublime Text/subl",
			"--wait",
		])
	})

	test("single-quoted args are literal", () => {
		expect(splitEditorString("vim '+set ft=markdown'")).toEqual(["vim", "+set ft=markdown"])
	})

	test("backslash escapes space outside quotes", () => {
		expect(splitEditorString("/usr/local/bin/My\\ Editor --wait")).toEqual([
			"/usr/local/bin/My Editor",
			"--wait",
		])
	})

	test('double-quoted escapes for \\" and \\\\', () => {
		expect(splitEditorString('vim "say \\"hi\\""')).toEqual(["vim", 'say "hi"'])
		expect(splitEditorString('vim "a\\\\b"')).toEqual(["vim", "a\\b"])
	})

	test("empty input → no tokens", () => {
		expect(splitEditorString("")).toEqual([])
		expect(splitEditorString("   \t  ")).toEqual([])
	})

	test("unbalanced quote emits the partial token rather than throwing", () => {
		// `sh` would error; we defer the error to spawn so callers see a
		// real ENOENT/etc. with the bad argv instead of a swallowed parse.
		expect(splitEditorString('vim "unterminated')).toEqual(["vim", "unterminated"])
	})

	test("adjacent quoted+unquoted segments coalesce into one token", () => {
		// POSIX behavior: `foo"bar baz"` → `foobar baz`. Rare in $EDITOR but
		// worth pinning so we don't regress to whitespace-only splitting.
		expect(splitEditorString('pre"fix mid"post')).toEqual(["prefix midpost"])
	})
})

describe("resolveEditor", () => {
	test("$VISUAL wins over $EDITOR", () => {
		const r = resolveEditor({ VISUAL: "code --wait", EDITOR: "vim" })
		expect(r).toEqual({ cmd: "code", args: ["--wait"] })
	})

	test("falls back to $EDITOR when $VISUAL is unset", () => {
		expect(resolveEditor({ EDITOR: "vim" })).toEqual({ cmd: "vim", args: [] })
	})

	test("falls back to $EDITOR when $VISUAL is empty / whitespace-only", () => {
		// Empty $VISUAL is common in dotfiles that conditionally export it;
		// honoring it as 'set' would block the $EDITOR fallback. Trim and
		// treat as unset.
		expect(resolveEditor({ VISUAL: "", EDITOR: "vim" })).toEqual({ cmd: "vim", args: [] })
		expect(resolveEditor({ VISUAL: "   ", EDITOR: "vim" })).toEqual({ cmd: "vim", args: [] })
	})

	test("both unset → null", () => {
		expect(resolveEditor({})).toBeNull()
	})

	test("both empty → null", () => {
		expect(resolveEditor({ VISUAL: "", EDITOR: "" })).toBeNull()
	})

	test("trims surrounding whitespace before splitting", () => {
		expect(resolveEditor({ EDITOR: "  vim --noplugin  " })).toEqual({
			cmd: "vim",
			args: ["--noplugin"],
		})
	})
})
