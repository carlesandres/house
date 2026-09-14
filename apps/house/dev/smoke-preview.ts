#!/usr/bin/env bun
/// <reference lib="dom" />

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "playwright"
import { startServer } from "../src/serve/server.ts"

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

const launchBrowser = async (): Promise<Browser> => {
	try {
		return await chromium.launch({ headless: true })
	} catch (error) {
		if (process.platform === "darwin") return chromium.launch({ channel: "chrome", headless: true })
		throw error
	}
}

const fixture = `# Browser preview

## Highlighting

\`\`\`ts
const answer: number = 42
\`\`\`

## Flowchart

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[HTML]
\`\`\`

## Sequence

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi
\`\`\`

## Class

\`\`\`mermaid
classDiagram
  Reader --> Document
\`\`\`

## Invalid source remains readable

\`\`\`mermaid
this is not a diagram
\`\`\`
`

const directory = await mkdtemp(join(tmpdir(), "house-preview-smoke-"))
const markdownPath = join(directory, "preview.md")
const plainPath = join(directory, "plain.md")
await writeFile(markdownPath, fixture)
await writeFile(plainPath, "# Plain preview\n")

const server = startServer({ path: markdownPath })
let browser: Browser | null = null

try {
	browser = await launchBrowser()
	const context = await browser.newContext({
		colorScheme: "dark",
		viewport: { width: 1440, height: 900 },
	})
	const page = await context.newPage()
	await page.route("**/*", async (route) => {
		const hostname = new URL(route.request().url()).hostname
		if (hostname === "localhost" || hostname === "127.0.0.1") await route.continue()
		else await route.abort()
	})
	const response = await page.goto(server.url)
	assert(response?.status() === 200, "preview page did not return 200")
	assert(
		response.headers()["content-security-policy"]?.includes("script-src 'self'"),
		"preview CSP does not restrict scripts to the local origin",
	)

	const secondBlock = page.locator(".markdown-html-mermaid").nth(1)
	await page.waitForFunction(
		() =>
			document.querySelectorAll(".markdown-html-mermaid")[1]?.getAttribute("data-mermaid-state") ===
			"pending",
	)
	await secondBlock.locator("summary").dispatchEvent("pointerdown")
	await page.waitForFunction(
		() => document.querySelectorAll(".markdown-html-mermaid-diagram svg").length === 3,
		undefined,
		{ timeout: 15_000 },
	)
	await page.waitForSelector('[data-markdown-html-mermaid-state="complete"]')
	assert(
		(await page.locator(".markdown-html-mermaid-diagram svg").count()) === 3,
		"expected three SVG diagrams",
	)
	assert(
		(await page.locator(".markdown-html-diagram-error").count()) === 1,
		"invalid Mermaid should produce one local error",
	)
	assert(
		(await page.locator(".markdown-html-mermaid-source").nth(1).getAttribute("open")) !== null,
		"diagram source interaction was not preserved",
	)
	assert(
		(await page.locator(".markdown-html-mermaid-source").last().getAttribute("open")) !== null,
		"invalid Mermaid source should remain open",
	)
	assert(
		(await page.locator(".preview-contents").getAttribute("open")) === null,
		"contents should start collapsed",
	)
	assert((await page.locator(".shiki").count()) === 1, "expected one highlighted code block")
	const diagramPanel = page.locator(".markdown-html-mermaid-diagram").first()
	const initialPanel = await diagramPanel.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	)
	await page.emulateMedia({ colorScheme: "light" })
	const changedPanel = await diagramPanel.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	)
	assert(initialPanel === changedPanel, "diagram panel changed tone without rerendering its SVG")
	const isolated = await page.evaluate(async () => {
		const markup =
			'<section data-markdown-html-mermaid="true" data-mermaid-eligible="true"><details class="markdown-html-mermaid-source" open><summary>Diagram source</summary><pre><code>flowchart LR\nA--&gt;B</code></pre></details><div class="markdown-html-mermaid-diagram"></div></section>'
		const target = document.createElement("article")
		const untouched = document.createElement("article")
		target.className = "markdown-html"
		untouched.className = "markdown-html"
		target.innerHTML = markup
		untouched.innerHTML = markup
		document.body.append(target, untouched)
		const asset = document.querySelector<HTMLMetaElement>(
			'meta[name="house-mermaid-asset"]',
		)!.content
		const module = (await import(asset)) as typeof import("../src/markdown-html/browser.ts")
		const enhancement = module.enhanceMermaid(target, { tone: "light" })
		await enhancement.done
		const result = {
			target: target.querySelectorAll("svg").length,
			untouched: untouched.querySelectorAll("svg").length,
		}
		enhancement.cleanup()
		target.remove()
		untouched.remove()
		return result
	})
	assert(
		isolated.target === 1 && isolated.untouched === 0,
		"enhancer escaped its caller-owned root",
	)

	await page.setViewportSize({ width: 320, height: 844 })
	const widths = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		scroll: document.documentElement.scrollWidth,
	}))
	assert(widths.client === widths.scroll, "preview has page-wide overflow at 320px")

	server.setTarget(plainPath)
	await page.waitForTimeout(200)
	const plainRequests: string[] = []
	page.on("request", (request) => plainRequests.push(request.url()))
	await page.goto(server.url)
	await page.waitForTimeout(100)
	assert(
		(await page.locator('meta[name="house-mermaid-asset"]').count()) === 0,
		"plain page advertises Mermaid",
	)
	assert(
		plainRequests.every((url) => !url.includes("/browser-")),
		"plain page requested the Mermaid entry asset",
	)
	await context.close()

	server.setTarget(markdownPath)
	const noScript = await browser.newContext({
		colorScheme: "dark",
		javaScriptEnabled: false,
		viewport: { width: 390, height: 844 },
	})
	const staticPage = await noScript.newPage()
	await staticPage.goto(server.url)
	assert((await staticPage.locator(".shiki").count()) === 1, "highlighting should be static HTML")
	assert(
		(await staticPage.locator(".preview-contents").count()) === 1,
		"contents should work without JavaScript",
	)
	assert(
		(await staticPage.locator(".markdown-html-mermaid-source[open]").count()) === 4,
		"diagram source should be open without JavaScript",
	)
	assert((await staticPage.locator("svg").count()) === 0, "Mermaid SVG should require enhancement")
	await noScript.close()

	console.log("preview browser smoke passed")
} finally {
	await browser?.close()
	await server.stop()
	await rm(directory, { force: true, recursive: true })
}
