#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveTheme } from "../src/theme/resolve.ts"
import type { ThemeJson, Tone } from "../src/theme/types.ts"

const SEMANTIC = [
	"primary",
	"secondary",
	"accent",
	"error",
	"warning",
	"success",
	"info",
	"selectedListItemText",
] as const

const dir = join(import.meta.dir, "../src/theme/themes")
const files = readdirSync(dir).filter((f) => f.endsWith(".json"))

const hexToRgb = (h: string): [number, number, number] => {
	const v = h.slice(1)
	return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
const channel = (c: number) => {
	const s = c / 255
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = (h: string) => {
	const [r, g, b] = hexToRgb(h)
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a: string, b: string) => {
	const la = lum(a)
	const lb = lum(b)
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
	return (hi + 0.05) / (lo + 0.05)
}

type Row = {
	theme: string
	tone: Tone
	collapses: string[]
	lowContrastVsBg: string[]
	bg: string
}

const rows: Row[] = []
for (const f of files) {
	const json = JSON.parse(readFileSync(join(dir, f), "utf-8")) as ThemeJson
	for (const tone of ["dark", "light"] as const) {
		const r = resolveTheme(json, tone)
		const collapses: string[] = []
		for (let i = 0; i < SEMANTIC.length; i++) {
			for (let j = i + 1; j < SEMANTIC.length; j++) {
				const a = SEMANTIC[i]!
				const b = SEMANTIC[j]!
				if (r[a] === r[b]) collapses.push(`${a}=${b}`)
			}
		}
		const lowContrastVsBg: string[] = []
		for (const t of SEMANTIC) {
			const c = contrast(r[t], r.background)
			if (c < 3.0) lowContrastVsBg.push(`${t}(${c.toFixed(2)})`)
		}
		rows.push({
			theme: f.replace(".json", ""),
			tone,
			collapses,
			lowContrastVsBg,
			bg: r.background,
		})
	}
}

const problem = rows.filter((r) => r.collapses.length > 0 || r.lowContrastVsBg.length > 0)
console.log(`\nThemes audited: ${files.length}  (${rows.length} theme/tone pairs)\n`)
console.log(`Pairs with issues: ${problem.length}\n`)

console.log("=".repeat(80))
console.log("COLLAPSED SEMANTIC TOKENS")
console.log("=".repeat(80))
for (const r of rows.filter((x) => x.collapses.length > 0)) {
	console.log(`${r.theme} [${r.tone}]: ${r.collapses.join(", ")}`)
}

console.log("\n" + "=".repeat(80))
console.log("LOW CONTRAST vs BACKGROUND (< 3.0 WCAG)")
console.log("=".repeat(80))
for (const r of rows.filter((x) => x.lowContrastVsBg.length > 0)) {
	console.log(`${r.theme} [${r.tone}] bg=${r.bg}: ${r.lowContrastVsBg.join(", ")}`)
}

console.log("\n" + "=".repeat(80))
console.log("CLEAN THEMES (no collapse, all semantic tokens >= 3.0 contrast)")
console.log("=".repeat(80))
const clean = rows.filter((r) => r.collapses.length === 0 && r.lowContrastVsBg.length === 0)
const byTheme = new Map<string, Tone[]>()
for (const r of clean) {
	const arr = byTheme.get(r.theme) ?? []
	arr.push(r.tone)
	byTheme.set(r.theme, arr)
}
for (const [t, tones] of byTheme) {
	if (tones.length === 2) console.log(`${t} (both)`)
	else console.log(`${t} (${tones[0]} only)`)
}
