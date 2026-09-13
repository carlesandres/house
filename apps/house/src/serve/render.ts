import {
	createMarkdownRenderer,
	markdownHtmlCss,
	type MarkdownHeading,
} from "../markdown-html/index.ts"
import { css } from "./css.ts"

const defaultRenderer = createMarkdownRenderer()

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

interface ContentsNode {
	readonly heading: MarkdownHeading
	readonly children: ContentsNode[]
}

const contentsTree = (headings: readonly MarkdownHeading[]): ContentsNode[] => {
	const roots: ContentsNode[] = []
	const stack: ContentsNode[] = []
	for (const heading of headings) {
		const node: ContentsNode = { heading, children: [] }
		while (stack.length > 0 && stack.at(-1)!.heading.level >= heading.level) stack.pop()
		const parent = stack.at(-1)
		if (parent === undefined) roots.push(node)
		else parent.children.push(node)
		stack.push(node)
	}
	return roots
}

const renderContentsList = (nodes: readonly ContentsNode[]): string =>
	`<ol>${nodes
		.map(({ heading, children }) => {
			const label = heading.text || "Untitled section"
			const nested = children.length === 0 ? "" : renderContentsList(children)
			return `<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(label)}</a>${nested}</li>`
		})
		.join("")}</ol>`

const renderContents = (headings: readonly MarkdownHeading[]): string => {
	if (headings.length < 2) return ""
	return `<details class="preview-contents"><summary>Contents</summary><nav aria-label="Document contents">${renderContentsList(contentsTree(headings))}</nav></details>`
}

export interface RenderHtmlOptions {
	readonly clientAssetPath?: string
	readonly mermaidAssetPath?: string
	readonly origin?: string
	readonly renderer?: ReturnType<typeof createMarkdownRenderer>
}

export const renderHtml = async (
	markdown: string,
	title: string,
	options: RenderHtmlOptions = {},
): Promise<string> => {
	const result = await (options.renderer ?? defaultRenderer).render(markdown)
	const clientScript =
		options.clientAssetPath === undefined
			? ""
			: `<script type="module" src="${escapeHtml(options.clientAssetPath)}"></script>`
	const originMeta =
		options.origin === undefined
			? ""
			: `<meta name="house-preview-origin" content="${escapeHtml(options.origin)}">`
	const mermaidMeta =
		result.hasMermaid && options.mermaidAssetPath !== undefined
			? `<meta name="house-mermaid-asset" content="${escapeHtml(options.mermaidAssetPath)}">`
			: ""

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${originMeta}
${mermaidMeta}
<title>${escapeHtml(title)}</title>
<style>${css}\n${markdownHtmlCss}</style>
</head>
<body>
<main>
${renderContents(result.headings)}
<article class="markdown-html">${result.html}</article>
</main>
${clientScript}
</body>
</html>`
}
