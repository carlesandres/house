import type {
	ColorValue,
	HexColor,
	ResolvedTheme,
	ThemeJson,
	ThemeTokens,
	TokenName,
	Tone,
} from "./types.ts"

/**
 * Hard-coded safe defaults for every UI / markdown / syntax token. Used when
 * a theme JSON omits a token entirely (validation is permissive — opencode
 * does the same). Fallback values are reasonable greys so the app stays
 * legible even with a near-empty theme.
 */
const HARD_FALLBACK_RAW: Readonly<Record<TokenName, HexColor>> = {
	primary: "#7AA2F7",
	secondary: "#9ECE6A",
	accent: "#BB9AF7",
	error: "#F7768E",
	warning: "#E0AF68",
	success: "#9ECE6A",
	info: "#7DCFFF",
	text: "#D8DEE9",
	textMuted: "#7B8794",
	selectedListItemText: "#FFFFFF",
	background: "#1A1B26",
	backgroundPanel: "#24283B",
	backgroundElement: "#414868",
	border: "#3B4261",
	borderActive: "#7AA2F7",
	borderSubtle: "#292E42",
	markdownText: "#D8DEE9",
	markdownHeading: "#7AA2F7",
	markdownLink: "#7DCFFF",
	markdownLinkText: "#7AA2F7",
	markdownCode: "#9ECE6A",
	markdownBlockQuote: "#7B8794",
	markdownEmph: "#E0AF68",
	markdownStrong: "#FFFFFF",
	markdownHorizontalRule: "#7B8794",
	markdownListItem: "#7AA2F7",
	markdownListEnumeration: "#BB9AF7",
	markdownImage: "#7DCFFF",
	markdownImageText: "#BB9AF7",
	markdownCodeBlock: "#D8DEE9",
	syntaxComment: "#7B8794",
	syntaxKeyword: "#7AA2F7",
	syntaxFunction: "#7DCFFF",
	syntaxVariable: "#D8DEE9",
	syntaxString: "#9ECE6A",
	syntaxNumber: "#BB9AF7",
	syntaxType: "#E0AF68",
	syntaxOperator: "#7AA2F7",
	syntaxPunctuation: "#D8DEE9",
}

const HEX_RE_INIT = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const lowerHex = (hex: HexColor): HexColor => {
	const v = hex.replace("#", "")
	const expanded =
		v.length === 3 || v.length === 4
			? v
					.split("")
					.map((c) => c + c)
					.join("")
			: v
	const rgb = expanded.length === 8 ? expanded.slice(0, 6) : expanded
	return `#${rgb.toLowerCase()}` as HexColor
}
// Sanity: ensure HARD_FALLBACK_RAW matches the hex regex (catch a typo at load).
for (const v of Object.values(HARD_FALLBACK_RAW)) {
	if (!HEX_RE_INIT.test(v)) throw new Error(`bad fallback hex: ${v}`)
}
const HARD_FALLBACK: Readonly<Record<TokenName, HexColor>> = Object.fromEntries(
	Object.entries(HARD_FALLBACK_RAW).map(([k, v]) => [k, lowerHex(v)]),
) as Readonly<Record<TokenName, HexColor>>

/**
 * Tokens that fall back to another token (rather than `HARD_FALLBACK`) when
 * the theme omits them. Mirrors opencode's resolve behavior.
 */
const TOKEN_FALLBACK: Partial<Record<TokenName, TokenName>> = {
	selectedListItemText: "text",
	markdownText: "text",
	markdownCodeBlock: "text",
	borderSubtle: "border",
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const isHex = (value: string): value is HexColor => HEX_RE.test(value)

/** Normalize a hex value to `#rrggbb` (lowercase, 6-digit). */
const normalizeHex = (value: HexColor): HexColor => {
	const v = value.replace("#", "")
	const expanded =
		v.length === 3 || v.length === 4
			? v
					.split("")
					.map((c) => c + c)
					.join("")
			: v
	const rgb = expanded.length === 8 ? expanded.slice(0, 6) : expanded
	return `#${rgb.toLowerCase()}` as HexColor
}

/**
 * Resolve a single side of a {dark,light} variant — i.e. a string that's
 * either a hex literal or a name in the theme's `defs` map. Returns `null`
 * if the input doesn't resolve (caller falls back).
 */
const resolveSide = (value: string, defs: Record<string, string>): HexColor | null => {
	if (isHex(value)) return normalizeHex(value)
	const looked = defs[value]
	if (looked && isHex(looked)) return normalizeHex(looked)
	return null
}

/** Resolve a single ColorValue (variant, hex, or defs ref) for a tone. */
export const resolveColorValue = (
	value: ColorValue | undefined,
	tone: Tone,
	defs: Record<string, string> = {},
): HexColor | null => {
	if (value === undefined) return null
	if (typeof value === "string") return resolveSide(value, defs)
	const side = value[tone]
	return resolveSide(side, defs)
}

/**
 * Resolve a theme JSON to a flat record of `{ token → #rrggbb }` for the
 * given tone. Missing tokens fall back via `TOKEN_FALLBACK` (chained) and
 * ultimately `HARD_FALLBACK`.
 */
export const resolveTheme = (theme: ThemeJson, tone: Tone): ResolvedTheme => {
	const defs = theme.defs ?? {}
	const out: Partial<Record<TokenName, HexColor>> = {}

	const tokenNames = Object.keys(HARD_FALLBACK) as readonly TokenName[]
	const seen = new Set<TokenName>()
	const resolveOne = (name: TokenName): HexColor => {
		if (seen.has(name)) return HARD_FALLBACK[name]
		seen.add(name)
		const direct = resolveColorValue(theme.theme[name], tone, defs)
		if (direct) return direct
		const fallback = TOKEN_FALLBACK[name]
		if (fallback) return resolveOne(fallback)
		return HARD_FALLBACK[name]
	}

	for (const name of tokenNames) {
		seen.clear()
		out[name] = resolveOne(name)
	}
	return out as ResolvedTheme
}

/** Permissive runtime validation: any object with a `theme` object passes. */
export const isThemeJson = (value: unknown): value is ThemeJson => {
	if (typeof value !== "object" || value === null) return false
	const v = value as Record<string, unknown>
	return typeof v["theme"] === "object" && v["theme"] !== null
}

export type { ThemeTokens }
