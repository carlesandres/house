/**
 * Portable Markdown rendering API. Consumers provide Markdown text and own the page shell,
 * assets, file I/O, and optional browser enhancements.
 */

import GithubSlugger, { slug as githubSlug } from "github-slugger"
import { Lexer, Parser, Renderer, TextRenderer, walkTokens, type Token, type Tokens } from "marked"
import sanitizeHtml from "sanitize-html"
import { createMarkdownHighlighter, highlightAdmission, normalizeLanguage } from "./highlight.ts"

export { markdownHtmlCss } from "./styles.ts"

export interface MarkdownHeading {
	readonly id: string
	readonly level: number
	readonly text: string
}

export type MarkdownDiagnosticCode =
	| "highlight-block-limit"
	| "highlight-document-limit"
	| "highlight-unavailable"
	| "mermaid-block-limit"

export interface MarkdownDiagnostic {
	readonly code: MarkdownDiagnosticCode
	readonly blockIndex: number
}

export interface MarkdownRenderResult {
	readonly html: string
	readonly headings: readonly MarkdownHeading[]
	readonly hasMermaid: boolean
	readonly diagnostics: readonly MarkdownDiagnostic[]
}

export interface MarkdownRenderer {
	render(markdown: string): Promise<MarkdownRenderResult>
	dispose(): Promise<void>
}

export const MAX_MERMAID_UNITS = 50_000

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;"
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case '"':
				return "&quot;"
			default:
				return "&#39;"
		}
	})

const decodeText = (value: string): string =>
	value
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([\da-f]+);/gi, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")

const inlineOptions: sanitizeHtml.IOptions = {
	allowedTags: ["a", "code", "del", "em", "img", "strong", "sub", "sup"],
	allowedAttributes: {
		a: ["href", "title"],
		img: ["src", "alt", "title"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowedSchemesByTag: { img: ["http", "https"] },
	allowProtocolRelative: false,
}

const documentOptions: sanitizeHtml.IOptions = {
	allowedTags: [
		"a",
		"blockquote",
		"br",
		"code",
		"del",
		"details",
		"div",
		"em",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"img",
		"input",
		"kbd",
		"li",
		"ol",
		"p",
		"pre",
		"span",
		"strong",
		"sub",
		"summary",
		"sup",
		"table",
		"tbody",
		"td",
		"th",
		"thead",
		"tr",
		"ul",
	],
	allowedAttributes: {
		a: ["href", "title"],
		details: ["open"],
		img: ["src", "alt", "title", "width", "height"],
		input: ["type", "checked", "disabled"],
		ol: ["start"],
		td: ["align", "colspan", "rowspan"],
		th: ["align", "colspan", "rowspan"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowedSchemesByTag: { img: ["http", "https"] },
	allowProtocolRelative: false,
	transformTags: {
		input: (_tagName, attribs) => ({
			tagName: "input",
			attribs: {
				type: "checkbox",
				disabled: "disabled",
				...(attribs.checked === undefined ? {} : { checked: "checked" }),
			},
		}),
	},
	nonTextTags: ["script", "style", "textarea", "option", "noscript", "svg", "math"],
}

const visibleHeadingText = (tokens: Token[]): string =>
	decodeText(new Parser().parseInline(tokens, new TextRenderer())).replace(/\s+/g, " ").trim()

const slotId = (): string => `HOUSE_RENDER_SLOT_${crypto.randomUUID().replaceAll("-", "")}`

export const createMarkdownRenderer = (): MarkdownRenderer => {
	let lifecycle: "active" | "disposing" | "disposed" = "active"
	let activeRenders = 0
	let highlighterPromise: ReturnType<typeof createMarkdownHighlighter> | null = null
	const drained: Array<() => void> = []

	const acquireHighlighter = async () => {
		if (highlighterPromise === null) {
			highlighterPromise = createMarkdownHighlighter().catch((error) => {
				highlighterPromise = null
				throw error
			})
		}
		return highlighterPromise
	}

	const render = async (markdown: string): Promise<MarkdownRenderResult> => {
		if (lifecycle !== "active") throw new Error("Markdown renderer has been disposed")
		activeRenders += 1

		try {
			const tokens = Lexer.lex(markdown, { gfm: true })
			const slots = new Map<string, string>()
			const tokenSlots = new WeakMap<object, string>()
			const headings: MarkdownHeading[] = []
			const diagnostics: MarkdownDiagnostic[] = []
			const slugger = new GithubSlugger()
			const codeTokens: Tokens.Code[] = []
			let blockIndex = 0
			let admittedUnits = 0
			let hasMermaid = false

			walkTokens(tokens, (token: Token) => {
				if (token.type === "heading") {
					const heading = token as Tokens.Heading
					const inlineHtml = sanitizeHtml(Parser.parseInline(heading.tokens ?? []), inlineOptions)
					const text = visibleHeadingText(heading.tokens ?? [])
					const candidate = githubSlug(text)
					const id = slugger.slug(candidate.length === 0 ? "section" : text)
					const slot = slotId()
					headings.push({ id, level: heading.depth, text })
					slots.set(
						slot,
						`<h${heading.depth} id="${escapeHtml(id)}">${inlineHtml}</h${heading.depth}>`,
					)
					tokenSlots.set(token, slot)
				} else if (token.type === "code") {
					codeTokens.push(token as Tokens.Code)
				}
			})

			for (const token of codeTokens) {
				const currentIndex = blockIndex++
				const info = token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase()
				const slot = slotId()
				let fragment: string

				if (info === "mermaid") {
					hasMermaid = true
					const eligible = token.text.length <= MAX_MERMAID_UNITS
					if (!eligible) diagnostics.push({ code: "mermaid-block-limit", blockIndex: currentIndex })
					fragment = `<section class="markdown-html-mermaid" data-markdown-html-mermaid="true" data-mermaid-eligible="${eligible}"><details class="markdown-html-mermaid-source" open><summary>Diagram source</summary><pre><code>${escapeHtml(token.text)}</code></pre></details><div class="markdown-html-mermaid-diagram" role="img" aria-label="Mermaid diagram"></div>${eligible ? "" : '<p class="markdown-html-note">Diagram rendering skipped: source exceeds the preview limit.</p>'}</section>`
				} else {
					const language = normalizeLanguage(token.lang)
					const admission = highlightAdmission(token.text, admittedUnits)
					if (language === null) {
						fragment = `<pre><code>${escapeHtml(token.text)}</code></pre>`
					} else if (admission === "admit") {
						admittedUnits += token.text.length
						try {
							const highlighter = await acquireHighlighter()
							fragment = highlighter.codeToHtml(token.text, {
								lang: language,
								themes: { light: "github-light", dark: "github-dark" },
								defaultColor: "light",
							})
						} catch {
							diagnostics.push({ code: "highlight-unavailable", blockIndex: currentIndex })
							fragment = `<pre><code>${escapeHtml(token.text)}</code></pre><p class="markdown-html-note">Syntax highlighting unavailable.</p>`
						}
					} else {
						const reason =
							admission === "block-limit"
								? "Highlighting skipped: code block exceeds the preview limit."
								: admission === "document-limit"
									? "Highlighting skipped: document exceeds the preview limit."
									: null
						if (admission === "block-limit")
							diagnostics.push({ code: "highlight-block-limit", blockIndex: currentIndex })
						else if (admission === "document-limit")
							diagnostics.push({ code: "highlight-document-limit", blockIndex: currentIndex })
						fragment = `<pre><code>${escapeHtml(token.text)}</code></pre>${reason === null ? "" : `<p class="markdown-html-note">${reason}</p>`}`
					}
				}

				slots.set(slot, fragment)
				tokenSlots.set(token, slot)
			}

			const renderer = new Renderer()
			renderer.heading = (token) => tokenSlots.get(token) ?? ""
			renderer.code = (token) => tokenSlots.get(token) ?? ""
			let html = sanitizeHtml(Parser.parse(tokens, { renderer }), documentOptions)
			// Function replacer: a string replacement would interpret $$, $&, $', $`
			for (const [slot, fragment] of slots) html = html.replace(slot, () => fragment)

			return { html, headings, hasMermaid, diagnostics }
		} finally {
			activeRenders -= 1
			if (activeRenders === 0) for (const resolve of drained.splice(0)) resolve()
		}
	}

	const dispose = async (): Promise<void> => {
		if (lifecycle === "disposed") return
		if (lifecycle === "active") lifecycle = "disposing"
		if (activeRenders > 0) await new Promise<void>((resolve) => drained.push(resolve))
		const highlighter = await highlighterPromise?.catch(() => null)
		highlighter?.dispose()
		highlighterPromise = null
		lifecycle = "disposed"
	}

	return { render, dispose }
}
