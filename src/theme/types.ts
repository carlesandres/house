import type { StyleDefinitionInput } from "@opentui/core"

export type HexColor = `#${string}`
export type RefName = string

/**
 * A token's value. Either a literal hex (`"#abcdef"`), a reference to an
 * entry in the theme's `defs` block (`"nord8"`), or a `{dark, light}`
 * variant where each side is itself a hex or a defs ref.
 */
export type ColorValue = HexColor | RefName | { readonly dark: string; readonly light: string }

/** Light or dark mode selector. Each theme JSON pairs both. */
export type Tone = "dark" | "light"

/**
 * The complete house token surface. Adapted from opencode's TUI theme
 * (see reference/opencode/.../tui/context/theme/) by dropping the `diff*`
 * cluster, `backgroundMenu`, and `thinkingOpacity` (none of which are
 * reachable in a markdown reader).
 */
export interface ThemeTokens {
	// UI semantics
	readonly primary: ColorValue
	readonly secondary: ColorValue
	readonly accent: ColorValue
	readonly error: ColorValue
	readonly warning: ColorValue
	readonly success: ColorValue
	readonly info: ColorValue
	readonly text: ColorValue
	readonly textMuted: ColorValue
	readonly selectedListItemText?: ColorValue
	readonly background: ColorValue
	readonly backgroundPanel: ColorValue
	readonly backgroundElement: ColorValue
	readonly border: ColorValue
	readonly borderActive: ColorValue
	readonly borderSubtle: ColorValue
	// Markdown rendering
	readonly markdownText: ColorValue
	readonly markdownHeading: ColorValue
	readonly markdownLink: ColorValue
	readonly markdownLinkText: ColorValue
	readonly markdownCode: ColorValue
	readonly markdownBlockQuote: ColorValue
	readonly markdownEmph: ColorValue
	readonly markdownStrong: ColorValue
	readonly markdownHorizontalRule: ColorValue
	readonly markdownListItem: ColorValue
	readonly markdownListEnumeration: ColorValue
	readonly markdownImage: ColorValue
	readonly markdownImageText: ColorValue
	readonly markdownCodeBlock: ColorValue
	// Fenced-code syntax
	readonly syntaxComment: ColorValue
	readonly syntaxKeyword: ColorValue
	readonly syntaxFunction: ColorValue
	readonly syntaxVariable: ColorValue
	readonly syntaxString: ColorValue
	readonly syntaxNumber: ColorValue
	readonly syntaxType: ColorValue
	readonly syntaxOperator: ColorValue
	readonly syntaxPunctuation: ColorValue
}

/** Raw on-disk shape for a theme JSON file. */
export interface ThemeJson {
	readonly $schema?: string
	readonly name?: string
	readonly defs?: Record<string, string>
	readonly theme: Partial<ThemeTokens>
}

/** Token names that consumers may reference. */
export type TokenName = keyof ThemeTokens

/**
 * Flat record after `resolveTheme`: every token has a concrete `#rrggbb`
 * value with the requested tone applied and defs refs resolved.
 */
export type ResolvedTheme = Readonly<Record<TokenName, HexColor>>

/**
 * The flat color object consumed by Browser/HelpOverlay/index. Uses the
 * OpenCode-aligned UI token names directly (`background`, `backgroundPanel`,
 * `backgroundElement`, `borderSubtle`, `primary`, `secondary`, …). Values
 * come from `colors.ts`'s adapter, which maps `ResolvedTheme` → this shape.
 */
export interface ColorPalette {
	readonly background: string
	readonly backgroundPanel: string
	readonly backgroundElement: string
	readonly text: string
	readonly textMuted: string
	readonly border: string
	readonly borderActive: string
	readonly borderSubtle: string
	readonly selectedListItemText: string
	readonly primary: string
	readonly secondary: string
	readonly accent: string
	readonly error: string
	readonly warning: string
	readonly success: string
	readonly info: string
	readonly syntax: Record<string, StyleDefinitionInput>
}

/** Registry entry for a theme; what the loader returns. */
export interface ThemeDefinition {
	readonly id: string
	readonly name: string
	readonly source: ThemeJson
}
