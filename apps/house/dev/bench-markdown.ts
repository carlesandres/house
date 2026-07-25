#!/usr/bin/env bun
/**
 * Microbenchmark: how long does a single <markdown> content swap take?
 *
 * Usage:
 *   bun run dev/bench-markdown.ts <path-to-md-file> [...more-files]
 *
 * Walks the given files (or .md files in a directory), creates one
 * MarkdownRenderable, swaps `content` to each in turn, and reports
 * milliseconds per swap.
 */

import { readFile, stat } from "node:fs/promises"
import { MarkdownRenderable, parseColor, SyntaxStyle } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { walkToArray } from "../src/discovery/walk.ts"

const args = Bun.argv.slice(2)
if (args.length === 0) {
	console.error("usage: bun run dev/bench-markdown.ts <file-or-dir> [...]")
	process.exit(2)
}

const collectFiles = async (paths: readonly string[]): Promise<string[]> => {
	const out: string[] = []
	for (const p of paths) {
		const s = await stat(p)
		if (s.isDirectory()) {
			const found = await Effect.runPromise(walkToArray(p))
			out.push(...found.map((f) => f.path))
		} else {
			out.push(p)
		}
	}
	return out
}

const styles = {
	keyword: { fg: parseColor("#81A1C1"), bold: true },
	string: { fg: parseColor("#A3BE8C") },
	comment: { fg: parseColor("#616E88") },
	number: { fg: parseColor("#B48EAD") },
	function: { fg: parseColor("#88C0D0") },
	type: { fg: parseColor("#8FBCBB") },
	operator: { fg: parseColor("#81A1C1") },
	variable: { fg: parseColor("#D8DEE9") },
	property: { fg: parseColor("#88C0D0") },
	"punctuation.bracket": { fg: parseColor("#ECEFF4") },
	"punctuation.delimiter": { fg: parseColor("#ECEFF4") },
	"markup.heading": { fg: parseColor("#88C0D0"), bold: true },
	"markup.heading.1": { fg: parseColor("#8FBCBB"), bold: true, underline: true },
	"markup.heading.2": { fg: parseColor("#88C0D0"), bold: true },
	"markup.heading.3": { fg: parseColor("#81A1C1") },
	"markup.bold": { fg: parseColor("#ECEFF4"), bold: true },
	"markup.strong": { fg: parseColor("#ECEFF4"), bold: true },
	"markup.italic": { fg: parseColor("#ECEFF4") },
	"markup.list": { fg: parseColor("#EBCB8B") },
	"markup.quote": { fg: parseColor("#81A1C1") },
	"markup.raw": { fg: parseColor("#A3BE8C"), bg: parseColor("#3B4252") },
	"markup.raw.block": { fg: parseColor("#A3BE8C"), bg: parseColor("#3B4252") },
	"markup.raw.inline": { fg: parseColor("#A3BE8C"), bg: parseColor("#3B4252") },
	"markup.link": { fg: parseColor("#88C0D0"), underline: true },
	"markup.link.label": { fg: parseColor("#A3BE8C"), underline: true },
	"markup.link.url": { fg: parseColor("#88C0D0"), underline: true },
	label: { fg: parseColor("#A3BE8C") },
	conceal: { fg: parseColor("#4C566A") },
	"punctuation.special": { fg: parseColor("#616E88") },
	default: { fg: parseColor("#D8DEE9") },
}

const files = await collectFiles(args)
console.log(`Benchmarking ${files.length} files at 100×30 viewport...\n`)

const { renderer, renderOnce } = await createTestRenderer({ width: 100, height: 30 })
const syntaxStyle = SyntaxStyle.fromStyles(styles)

const md = new MarkdownRenderable(renderer, {
	id: "bench",
	content: "",
	syntaxStyle,
	fg: "#D8DEE9",
	bg: "#2E3440",
	conceal: true,
	width: "100%",
})
renderer.root.add(md)

// Warm up: opentui lazy-loads tree-sitter parsers on first render.
md.content = "# warmup\n\n```ts\nconst x = 1\n```\n"
await renderOnce()

const measurements: Array<{ path: string; bytes: number; ms: number }> = []

for (const path of files) {
	const text = await readFile(path, "utf8")
	const t0 = performance.now()
	md.content = text
	await renderOnce()
	const ms = performance.now() - t0
	measurements.push({ path, bytes: Buffer.byteLength(text, "utf8"), ms })
}

measurements.sort((a, b) => b.ms - a.ms)
const total = measurements.reduce((s, m) => s + m.ms, 0)
const avg = total / measurements.length
const p50 = measurements[Math.floor(measurements.length / 2)]?.ms ?? 0
const p95 = measurements[Math.floor(measurements.length * 0.95)]?.ms ?? 0

console.log(`n=${measurements.length}  total=${total.toFixed(1)}ms  avg=${avg.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms\n`)
console.log("slowest 10:")
for (const m of measurements.slice(0, 10)) {
	console.log(`  ${m.ms.toFixed(1).padStart(6)}ms  ${(m.bytes / 1024).toFixed(1).padStart(5)}KB  ${m.path}`)
}

renderer.destroy()
