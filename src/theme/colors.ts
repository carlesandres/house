import type { StyleDefinitionInput } from "@opentui/core"
import { resolveTheme } from "./resolve.ts"
import type { ColorPalette, ResolvedTheme, ThemeDefinition, Tone } from "./types.ts"

/**
 * Adapt a resolved theme (opencode-shaped flat tokens) to the
 * {@link ColorPalette} shape consumed by Browser / HelpOverlay / index.
 *
 * - UI tokens map name-for-name with OpenCode's TUI theme semantics.
 * - `syntax` is a fully populated opentui tree-sitter scope map built from
 *   `markdown*` and `syntax*` tokens.
 */
const buildPalette = (r: ResolvedTheme): ColorPalette => {
	return {
		background: r.background,
		backgroundPanel: r.backgroundPanel,
		backgroundElement: r.backgroundElement,
		text: r.text,
		textMuted: r.textMuted,
		border: r.border,
		borderActive: r.borderActive,
		borderSubtle: r.borderSubtle,
		selectedListItemText: r.selectedListItemText,
		primary: r.primary,
		secondary: r.secondary,
		accent: r.accent,
		error: r.error,
		warning: r.warning,
		success: r.success,
		info: r.info,
		syntax: buildSyntaxMap(r),
	}
}

const buildSyntaxMap = (r: ResolvedTheme): Record<string, StyleDefinitionInput> => {
	const codeBg = r.backgroundPanel
	return {
		keyword: { fg: r.syntaxKeyword, bold: true },
		string: { fg: r.syntaxString },
		comment: { fg: r.syntaxComment, italic: true },
		number: { fg: r.syntaxNumber },
		function: { fg: r.syntaxFunction },
		type: { fg: r.syntaxType },
		operator: { fg: r.syntaxOperator },
		variable: { fg: r.syntaxVariable },
		property: { fg: r.syntaxFunction },
		"punctuation.bracket": { fg: r.syntaxPunctuation },
		"punctuation.delimiter": { fg: r.syntaxPunctuation },
		"punctuation.special": { fg: r.syntaxPunctuation },
		"markup.heading": { fg: r.markdownHeading, bold: true },
		"markup.heading.1": { fg: r.markdownHeading, bold: true, underline: true },
		"markup.heading.2": { fg: r.markdownHeading, bold: true },
		"markup.heading.3": { fg: r.markdownHeading },
		"markup.bold": { fg: r.markdownStrong, bold: true },
		"markup.strong": { fg: r.markdownStrong, bold: true },
		"markup.italic": { fg: r.markdownEmph, italic: true },
		// opentui's SyntaxStyle has no strikethrough attribute — best-effort:
		// dim + muted color so `~~strike~~` is at least visually distinguishable.
		"markup.strikethrough": { fg: r.textMuted, dim: true },
		"markup.list": { fg: r.markdownListItem },
		"markup.quote": { fg: r.markdownBlockQuote, italic: true },
		"markup.raw": { fg: r.markdownCode, bg: codeBg },
		"markup.raw.block": { fg: r.markdownCodeBlock, bg: codeBg },
		"markup.raw.inline": { fg: r.markdownCode, bg: codeBg },
		"markup.link": { fg: r.markdownLink, underline: true },
		"markup.link.label": { fg: r.markdownLinkText, underline: true },
		"markup.link.url": { fg: r.markdownLink, underline: true },
		label: { fg: r.markdownListItem },
		conceal: { fg: r.borderSubtle },
		default: { fg: r.markdownText },
	}
}

/**
 * Active flat palette. Components import `colors` and read tokens
 * directly. `setActiveTheme` mutates this in place so the reference stays
 * stable (no Provider/context).
 *
 * Initial value uses the all-fallback resolution; `setActiveTheme` is
 * called at boot from `index.tsx` before the React tree mounts.
 */
export const colors: ColorPalette = buildPalette(resolveTheme({ theme: {} }, "dark"))

export const setActiveTheme = (definition: ThemeDefinition, tone: Tone): void => {
	Object.assign(colors, buildPalette(resolveTheme(definition.source, tone)))
}
