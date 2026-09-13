import { describe, expect, test } from "bun:test"
import {
	highlightAdmission,
	MAX_CODE_LINES,
	MAX_CODE_UNITS,
	MAX_HIGHLIGHT_UNITS,
} from "../src/markdown-html/highlight.ts"
import { createMarkdownRenderer } from "../src/markdown-html/index.ts"

describe("markdown HTML renderer", () => {
	test("returns safe highlighted HTML through the standalone API", async () => {
		const renderer = createMarkdownRenderer()
		try {
			const result = await renderer.render(`
# Example

<script>alert("no")</script>
<details open><summary>More</summary><kbd>Enter</kbd></details>

\`\`\`ts
const answer: number = 42
\`\`\`
`)

			expect(result.html).toContain('<h1 id="example">Example</h1>')
			expect(result.html).toContain("shiki")
			expect(result.html).toContain("--shiki-dark")
			expect(result.html).toContain("<details open>")
			expect(result.html).toContain("<kbd>Enter</kbd>")
			expect(result.html).not.toContain("<script")
			expect(result.headings).toEqual([{ id: "example", level: 1, text: "Example" }])
			expect(result.hasMermaid).toBe(false)
		} finally {
			await renderer.dispose()
		}
	})

	test("isolates heading slugs across concurrent renders", async () => {
		const renderer = createMarkdownRenderer()
		try {
			const [first, second] = await Promise.all([
				renderer.render("# Usage\n# Usage"),
				renderer.render("# Usage"),
			])
			expect(first.headings.map(({ id }) => id)).toEqual(["usage", "usage-1"])
			expect(second.headings.map(({ id }) => id)).toEqual(["usage"])
		} finally {
			await renderer.dispose()
		}
	})

	test("creates stable heading metadata without trusting authored HTML", async () => {
		const renderer = createMarkdownRenderer()
		try {
			const result = await renderer.render(`
# Usage
# Usage
### Café \`API\` ![icon](https://example.com/icon.png)
# !
# ?
<h1 id="house-preview-origin">Raw heading</h1>
\`\`\`
# Not a heading
\`\`\`
`)
			expect(result.headings).toEqual([
				{ id: "usage", level: 1, text: "Usage" },
				{ id: "usage-1", level: 1, text: "Usage" },
				{ id: "café-api-icon", level: 3, text: "Café API icon" },
				{ id: "section", level: 1, text: "!" },
				{ id: "section-1", level: 1, text: "?" },
			])
			expect(result.html).toContain("<h1>Raw heading</h1>")
			expect(result.html).not.toContain('id="house-preview-origin"')
		} finally {
			await renderer.dispose()
		}
	})

	test("removes active content and unsafe URLs while retaining safe reading HTML", async () => {
		const renderer = createMarkdownRenderer()
		try {
			const result = await renderer.render(`
<a href="&#x6a;avascript:alert(1)" onclick="alert(1)" style="color:red" id="x">bad</a>
<a href="https://example.com">good</a>
<img src="data:text/html,bad" onerror="alert(1)">
<svg><script>alert(1)</script></svg>
<form><input autofocus></form>

- [x] done
`)
			expect(result.html).toContain('<a href="https://example.com">good</a>')
			expect(result.html).toContain(
				'<input type="checkbox" disabled="disabled" checked="checked" />',
			)
			expect(result.html).not.toMatch(
				/javascript:|onclick|style=|id=|data:text|<svg|<script|<form|autofocus/,
			)
		} finally {
			await renderer.dispose()
		}
	})

	test("preserves unknown, oversized and Mermaid source", async () => {
		const renderer = createMarkdownRenderer()
		try {
			const oversized = "x".repeat(100_001)
			const result = await renderer.render(
				`\`\`\`unknown\n<hello>\n\`\`\`\n\n\`\`\`ts\n${oversized}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\``,
			)
			expect(result.html).toContain("&lt;hello&gt;")
			expect(result.html).toContain("Highlighting skipped: code block exceeds the preview limit")
			expect(result.html).toContain('data-markdown-html-mermaid="true"')
			expect(result.html).toContain("flowchart LR")
			expect(result.hasMermaid).toBe(true)
			expect(result.diagnostics.map(({ code }) => code)).toContain("highlight-block-limit")
		} finally {
			await renderer.dispose()
		}
	})

	test("applies line and cumulative highlighting limits at their boundaries", () => {
		const exactLines = Array.from({ length: MAX_CODE_LINES }, () => "x").join("\n")
		expect(highlightAdmission(exactLines, 0)).toBe("admit")
		expect(highlightAdmission(`${exactLines}\nx`, 0)).toBe("block-limit")
		expect(highlightAdmission("x".repeat(MAX_CODE_UNITS), 0)).toBe("admit")
		expect(highlightAdmission("x".repeat(MAX_CODE_UNITS + 1), 0)).toBe("block-limit")
		expect(highlightAdmission("x", MAX_HIGHLIGHT_UNITS - 1)).toBe("admit")
		expect(highlightAdmission("xx", MAX_HIGHLIGHT_UNITS - 1)).toBe("document-limit")
	})

	test("rejects new renders after disposal starts", async () => {
		const renderer = createMarkdownRenderer()
		await renderer.dispose()
		await expect(renderer.render("hello")).rejects.toThrow("disposed")
	})

	test("disposal drains a render that was already accepted", async () => {
		const renderer = createMarkdownRenderer()
		const rendering = renderer.render("```ts\nconst accepted = true\n```")
		const disposing = renderer.dispose()
		const result = await rendering
		expect(result.html).toContain("shiki")
		await disposing
		await expect(renderer.render("again")).rejects.toThrow("disposed")
	})
})
