/**
 * Fail-closed markdown highlighter gate.
 *
 * OpenTUI's `<markdown>` silently renders raw source when TreeSitterClient
 * cannot initialize (opentui#1201). House treats that as a broken install:
 * the TUI must not start, and package builds must not succeed, unless the
 * wasm path OpenTUI imports resolves and the bundled markdown/typescript
 * parsers actually highlight.
 */
import { createRequire } from "node:module"
import { getTreeSitterClient } from "@opentui/core"
import housePkg from "../../package.json" with { type: "json" }

/** Specifier OpenTUI 0.5.x imports from the tree-sitter worker. */
export const TREE_SITTER_WASM_SPECIFIER = "web-tree-sitter/tree-sitter.wasm"

const require = createRequire(import.meta.url)

export type HighlighterAssetOptions = {
	readonly resolveSpecifier?: (specifier: string) => string
	readonly houseWebTreeSitter?: string
	readonly opentuiPeerWebTreeSitter?: string
}

const highlighterUnavailable = (detail: string): Error =>
	new Error(`markdown highlighter unavailable: ${detail}`)

const readHouseWebTreeSitter = (): string => {
	const version = housePkg.dependencies["web-tree-sitter"]
	if (typeof version !== "string" || version.length === 0) {
		throw highlighterUnavailable("house does not declare a web-tree-sitter dependency")
	}
	return version
}

const readOpentuiPeerWebTreeSitter = (): string => {
	const pkg = require("@opentui/core/package.json") as {
		readonly peerDependencies?: { readonly "web-tree-sitter"?: string }
	}
	const peer = pkg.peerDependencies?.["web-tree-sitter"]
	if (typeof peer !== "string" || peer.length === 0) {
		throw highlighterUnavailable("@opentui/core does not declare a web-tree-sitter peer")
	}
	return peer
}

const defaultResolveSpecifier = (specifier: string): string => import.meta.resolve(specifier)

/**
 * Check the install shape OpenTUI needs: house's `web-tree-sitter` pin matches
 * `@opentui/core`'s peer, and `web-tree-sitter/tree-sitter.wasm` resolves.
 */
export const assertHighlighterAssets = (options: HighlighterAssetOptions = {}): void => {
	const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
	try {
		resolveSpecifier(TREE_SITTER_WASM_SPECIFIER)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw highlighterUnavailable(`cannot resolve ${TREE_SITTER_WASM_SPECIFIER}: ${detail}`)
	}

	const houseWebTreeSitter = options.houseWebTreeSitter ?? readHouseWebTreeSitter()
	const opentuiPeerWebTreeSitter =
		options.opentuiPeerWebTreeSitter ?? readOpentuiPeerWebTreeSitter()
	if (houseWebTreeSitter !== opentuiPeerWebTreeSitter) {
		throw highlighterUnavailable(
			`web-tree-sitter ${houseWebTreeSitter} does not match @opentui/core peer ${opentuiPeerWebTreeSitter}`,
		)
	}
}

const SMOKE_HIGHLIGHTS = [
	{ label: "markdown", content: "# Title\n", filetype: "markdown" },
	{ label: "typescript", content: "const x = 1\n", filetype: "typescript" },
] as const

/**
 * Initialize OpenTUI's TreeSitterClient and prove bundled parsers work.
 * Call this before creating the CLI renderer so a broken highlighter cannot
 * take over the terminal and render raw markdown.
 */
export const ensureMarkdownHighlighter = async (): Promise<void> => {
	assertHighlighterAssets()
	const client = getTreeSitterClient()
	try {
		await client.initialize()
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw highlighterUnavailable(`tree-sitter failed to initialize: ${detail}`)
	}
	if (!client.isInitialized()) {
		throw highlighterUnavailable("tree-sitter initialized without becoming ready")
	}
	for (const sample of SMOKE_HIGHLIGHTS) {
		const result = await client.highlightOnce(sample.content, sample.filetype)
		if (result.error) {
			throw highlighterUnavailable(`${sample.label} highlight failed: ${result.error}`)
		}
		if (result.highlights === undefined || result.highlights.length === 0) {
			throw highlighterUnavailable(`${sample.label} highlight returned no tokens`)
		}
	}
}
