/**
 * Fail-closed highlighter gate. OpenTUI falls back to raw markdown when
 * TreeSitterClient cannot initialize; these tests cover the house-owned
 * checks that refuse to build or start in that state.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { getTreeSitterClient } from "@opentui/core"
import {
	TREE_SITTER_WASM_SPECIFIER,
	assertHighlighterAssets,
	ensureMarkdownHighlighter,
} from "../src/markdown/highlighter.ts"
import { resetOpenTuiSingletons } from "./helpers/opentui-test-cleanup.ts"
import housePkg from "../package.json" with { type: "json" }
import rootPkg from "../../../package.json" with { type: "json" }

afterEach(async () => {
	const client = getTreeSitterClient()
	await client.destroy()
	resetOpenTuiSingletons()
})

describe("highlighter assets", () => {
	test("resolves the wasm path OpenTUI imports and matches its peer", () => {
		expect(() => assertHighlighterAssets()).not.toThrow()
		expect(() => import.meta.resolve(TREE_SITTER_WASM_SPECIFIER)).not.toThrow()
		expect(housePkg.dependencies["web-tree-sitter"]).toBe("0.25.10")
		expect(rootPkg.overrides["web-tree-sitter"]).toBe(housePkg.dependencies["web-tree-sitter"])
	})

	test("fails when the wasm specifier cannot resolve", () => {
		expect(() =>
			assertHighlighterAssets({
				resolveSpecifier: () => {
					throw new Error("Cannot find module 'web-tree-sitter/tree-sitter.wasm'")
				},
			}),
		).toThrow(/cannot resolve web-tree-sitter\/tree-sitter\.wasm/)
	})

	test("fails when house's web-tree-sitter pin drifts from OpenTUI's peer", () => {
		expect(() =>
			assertHighlighterAssets({
				houseWebTreeSitter: "0.27.0",
				opentuiPeerWebTreeSitter: "0.25.10",
			}),
		).toThrow(/web-tree-sitter 0\.27\.0 does not match @opentui\/core peer 0\.25\.10/)
	})
})

describe("ensureMarkdownHighlighter", () => {
	test("initializes tree-sitter and highlights bundled markdown and typescript", async () => {
		await ensureMarkdownHighlighter()
	})
})
