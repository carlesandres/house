import type { StyleDefinitionInput } from "@opentui/core"
import { resolveTheme } from "./resolve.ts"
import type { ColorPalette, ResolvedTheme, ThemeDefinition, Tone } from "./types.ts"

/**
 * Adapt a resolved theme (opencode-shaped flat tokens) to the
 * {@link ColorPalette} shape consumed by Browser / HelpOverlay / index.
 *
 * - UI tokens map name-for-name where they overlap.
 * - `surface` ← `backgroundPanel`, `selectedBg` ← `backgroundElement`,
 *   `selectedBgInactive` ← `borderSubtle`.
 * - `textStrong` ← `primary` (opencode's convention for emphasized brand
 *   text in UI chrome). Markdown rendering still reads `markdownStrong`
 *   directly via the syntax map.
 * - `syntax` is a fully populated opentui tree-sitter scope map built from
 *   `markdown*` and `syntax*` tokens.
 */
/** Relative luminance of a `#rrggbb` color (0..1). Sufficient for ordering
 *  two near-neutral chrome colors — not a full WCAG contrast calculation.
 *  Non-hex inputs fall back to 0.5 so the caller's ordering is a no-op. */
const luminance = (hex: string): number => {
	const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
	if (!m) return 0.5
	const h = m[1]!
	const r = parseInt(h.slice(0, 2), 16)
	const g = parseInt(h.slice(2, 4), 16)
	const b = parseInt(h.slice(4, 6), 16)
	// Rec. 601 weighting — perceptual ordering, not the linearized WCAG variant.
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Pane chrome assumes the active/raised pane sits on the darker of the two
 *  background tokens and the dim chrome on the lighter one. Most themes
 *  define `background` darker than `backgroundPanel` and this is a no-op;
 *  some (e.g. cursor) flip the polarity, in which case we swap so the
 *  active-pane convention stays consistent across themes. */
const orientChrome = (r: ResolvedTheme): { raised: string; dim: string } => {
	const bg = r.background
	const panel = r.backgroundPanel
	return luminance(bg) <= luminance(panel) ? { raised: bg, dim: panel } : { raised: panel, dim: bg }
}

const buildPalette = (r: ResolvedTheme): ColorPalette => {
	const { raised, dim } = orientChrome(r)
	return {
		background: raised,
		surface: dim,
		text: r.text,
		textStrong: r.primary,
		textMuted: r.textMuted,
		border: r.border,
		borderActive: r.borderActive,
		selectedBg: r.backgroundElement,
		selectedBgInactive: r.borderSubtle,
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
