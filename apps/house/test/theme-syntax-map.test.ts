/**
 * Coverage check for the tree-sitter scope map house feeds to opentui's
 * `<markdown>` renderer. We don't re-test opentui itself — we test that
 * for every markdown node type DESIGN §5.1.3 promises, our syntax map
 * has a corresponding style. Without these mappings, opentui renders
 * the node as plain text.
 */
import { describe, expect, test } from "bun:test"
import { colors } from "../src/theme/colors.ts"

const required = [
	// Headings
	"markup.heading",
	"markup.heading.1",
	"markup.heading.2",
	"markup.heading.3",
	// Inline emphasis
	"markup.bold",
	"markup.strong",
	"markup.italic",
	"markup.strikethrough",
	// Inline code + fenced blocks
	"markup.raw",
	"markup.raw.inline",
	"markup.raw.block",
	// Links (and images, which opentui styles as links)
	"markup.link",
	"markup.link.label",
	"markup.link.url",
	// Lists and blockquotes
	"markup.list",
	"markup.quote",
	// Conceal markers (asterisks, backticks) and the catch-all
	"conceal",
	"default",
] as const

describe("colors.syntax — scope coverage for DESIGN §5.1.3 nodes", () => {
	for (const scope of required) {
		test(`maps ${scope}`, () => {
			expect(colors.syntax[scope]).toBeDefined()
		})
	}

	test("every mapped style has a usable fg or attribute", () => {
		for (const [scope, style] of Object.entries(colors.syntax)) {
			const usable =
				style.fg !== undefined ||
				style.bg !== undefined ||
				style.bold ||
				style.italic ||
				style.underline ||
				style.dim
			expect(usable, `scope ${scope} has no visible effect`).toBe(true)
		}
	})
})
